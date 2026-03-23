---
name: text
description: For LLM agents editing the text tool—click on canvas creates shape; `shape.js` syncs `ref.at('text')` with a textarea and autosizing (`field-sizing` or mirror fallback).
---

# Text

You are editing text placement (`button.js`) and collaborative editing UI (`shape.js`). The Automerge field `text` is the source of truth; the textarea is a view that must not fight remote updates while focused.

**Model of the code**

- `button.js`: When `selectedTool` is `text`, pointer down on canvas creates a new shape with `text: ''` and positions `x`/`y` from client coordinates.
- `shape.js`: Subscribes to `textRef`; on input calls `textRef.change`; on subscription updates, skips overwriting if the textarea is `document.activeElement`. `resizeMirror` supports browsers without `field-sizing: content`.

## Examples

- **Add rich text or markdown:** You must extend `TextSchema`, migration, and rendering; the current stack assumes a plain string field.

## Guidelines

- Keep `TextSchema` fields (`x`, `y`, `toolUrl`, `text`) consistent across `init()`, `parse()`, button, and shape.
- Match other tools’ rule: only start placement when the event’s relevant `ref-view` is the canvas, not a nested tool.
- If you add subscriptions or timers, ensure teardown (unsubscribe/cleanup) on unmount matches Solid lifecycle patterns already in the file.
