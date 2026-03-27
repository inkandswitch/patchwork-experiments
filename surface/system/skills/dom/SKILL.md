---
name: dom
description: Inspect the DOM elements of shapes and components you've added to the canvas.
---

# Inspecting the DOM

When you add a shape to the canvas, it is rendered as a `<ref-view>` custom element inside the frame's DOM. 

You can find the corresponding DOM element by querying the frame `element` for the `ref-view` that matches the shape's document URL.

## Finding a shape's DOM element

If you know the ID of the shape you added (e.g., `my_shape_id`):

```js
// 1. Get the shape's reference URL
const shapeUrl = element.ref.at('shapes', 'my_shape_id').url;

// 2. Query the DOM for the matching ref-view
// Note: We use CSS attribute selector [ref-url="..."]
const shapeElement = element.querySelector(`ref-view[ref-url="${shapeUrl}"]`);

if (shapeElement) {
  console.log('Found DOM element:', shapeElement);
  
  // You can inspect its dimensions, position, and properties
  const rect = shapeElement.getBoundingClientRect();
  console.log('Bounding rect:', rect.x, rect.y, rect.width, rect.height);
  
  // The shape itself is rendered inside the ref-view's light DOM
  console.log('Inner HTML:', shapeElement.innerHTML);
} else {
  console.log('DOM element not found (it might not be rendered yet or id is incorrect)');
}
```

## Waiting for rendering

If you just added a shape via `element.ref.at(...).change(...)`, it might take a moment to render reactively in the DOM. You may need to wait for the next animation frame or use a short delay before querying:

```js
element.ref.at('shapes', 'my_new_shape').change(() => ({
  x: 100, y: 100, toolUrl: toolUrl('text/shape.js'), text: 'Hello'
}));

// Wait briefly for reactive rendering
await new Promise(resolve => setTimeout(resolve, 50));

const shapeUrl = element.ref.at('shapes', 'my_new_shape').url;
const shapeElement = element.querySelector(`ref-view[ref-url="${shapeUrl}"]`);
console.log('Rendered element:', shapeElement);
```
