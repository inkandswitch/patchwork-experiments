# bag

A token bag: a **container**. It is a thing on the table that holds other
things out of sight, shows how many, takes what is dropped on it and gives
what is drawn from it. It is a physical component, not a rule: it knows
nothing of turns, hands, seats or limits, and enforces none.

A bag is its own document, with its own 2D panel, and has a presence in any
[scene](../scene/README.md). It needs no other package but the scene, and in
particular not `tabletop`: a deck there is ordered cards with backs; a bag
relaxes all three (no order, any object, things go back in during play).

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `bag` | a bag: its title, look, draw rule and contents |
| `patchwork:tool` | `bag` | its 2D panel: contents by kind with counts, the total, the rule, Draw / Draw several / Empty, and what was taken out. Useful on its own, outside any scene |
| `scene:source` | `bag-sack` | the bag built as a GLB at real size: a plain drawstring sack (20 cm by default) |
| `scene:part` | `bag.token-bag` | the parts bin's "Token bag" (under Containers): makes a new bag doc and adds it |
| `scene:extension` | `bag` | the container verbs in a scene, in play and in edit (trait `bag.container`) |

## The verbs

Taken from what real bags and cups are asked to do (Scrabble's exchange,
Azul's refill from the lid, chit-pull cups, a bag per player that is drawn
from quickly, tiles that move freely between a bag and the table), without
any game's rule:

