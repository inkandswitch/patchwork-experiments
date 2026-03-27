---
name: screenshot
description: Take a screenshot of the canvas (or a region) and get an <img> element.
---

# Screenshot

Returns an `<img>` element (PNG data URL, max 1024x1024). Return it from the script to pass the image back as a vision input.

```js
const { screenshot } = await filesystem.import('skills/screenshot/screenshot.js');
const img = await screenshot(element);
return img;
```

Crop to a region with `{ x, y, width, height }` in pixels (all optional, relative to the element):

```js
const img = await screenshot(element, { x: 100, y: 50, width: 300, height: 200 });
return img;
```
