---
name: paper
description: For LLM agents editing the Paper canvas tool—`paper.js` lazy-inits `shapes` / `selectedTool` / `selectedShapes`, renders the toolbar `ref-view`s, and owns default button URLs.
---

# Paper canvas (`paper/paper.js`)

You are editing the frame document’s interactive surface. The host `ref-view` loads `bootstrap.js`, which nests another `ref-view` pointing here with the **same** `ref-url`, so `element.ref` is still the frame Automerge document.

**Model of the code**

- `ensurePaperDocument(ref)` calls `ref.at('shapes').as(shapesSchema).value()`, then `selectedTool`, then `selectedShapes`. Each call may persist defaults the first time that path is missing (`Ref.value()` behavior).
- `mount` then `useRef(ref.at('shapes'))` and `useRef(ref.at('selectedShapes'))` and renders the `For` over toolbar entries (positioned `ref-view`s per shape).

## Examples

- **Add a toolbar tool:** Add a key in `shapesSchema.init()` with `toolUrl: new URL('../yourtool/button.js', import.meta.url).href` (paths are relative to `paper/paper.js`).
- **Add frame-level state:** Define a small `{ init, parse }` schema, call `ref.at('yourKey').as(yourSchema).value()` inside `ensurePaperDocument`, and read it from tools via `canvas.ref.at('yourKey')`.

## Guidelines

- Keep `TOOL_NAME` strings in sibling `*/button.js` files aligned with `selectedTool` comparisons (`line`, `rectangle`, `selection`, etc.).
- After changing `shapesSchema` or Zod shapes, ensure existing documents still `parse` or provide tolerant `parse` implementations.
- Selection highlight uses `selectedShapes[id]`; changing that contract requires updating `selection/button.js` and this renderer together.