| | how | what happens |
|---|---|---|
| **Put in** | carry a piece with the hand and let go over the bag; or right-click a piece or a group (or the inspector) → Put in *bag* | it leaves the scene doc in one change and is in the bag doc. A group goes in as its members (and the emptied group goes too). Several bags at a table are told apart by title |
| **Draw** | hover the bag and press **D** (the use prompt: "Draw from Token bag (3)"), or the menu | one item, by the bag's rule, is an object in the scene again and is in the drawer's hand (the scene hand's `carry`): it follows the pointer until the next click, which puts it down wherever the drawer chooses. With no hand running, it is set down beside the bag |
| **Draw several** | menu or inspector → Draw 2…10 | that many, each drawn on its own, set down in a row round the bag |
| **Pour into** | menu or inspector on a bag → Pour into *other bag* | everything inside goes into the other bag |
| **Empty out** | menu or inspector, editing only | everything is set down round the bag |
| **Look inside** | menu or inspector on a bag | the bag's own panel docks beside the scene. This is the only way to see what is inside without drawing, **anyone can**, and the others are told that you looked |

Everyone else is told what was done, with `api.send`: "*Ana* drew from *Token
bag*", "put 2 things in", "poured … into …", "looked inside". Which bag and
how many, never what. Received messages are checked for shape and for naming
a bag of this scene; anything else is dropped.

What mustn't go in doesn't: the bag itself (through any object of the same
bag doc), a bag that holds this one at any depth, a locked object, one a peer
is holding, and anything a running extension vetoes with `carryable`.

**The count is public** (a label on the bag: "Token bag · 3"). **The contents
are not a secret**: see below.

## The document

```js
{
  "@patchwork": { type: "bag", suggestedImportUrl? },
  title: "Token bag",
  look: { color: "#7a5a3a", size: 0.2 },      // metres, at real size: how wide the sack is
  rule: "random",                             // "random" | "random-replace" | "top"
  items: {                                    // the contents: src/contents.js, and nothing else, reads or writes this
    "<item>#<nonce>": {                       // one PUT of one item, written once, whole
      id, from,                               // the object's id, and the scene it came from
      object: { name, sourceUrl, providerId, renderUrl, traits, tags, color, hint, … },
      scale,                                  // its size
      n,                                      // a stamp (one more than every stamp its writer had seen)
      out?: { by, n },                        // taken out: by which view, at which stamp. The record stays
    },
  },
}
```

- **What an item keeps** is its whole object record except where it was (its
  transform's position and rotation, its parent and its group) and the
  stage's runtime `claims`: everything needed to put it back exactly as it
  was, including traits, source, provider and render doc. Its scale is kept
  beside it. Going into a bag and coming out is a **move**, not the stage's
  copy: the object that comes out is the one that went in, under its own id
  when it comes out in the scene it came from, so a trait that knows it by id
  (a deck's hidden card) still does. Only a draw **with replacement** makes a
  copy, and that one goes through the stage's own rule (`api.addObject` with
  `fields`, and `render` seeded from the item's render doc).
- **An item in the bag is not in the scene doc.** That is what "inside" means
  here, and it is all it means.
- **Draw rules** are data (`rule`): `random` (without replacement, the
  default), `random-replace` (a copy comes out, the item stays in), `top`
  (last in, first out). The randomness of a draw is one function,
  `drawIndex` in `src/draw.js`, today the drawer's own `Math.random`; a fair,
  jointly drawn value will replace it there.
- **A copy of a bag doc starts empty** (`markCopy`): an item is in one place.

### Not a secret

Anyone who can open the bag doc can read what is in it: the panel shows it,
and so does any inspector. The scene doc's history also still holds every
object that was ever put in. The panel says so, every time. What a bag
gives you today is *out of sight*, not *hidden*: nobody sees the contents by
looking at the table, and looking in the panel is announced, but nothing
stops someone reading the document.

A jointly kept secret (contents nobody can read alone, a draw nobody can
choose) is planned as a stage-level capability. It replaces this storage, so
everything that reads or writes the contents is behind one small module,
`src/contents.js` (`inside`, `outside`, `putIn`, `takeOut`, `verdict`,
`forget`): that file's exports are what a keeper must provide, and
`drawIndex` is where its randomness goes.

## Two peers at once

A put and a draw each change **two** documents, the scene and the bag, and
the two reach a peer separately, in either order. Nothing makes that atomic.
The shape of the bag doc is chosen so that every merge of every interleaving
is harmless (the full argument is the header of `src/contents.js`):

1. **A put adds; a draw removes only the puts it saw.** Every put is a new
   entry under a tag nobody else can write, and taking an item out marks
   exactly the puts of it that are in the drawer's own copy (an
   observed-remove set). An object leaves the scene only in the same hand's
   put; that put can only be marked by a take that saw it; and a take is
   always the same hand's write of the item somewhere else. So **nothing is
   lost, by construction**.
2. **One key per item in the scene.** A drawn item is `objects[id]` under the
   id it went in with. Two draws of one item at once both write that key,
   Automerge keeps one whole value there, so **the scene has it once, by
   construction**.
3. **Who drew it is decided by the doc, the same for everyone.** Each take is
   stamped. Where two takes marked the same put the merge keeps one mark; a
   drawer none of whose marks survived has lost, and among those whose marks
   survived the lowest stamp has it. **Exactly one drawer reads "mine"** once
   the bag doc has merged; the other lets go and draws again.

**The invariant.** Once both docs have reached a peer, each item is in
exactly one place: an object in the scene, or inside one bag.

**The readers' rule that makes it so.** Some interleavings leave an item both
listed in the bag and an object in the scene (a draw that hadn't heard of a
put-back; a pour racing a draw; or just a put whose bag half arrived first).
Every reader settles those the same way, with no write: **the scene wins**.
A listed item whose object is in its scene is a stray: not counted, not
shown, not drawn. And an item listed in two bags of one scene is inside the
first by URL.

### Its honest limits

- **A stray stays listed.** Nothing is written for the readers' rule (a write
  was tried, and the exhaustive search found the loss in it), so the bag doc
  keeps listing a stray. The panel opened on its own, with no scene to check
  against, shows it as inside. If the stray's object is then deleted from
  the table, the item is inside again: back in the bag, rather than gone.
- **Half a move that never arrives.** A put writes the bag, then the scene,
  in one tick; a draw writes the scene, then the bag. If a tab dies after one
  of those reached its peers and before the other was ever sent: a put is
  then in both places (a stray: the scene wins, nothing lost); a draw is an
  object in the scene and still listed (the same). Neither loses the item.
- **Edits made while it goes in.** A peer who changes or deletes an object at
  the moment another puts it in loses that edit: the bag holds the object as
  the putter saw it.
- **Winning takes a merge.** A drawer can't know it has won, only that it
  hasn't lost yet. If the other's draw arrives after this one has already put
  the piece down (seconds of disconnection), the piece is theirs, wherever it
  now lies, and the loser is told and given another, set down beside the bag.
- **A pour racing a draw** of the same item through two bags can leave two
  drawers the bag docs can't tell apart (one took it from the first bag, one
  from the second after the pour). The docs are still right: one object, and
  no bag listing it. The hands settle who carries it (the stage's hold
  order makes one give way); the one who gave way picks it up again if the
  other lets go where it lies, and gives it up and draws another if the
  other puts it somewhere. This rests on presence, not on the docs.
- **Would a claim make a draw exclusive?** No. `api.claim` is the same kind
  of thing as the mark here: two views taking a claim at once both get a
  release, and the merge keeps one. It narrows nothing the mark doesn't, it
  lives in the scene doc (a third thing to merge), and a bag used without a
  scene has no claims at all. So there is no lock, and no window to hold one
  in: the doc settles it after the fact.

### How it is checked

