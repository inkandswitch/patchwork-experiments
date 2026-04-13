# Markdown

## Markdown canvas

A paper canvas with text and drawing tools plus the markdown formatting card. Text shapes get live markdown preview with styled headings, bold, italic, links, and code.

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
            "md_card": { "viewUrl": "markdown/card.json", "data": { "x": 20, "y": 20 } },
            "note": { "viewUrl": "text/tool.json", "data": { "x": 80, "y": 80, "text": "# Hello Markdown\n\nThis is **bold** and *italic* text.\n\nA [link](https://example.com) and some `inline code`.\n\n## Lists\n\n- First item\n- Second item\n- Third item" } }
          }
        },
        {
          "viewUrl": "dock-layout/tool.json",
          "dockLayout": {
            "top-left": null,
            "top-center": [
              { "viewUrl": "selection/button.json" },
              { "viewUrl": "text/button.json" },
              { "viewUrl": "eraser/button.json" }
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

## Markdown card

The card that activates markdown formatting on all text shapes.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "viewUrl": "markdown/card.json", "data": { "x": 10, "y": 10 } }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```
