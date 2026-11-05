# Driving Patchwork tools from Livelymerge

This is a record of the first malleability experiment: Livelymerge (LM) controlling a TLDraw
canvas that is open in a different browser window. It covers what worked, what didn't, and the
lessons for the next experiments. Written 2026-09-24.

## What works now

In any LM world, evaluate:

```js
linkToDoc('automerge:3wPV4Q7YTvBUYAWeu5zGkuT88Wh5')   // any TLDraw doc URL, id, or Patchwork link
```

This puts a `TLDrawDocLinkMorph` in the world. It shows three things:

- the canvas title;
- a status line such as "5 shapes · 1 selected";
- a live mini-map of the canvas, with the current TLDraw selection drawn in blue.

Its halo menu can:

- add a box, add a note, or turn the open ToDo list items into notes;
- spin or nudge the shapes selected in TLDraw;
- log the shapes to the console;
- mark a revert point, and revert the canvas to that mark.

The TLDraw doc can be open anywhere: another tab, another window, or not open at all. The
selection only comes through while TLDraw is open somewhere and broadcasting.

## How it works

There are three channels, and each one does one job.

| Channel | Direction | Used for |
|---|---|---|
| The Automerge document (`doc.store`) | read and write | shapes: create, move, rotate, delete, revert |
| Presence broadcasts on the doc handle | read | which shapes are selected in TLDraw |
| Doc history (`handle.view(heads)`) | read, then write back | revert to a marked version |

### 1. Reading and writing the TLDraw document

A TLDraw document is `{ store, schema }`. `store` maps a record id to a record. Records include:

- `page:page`, with `typeName: 'page'` and `name` holding the canvas title;
- `shape:…`, with `typeName: 'shape'`;
- camera and asset records.

Both our `llm-canvas` tool and Patchwork's built-in `tldraw4` tool use this layout.
When the store changes, TLDraw applies the Automerge patches to its live editor. So **editing the
doc is the same as editing the canvas**, and the edit shows up in every window.

The LM side gets the doc like this:

```js
window.repo.find(url)          // Patchwork's repo; returns a Promise of a DocHandle
handle.doc().store             // read
handle.change(d => { d.store[id] = record })   // write
```

TLDraw validates every record it loads. A new shape must be a complete record:

- `id`, `typeName: 'shape'`, `type`, `x`, `y`, `rotation`;
- `index`, a fractional z-order key; we use the current maximum plus `'V'`;
- `parentId` (the page id), `isLocked`, `opacity`, `meta`;
- a full `props` object for its type.

`TLDrawDocLinkMorph.addShape` builds the geo and note records. Their props match
`getDefaultProps()` in TLDraw 4.3/4.4. We checked this against the real
`@tldraw/tlschema` validator. Text lives in `props.richText`, as
`{type:'doc', content:[{type:'paragraph', content:[{type:'text', text}]}]}`.

A shape record's `x`, `y` is its **top-left**, and `rotation` turns it about that corner.
`rotateShapes` works out the shape's centre, so the spin looks right.

Every shape LM creates gets an id starting with `shape:lm…`. This makes our shapes easy to find
and clean up.

### 2. Reading the TLDraw selection (presence)

Selection is per-user session state. It is **not in the document**, so it has to come from
presence broadcasts: ephemeral messages sent on the doc handle, which reach every repo that has
the doc open. There are two formats:

- **`llm-canvas`** (older `useLocalAwareness` hooks) sends `[userId, instancePresenceRecord]`.
- **`tldraw4`** (automerge-repo 2.6 `Presence`) sends
  `{ __presence: { type: 'update', channel: 'presence', value: instancePresenceRecord } }`.
  It also sends `type: 'snapshot'` (the whole state) and `type: 'heartbeat'` (about 1/s, no data).

The `instance_presence` record carries `selectedShapeIds`.

**tldraw4 streams selection changes only while its window is active.** When the window loses
focus, it sends one final update, which is enough for "select there, then act here".

There's a subtlety when both views share one repo. A handle **never hears its own broadcasts**.
If TLDraw and LM ran in the same page, they would share one handle and presence would never
arrive. So the linker also wraps `handle.broadcast` to capture outgoing messages.

### 3. Revert

Automerge keeps the full history, and the doc handle can read any past version:

```js
handle.history()      // one heads-array per change, oldest first
handle.metadata(hash) // { time, actor, … } for a change
handle.view(heads)    // a read-only handle showing the doc at that version
```

"mark revert point" saves `handle.heads()` as strings in the link morph. That's a persistent
field, so it survives a reload, though not `init`. "revert" reads the store at those heads. It then:

