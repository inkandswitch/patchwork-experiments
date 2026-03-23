---
name: llm
description: For LLM agents editing the in-app LLM panel—`shape.js` schema/UI, `process.js` streaming + script runs, `parser.js` `<script>` extraction, `system-prompt.js` agent instructions.
---

# LLM

You are maintaining the coding-agent surface: persisted `config` + `runs`, OpenRouter-compatible streaming, incremental parse of `<script data-description="...">` blocks, execution with captured console, and the static instructions in `SYSTEM_PROMPT`.

**File roles**

- `shape.js`: Zod schemas for `config` and `runs`, Solid UI, orchestration entry into `runLlmTurns`.
- `process.js`: `streamChatCompletion`, `createCapturedConsole`, turn loop with `MAX_ITERATIONS`, script evaluation environment (must match what `system-prompt.js` documents).
- `parser.js`: Async tokenizer state machine yielding text vs script segments; do not break streaming partial-tag behavior without tests.
- `system-prompt.js`: Single export `SYSTEM_PROMPT`; keep it synchronized with real globals (`canvas`, `repo`, `readDoc`, Automerge mutation rules).

## Examples

- **Change default model:** Adjust `schema.init()` defaults and/or `schema.parse` fallbacks for `config.model` and `config.apiUrl` together so old documents still parse.
- **New output block type:** Extend `OutputBlockSchema` and every consumer that renders or executes runs; prefer backward-compatible `parse` for stored runs.

## Guidelines

- Never document APIs in `SYSTEM_PROMPT` that `process.js` does not inject into the script sandbox.
- Preserve bounds: iteration cap, abort `signal`, and error recording on runs so failed streams do not spin forever.
- OpenRouter-specific headers in `streamChatCompletion` exist for provider expectations; if you target another API, replace consistently (auth, path, SSE format).
- After changing prompt or script API, search for other references (embed tools, docs) that teach the same contract.
