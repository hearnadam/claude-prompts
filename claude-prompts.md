# Claude Code Extracted Prompts

Source binary: node_modules/@anthropic-ai/claude-code-linux-x64/claude
Claude Code: 2.1.259 (Claude Code)

Notes:
- Claude Code does not currently expose a structured prompt-debug command like `codex debug prompt-input`.
- The extractor parses embedded JavaScript chunks from the installed native binary and emits substantial prompt-shaped AST candidates.
- Short prompt fragments are intentionally excluded so `prompts/` is not polluted with one-line strings.
- Treat prompt files as extracted embedded prompt components, not guaranteed fully composed runtime prompts.

- [claude-code](prompts/claude-code.md)
- [codebase-search-specialist](prompts/codebase-search-specialist.md)
- [coming-up-with-a-title-and-a-git-branch-name-for-a-coding-session-based](prompts/coming-up-with-a-title-and-a-git-branch-name-for-a-coding-session-based.md)
- [date-time-parser](prompts/date-time-parser.md)
- [hook-condition-evaluator](prompts/hook-condition-evaluator.md)
- [operating-autonomously](prompts/operating-autonomously.md)
- [phase-1-initial-understanding](prompts/phase-1-initial-understanding.md)
- [phase-2-design](prompts/phase-2-design.md)
- [selecting-memories-that-will-be-useful-to-claude-code-as-it-processes-a](prompts/selecting-memories-that-will-be-useful-to-claude-code-as-it-processes-a.md)
- [skill-generator](prompts/skill-generator.md)
- [stop-condition-evaluator](prompts/stop-condition-evaluator.md)
- [team-shutdown-reminder](prompts/team-shutdown-reminder.md)
- [usage-friction-points](prompts/usage-friction-points.md)
- [usage-future-opportunities](prompts/usage-future-opportunities.md)
- [usage-improvements](prompts/usage-improvements.md)
- [usage-interaction-style](prompts/usage-interaction-style.md)
- [usage-memorable-moment](prompts/usage-memorable-moment.md)
- [usage-project-areas](prompts/usage-project-areas.md)
- [usage-session-facets](prompts/usage-session-facets.md)
- [usage-working-well](prompts/usage-working-well.md)
- [workflow-subagent](prompts/workflow-subagent.md)

Raw artifacts:
- [claude --help](raw/claude-help.txt)
- [claude auto-mode defaults](raw/auto-mode-defaults.json)
- [bundle chunk metadata](raw/bundle-chunks.json)
- [prompt candidate metadata](raw/prompt-candidates.json)