`src/moves.test.js` runs two peers, each with its own real Automerge replicas
of the scene doc and two bag docs, through short programs of puts, draws,
put-backs and pours, and visits **every** interleaving of their steps and of
each doc reaching the other peer (a random draw branches over every item it
could take). At every end state it checks the invariant, that both peers'
docs are the same, that nothing is gone from the docs, and that no piece is
held by both peers. Nothing is sampled. `pnpm test` searches 25 pairs of
programs: 12,937 states, 751 end states, about 6 s. `BAG_FULL=1 pnpm test`
adds the 11 largest pairs: 36 pairs in all, 156,177 states, 7,055 end
states, about two minutes, all holding. (`BAG_TRACE=<file>` appends each
pair's numbers.) Two things the stage does that aren't in the docs are
modelled as it does them: a view doesn't put away a piece another view is
holding, and two views left holding one object once everything is delivered
are settled by the hands (the last limit above). That was needed 31 times in
4 of the 36 pairs (a pour then a draw against a pour then a draw, a draw, or a
draw and a put into the other bag; and, with one bag, each peer putting the
same piece in and then drawing), and never for draws alone from one bag,
which the test asserts.

The search is why the doc has this shape. It found a loss in each of two
earlier ones (one entry per item, replaced by each put; and a written-down
"left" mark for a stray), each a few steps long, each of which reads as
obviously fine.

`probes/bag.mjs` does it for real: the built scene and this package on real
Automerge documents, two views with a replica each, real mouse and keys in
headless Chrome, the link between the two peers held shut while both press
Draw. With `--rule top` both take the same token (42 checks); with `--rule
random`, whichever each draws (40 checks). Either way each ends up carrying a
different token, the count is 1, and every token is in exactly one place.
It needs `scene/` built beside this package; nothing else here does.

## In a scene

- **Which object is a bag**: one with the trait `bag.container`
  (`{ doc: url }`). Its bag document is the trait's `doc`, else the document
  the object is drawn from. So any object can be a container (a box lid, a
  cup: add the Container behaviour in the inspector and give it a bag
  document), and the sack is only what a bag doc looks like by default.
- **A bag doc dropped into a scene** becomes a bag there (the extension's
  `drop`), built by the `bag-sack` source, which reads only the bag's look:
  putting things in and drawing them never rebuilds it.
- **Where things come out**: beside the bag, in the frame the bag stands in
  (its parent's), so a bag on a table aboard a ship gives pieces that ride
  along. A drawn piece is then picked up from there.
- **What is attached to a piece stays behind** when it goes in (the stage's
  remove puts attachments back at the root where they were).
- **The panel's "Put it in a new scene"** writes a scene doc whole, with
  `packages` and `@patchwork.suggestedImportUrl` as every scene doc made
  outside the scene's own tool carries them. A scene written whole can't ask
  the stage for a render doc, so that bag is shown from a GLB file of the
  sack as it looked then.

## What the stage lacks (worked round here)

The bag is built only from the scene's extension contract
([STAGE.md](../scene/STAGE.md)). Where the contract had no word for what a
container needs, this is what it does instead:

| needed | the contract has | so the bag |
|---|---|---|
| "this was put down on me" | `landing`: a question the hand asks while it carries, not asked at all once the carrier has flipped the piece, and no event when it lets go | remembers which object this view's hand asked about, and when the doc then shows that object moved, looks at whether it lies on a bag. A drop is therefore two changes (the hand's put-down, then the bag's removal), not one |
| carry something from a key press, or something that doesn't exist yet | `carry(id, ev, opts)` returns a session "to give back from their press" | arms itself, feeds the pointer to the hand's session, and ends it on the next click |
| "is my own hand still holding this?" | `heldBy(id)`: peers only | infers that the hand gave way from a peer's hold appearing |
| put an object back as it was | `addObject` (a new id, a new render doc, asynchronous) and `remove`; no insert | writes `objects[id]` and `order` itself, in one change |
| what a copy leaves behind (runtime traits) | the rule is in `scene/src/transfer.js`, not on `api` | keeps every trait (a move, not a copy), dropping only `claims` |
| dock a document's own tool beside the scene | `api.edge` (camber.shape mounts its own app there) | mounts this package's own tool in the edge; there is no generic "dock this doc's tool" |
| two docs changed together | nothing | the doc shape above |

## Files

| | |
|---|---|
| `src/contents.js` | the contents: the one module that reads and writes them (the seam) |
| `src/draw.js` | the draw rules and `drawIndex` |
| `src/moves.js` | put, draw, pour, settle: the same writes for the extension, the tool and the tests |
| `src/object.js` | a scene object as the bag keeps it, and as it goes back |
| `src/place.js` | where things are set down round a bag |
| `src/datatype.js`, `src/sack.js`, `src/source.js`, `src/part.js` | the doc, its GLB, its provider, the part and the drop |
| `src/extension.js` | the stage side |
| `src/tool.js`, `src/styles.css` | the panel |
| `src/new-scene.js`, `src/empty-scene.js`, `src/scene-package.js`, `src/own-package.js` | scene docs made here, and where packages come from |
| `src/glb.js` | the GLB kit (v3), copied whole from `scene/src/glb.js` |
| `probes/` | the browser probe: `bag.mjs` drives `bag-probe.html`; `real-repo.js` is two peers on real Automerge docs |
