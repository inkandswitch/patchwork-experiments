# traversal

Going elsewhere from a [scene](../scene/README.md): an object that leads to
another document. A boat's companionway, a level's exit, a doorway to
another scene: the same trait, each with a verb of its own.

```
pnpm install && pnpm build && pnpm test
```

Going somewhere is traversal, not a link (scene/COMPOSITION.md §9): a link
places one world inside another, and an exit opens another world in place of
this one. Nothing crosses: the document it leads to opens as itself, where it
starts and in the activity it starts in, as it would for anyone opening it.

It doesn't depend on the scene package: it reads the trait in the shape below,
through the stage's contract (scene/STAGE.md), and the scene finds it by its
trait.

## What this package registers

| type | id | for |
|---|---|---|
| `scene:extension` | `traversal` | exits: the verb, on every surface (`src/extension.js`; the rules are `src/exit.js`, the leaving `src/go.js`) |

It declares no `activities`, so it runs whatever the viewer is doing, and
offers no activity of its own. It `requires` nothing: the use prompt is a
game's to bring into play.

## The trait

```js
"traversal.exit": {
  to?:   "automerge:…",   // where it leads: a document link, as the inspector's url fields take one
  verb?: string,          // what using it is called ("Go below", "Exit"); "Go" when missing or blank
}
```

- **No destination, no verb.** An exit whose `to` is missing, isn't a
  document link, or links to the document it's in leads nowhere, and offers
  nothing anywhere. So a part can carry an exit that a scene gives somewhere
  to go later (a boat's companionway, a map's exit switch), and until then
  it's only a part.
- `to` is passed on as written, `#…` and all (`automerge:<id>#<heads>` opens
  that version, as any Patchwork link does). The note's named frames
  (`url#name`, landing at a frame the other doc publishes) wait for the
  stage's `api.go`.
- The verb is trimmed and at most 40 characters.
- The inspector's "Add behaviour…" offers it (Leads to, Verb). A copy keeps
  where it leads (it's about the object).

## Using it

One verb, its own (**[F] Go below**, or "Go"), on every surface: the use
prompt, the menu, the inspector and the key map. It says `reach: true`, so
the stage measures it from the body's eye against the body's reach
(scene/TOOLS.md §4): walking, within 2 m of the point looked at (out of
reach it shows disabled, "too far"); in orbit, anywhere.

Using it sends Patchwork's `patchwork:open-document` event, `{ url: to }`,
bubbling and composed out of the stage's element: what openDocument in
`@inkandswitch/patchwork-elements` sends, and what the scene's inspector
sends to open a file. Patchwork opens that document there. It reads where the
exit leads again when it's used, so a destination changed meanwhile goes
where the doc now says. Nothing is written, claimed or held.

`go()` (`src/go.js`) is the one place that leaves. COMPOSITION.md §9 plans
`api.go(url)` on the stage (the view opening the doc and putting the eye at a
named frame); when it exists, `go()` becomes that call.

## Consumers

The same trait, unchanged, with different verbs:

- a boat's **companionway** (sailing's sloop): "Go below", no destination
  unless a scene gives it one;
- a map's **exit switch** (the doom package): "Exit", no destination unless a
  scene gives it one;
- a **doorway** to another scene (a Croquet-style portal: the doorway is the
  exit; drawing the world beyond it is the stage's, a link's job, not this);
- an arena level's **exit** to the next level.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe), with the trait's description |
| `src/exit.js` | the trait and its rules: where it leads, its verb, reach (pure) |
| `src/go.js` | leaving: the open-document event |
| `src/extension.js` | the stage's side: the one command |

## Testing

`pnpm test`:

- `src/exit.test.js`: every kind of `to` (13: missing, null, a number,
  blank, a web link, a bare scheme, not base58, a link, padded, with a
  `#name`, this doc, this doc with a `#name`) × every kind of `verb` (8) ×
  every target (6: the exit, an object without it, a group with it, a missing
  id, a ref, the scene): 624 cases, each against the rule stated plainly.
  Reach is the stage's, and scene's own tests (H9) cover it.
- `src/extension.test.js`: the one verb (F, `reach: true`, every surface);
  with nowhere to go, nothing offered and nothing sent; using
  it sends exactly one event, `{ url }`, bubbling and composed, from the
  stage's root, and writes nothing; it goes where the doc says when used; the
  metadata.

**The browser probe** (`probes/round-trip.mjs`) takes a visitor round a trip
between two scenes in headless Chrome, with real keys and a real mouse, in a
small shell that opens whatever an open-document event asks for, as
Patchwork does: the BUILT packages whose tools make the two scenes, and this
one. In each scene the visitor walks up to an exit made by another package;
with nowhere to go it offers nothing, and given the other scene it offers its
verb, and F opens that scene. Nothing either scene shows names the other.

```
(in each package it lists) pnpm build
node probes/round-trip.mjs [--shots <dir>] [--show] [--gpu]
```
