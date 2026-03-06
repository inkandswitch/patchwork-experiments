---
name: rich-messages
description: Send rich chat messages containing embedded files, existing documents, or new interactive tools. Use when you need to attach a file, embed a doc by URL, or build and share a patchwork tool inline.
---

# Rich Messages Skill

Chat messages can carry embedded Patchwork documents by including special fenced blocks alongside normal text. Each block is parsed and rendered as an inline `patchwork-view` inside the message.

## Three Block Types

### 1. `patchwork-tool` — Create a new interactive tool

Outputs a complete single-file JS module. The system creates the module doc, pins it in the sidebar, and embeds a live view in the message.

````
```patchwork-tool
// complete JS module — see build-patchwork-tool skill
export const plugins = [...];
```
````

Use this when building a new interactive mini-app from scratch.

---

### 2. `file` — Create and embed a new file

Creates a Patchwork file doc and embeds it inline. The content between the fences becomes the file body.

````
```file name=hello.js mimeType=application/javascript
console.log("hello world");
```
````

Opening line attributes:

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `name` | yes | — | File name shown in the embed (e.g. `style.css`, `data.json`) |
| `mimeType` | no | `text/plain` | MIME type of the content |

Common `mimeType` values:
- `application/javascript` — JS source files
- `text/css` — stylesheets
- `application/json` — JSON data
- `text/markdown` — Markdown documents
- `text/plain` — plain text (default)

Use this when sharing new code snippets, config files, or data files.

---

### 3. `embed` — Embed an existing document

Embeds any existing Patchwork doc by its Automerge URL. The doc renders inline as a live `patchwork-view`.

````
```embed
docUrl: automerge:XXXXX
title: my-file.js
```
````

Body fields:

| Field | Required | Description |
|-------|----------|-------------|
| `docUrl` | yes | Exact automerge URL from the workspace or chat context listing |
| `title` | no | Display label for the embed |

Use this when referencing a doc that already exists — never create a new file to share an existing one.

---

## Choosing the Right Block

| Situation | Block to use |
|-----------|-------------|
| Build a new interactive UI / game / tracker | `patchwork-tool` |
| Share new code, config, or data you're writing now | `file` |
| Reference a doc that already exists in the workspace | `embed` |
| Normal conversational reply | plain text (no block) |

## Multiple Attachments

You can include multiple blocks in a single response. Text outside the blocks becomes the message text shown above/between the embeds.

Example:

````
Here are two files for your review:

```file name=index.html mimeType=text/html
<!doctype html><html><body>Hello</body></html>
```

```file name=style.css mimeType=text/css
body { font-family: system-ui; }
```
````

## Notes

- All attachments render as embedded `patchwork-view` elements inside the chat message bubble.
- The `patchwork-tool` block also automatically pins the new tool in the sidebar.
- Do not nest blocks — each fence must be top-level in your response.
