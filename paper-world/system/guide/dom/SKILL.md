---
name: dom
description: Inspect the DOM elements of shapes and components you've added to the canvas.
---

# Inspecting the DOM

When you add a shape to a surface, it is rendered as a `<ref-view>` custom element inside the surface's DOM.

First find the surface (see the paper skill), then query it for the `ref-view` matching the shape's document URL.

## Finding a shape's DOM element

If you know the ID of the shape you added (e.g., `my_shape_id`):

```js
const { surfaceSchema } = await filesystem.import('surface/schema.js');
const surface = element.findClosest(surfaceSchema);

const shapeUrl = surface.ref.at('shapes', 'my_shape_id').url;
const shapeElement = surface.querySelector(`ref-view[ref-url="${shapeUrl}"]`);

if (shapeElement) {
  const rect = shapeElement.getBoundingClientRect();
  console.log('Bounding rect:', rect.x, rect.y, rect.width, rect.height);
  console.log('Inner HTML:', shapeElement.innerHTML);
} else {
  console.log('DOM element not found (it might not be rendered yet or id is incorrect)');
}
```

## Waiting for rendering

If you just added a shape, it might take a moment to render reactively in the DOM. Wait for the next animation frame or use a short delay before querying:

```js
surface.ref.at('shapes', 'my_new_shape').change(() => ({
  x: 100, y: 100, viewUrl: 'text/tool.json', text: 'Hello'
}));

await new Promise(resolve => setTimeout(resolve, 50));

const shapeUrl = surface.ref.at('shapes', 'my_new_shape').url;
const shapeElement = surface.querySelector(`ref-view[ref-url="${shapeUrl}"]`);
console.log('Rendered element:', shapeElement);
```
