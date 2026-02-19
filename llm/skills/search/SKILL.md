---
name: search
description: Search for text or regex patterns across files. Use this whenever you need to find mentions of a person, topic, keyword, or phrase across documents. Always prefer this over manually reading files.
---

# Search Skill

Recursively search file contents for a text or regex pattern. Returns matching lines with file paths and line numbers.

## Import

```javascript
const { search } = await fs.importModule('/skills/search/index.js');
```

## API

### `search(fs, pattern, startPath?)`

Search for a pattern across all files under `startPath` (defaults to `"/"`).

- **fs** `object` — The filesystem object (provided by the LLM eval context)
- **pattern** `string | RegExp` — A plain string (case-insensitive substring match) or a `RegExp` for full regex matching
- **startPath** `string` (optional) — Directory to start searching from. Defaults to `"/"`

Returns `Array<{ file: string, line: string, lineNumber: number }>` — matching lines with their file path and 1-based line number.

## Examples

```javascript
const { search } = await fs.importModule('/skills/search/index.js');

// Find all files mentioning "TODO" (case-insensitive string match)
const results = await search(fs, 'TODO');
console.log(results);

// Search only in a specific directory
const results = await search(fs, 'import', '/src');
console.log(results);

// Regex: find function declarations
const fns = await search(fs, /function\s+\w+/);
console.log(fns);

// Regex: case-insensitive with the `i` flag
const hits = await search(fs, /error|warn/i);
console.log(hits);
```

## Guidelines

- String patterns are always case-insensitive; for regex, case sensitivity is controlled by the flags you pass (e.g. `/pat/i`)
- Only text files are searched (binary files and folders are skipped)
- The skill walks folders recursively using `fs.listFolder` and `fs.readFile`
- The `fs` object must be passed explicitly as the first argument
- Large files are read in full; be mindful of very large codebases
