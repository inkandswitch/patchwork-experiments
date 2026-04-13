# Hand

## Pan tool button

Just the pan tool button.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "viewUrl": "hand/button.json", "data": { "x": 10, "y": 10 } }
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
      "btn": { "viewUrl": "hand/button.json", "data": { "x": 10, "y": 10 } },
      "rect1": { "viewUrl": "rectangle/tool.json", "data": { "x": 80, "y": 60, "width": 100, "height": 70 } },
      "rect2": { "viewUrl": "rectangle/tool.json", "data": { "x": 220, "y": 120, "width": 80, "height": 50 } },
      "text1": { "viewUrl": "text/tool.json", "data": { "x": 90, "y": 170, "text": "drag to pan" } }
    }
  },
  "width": 350,
  "height": 250
}
```
