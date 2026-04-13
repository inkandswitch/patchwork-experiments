# Paper

## Blank canvas

An empty paper canvas with no shapes.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": { "shapes": {} },
  "width": 400,
  "height": 300
}
```

## Canvas with shapes

A paper canvas with a rectangle, text label, and freehand line.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "rect1": { "viewUrl": "rectangle/tool.json", "data": { "x": 40, "y": 30, "width": 120, "height": 80 } },
      "text1": { "viewUrl": "text/tool.json", "data": { "x": 200, "y": 50, "text": "Hello" } },
      "line1": { "viewUrl": "line/tool.json", "data": { "x": 30, "y": 150, "points": [[0, 0, 0.5], [60, 30, 0.6], [120, 10, 0.5], [180, 40, 0.6]] } }
    }
  },
  "width": 400,
  "height": 300
}
```
