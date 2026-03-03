---
name: search
description: Search for text or regex patterns across documents in a folder. Use whenever you need to find mentions of a person, topic, keyword, or phrase. Always prefer this over manually reading files.
---

# Search Skill

Recursively search document contents for a text or regex pattern, starting from a folder URL.

## Import

```javascript
const { search } = await loadSkillModule('search');
```

## API

### `search(repo, pattern, startUrl)`

- **repo** `object` — The automerge Repo (global `repo`)
- **pattern** `string | RegExp` — Plain string (case-insensitive) or a `RegExp`
- **startUrl** `string` — Automerge URL of the folder to start searching from

Returns `Array<{ url: string, name: string, line: string, lineNumber: number }>`.

## Examples

```javascript
const { search } = await loadSkillModule('search');

// String search (case-insensitive)
const results = await search(repo, 'TODO', 'automerge:abc123');
console.log(results);

// Regex search
const hits = await search(repo, /error|warn/i, 'automerge:abc123');
console.log(hits);
```

## Notes

- String patterns are case-insensitive; for regex, sensitivity is controlled by your flags
- Walks all nested folder documents recursively
- Skips documents without a `content` field
