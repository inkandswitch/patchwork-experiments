# Color Picker

## Color picker button

The toolbar button that opens a color palette for choosing the drawing color.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "viewUrl": "color-picker/button.json", "data": { "x": 10, "y": 10 } }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```

## Color picker with drawing tools

A canvas toolbar with rectangle, line, and color picker buttons.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "rect_btn": { "viewUrl": "rectangle/button.json", "data": { "x": 10, "y": 10 } },
      "line_btn": { "viewUrl": "line/button.json", "data": { "x": 50, "y": 10 } },
      "color_btn": { "viewUrl": "color-picker/button.json", "data": { "x": 90, "y": 10 } }
    }
  },
  "width": 300,
  "height": 200
}
```
