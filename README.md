# claude-prompts

Tooling that extracts prompt-like strings and stable CLI prompt/config surfaces from the installed Claude Code binary.

Claude Code currently ships as a native executable with a bundled JavaScript payload. Unlike Codex, it does not expose a structured prompt-input debug command, so this repo starts with a conservative extractor:

1. Pins `@anthropic-ai/claude-code` as a dependency.
2. Resolves the local `claude` binary, falling back to `CLAUDE_BIN` or `claude` on `PATH`.
3. Captures stable CLI surfaces such as `claude --help` and `claude auto-mode defaults`.
4. Extracts high-confidence prompt-like UTF-8/UTF-16 strings embedded in the binary.

## Quick Start

```sh
bun install
bun run extract
```

The script writes:

- `prompts/<name>.md` - recognized embedded prompt-like strings.
- `raw/` - raw command outputs used as structured or semi-structured source material.
- `claude-prompts.md` - generated index.

## Caveats

- Extracted prompt files are embedded strings, not guaranteed fully composed runtime system prompts.
- Some runtime prompts are assembled from fragments and dynamic context; this first pass intentionally avoids pretending otherwise.
- If Claude Code later exposes a structured debug command for model-visible prompt input, the extractor should switch to that as the source of truth.
