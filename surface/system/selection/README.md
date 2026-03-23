---
name: selection
description: For LLM agents editing the selection tool—sets `selectedTool` to `selection`, maintains `selectedShapes` on the frame ref, derives ids from child `ref-view` `ref-url`.
---

# Selection

You are editing hit-testing and selection state (`button.js`). The frame ref field `selectedShapes` is an object map used by `paper/paper.js` for toolbar highlighting; clearing behavior is tied to deactivating this tool.

**Model of the code**

- `shapeIdFromEvent`: Walks from `event.target` to a child `ref-view`, reads `ref-url`, returns the last path segment as shape id; returns null for canvas or missing url.
- Deactivating the tool clears `selectedShapes` in the same flow that toggles `selectedTool` off.

## Examples

- **Multi-select:** Extend `selectedShapesSchema` parsing, update pointer logic to merge/toggle keys, and update `paper/paper.js` if highlight semantics change (e.g. multiple keys).

## Guidelines

- Keep `TOOL_NAME` as `selection` to match `selectedTool` comparisons elsewhere.
- Do not treat toolbar `ref-view` nodes as selectable canvas children—mirror the existing closest-ref-view vs canvas checks.
- Any change to `selectedShapes` shape must be reflected wherever the frame or tools read it.
