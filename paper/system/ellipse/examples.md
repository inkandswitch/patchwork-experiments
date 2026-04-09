# Ellipse

## Circle

A 100x100 circle.

```json
{
  "tool": "ellipse/tool.json",
  "value": { "x": 0, "y": 0, "viewUrl": "ellipse/tool.json", "width": 100, "height": 100 },
  "width": 100,
  "height": 100
}
```

## Wide oval

A wide, flat oval.

```json
{
  "tool": "ellipse/tool.json",
  "value": { "x": 0, "y": 0, "viewUrl": "ellipse/tool.json", "width": 200, "height": 80 },
  "width": 200,
  "height": 80
}
```

## Tall oval

A narrow, tall oval.

```json
{
  "tool": "ellipse/tool.json",
  "value": { "x": 0, "y": 0, "viewUrl": "ellipse/tool.json", "width": 60, "height": 180 },
  "width": 60,
  "height": 180
}
```

## Ellipse button

The toolbar button that activates the ellipse drawing tool.

```json
{
  "tool": "paper/tool.json",
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "ellipse/button.json" }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```
