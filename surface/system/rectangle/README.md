---
name: rectangle
description: For LLM agents editing the rectangle tool—drag on canvas creates `width`/`height`/`x`/`y`, `shape.js` renders a styled div; `selectedTool` string `rectangle`.
---

# Rectangle

You are editing rectangle creation (`button.js`) and rectangle display (`shape.js`). State is plain numeric geometry plus `toolUrl` for the shape module.

**Model of the code**

- `button.js`: Toggles `rectangle` tool; drag on canvas defines opposing corners; writes final `width`, `height`, and position onto a new `shapes` child (pattern matches other draw tools).
- `shape.js`: Renders a `div` from `data()?.width` / `height` and inline styles (color, radius).

## Examples

- **Add stroke or label:** Extend `RectangleSchema`, default in `init()`, set fields in `button.js` when creating the shape, consume in `shape.js`—all three must stay in sync.

## Guidelines

- Use `TOOL_NAME` / `selectedTool` value `rectangle` consistently with `paper/paper.js` toolbar registration.
- Ignore pointer starts on nested `ref-view` elements unless you deliberately want sub-target drags.
- Remove or gate `console.log` noise before finishing if you touched debug statements in `button.js`.
