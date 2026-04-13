# Hand

## Pan tool button

Just the pan tool button.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "hand/button.json" }
    }
  },
  "width": 60,
  "height": 60,
  "create": "shapes.btn"
}
```

## Pan tool

The hand tool with some shapes to pan around.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "hand/button.json" },
      "rect1": { "x": 80, "y": 60, "viewUrl": "rectangle/tool.json", "width": 100, "height": 70 },
      "rect2": { "x": 220, "y": 120, "viewUrl": "rectangle/tool.json", "width": 80, "height": 50 },
      "text1": { "x": 90, "y": 170, "viewUrl": "text/tool.json", "text": "drag to pan" }
    }
  },
  "width": 350,
  "height": 250
}
```
