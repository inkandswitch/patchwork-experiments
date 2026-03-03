---
name: markdown-file
description: Read and write a single markdown document by Automerge URL. Use when you need to read from or write to a markdown (.md) document.
---

# Markdown File Skill

Read and write a markdown document using `repo`.

## Import

```javascript
const { getMarkdown } = await loadSkillModule('markdown-file');
```

## API

### `getMarkdown(repo, url)`

Returns `{ read(), write(content) }` for the document at `url`.

| Method | Description |
|--------|-------------|
| `read()` | Async. Returns the document's content as a string. |
| `write(content)` | Replaces the document's content. |

## Examples

```javascript
const { getMarkdown } = await loadSkillModule('markdown-file');

const md = getMarkdown(repo, 'automerge:abc123');

// Read
const text = await md.read();
console.log(text);

// Write
md.write('# My Notes\n\nHello world.');

// Read-modify-write
const existing = await md.read();
md.write(existing + '\n- New item');
```
