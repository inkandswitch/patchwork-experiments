# Stack

## Paper

A paper canvas with a dock layout toolbar and parts bin.

```json
{
  "tool": "stack/tool.json",
  "tags": ["starter"],
  "value": {
    "toolUrl": "stack/tool.json",
    "stack": {
      "children": [
        {
          "viewUrl": "paper/tool.json",
          "shapes": {
            "import_card": { "viewUrl": "world-drop/card.json", "x": 20, "y": 20, "width": 180, "height": 110 },
            "parts_bin": { "viewUrl": "parts-bin/tool.json", "x": 420, "y": 0, "width": 280, "height": 600 }
          }
        },
        {
          "viewUrl": "dock-layout/tool.json",
          "dockLayout": {
            "top-left": null,
            "top-center": [
              { "viewUrl": "selection/button.json" },
              { "viewUrl": "rectangle/button.json" },
              { "viewUrl": "line/button.json" },
              { "viewUrl": "text/button.json" },
              { "viewUrl": "eraser/button.json" },
              { "viewUrl": "rainbow-marker/button.json" },
              { "viewUrl": "sparkle-marker/button.json" }
            ],
            "top-right": null,
            "middle-left": null,
            "middle-right": null,
            "bottom-left": null,
            "bottom-center": null,
            "bottom-right": [{ "viewUrl": "viewport/tool.json" }]
          }
        }
      ]
    }
  },
  "width": 400,
  "height": 300
}
```

## Canvas

A clean canvas with drawing tools but no parts bin.

```json
{
  "tool": "stack/tool.json",
  "tags": ["starter"],
  "value": {
    "toolUrl": "stack/tool.json",
    "stack": {
      "children": [
        {
          "viewUrl": "paper/tool.json",
          "shapes": {
            "import_card": { "viewUrl": "world-drop/card.json", "x": 20, "y": 20, "width": 180, "height": 110 }
          }
        },
        {
          "viewUrl": "dock-layout/tool.json",
          "dockLayout": {
            "top-left": null,
            "top-center": [
              { "viewUrl": "selection/button.json" },
              { "viewUrl": "rectangle/button.json" },
              { "viewUrl": "line/button.json" },
              { "viewUrl": "text/button.json" },
              { "viewUrl": "eraser/button.json" },
              { "viewUrl": "rainbow-marker/button.json" },
              { "viewUrl": "sparkle-marker/button.json" }
            ],
            "top-right": null,
            "middle-left": null,
            "middle-right": null,
            "bottom-left": null,
            "bottom-center": null,
            "bottom-right": [{ "viewUrl": "viewport/tool.json" }]
          }
        }
      ]
    }
  },
  "width": 400,
  "height": 300
}
```
