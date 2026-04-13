# Text

## Empty text

A blank text field.

```json
{
  "tool": "text/tool.json",
  "tags": [],
  "value": { "x": 0, "y": 0, "text": "" },
  "width": 250,
  "height": 60
}
```

## Hello world

A simple greeting.

```json
{
  "tool": "text/tool.json",
  "tags": [],
  "value": { "x": 0, "y": 0, "text": "Hello, world!" },
  "width": 250,
  "height": 60
}
```

## Multiline note

A text block with multiple lines.

```json
{
  "tool": "text/tool.json",
  "tags": [],
  "value": { "x": 0, "y": 0, "text": "Meeting notes:\n- Review Q3 goals\n- Discuss roadmap\n- Assign action items" },
  "width": 280,
  "height": 120
}
```

## Text button

The toolbar button that activates the text placement tool.

```json
{
  "tool": "paper/tool.json",
  "tags": [],
  "value": {
    "shapes": {
      "btn": { "x": 10, "y": 10, "viewUrl": "text/button.json" }
    }
  },
  "width": 200,
  "height": 80,
  "create": "shapes.btn"
}
```
