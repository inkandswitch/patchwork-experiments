---
name: p3net
description: Create and manipulate Petri net documents (P3NetDoc) by Automerge URL. Use when creating a new Petri net from a JS source string, reading an existing net's source, or managing tokens in a net's places.
---

# P3Net Skill

Create and manipulate Petri net documents. A P3NetDoc has a `sourceUrl` pointing to a FolderDoc (containing `net.js` and `package.json`) and a token state (`tokens`) keyed by place ID.

## Import

```javascript
const { createDoc, readSource, getTokens, addToken, removeToken } = await importSkillApi("p3net");
```

## Net source format

A net source is a plain JS module that default-exports a factory `(repo, api) => NetDef`. The runtime wraps it with `defineNet` automatically — no imports needed in the source.

`api` provides:
- `api.datatypes` — the datatype registry; use `await api.datatypes.load('markdown')` to get a loaded datatype
- `api.createDocOfDatatype2(datatype, repo, change?)` — creates a new Automerge document of the given type
- `api.runLLMProcess(repo, url)` — runs an LLM process document to completion

### Token state

Every token has exactly two fields:
```javascript
{ type: string, documentUrl: string }
```

`type` identifies the token kind. `documentUrl` is the Automerge URL of the backing document. All other metadata (e.g. `done`, iteration counts, secondary references) lives in that backing document.

### Net source example

```javascript
export default (repo, api) => ({
  places: ['inbox', 'processing', 'done'],

  transitions: [
    {
      id: 'start',
      from: ['inbox'],
      to: ['processing'],
      // guard: optional, return false to block firing
      async guard({ inbox }, repo) {
        const h = await repo.find(inbox.state.documentUrl)
        return h.doc()?.ready === true
      },
      // onConsumedTokens: transform input tokens into output tokens
      async onConsumedTokens({ inbox }, repo) {
        const processHandle = repo.create()
        processHandle.change(d => {
          d['@patchwork'] = { type: 'petrinet-llm-process' }
          d.output = []
          d.done = false
        })
        return {
          produce: [{ state: { type: 'job', documentUrl: processHandle.url }, toPlace: 'processing' }],
        }
      },
      // onProducedToken: side effects after animation, token is already in its place.
      // handle and repo are injected — no closure needed.
      async onProducedToken(token, handle, repo) {
        const processUrl = token.state.documentUrl
        api.runLLMProcess(repo, processUrl).then(() => {
          repo.find(processUrl).then(h => h.change(d => { d.done = true }))
        })
      },
    },
    {
      id: 'complete',
      from: ['processing'],
      to: ['done'],
      async guard({ processing }, repo) {
        const h = await repo.find(processing.state.documentUrl)
        return h.doc()?.done === true
      },
    },
  ],

  tokenTypes: [
    {
      id: 'inbox-item',
      label: 'Inbox Item',
      color: '#7c3aed',
      // create() can be async — repo and api are in scope from the factory closure
      async create() {
        const markdown = await api.datatypes.load('markdown')
        const h = await api.createDocOfDatatype2(markdown, repo)
        return { type: 'inbox-item', documentUrl: h.url }
      },
    },
  ],

  getColor(state) {
    if (state.type === 'inbox-item') return '#7c3aed'
    if (state.type === 'job') return '#d97706'
    return '#6b7280'
  },
})
```

### `TokensResult` returned by `onConsumedTokens`

```javascript
// Forward inputs unchanged to all to-places (default when omitted)
return {}

// Destroy some inputs, forward the rest
return { destroy: ['inbox'] }

// Produce explicit output tokens (all inputs consumed, only listed tokens go to outputs)
return {
  produce: [
    { state: { type: 'job', documentUrl: someUrl }, toPlace: 'processing' },  // toPlace is optional
  ],
}
```

## API

### `createDoc(repo, netSource)` → `string` (AutomergeUrl)

Creates a new P3NetDoc from a JS source string. The source is stored as a `SourceDoc` (file) referenced by `doc.sourceUrl`. Returns the URL of the new P3NetDoc.

