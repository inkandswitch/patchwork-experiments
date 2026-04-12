# Color Picker

## Color picker button

The toolbar button that opens a color palette for choosing the drawing color.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "color-picker/button.json" }
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
      "rect_btn": { "x": 10, "y": 10, "viewUrl": "rectangle/button.json" },
      "line_btn": { "x": 50, "y": 10, "viewUrl": "line/button.json" },
      "color_btn": { "x": 90, "y": 10, "viewUrl": "color-picker/button.json" }
    }
  },
  "width": 300,
  "height": 200
}
```
