# Map

## Blank map

An empty MapLibre canvas using the OpenFreeMap Liberty style.

```json
{
  "tool": "map/tool.json",
  "tags": [],
  "value": {
    "centerX": 13.388,
    "centerY": 52.517,
    "zoom": 9.5,
    "shapes": {}
  },
  "width": 400,
  "height": 300
}
```

## Map with shapes

A map canvas with a rectangle, ellipse, and line stored in map coordinates.

```json
{
  "tool": "map/tool.json",
  "tags": [],
  "value": {
    "centerX": 13.388,
    "centerY": 52.517,
    "zoom": 9.5,
    "shapes": {
      "rect1": { "x": 13.365, "y": 52.505, "viewUrl": "rectangle/tool.json", "width": 0.018, "height": 0.012 },
      "ellipse1": { "x": 13.395, "y": 52.5, "viewUrl": "ellipse/tool.json", "width": 0.015, "height": 0.01 },
      "line1": { "x": 13.375, "y": 52.522, "viewUrl": "line/tool.json", "points": [[0, 0, 0.5], [0.012, 0.004, 0.6], [0.024, -0.003, 0.5]] }
    }
  },
  "width": 400,
  "height": 300
}
```