**`repo.create()` is synchronous — this function must NOT be awaited.**

```javascript
const netUrl = createDoc(repo, netSource)
```

### `readSource(repo, url)` (async) → `{ source: string, sourceUrl: string }`

Reads the JS source from an existing P3NetDoc.

```javascript
const { source, sourceUrl } = await readSource(repo, existingNetUrl)
```

### `writeSource(repo, url, newSource)` (async)

Replaces the JS source of an existing P3NetDoc's source document.

```javascript
await writeSource(repo, netUrl, updatedSource)
```

### `getTokens(repo, url, placeId?)` (async) → `{ id, placeId, state }[]`

Returns all tokens across all places, or only tokens in `placeId` if provided.

```javascript
const running = await getTokens(repo, netUrl, 'running')
// Each token: { id: string, placeId: string, state: { type: string, documentUrl: string } }
```

### `addToken(repo, url, placeId, state)` (async)

Adds a token with the given state to `placeId`.

```javascript
await addToken(repo, netUrl, 'inbox', { type: 'inbox-item', documentUrl: docUrl })
```

### `removeToken(repo, url, placeId, tokenId)` (async)

Removes the token with `tokenId` from `placeId`.

```javascript
await removeToken(repo, netUrl, 'inbox', tokenId)
```

## Example: create a simple net

```javascript
const { createDoc } = await importSkillApi("p3net");

const netSource = `export default (repo, api) => ({
  places: ['todo', 'done'],
  transitions: [{
    id: 'complete',
    from: ['todo'],
    to: ['done'],
  }],
  tokenTypes: [{
    id: 'task',
    label: 'Task',
    color: '#7c3aed',
    async create() {
      const markdown = await api.datatypes.load('markdown')
      const h = await api.createDocOfDatatype2(markdown, repo)
      return { type: 'task', documentUrl: h.url }
    },
  }],
  getColor(state) { return '#7c3aed' },
})`;

const netUrl = createDoc(repo, netSource);
```

## Example: create a net that launches an LLM process

```javascript
const { createDoc } = await importSkillApi("p3net");

const netSource = `export default (repo, api) => ({
  places: ['inbox', 'running'],
  transitions: [{
    id: 'start',
    from: ['inbox'],
    to: ['running'],
    async onConsumedTokens({ inbox }, repo) {
      const inboxDoc = (await repo.find(inbox.state.documentUrl)).doc()
      const processHandle = repo.create()
      processHandle.change(d => {
        d['@patchwork'] = { type: 'petrinet-llm-process' }
        d.prompt = inboxDoc?.content ?? ''
        d.output = []
        d.done = false
      })
      return { produce: [{ state: { type: 'run', documentUrl: processHandle.url }, toPlace: 'running' }] }
    },
    async onProducedToken(token, handle, repo) {
      const processUrl = token.state.documentUrl
      api.runLLMProcess(repo, processUrl).then(() => {
        repo.find(processUrl).then(h => h.change(d => { d.done = true }))
      })
    },
  }, {
    id: 'complete',
    from: ['running'],
    to: ['inbox'],
    async guard({ running }, repo) {
      const h = await repo.find(running.state.documentUrl)
      return h.doc()?.done === true
    },
    async onConsumedTokens({ running }, repo) {
      const processDoc = (await repo.find(running.state.documentUrl)).doc()
      return { produce: [{ state: { type: 'result', documentUrl: processDoc.docUrl }, toPlace: 'inbox' }] }
    },
  }],
  tokenTypes: [{
    id: 'inbox-item',
    label: 'Inbox Item',
    color: '#7c3aed',
    async create() {
      const markdown = await api.datatypes.load('markdown')
      const h = await api.createDocOfDatatype2(markdown, repo)
      return { type: 'inbox-item', documentUrl: h.url }
    },
  }],
  getColor(state) {
    if (state.type === 'inbox-item') return '#7c3aed'
    if (state.type === 'run') return '#d97706'
    if (state.type === 'result') return '#16a34a'
    return '#6b7280'
  },
})`;

const netUrl = createDoc(repo, netSource);
```
