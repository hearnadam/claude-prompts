import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const RAW_DIR = path.join(ROOT, 'raw');
const INDEX_FILE = path.join(ROOT, 'claude-prompts.md');

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
    .slice(0, 80) || 'prompt';
}

function printableAscii(byte) {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}

function extractUtf8Strings(buffer, minLen = 24) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= buffer.length; i++) {
    const ok = i < buffer.length && printableAscii(buffer[i]);
    if (ok && start === -1) start = i;
    if ((!ok || i === buffer.length) && start !== -1) {
      if (i - start >= minLen) out.push(buffer.subarray(start, i).toString('utf8'));
      start = -1;
    }
  }
  return out;
}

function extractUtf16LeAsciiStrings(buffer, minChars = 24) {
  const out = [];
  let chars = [];
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const lo = buffer[i];
    const hi = buffer[i + 1];
    const ok = hi === 0 && printableAscii(lo);
    if (ok) chars.push(String.fromCharCode(lo));
    else {
      if (chars.length >= minChars) out.push(chars.join(''));
      chars = [];
    }
  }
  if (chars.length >= minChars) out.push(chars.join(''));
  return out;
}

function normalizeText(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u0000/g, '')
    .trim();
}

const KNOWN_PROMPTS = [
  ['You are Claude Code, Anthropic\'s official CLI for Claude, running within the Claude Agent SDK.', 'claude-code-sdk'],
  ['You are Claude Code, Anthropic\'s official CLI for Claude.', 'claude-code'],
  ['You are a Claude agent, built on Anthropic\'s Claude Agent SDK.', 'claude-agent-sdk'],
  ['You are an expert reviewer of auto mode classifier rules for Claude Code.', 'auto-mode-classifier-reviewer'],
  ['You are a file search specialist for Claude Code', 'file-search-specialist'],
  ['You are a software architect and planning specialist for Claude Code', 'planning-specialist'],
  ['You are a helpful AI assistant tasked with summarizing conversations.', 'conversation-summarizer'],
  ['You are a date/time parser that converts natural language into ISO 8601 format.', 'date-time-parser'],
  ['You are an interactive agent that helps users with software engineering tasks.', 'interactive-agent'],
  ['You are an interactive agent that helps users according to your "Output Style" below', 'output-style-agent'],
  ['You are a helpful code reviewer who...', 'agent-prompt-placeholder'],
];

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
const strings = [...extractUtf8Strings(binary), ...extractUtf16LeAsciiStrings(binary)]
  .map(normalizeText)
  .filter(Boolean);

const prompts = [];
const seenNames = new Set();
for (const [needle, name] of KNOWN_PROMPTS) {
  const match = strings.find((s) => s.includes(needle));
  if (!match) continue;
  const text = match.length > 4000 ? match.slice(0, 4000).trimEnd() + '\n\n[truncated]' : match;
  prompts.push({ name, needle, text });
  seenNames.add(name);
}

for (const text of strings) {
  if (!/^You are /.test(text)) continue;
  if (text.length < 40 || text.length > 3000) continue;
  if (/highest Max subscription plan|using your overages|using your subscription|not in plan mode|working in a worktree/i.test(text)) continue;
  const name = slug(text.split(/[.\n]/, 1)[0]);
  if (seenNames.has(name) || prompts.some((p) => p.text === text)) continue;
  prompts.push({ name, needle: 'You are', text });
  seenNames.add(name);
}

fs.rmSync(PROMPTS_DIR, { recursive: true, force: true });
fs.rmSync(RAW_DIR, { recursive: true, force: true });
fs.mkdirSync(PROMPTS_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

fs.writeFileSync(path.join(RAW_DIR, 'claude-help.txt'), help);
fs.writeFileSync(path.join(RAW_DIR, 'auto-mode-defaults.json'), autoModeDefaults);

const entries = [];
for (const prompt of prompts.sort((a, b) => a.name.localeCompare(b.name))) {
  const file = `${prompt.name}.md`;
  const body = [
    `# ${prompt.name}`,
    '',
    `_Source: embedded string in Claude Code binary; matched ${JSON.stringify(prompt.needle)}_`,
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
  '- The extractor records stable CLI surfaces and pulls high-confidence prompt-like strings from the installed binary.',
  '- Treat prompt files as extracted embedded strings, not guaranteed fully composed runtime prompts.',
  '',
  ...entries,
  '',
  'Raw artifacts:',
  '- [claude --help](raw/claude-help.txt)',
  '- [claude auto-mode defaults](raw/auto-mode-defaults.json)',
  '',
].join('\n');

fs.writeFileSync(INDEX_FILE, index);
console.log(`Wrote ${prompts.length} prompt files to ${PROMPTS_DIR}`);
console.log(`Wrote index to ${INDEX_FILE}`);
