# keep

**Keepers** for [scenes](../scene/README.md): what an object really is, kept
in a container document away from the scene, and shown only to whoever the
scene says may see it. This package has the **plain keeper** (a table, not a
vault).

A keeper is an ordinary `scene:extension` (scene/STAGE.md, "Keepers"),
attached to objects by its own trait:

```
"keep.plain": { by: <container url>, slot: n }
```

So a scene that uses it lists this package like any other, and someone who
arrives by link without it sees the objects' own (closed) looks and is
offered it. It names no other package. Who may see what comes from the
stage (`api.audience`, `api.shown`: whatever policies are running, such as a
table's hands and face-up cards); what it draws is by the one rule keepers
share (`src/rule.js`); whatever handles kept things (a table's Shuffle)
finds it through the `keeper` convention; and setup code finds it by its
plugin's `keeper: "plain"` and calls its module's `contain`.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `scene:extension` | `keep.plain` | the plain keeper (`src/plain-keeper.js`): trait `keep.plain`, `keeper: "plain"`, in every activity |
| `patchwork:datatype` | `keep-plain` | its container document (unlisted: setup code makes it) |

## The container

```ts
{ "@patchwork": { type: "keep-plain" }, title: string,
  items: any[],      // what is kept: any JSON (a scene puts { sourceUrl, name } here)
  at: number[] }     // slot k holds items[at[k]]
```

A scene object names a slot, in the scene doc, so moving or drawing a kept
thing is one change there and none here. A shuffle of some slots is a new
`at`, assigned whole: two shuffles at once merge to one of them, whole (no
item twice, none lost). `items` is never rewritten.

```js
const { key, bind } = await contain({ repo }, { title, items });   // slot k holds items[k]
object.traits = { ...bind(slot) };
```

## What a viewer sees

By the rule every keeper shares (`src/rule.js`), from the stage's two
answers for the object: `audience` (who may see what it is) and `shown` (who
it is turned toward, before anything screens it):

| | drawn as |
|---|---|
| the container isn't loaded, or the audience is unknown (a package the scene lists isn't here) | the object's own look |
| you're in the audience | the item (`{ sourceUrl, name }`) |
| else, you're in `shown` (it's turned toward you, and screened) | the stage's veil |
| else (face down; in another's hand) | the object's own look |

Two objects naming one slot: the lower id keeps it; the other stays closed
and the HUD flags it. A copy of a kept object leaves the binding behind (the
trait is `runtime`): it is only what it looks like.

## Threat model

This is a table, not a vault, and the HUD says so at every scene that uses
one ("… is kept in the open: anyone who opens its document can read
everything in it").

- **Someone who opens the container** reads every item and which slot holds
  it, and so, with the scene doc, what every object is.
- **Anyone can write it**: reorder it, change an item.
- **What keeps a card from a viewer** is their own client choosing not to
  draw it. A client that ignores the rule sees everything.
- **What is guaranteed**: the scene itself (objects, names, ids, order,
  groups, the files a view fetches before a look applies) says nothing of
  what anything is; and a client that follows the rule shows an item only
  to the audience the scene's policies give, and nothing while that is
  unknown.

For secrets nobody can read alone, use a joint keeper (card-table).

## Not here yet

A **sealed keeper** (an authored secret behind a commitment, opened to all
when its audience becomes everyone) belongs here too. It needs a private
place for its author's value that outlasts a browser, which the stage
doesn't have yet.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/plain-keeper.js` | the extension: looks by the rule, the HUD, the `keeper` convention, and `contain` |
| `src/plain.js` | the container: slots over items, shuffles that merge whole, its datatype (pure but for the handle a shuffle writes through) |
| `src/rule.js` | the look rule and the slot rule (pure; the same file in every keeper package) |
