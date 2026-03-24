---
name: screenshot
description: Take a screenshot of the canvas and get a data URL.
---

# Screenshot

Capture the current frame as a PNG data URL using `modern-screenshot`.

## Quick usage (inline)

```js
const { domToPng } = await import('https://esm.sh/modern-screenshot');
const dataUrl = await domToPng(element);
console.log(dataUrl);
```

`element` is the frame `ref-view` available in the script scope.

## Using the helper module

A bundled helper is available at `skills/screenshot/screenshot.js` relative to the system root:

```js
const screenshotUrl = element.filesystem.getUrlOfFile('skills/screenshot/screenshot.js');
const { screenshot } = await import(screenshotUrl);
const dataUrl = await screenshot(element);
```

## Displaying the image

Create an embed shape that shows the screenshot, or insert it as a data URL in an `<img>`:

```js
const img = document.createElement('img');
img.src = dataUrl;
element.appendChild(img);
```

## Options

`domToPng` accepts an optional second argument for render options:

```js
const dataUrl = await domToPng(element, {
  width: 800,
  height: 600,
  scale: 2, // retina
});
```
