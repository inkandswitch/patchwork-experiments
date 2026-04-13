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
  }
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
      "rect1": { "viewUrl": "rectangle/tool.json", "data": { "x": 13.365, "y": 52.505, "width": 0.018, "height": 0.012 } },
      "ellipse1": { "viewUrl": "ellipse/tool.json", "data": { "x": 13.395, "y": 52.5, "width": 0.015, "height": 0.01 } },
      "line1": { "viewUrl": "line/tool.json", "data": { "x": 13.375, "y": 52.522, "points": [[0, 0, 0.5], [0.012, 0.004, 0.6], [0.024, -0.003, 0.5]] } }
    }
  }
}
```
