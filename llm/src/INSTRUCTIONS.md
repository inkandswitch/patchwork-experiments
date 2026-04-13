## Executing Code

To execute code, wrap it in `<script>` tags with a required description:

```html
<script data-description="brief description of what this does">
  // your code here
</script>
```

The description is **required** and should briefly explain what the script will do (under 10 words). Scripts run in an async context with `await` available at the top level.

## Automerge Documents

Documents are stored in Automerge, a CRDT library. Key patterns:

### Finding Documents

```javascript
const handle = await workspace.find(url);

// Access the document after find resolves
const doc = handle.doc();

// Modify documents with change()
handle.change((doc) => {
  doc.title = "New Title";
  doc.items.push({ id: "123", name: "Item" });
});
```

**Important:** You never need to call `handle.whenReady()` - the handle is ready once `find()` resolves.

### Creating Documents

```javascript
// Create a document — it is automatically added to the workspace folder
const handle = await workspace.create({ name: "My Document", type: "my-type" });

// Initialize the document
handle.change((doc) => {
  doc.title = "My Document";
  doc.items = [];
});

// Get the URL for later reference
const url = handle.url;
```

### Document Patterns

- Arrays: Use `push()`, `splice()`, `filter()` inside `change()`
- Objects: Assign properties directly inside `change()`
- Text: Use `Automerge.updateText(doc, ['field'], newValue)` for efficient text updates

**Important constraints:**

- **Mutate, don't reassign:** You cannot reassign objects or arrays. Mutate them instead.

  ```javascript
  // Wrong - reassigning the array
  handle.change((doc) => {
    doc.items = doc.items.filter((x) => x.active);
  });

  // Correct - mutate in place
  handle.change((doc) => {
    const toRemove = doc.items.filter((x) => !x.active);
    toRemove.forEach((item) => {
      const idx = doc.items.indexOf(item);
      if (idx !== -1) doc.items.splice(idx, 1);
    });
  });
  ```

- **No undefined values:** Never assign `undefined` to document fields. Use `delete` to remove a field, or set to `null`.

  ```javascript
  // Wrong
  doc.optionalField = undefined;

  // Correct
  delete doc.optionalField;
  // or
  doc.optionalField = null;
  ```

## Workspace API

The `workspace` object is available in all scripts:

| Method                      | Description                                |
| --------------------------- | ------------------------------------------ |
| `loadSkill(id)`             | Load a skill plugin and get its API        |
| `getSkillDocumentation(id)` | Get markdown documentation for a skill     |
| `find(url)`                 | Find a document by URL (async)             |
| `create({name?, type?})`    | Create a new document and add to folder    |
| `listDocuments()`           | List all documents in the workspace folder |

## Using Skills

Skills provide domain-specific APIs. Always load documentation first:

```javascript
// 1. Check what a skill can do
const docs = await workspace.getSkillDocumentation("skillId");
console.log(docs);

// 2. Load and use the skill
const skill = await workspace.loadSkill("skillId");
// ... use skill API as documented
```
