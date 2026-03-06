---
name: folder
description: List and read files inside a Patchwork folder document by Automerge URL. Use when you need to browse or read the contents of a folder.
---

# Folder Skill

Browse a Patchwork folder document using `repo`.

## Import

```javascript
const { getFolder } = await loadSkill('folder');
```

## API

### `getFolder(repo, url)` — async

Returns `{ list(), readFile(name) }` for the folder at `url`.

| Method | Description |
|--------|-------------|
| `list()` | Returns `[{ name, type, url }]` for all entries in the folder. |
| `readFile(name)` | Async. Reads a file entry by name, returns its content as a string. |

## Examples

```javascript
const { getFolder } = await loadSkill('folder');

const folder = await getFolder(repo, 'automerge:abc123');

// List entries
const entries = folder.list();
console.log(entries); // [{ name: 'README.md', type: 'file', url: 'automerge:...' }, ...]

// Read a file by name
const content = await folder.readFile('README.md');
console.log(content);
```
