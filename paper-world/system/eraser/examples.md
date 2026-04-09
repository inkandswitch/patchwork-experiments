# Eraser

## Eraser button

The eraser toolbar button with some shapes to erase.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "eraser/button.json" },
      "rect1": { "x": 60, "y": 50, "viewUrl": "rectangle/tool.json", "width": 80, "height": 50 },
      "sparkle1": { "x": 20, "y": 110, "viewUrl": "sparkle-marker/tool.json", "points": [[0, 0, 0.5], [40, 25, 0.7], [90, 10, 0.6], [130, 35, 0.5]], "color": "#f0abfc" },
      "line1": { "x": 30, "y": 60, "viewUrl": "line/tool.json", "points": [[0, 0, 0.5], [50, 40, 0.6], [100, 15, 0.5], [140, 50, 0.6]] },
      "text1": { "x": 70, "y": 155, "viewUrl": "text/tool.json", "text": "erase me" }
    }
  },
  "width": 200,
  "height": 200,
  "create": "shapes.btn"
}
```
