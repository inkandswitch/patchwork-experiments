---
name: todo-list
description: Read and write a todo-list document by Automerge URL. Use when you need to read, add, update, or delete todos in a todo-list document.
---

# Todo List Skill

Read and write a todo-list document using `repo`.

## Document Schema

```json
{
  "todos": [
    {
      "id": "0c3570b1-3ce9-4913-a904-00ca6e6153ad",
      "description": "Buy milk",
      "done": false
    }
  ],
  "@patchwork": {
    "type": "todo",
    "suggestedImportUrl": "automerge:3tRth7b23LCyB2DYCFK1GrH8NRH5"
  }
}
```

- `todos` — array of todo items
  - `id` — unique string identifier (use `crypto.randomUUID()` when creating new todos)
  - `description` — text of the todo
  - `done` — boolean completion status
- `@patchwork` — metadata, do not modify

## Usage

Use `repo.find(url)` to get the document handle, then mutate it with `handle.change(doc => { ... })`.

### Read all todos

```javascript
const handle = repo.find("automerge:...");
const doc = await handle.doc();
const todos = doc.todos;
```

### Add a todo

```javascript
const handle = repo.find("automerge:...");
handle.change((doc) => {
  doc.todos.push({
    id: crypto.randomUUID(),
    description: "New task",
    done: false,
  });
});
```

### Mark a todo as done

```javascript
const handle = repo.find("automerge:...");
handle.change((doc) => {
  const todo = doc.todos.find((t) => t.id === targetId);
  if (todo) todo.done = true;
});
```

### Update a todo's description

```javascript
const handle = repo.find("automerge:...");
handle.change((doc) => {
  const todo = doc.todos.find((t) => t.id === targetId);
  if (todo) todo.description = "Updated text";
});
```

### Delete a todo

```javascript
const handle = repo.find("automerge:...");
handle.change((doc) => {
  const idx = doc.todos.findIndex((t) => t.id === targetId);
  if (idx !== -1) doc.todos.splice(idx, 1);
});
```
