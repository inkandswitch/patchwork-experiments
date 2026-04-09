# Rectangle

## Small square

A compact 100x100 square.

```json
{
  "tool": "rectangle/tool.json",
  "tags": [],
  "value": { "x": 0, "y": 0, "viewUrl": "rectangle/tool.json", "width": 100, "height": 100 },
  "width": 100,
  "height": 100
}
```

## Wide banner

A wide, short rectangle.

```json
{
  "tool": "rectangle/tool.json",
  "tags": [],
  "value": { "x": 0, "y": 0, "viewUrl": "rectangle/tool.json", "width": 300, "height": 60 },
  "width": 300,
  "height": 60
}
```

## Tall column

A narrow, tall rectangle.

```json
{
  "tool": "rectangle/tool.json",
  "tags": [],
  "value": { "x": 0, "y": 0, "viewUrl": "rectangle/tool.json", "width": 60, "height": 300 },
  "width": 60,
  "height": 300
}
```

## Rectangle button

The toolbar button that activates the rectangle drawing tool.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "rectangle/button.json" }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```
