# Sparkle Marker

## Pink sparkle

A sparkle trail in the default pink color.

```json
{
  "tool": "sparkle-marker/tool.json",
  "value": {
    "x": 0, "y": 0, "viewUrl": "sparkle-marker/tool.json",
    "points": [[20, 60, 0.5], [50, 30, 0.7], [80, 50, 0.6], [120, 20, 0.8], [160, 45, 0.5]],
    "color": "#f0abfc"
  },
  "width": 200,
  "height": 100
}
```

## Gold sparkle

A sparkle trail in gold.

```json
{
  "tool": "sparkle-marker/tool.json",
  "value": {
    "x": 0, "y": 0, "viewUrl": "sparkle-marker/tool.json",
    "points": [[15, 50, 0.6], [60, 15, 0.8], [100, 55, 0.5], [150, 25, 0.7], [190, 60, 0.6]],
    "color": "#fbbf24"
  },
  "width": 200,
  "height": 100
}
```

## Cyan loop

A looping sparkle path in cyan.

```json
{
  "tool": "sparkle-marker/tool.json",
  "value": {
    "x": 0, "y": 0, "viewUrl": "sparkle-marker/tool.json",
    "points": [[30, 50, 0.5], [60, 20, 0.6], [100, 30, 0.7], [130, 60, 0.5], [100, 80, 0.6], [60, 70, 0.7], [30, 50, 0.5]],
    "color": "#22d3ee"
  },
  "width": 200,
  "height": 100
}
```

## Sparkle marker button

The toolbar button that activates the sparkle marker drawing tool.

```json
{
  "tool": "paper/tool.json",
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "sparkle-marker/button.json" }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```
