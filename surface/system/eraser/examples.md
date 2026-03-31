# Eraser

## Eraser button

The eraser toolbar button with some shapes to erase.

```json
{
  "tool": "paper/paper.js",
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "toolUrl": "eraser/button.js" },
      "rect1": { "x": 60, "y": 50, "toolUrl": "rectangle/tool.js", "width": 80, "height": 50 },
      "sparkle1": { "x": 20, "y": 110, "toolUrl": "sparkle-marker/tool.js", "points": [[0, 0, 0.5], [40, 25, 0.7], [90, 10, 0.6], [130, 35, 0.5]], "color": "#f0abfc" },
      "line1": { "x": 30, "y": 60, "toolUrl": "line/tool.js", "points": [[0, 0, 0.5], [50, 40, 0.6], [100, 15, 0.5], [140, 50, 0.6]] },
      "text1": { "x": 70, "y": 155, "toolUrl": "text/tool.js", "text": "erase me" }
    }
  },
  "width": 200,
  "height": 200,
  "create": "shapes.btn"
}
```
