---
name: embed
description: For LLM agents editing the embed tool—`button.js` placement/repo usage, `shape.js` chrome and nested `ref-view`, schema fields `embedDocUrl` / `embedToolUrl` / dimensions.
---

# Embed

You are editing embed placement (`button.js`) and embed rendering (`shape.js`). Assume the frame holds canvas shapes; embed adds child shapes that host another document or tool via `ref-view`.

**Model of the code**

- `button.js`: Toggles `selectedTool === 'embed'`. On pointer down on the canvas (not nested `ref-view`), creates a new shape and may create linked documents through `globalThis.repo` (requires `repo.create` or equivalent—log or throw clearly if missing).
- `shape.js`: Validates with Zod, renders layout (`width`, `height`, styling), wires `embedToolUrl` and `embedDocUrl` into nested `ref-view` when present.

## Examples

- **Resize or retarget programmatically:** Mutate the shape ref’s `width`, `height`, `embedDocUrl`, or `embedToolUrl` consistently with `schema.parse` so persisted documents stay valid.
- **Debug missing embed content:** Trace whether `embedDocUrl` is set and whether the nested `ref-view` receives the expected `tool-url` / `ref-url` attributes.

## Guidelines

- Keep Zod schemas in `button.js` / `shape.js` aligned: any new persisted field must appear in `init()`, `parse()`, and the UI that reads it.
- If you introduce new repo calls, guard on `globalThis.repo` the same way as existing code; do not assume repo exists in tests or static contexts.
- When linking to LLM documents, stay compatible with `../llm/shape.js` schema expectations for URLs and handles.
