# claude-prompts

Tooling that extracts prompt components from the installed Claude Code binary.

Claude Code currently ships as a native executable with bundled JavaScript chunks. Unlike Codex, it does not expose a structured prompt-input debug command, so this repo extracts the next-best source of truth:

1. Pins `@anthropic-ai/claude-code` as a dependency.
2. Resolves the local native `claude` binary, falling back to `CLAUDE_BIN` or `claude` on `PATH`.
3. Captures stable CLI surfaces such as `claude --help` and `claude auto-mode defaults`.
4. Finds large embedded JavaScript chunks in the native binary, parses them with Babel, and emits substantial prompt-shaped AST candidates.

## Quick Start

```sh
bun install
bun run extract
```

The script writes:

- `prompts/<name>.md` - extracted prompt components from parsed bundle AST nodes.
- `raw/` - command outputs and extraction metadata.
- `claude-prompts.md` - generated index.

## Caveats

- Extracted prompt files are embedded prompt components, not guaranteed fully composed runtime system prompts.
- Runtime prompts can be assembled from fragments and dynamic context; the extractor avoids publishing short one-line fragments as standalone prompts.
- If Claude Code later exposes a structured debug command for model-visible prompt input, the extractor should switch to that as the source of truth.
