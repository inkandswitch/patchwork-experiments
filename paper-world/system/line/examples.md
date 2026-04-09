# Line

## Simple stroke

A short diagonal line.

```json
{
  "tool": "line/tool.json",
  "tags": [],
  "value": {
    "x": 0, "y": 0, "viewUrl": "line/tool.json",
    "points": [[10, 10, 0.5], [50, 80, 0.7], [120, 40, 0.6], [180, 90, 0.5]]
  },
  "width": 200,
  "height": 100
}
```

## Zigzag

A zigzag pattern across the canvas.

```json
{
  "tool": "line/tool.json",
  "tags": [],
  "value": {
    "x": 0, "y": 0, "viewUrl": "line/tool.json",
    "points": [[10, 80, 0.5], [50, 10, 0.6], [90, 80, 0.5], [130, 10, 0.6], [170, 80, 0.5], [210, 10, 0.6], [250, 80, 0.5]]
  },
  "width": 270,
  "height": 100
}
```

## Line button

The toolbar button that activates the freehand line drawing tool.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "line/button.json" }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```
