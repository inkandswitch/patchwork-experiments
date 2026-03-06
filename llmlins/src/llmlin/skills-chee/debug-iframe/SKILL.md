---
name: debug-iframe
description: Inspect and debug a pinned Patchwork tool iframe. Use when a tool is broken, throwing errors, or showing unexpected output — inspect its DOM and console errors, then evaluate JS inside it to diagnose or patch the issue.
---

# Debug Iframe Skill

Two tools are available for inspecting pinned tool iframes: `inspect_iframe` and `eval_in_iframe`. Both are invoked via `tool-call` fenced blocks in the chat.

## Import (optional helper)

```js
const { formatToolCall } = await loadSkill('debug-iframe');
```

## Tool Calls

### `inspect_iframe` — Get DOM + console errors

Returns the current inner HTML of the iframe and any captured console errors.

````
```tool-call
tool: inspect_iframe
url: automerge:XXXXX
```
````

**Result format:**
```
DOM:
<div class="mytool-container">...</div>

Console errors:
TypeError: Cannot read properties of undefined (reading 'count')
  at render (mytool.js:42)
```

Use this first when a tool appears broken — check for runtime errors before reaching for `eval_in_iframe`.

---

### `eval_in_iframe` — Run JavaScript inside the iframe

Executes arbitrary JS in the context of the pinned tool's iframe and returns the result.

````
```tool-call
tool: eval_in_iframe
url: automerge:XXXXX
code: document.querySelector('.mytool-value')?.textContent
```
````

**Result format:**
```
"42"
```

For multi-line code, write it as a single expression or use a self-invoking function:

````
```tool-call
tool: eval_in_iframe
url: automerge:XXXXX
code: (() => { const doc = window.handle?.doc(); return JSON.stringify(doc, null, 2); })()
```
````

---

## Workflow: Debugging a Broken Tool

1. **Inspect first** — use `inspect_iframe` to capture the current DOM and any console errors.
2. **Identify the error** — look at the console error stack trace to find the file and line.
3. **Read the source** — use `read_doc` on the file doc URL to read the current JS source.
4. **Fix via eval** — for quick patches, use `eval_in_iframe` to test a fix in-place.
5. **Persist the fix** — update the actual source with `edit_doc` on the file doc, then update `lastSyncAt` on the folder doc to reload the module.

```
```tool-call
tool: edit_doc
url: automerge:FILE_DOC_URL
field: content
value: "/* fixed source code */"
```

```tool-call
tool: edit_doc
url: automerge:FOLDER_DOC_URL
field: lastSyncAt
value: 1700000000000
```
```

---

## Getting the iframe URL

The URL needed for `inspect_iframe` / `eval_in_iframe` is the **document URL** of the pinned tool instance (not the module/folder URL). It appears in the `@patchwork.suggestedImportUrl` field of the tool document, or can be found in the chat's sidebar pinned docs list.

To find it via `read_doc`:

````
```tool-call
tool: read_doc
url: automerge:TOOL_INSTANCE_URL
```
````

Look for `"@patchwork": { "suggestedImportUrl": "automerge:..." }` in the result.

---

## Helper API

```js
const { formatToolCall, parseToolResult } = await loadSkill('debug-iframe');

// Format a tool-call fence string
const fence = formatToolCall('eval_in_iframe', {
  url: 'automerge:XXXXX',
  code: 'document.title',
});
// Returns:
// "```tool-call\ntool: eval_in_iframe\nurl: automerge:XXXXX\ncode: document.title\n```"

// Parse a plain-text tool result to a JS value (best-effort)
const value = parseToolResult('"hello"');  // -> "hello"
const value2 = parseToolResult('42');      // -> 42
```
