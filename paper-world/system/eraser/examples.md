# Eraser

## Eraser button

The eraser toolbar button with some shapes to erase.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "viewUrl": "eraser/button.json", "data": { "x": 10, "y": 10 } },
      "rect1": { "viewUrl": "rectangle/tool.json", "data": { "x": 60, "y": 50, "width": 80, "height": 50 } },
      "sparkle1": { "viewUrl": "sparkle-marker/tool.json", "data": { "x": 20, "y": 110, "points": [[0, 0, 0.5], [40, 25, 0.7], [90, 10, 0.6], [130, 35, 0.5]], "color": "#f0abfc" } },
      "line1": { "viewUrl": "line/tool.json", "data": { "x": 30, "y": 60, "points": [[0, 0, 0.5], [50, 40, 0.6], [100, 15, 0.5], [140, 50, 0.6]] } },
      "text1": { "viewUrl": "text/tool.json", "data": { "x": 70, "y": 155, "text": "erase me" } }
    }
  },
  "width": 200,
  "height": 200,
  "create": "shapes.btn"
}
```
