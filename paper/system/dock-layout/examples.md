# Dock Layout

## Empty dock

A dock layout with all positions empty.

```json
{
  "tool": "dock-layout/tool.json",
  "value": {
    "dockLayout": {
      "top-left": null,
      "top-center": null,
      "top-right": null,
      "middle-left": null,
      "middle-right": null,
      "bottom-left": null,
      "bottom-center": null,
      "bottom-right": null
    }
  },
  "width": 400,
  "height": 300
}
```

## Toolbar only

A dock layout with a selection and rectangle button in the top center.

```json
{
  "tool": "dock-layout/tool.json",
  "value": {
    "dockLayout": {
      "top-left": null,
      "top-center": [
        { "viewUrl": "selection/button.json" },
        { "viewUrl": "rectangle/button.json" }
      ],
      "top-right": null,
      "middle-left": null,
      "middle-right": null,
      "bottom-left": null,
      "bottom-center": null,
      "bottom-right": null
    }
  },
  "width": 400,
  "height": 300
}
```
