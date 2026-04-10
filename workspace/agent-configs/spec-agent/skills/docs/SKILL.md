---
name: docs
description: Read any Automerge document by URL. Returns the full document as a JSON object.
---

# Docs Skill

Read Automerge documents by URL. Use this to inspect reference documents, solution artifacts, or any other document in the workspace.

## Import

```javascript
const { readDoc } = await useSkill("docs");
```

## API

### `await readDoc(url)` (async)

Reads the document at the given Automerge URL and returns its full content as a plain JSON object.

```javascript
const doc = await readDoc("automerge:abc123");
console.log(JSON.stringify(doc, null, 2));
```

## Example — Read reference documents

```javascript
const { readDoc } = await useSkill("docs");

// Reference doc URLs are provided in the user message
const refs = [
  { name: "config.json", url: "automerge:abc123" },
  { name: "data.csv", url: "automerge:def456" },
];

for (const { name, url } of refs) {
  const doc = await readDoc(url);
  console.log(`=== ${name} ===`);
  console.log(JSON.stringify(doc, null, 2));
}
```
