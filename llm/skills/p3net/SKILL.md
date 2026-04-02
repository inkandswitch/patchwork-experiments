---
name: p3net
description: Inspect, manipulate, and create Petri net simulation documents (P3NetDoc) by Automerge URL. Use when working with Petri net token state — reading which tokens are in which places, adding or removing tokens, moving tokens between places, resetting the simulation, or creating a new net from scratch.
---

# P3Net Skill

Inspect, manipulate, and create Petri net simulation documents using `repo`.

## Import

```javascript
const { getP3Net, readSource, createDoc } = await loadSkill('p3net');
```

## API

### `getP3Net(repo, url)` — read/write an existing net

Returns a read/write interface for the P3NetDoc at `url`.

| Method | Description |
|--------|-------------|
| `getSourceUrl()` | Async. Returns the AutomergeUrl of the JS net definition. |
| `getState()` | Async. Returns `{ [placeId]: TokenInstance[] }` — all places and their tokens. |
| `getTokens(placeId)` | Async. Returns tokens in a specific place as `{ id, state }[]`. |
| `getCanvas()` | Async. Returns floating canvas tokens as `{ id, state, x, y }[]`. |
| `addToken(placeId, state)` | Adds a token to a place; returns the new token ID. |
| `removeToken(placeId, tokenId)` | Removes a token by ID; returns `true` if found. |
| `moveToken(fromPlace, tokenId, toPlace)` | Moves a token between places; returns `true` if found. |
| `reset()` | Clears all tokens from all places and the canvas. |

### `readSource(repo, p3netUrl)` — read the JS net definition

Async. Returns `{ sourceUrl, source }` where `source` is the full JS text of the net definition. Use this to inspect the net logic or to extract the `defineNet` import URL before creating a new net.

### `createDoc(repo, jsSource, initialTokens?)` — create a net from scratch

Creates a new `SourceDoc` (JS file) and `P3NetDoc` in one call. Returns the AutomergeUrl of the new P3NetDoc.

- `jsSource` — JS source string (see format below)
- `initialTokens` — optional `{ [placeId]: { state }[] }` to seed with tokens

## Creating a net from scratch

A net is defined by two documents:
1. **SourceDoc** — a JS file that default-exports `(handle, repo) => defineNet({...})`
2. **P3NetDoc** — `{ '@patchwork': { type: 'p3net' }, sourceUrl, tokens: {}, canvas: [] }`

`createDoc` handles both. The only information you need from outside is the URL to import `defineNet` from, which you get by reading the source of any existing net.

### Step 1 — get the `defineNet` import URL

```javascript
const { readSource, createDoc } = await loadSkill('p3net');

// Read an existing net to extract the defineNet import URL
const { source } = await readSource(repo, 'automerge:<existing-p3net-url>');
const defineNetUrl = source.match(/from '([^']+)'/)?.[1];
console.log('defineNet URL:', defineNetUrl);
```

### Step 2 — write the JS source

The source must default-export a factory `(handle, repo) => defineNet({...})`:

```javascript
const jsSource = `
import { defineNet } from '${defineNetUrl}'

export default (handle, repo) => defineNet({

  places: ['inbox', 'processing', 'done'],

  transitions: [
    {
      id: 'start',
      from: ['inbox'],
      to: ['processing'],
      // onConsumedTokens is optional; omitting it forwards the token unchanged
    },
    {
      id: 'finish',
      from: ['processing'],
      to: ['done'],
      async guard({ processing }) {
        // return false to block the transition
        return true
      },
    },
  ],

  tokenTypes: [
    {
      id: 'task',
      label: 'Task',
      color: '#7c3aed',
      create(repo) {
        return { type: 'task', title: 'Untitled' }
      },
    },
  ],

  getColor(state) {
    if (state.type === 'task') return '#7c3aed'
    return '#6b7280'
  },

})
`
```

### Step 3 — create the net

```javascript
const newUrl = createDoc(repo, jsSource, {
  inbox: [{ state: { type: 'task', title: 'My first task' } }],
});
console.log('Created P3Net:', newUrl);
```

## Token state and Automerge links

Token `state` is a plain object. If `state` contains an Automerge URL, the UI renders it as an embedded view:

```javascript
// Create a markdown doc for the token to link to
const docHandle = repo.create();
docHandle.change((d) => {
  d['@patchwork'] = { type: 'markdown' };
  d.content = '# My Task\n\nDetails here.';
});

net.addToken('inbox', { type: 'task', url: docHandle.url });
```

## Notes

- `addToken` / `removeToken` / `moveToken` / `reset` mutate the doc directly without running transition logic.
- `state.type` should match a token type `id` from the net's palette for the UI to render palette colors.
- Canvas tokens (`getCanvas`) are floating tokens that do not participate in transitions.
- To edit an existing net's logic, read the source with `readSource`, modify the JS string, then write it back via `repo.find(sourceUrl).change(d => { d.content = newSource })`.

