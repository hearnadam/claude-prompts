import { parse } from '@babel/parser';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const RAW_DIR = path.join(ROOT, 'raw');
const INDEX_FILE = path.join(ROOT, 'claude-prompts.md');
const MIN_PROMPT_LENGTH = 240;

function run(cmd, args, opts = {}) {
  return childProcess.execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function nativePackageName() {
  const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : null;
  if (!arch) return null;
  if (process.platform === 'darwin') return `claude-code-darwin-${arch}`;
  if (process.platform === 'linux') return `claude-code-linux-${arch}`;
  if (process.platform === 'win32') return `claude-code-win32-${arch}`;
  return null;
}

function resolveClaudeBinary() {
  const nativePackage = nativePackageName();
  const candidates = [
    process.env.CLAUDE_BIN,
    nativePackage && path.join(ROOT, 'node_modules', '@anthropic-ai', nativePackage, process.platform === 'win32' ? 'claude.exe' : 'claude'),
    path.join(ROOT, 'node_modules', '@anthropic-ai', 'claude-code', 'cli-wrapper.cjs'),
    path.join(ROOT, 'node_modules', '.bin', 'claude'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  const global = run('sh', ['-lc', 'command -v claude']).trim();
  if (!global) throw new Error('Could not find claude on PATH. Set CLAUDE_BIN or install Claude Code.');
  return fs.realpathSync(global);
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72)
    .replace(/^-|-$/g, '') || 'prompt';
}

function printableAscii(byte) {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}

function extractJavaScriptChunks(buffer) {
  const chunks = [];
  let start = -1;
  for (let i = 0; i <= buffer.length; i += 1) {
    const ok = i < buffer.length && printableAscii(buffer[i]);
    if (ok && start === -1) start = i;
    if ((!ok || i === buffer.length) && start !== -1) {
      const length = i - start;
      if (length >= 50_000) {
        const text = buffer.subarray(start, i).toString('utf8');
        if (text.includes('You are') || text.includes('__create=Object.create') || text.includes('@bun')) {
          chunks.push({ offset: start, length, text });
        }
      }
      start = -1;
    }
  }
  return chunks;
}

function normalizeText(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stringValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateElement') return node.value.cooked ?? node.value.raw;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  }
  return null;
}

function arrayText(node) {
  if (!node || node.type !== 'ArrayExpression') return null;
  const parts = [];
  for (const element of node.elements) {
    const value = stringValue(element);
    if (typeof value !== 'string') return null;
    parts.push(value);
  }
  return parts.join('\n');
}

function isPromptLike(text, sourceKind) {
  const normalized = normalizeText(text);
  if (normalized.length < MIN_PROMPT_LENGTH) return false;

  const startsLikePrompt = /^(?:<[^>]+>\s*)?(You are|Your task is|You will|We need|Analyze this|Given the following|System Reminder:)/i.test(normalized);
  const hasPromptSection = /(^|\n)#{1,3}\s*(Role|Goal|Task|Instructions|Guidelines)|(^|\n)(?:Role|Goal|Task|Instructions|Guidelines):/i.test(normalized);
  if (!startsLikePrompt && !hasPromptSection) return false;

  if (/using your overages|using your subscription|highest Max subscription plan|not in plan mode/i.test(normalized)) return false;
  if (/^(Read browser|Take a higher-resolution screenshot|The directory to search in|IMPORTANT: You \*may\* attempt)/i.test(normalized)) return false;
  if (sourceKind === 'StringLiteral' && !/^You are/i.test(normalized) && normalized.split('\n').length < 4) return false;

  const lines = normalized.split('\n').filter((line) => line.trim().length > 0).length;
  const sentences = normalized.split(/[.!?](?:\s|$)/).filter((part) => part.trim().length > 24).length;
  return lines >= 4 || sentences >= 4 || normalized.length >= 600;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function markdownTitle(text) {
  const title = text.match(/^#\s+([^\n{}]+)/m)?.[1]?.trim();
  if (!title) return null;
  if (/^phase \d+/i.test(title)) return title;
  if (/^[a-z][a-z0-9_-]*$/i.test(title) && title.length <= 40) return title;
  return null;
}

function inferName(text) {
  const lower = text.toLowerCase();
  const title = markdownTitle(text);
  const rules = [
    [/analyze this claude code session and extract structured facets/, 'usage-session-facets'],
    [/describe the user's interaction style/, 'usage-interaction-style'],
    [/find a memorable moment/, 'usage-memorable-moment'],
    [/identify friction points/, 'usage-friction-points'],
    [/identify future opportunities/, 'usage-future-opportunities'],
    [/identify project areas/, 'usage-project-areas'],
    [/identify what's working well/, 'usage-working-well'],
    [/suggest improvements/, 'usage-improvements'],
    [/onboarding guide for teammates/, 'onboarding-guide-generator'],
    [/status line setup agent|statusline command/, 'status-line-setup-agent'],
    [/succinct title and git branch name/, 'session-title-branch-generator'],
    [/evaluating a stop-condition hook/, 'stop-condition-evaluator'],
    [/evaluating a hook condition/, 'hook-condition-evaluator'],
    [/searching for past claude code conversation sessions/, 'conversation-search-agent'],
    [/detailed summary of the conversation so far/, 'conversation-summary-continuation'],
    [/detailed summary of this conversation/, 'conversation-summary-session'],
    [/security monitor for autonomous ai coding agents/, 'security-monitor-agent'],
    [/# teamcreate|use this tool proactively whenever/, 'team-create'],
    [/# skillify|capturing this session's repeatable process as a reusable skill/, 'skill-generator'],
    [/phase 4: final plan|write your final plan to the plan file/, 'plan-finalizer'],
    [/subagent spawned by a workflow orchestration script/, 'workflow-subagent'],
    [/non-interactive mode and cannot return a response/, 'team-shutdown-reminder'],
    [/your strengths:\n- searching for code/, 'codebase-search-specialist'],
    [/date\/time parser|iso 8601/, 'date-time-parser'],
    [/expert reviewer of auto mode classifier rules/, 'auto-mode-classifier-reviewer'],
    [/file search specialist/, 'file-search-specialist'],
    [/software architect and planning specialist/, 'planning-specialist'],
    [/summarizing conversations|conversation summary/, 'conversation-summarizer'],
    [/claude code, anthropic's official cli/, 'claude-code'],
    [/claude agent sdk/, 'claude-agent-sdk'],
    [/code reviewer/, 'code-reviewer'],
    [/pr title|pull request/, 'pull-request-helper'],
    [/commit message/, 'commit-message-helper'],
    [/search query/, 'search-query-generator'],
    [/output style/, 'output-style-agent'],
  ];
  for (const [pattern, name] of rules) {
    if (pattern.test(lower)) return name;
  }
  if (title) return slug(title);
  const firstLine = text.split('\n').find((line) => /[a-z]/i.test(line)) ?? text;
  const firstSentence = firstLine.split(/[.!?]/, 1)[0];
  return slug(firstSentence.replace(/^You are an?\s+/i, '').replace(/^You are\s+/i, ''));
}

function addCandidate(candidates, text, source) {
  const normalized = normalizeText(text);
  if (!isPromptLike(normalized, source.kind)) return;
  const key = normalized.replace(/\s+/g, ' ');
  const existing = candidates.get(key);
  if (!existing || source.kind === 'array') candidates.set(key, { text: normalized, source });
}

function collectCandidates(chunks) {
  const candidates = new Map();
  const parseErrors = [];
  for (const chunk of chunks) {
    let ast;
    try {
      ast = parse(chunk.text, {
        sourceType: 'script',
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        plugins: ['jsx', 'typescript'],
      });
    } catch (err) {
      parseErrors.push({ offset: chunk.offset, length: chunk.length, error: String(err.message ?? err) });
      continue;
    }

    walk(ast, (node) => {
      if (node.type === 'CallExpression') {
        for (const argument of node.arguments ?? []) {
          const text = arrayText(argument);
          if (text) addCandidate(candidates, text, { kind: 'array', offset: chunk.offset });
        }
      }
      if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
        const value = stringValue(node);
        if (value) addCandidate(candidates, value, { kind: node.type, offset: chunk.offset });
      }
    });
  }
  return { candidates: [...candidates.values()], parseErrors };
}

function uniqueNames(prompts) {
  const counts = new Map();
  return prompts.map((prompt) => {
    const base = inferName(prompt.text);
    const next = (counts.get(base) ?? 0) + 1;
    counts.set(base, next);
    return { ...prompt, name: next === 1 ? base : `${base}-${next}` };
  });
}

const claudeBin = resolveClaudeBinary();
const version = run(claudeBin, ['--version']).trim();
const help = run(claudeBin, ['--help']);
let autoModeDefaults = '';
try {
  autoModeDefaults = run(claudeBin, ['auto-mode', 'defaults']);
} catch (err) {
  autoModeDefaults = JSON.stringify({ error: String(err.message ?? err) }, null, 2);
}

const binary = fs.readFileSync(claudeBin);
const chunks = extractJavaScriptChunks(binary);
const { candidates, parseErrors } = collectCandidates(chunks);
const prompts = uniqueNames(candidates)
  .sort((a, b) => a.name.localeCompare(b.name) || b.text.length - a.text.length);

fs.rmSync(PROMPTS_DIR, { recursive: true, force: true });
fs.rmSync(RAW_DIR, { recursive: true, force: true });
fs.mkdirSync(PROMPTS_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

fs.writeFileSync(path.join(RAW_DIR, 'claude-help.txt'), help);
fs.writeFileSync(path.join(RAW_DIR, 'auto-mode-defaults.json'), autoModeDefaults);
fs.writeFileSync(path.join(RAW_DIR, 'bundle-chunks.json'), `${JSON.stringify({ chunks: chunks.map(({ offset, length }) => ({ offset, length })), parseErrors }, null, 2)}\n`);
fs.writeFileSync(path.join(RAW_DIR, 'prompt-candidates.json'), `${JSON.stringify(prompts.map((prompt) => ({ name: prompt.name, length: prompt.text.length, source: prompt.source })), null, 2)}\n`);

const entries = [];
for (const prompt of prompts) {
  const file = `${prompt.name}.md`;
  const body = [
    `# ${prompt.name}`,
    '',
    prompt.text,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(PROMPTS_DIR, file), body);
  entries.push(`- [${prompt.name}](prompts/${file})`);
}

const index = [
  '# Claude Code Extracted Prompts',
  '',
  `Source binary: ${path.relative(ROOT, claudeBin)}`,
  `Claude Code: ${version}`,
  '',
  'Notes:',
  '- Claude Code does not currently expose a structured prompt-debug command like `codex debug prompt-input`.',
  '- The extractor parses embedded JavaScript chunks from the installed native binary and emits substantial prompt-shaped AST candidates.',
  '- Short prompt fragments are intentionally excluded so `prompts/` is not polluted with one-line strings.',
  '- Treat prompt files as extracted embedded prompt components, not guaranteed fully composed runtime prompts.',
  '',
  ...entries,
  '',
  'Raw artifacts:',
  '- [claude --help](raw/claude-help.txt)',
  '- [claude auto-mode defaults](raw/auto-mode-defaults.json)',
  '- [bundle chunk metadata](raw/bundle-chunks.json)',
  '- [prompt candidate metadata](raw/prompt-candidates.json)',
  '',
].join('\n');

fs.writeFileSync(INDEX_FILE, index);
console.log(`Parsed ${chunks.length} embedded JavaScript chunks from ${claudeBin}`);
console.log(`Wrote ${prompts.length} prompt files to ${PROMPTS_DIR}`);
console.log(`Wrote index to ${INDEX_FILE}`);

const MIN_PROMPTS = 10;
if (prompts.length < MIN_PROMPTS) {
  throw new Error(
    `Only ${prompts.length} prompt(s) extracted (expected at least ${MIN_PROMPTS}) — ` +
    'the binary format may have changed. ' +
    'Check extract-claude-prompts.mjs and update the extraction logic.'
  );
}
