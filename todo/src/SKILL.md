---
name: todo
description: Create and manage todo list documents (TodoDoc). Use for task lists, checklists, and simple project tracking.
---

# Todo Skill

Create and manage todo list documents.

## Import

```javascript
const todo = await workspace.loadSkill("todo");
```

## Types

```javascript
// TodoDoc shape
{ title: string, todos: Todo[] }

// Todo item
{ id: string, description: string, done: boolean }
```

## API

### `createTodo(title)` (async)

Creates a new todo list. Returns `{ handle, url }`.

```javascript
const { url } = await todo.createTodo("Shopping List");
```

### `getTodo(url)` (async)

Returns interface for the todo at `url`:

| Method | Description |
|--------|-------------|
| `addItem(description)` | Adds a new todo item |
| `toggleItem(id)` | Toggles done state |
| `removeItem(id)` | Removes item by id |
| `getItems()` | Returns all items |
| `getTitle()` | Returns list title |
| `setTitle(title)` | Updates title |

## Examples

```javascript
const todo = await workspace.loadSkill("todo");

// Create a new list
const { url } = await todo.createTodo("Weekly Tasks");

// Work with existing list
const list = await todo.getTodo(url);
list.addItem("Review PRs");
list.addItem("Update docs");
list.addItem("Deploy to staging");

const items = list.getItems();
console.log(items);
// [{ id: "...", description: "Review PRs", done: false }, ...]

// Mark first item as done
list.toggleItem(items[0].id);

// Remove an item
list.removeItem(items[2].id);

// Update title
list.setTitle("Sprint Tasks");
```