- deletes the shapes that are new since the mark;
- re-creates the shapes that have been deleted since the mark;
- restores any field that changed, on the rest.

It does all this in one `change`. It's an ordinary forward edit, so the history is kept.

## LM ⇄ host rules we had to follow

These cost us most of the debugging time. LM code runs in its own heap, sees the page's `window`
through a proxy, and must not be entered by host callbacks outside a transaction.

1. **Keep host async work in host code.** A promise `.then` or an event listener written in LM
   would run LM code outside a transaction.

   The fix is `hostDocLinkerSource()`, a *string* of plain JS compiled with
   `new window.Function('prior', src)`. The result lives on `window._lmDocLinker` and does all of
   this:

   - `repo.find`;
   - the presence listener and the broadcast wrapper;
   - record enumeration;
   - all `handle.change` calls;
   - revert.

   LM only calls its methods synchronously, from menu actions and steps.

2. **Never store host objects in LM objects** (morph fields). Store strings (doc URL, heads,
   shape ids) and look up host objects on every use.

3. **Pass host values into host code.** Use `hostArray`, `hostObject` or `toHost` (a deep
   copy). LM arrays and objects handed to host code don't behave as expected.

4. **The window proxy exposes constructors, not statics.**
   - `new window.Object()` and `new window.Array()` work.
   - `window.Object.keys` does **not** exist. LM's own `Object.keys` handles host objects.
   - Also missing in LM: `Object.assign`.
   - `location` isn't visible from LM code.

5. **The host linker is rebuilt when its source changes.** `hostDocLinker()` compares the source
   text and carries the old `state` forward, so doc handles found earlier survive. Presence taps
   call through `window._lmDocLinker`, so an edited parser also applies to handles tapped by
   older code. Editing `hostDocLinkerSource` therefore takes effect without a page reload.

6. **Don't write to the doc every step.** `linkStep` runs every 400 ms and only calls
   `this.changed()` when the status text or a shape/selection signature string changes. It also
   avoids allocating LM objects in the step: it counts in loops, and builds a signature string.

7. **No backticks inside `hostDocLinkerSource`.** It's a template literal. A backtick in a
   comment ended the string once.

## Where the code is in `newdefs.js`

Line numbers are for the 2026-09-24 11:02 build.

| Lines (approx.) | What |
|---|---|
| 8688 | Section header "Patchwork Tool Adapters" |
| 8697–8728 | The in-page registry (`toolAdapterRegistry`, `patchworkToolAdapters`, `toolAdapterForDoc`) and helpers `hostArray`, `hostObject` |
| 8729 | `linkTLDraw()`, the world-menu "Link TLDraw canvas" (in-page adapter only) |
| 8748–9016 | `class TLDrawLinkMorph`, the behaviours and rendering (see below) |
| 9018 | Section "Linking by document" |
| 9026–9134 | `hostDocLinkerSource()`, the host-side JS: `find`, `tap`/`notePresence`, `doc`, `recordsOfType`, `title`, `putRecord`, `setFields`, `heads`, `revertShapesTo` |
| 9135–9161 | `hostDocLinker()`, `toHost()`, `automergeUrlFrom()` |
| 9162 | `linkToDoc(url)` |
| 9185–9418 | `class TLDrawDocLinkMorph extends TLDrawLinkMorph`, the doc-based primitives and revert |
| 9420 | `openTodoItems()`, which parses the `[ ]` items out of `todoList` |
| 9545, 9852 | The "Patchwork tools" system-browser categories (classes, globals) |
| 12958 | The world-menu item |
| 13323 | `showNotifyMenu(msg, atIfAny, worldIfAny)`, the general fleeting notice (near the pointer, else mid-screen, always on screen) |

### How the two link classes divide the work

`TLDrawLinkMorph` holds the **behaviours**:

- `spinSelection`, `spinStep`, `nudgeSelection`, `todoNotes`, `logShapes`;
- the stepping (`linkStep`);
- the rendering (`renderMeOn`, `renderMapOn`);
- the menu (`menuItems`, `doMenuItem`).

The behaviours are written in terms of a small set of **primitives**: `shapes()`,
`selectedIds()`, `addShape()`, `rotateShapes()`, `nudgeShapes()`, `zoomToFit()`,
`pollCanvas()`, `hostShapeList()` and `mapSignature()`.

`TLDrawDocLinkMorph` overrides only the primitives, to work through the document and presence.
It adds revert. The base class's own primitives use the in-page adapter from
`llm-canvas/src/tldraw/toolAdapter.ts`.

That split is the kernel idea in miniature. **Behaviour is ordinary, editable Morphic code, and
only the thin primitive layer knows how to reach a particular tool.**

