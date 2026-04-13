# Selection

## Selection button

The selection and move tool with some shapes to select and drag.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "viewUrl": "selection/button.json", "data": { "x": 10, "y": 10 } },
      "rect1": { "viewUrl": "rectangle/tool.json", "data": { "x": 50, "y": 55, "width": 80, "height": 50 } },
      "sparkle1": { "viewUrl": "sparkle-marker/tool.json", "data": { "x": 25, "y": 120, "points": [[0, 0, 0.6], [35, 30, 0.7], [80, 5, 0.5], [120, 40, 0.7]], "color": "#fbbf24" } },
      "line1": { "viewUrl": "line/tool.json", "data": { "x": 20, "y": 70, "points": [[0, 0, 0.5], [40, 35, 0.6], [85, 10, 0.5], [130, 45, 0.6]] } },
      "text1": { "viewUrl": "text/tool.json", "data": { "x": 65, "y": 160, "text": "drag me" } }
    }
  },
  "width": 200,
  "height": 200,
  "create": "shapes.btn"
}
```
