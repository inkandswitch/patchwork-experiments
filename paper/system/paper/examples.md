# Paper

## Blank canvas

An empty paper canvas with no shapes.

```json
{
  "tool": "paper/tool.json",
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
  "value": {
    "shapes": {
      "rect1": { "x": 40, "y": 30, "viewUrl": "rectangle/tool.json", "width": 120, "height": 80 },
      "text1": { "x": 200, "y": 50, "viewUrl": "text/tool.json", "text": "Hello" },
      "line1": { "x": 30, "y": 150, "viewUrl": "line/tool.json", "points": [[0, 0, 0.5], [60, 30, 0.6], [120, 10, 0.5], [180, 40, 0.6]] }
    }
  },
  "width": 400,
  "height": 300
}
```
