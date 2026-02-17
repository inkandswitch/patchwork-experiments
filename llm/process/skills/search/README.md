---
name: search
description: Search for text patterns across files in the filesystem
---

# Search Skill

Recursively search file contents for a text pattern. Returns matching lines with file paths and line numbers.

## Import

```javascript
const { search } = await import("/<rootFolderUrl>/skills/search/index.js")
```

Replace `<rootFolderUrl>` with the actual automerge root folder URL (e.g. `automerge:ABC123`).

## API

### `search(pattern, startPath?)`

Search for a pattern across all files under `startPath` (defaults to `"/"`).

- **pattern** `string` — The text to search for (case-insensitive substring match)
- **startPath** `string` (optional) — Directory to start searching from. Defaults to `"/"`

Returns `Array<{ file: string, line: string, lineNumber: number }>` — matching lines with their file path and 1-based line number.

## Examples

```javascript
const { search } = await import("/<rootFolderUrl>/skills/search/index.js")

// Find all files mentioning "TODO"
const results = await search("TODO")
console.log(results)

// Search only in a specific directory
const results = await search("import", "/src")
console.log(results)
```

## Guidelines

- Searches are case-insensitive
- Only text files are searched (binary files and folders are skipped)
- The skill walks folders recursively using `fs.listFolder` and `fs.readFile`
- Large files are read in full; be mindful of very large codebases