`onCanvasEvent(evt)` is an empty hook in the base class, meant for reactive behaviour. Only
the in-page adapter calls it so far.

## The in-page adapter (built, not yet exercised)

`llm-canvas/src/tldraw/toolAdapter.ts` (llm-canvas 0.0.20) registers a `ToolAdapter` on
`window.__patchworkToolAdapters` whenever the canvas mounts. It offers:

- `info`, `shapes`, `selectedIds`, `select`;
- `createShape`, `updateShape`, `deleteShapes`;
- `rotateShapes`, `nudge`, `zoomToFit`;
- `drainEvents`, which returns queued selection and shape-change events.

It can do what the doc route can't: camera and zoom, the true live selection, and events
without polling. But it only works when the tool runs **in the same page** as LM, for example
embedded as a tile.

We haven't used it yet, for two reasons:

- your TLDraw docs open with Patchwork's **tldraw4** tool, not `llm-canvas`;
- separate windows are separate pages, so there is no shared `window`.

`llm-canvas` now builds from the published `@inkandswitch/patchwork-*` packages, whose
versions are identical to `patchwork-system/core`. Its old `link:../../patchwork-next/…`
dependencies were broken.

## Diagnosing live pages

The things that found the real problems were:

- **`node pwm/live.mjs eval --doc KvvFn --code '…'`** runs LM code in the LM tab. Return strings.
  Host `JSON.stringify` of an LM object gives `{}`.
- **A raw page-JS eval.** This is the same main-world `<script>` injection that `liveLib` does,
  but without `runtime.eval`. It ran in the *TLDraw* tab and read `window.repo.handles[id]`,
  history and presence directly. We wrote it as a throwaway `pwm/.live/rawEval.mjs`. It would be
  worth making permanent as `live.mjs raw --tab <hint> --code …`.
- **Listing Chrome tabs through AppleScript.** This showed the TLDraw doc was in another window,
  opened as `type=tldraw4`.
- **Instrumenting both sides for 20 s.** We wrapped `broadcast` in the TLDraw tab and added an
  `ephemeral-message` listener in the LM tab. That showed the presence format, and that messages
  do cross windows.
- **Reading the tool's shipped bundle,** `patchwork.inkandswitch.com/packages/tldraw4/dist/tool.js`,
  to find its presence protocol.

## Toward more interesting malleability experiments

What this experiment suggests:

- **The document is the universal API.** Any Patchwork tool's state is an Automerge doc that
  LM can read and write, with nothing installed in the tool. The work is learning each doc's
  schema and its validity rules.
- **Presence is the universal "what is the user doing" channel.** It covers selection, cursor
  and viewport, for any tool that uses automerge-repo presence, again with no changes to the
  tool.
- **History gives safe experimentation for free.** Mark, try something, revert.

Next steps that build on this:

1. **Generalise the linker.** `hostDocLinkerSource` is almost tool-neutral already. Split it
   into a generic `DocLink` (find, presence, heads, revert, record access) plus small per-tool
   schema classes, such as `TLDrawSchema` for building records and sizing shapes. Then linking
   a second tool is one new schema class.
2. **Conjoined behaviour between two tools.** For example, a TLDraw selection drives another
   tool's view, or notes on the canvas mirror a todo doc. This is what `onCanvasEvent` is for.
   Feed it from the doc route too, by diffing the store in `pollCanvas`, or with a host-side
   `handle.on('change')` that queues events for the LM step to drain.
3. **Write presence as well as read it.** LM could broadcast its own `instance_presence`, and
   appear in TLDraw as a collaborator with a cursor and a highlighted selection. That's "the
   kernel as a visible participant" rather than a hidden controller.
4. **Same-page experiments.** Embed LM in a TLDraw tile, or TLDraw in LM. That opens up the
   in-page adapter: camera, events, instant selection.
5. **Morphic proxies per shape.** A `TLShapeMorph` stores a shape id, mirrors the shape in LM,
   and can carry its own methods, such as a stepper that orbits it around another shape. That's
   per-object behaviour for another tool's objects.
6. **Make the diagnostics permanent.** Add `live.mjs raw`, a "who's broadcasting on this doc"
   inspector morph, and a history browser morph built on `handle.history()` and `view()`.

Two risks to watch for:

- **Schema drift.** TLDraw's record validators change between versions. `addShape` hard-codes
  4.3/4.4 props. Copying from an existing shape of the same type would be more robust.
- **Revert is wholesale.** It also undoes human edits made after the mark. A finer version
  would revert only changes whose actor is LM's repo (`handle.metadata(hash).actor`).
