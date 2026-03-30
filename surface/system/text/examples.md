# Text

## Empty text

A blank text field.

```json
{
  "tool": "text/tool.js",
  "value": { "x": 0, "y": 0, "toolUrl": "text/tool.js", "text": "" },
  "width": 250,
  "height": 60
}
```

## Hello world

A simple greeting.

```json
{
  "tool": "text/tool.js",
  "value": { "x": 0, "y": 0, "toolUrl": "text/tool.js", "text": "Hello, world!" },
  "width": 250,
  "height": 60
}
```

## Multiline note

A text block with multiple lines.

```json
{
  "tool": "text/tool.js",
  "value": { "x": 0, "y": 0, "toolUrl": "text/tool.js", "text": "Meeting notes:\n- Review Q3 goals\n- Discuss roadmap\n- Assign action items" },
  "width": 280,
  "height": 120
}
```

## Text button

The toolbar button that activates the text placement tool.

```json
{
  "tool": "text/button.js",
  "value": { "x": 0, "y": 0, "toolUrl": "text/button.js" },
  "width": 32,
  "height": 32
}
```
