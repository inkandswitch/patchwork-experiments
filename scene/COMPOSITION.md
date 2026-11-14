# Scenes made of scenes: a design note

A note to decide from, not a contract. [STAGE.md](STAGE.md) says what the
stage does today. [SCOPE.md](SCOPE.md) asks what an extension's scope should
be within one doc. This note asks what happens when a scene holds **another
scene document**: a card game on a ship's saloon table, a fit-out on a hull,
a level in a bay. Each section gives the options, what they cost, a
recommendation, and what it changes.

The bar: as few concepts as possible, each one general. No concept in the
stage makes sense for only one domain (cards, seats, ships). Identity,
state, time, frames, permissions and input stay separate. Every addition
needs two unrelated consumers, and so does everything already there.

## The idea

**A scene document is a world. A link places one world inside another.**

A link is an ordinary object whose content is a scene doc. To the host, the
linked scene is content, like a GLB: a box, surfaces a ray can hit, a frame
that rides whatever the link is attached to. To itself, it is a whole world
with its own **stage**: its snapshot, extensions, claims, channel, packages
and audience. The stages share one **view**: the canvas, the camera, the
pointer, the body stack and held tool ([TOOLS.md](TOOLS.md)), the viewer's
local state.

Extensions never see more than one doc. Inside a linked game, `null` still
means "the scene", now the game's root, and `api.url` is the game's. Nothing
about the game is taught to the stage, and nothing about the ship to the
game.

> **The stage composes docs only through space**: resting on something,
> riding it, being hit by a ray. An extension's snapshot is one scene doc.
> Anything else it reaches, it reaches by URL itself, as keepers reach
> their containers.

Two things a link is not:

- **Reuse is content; a place is a link.** A chess set's 32 pieces, 73
  coins, every car of one model: these are files or render objects placed
  many times, each with its own traits. A link is for an assembly that is a
  world of its own. A composite that must be reused with its own state per
  placement is copied.
- **Going somewhere is not a link.** A Doom exit, a teleporter, a portal
  names a doc to go to (section 9). A link would place E1M2 inside E1M1.

## Where we are

*As written, before build step 1; line references are to the code then.
Steps 1–14 have since been built (Build order, below). Since step 12 the
stage composes docs: Lost Cities aboard is two docs (the boat, with a
locked link to the game on its card table), and the Quiet games room links
its games, its Lost Cities table the same game doc as the boat's. Since
step 13 pins and mirrors open: "Fitting out" is a sloop whose companionway
is a fit-out fixed at a version, and one hatch linked live twice. Since
step 14 a viewer enters a linked doc to select and edit what's in it, the
boat live around them. What follows is kept as the record of why; where it
still holds, the step that left it says so.*

**The stage is one doc.** `Stage(handle, element)` closes over one handle
(`src/stage/stage.js:336`). Every per-object table is keyed by a doc-local
id. Presence, claims, activation, packages and the audience all read that
one doc. Nothing can show a scene inside a scene: dropping a scene doc fails
(`src/parts/add.js:247-248`), and the only cycle check is
`url === handle.url` (`stage.js:1417,1453`), so A→B→A is not caught.

**Lost Cities aboard is one doc, and it shows.**
`sailing/probes/publish-aboard.mjs` lays the game into the boat's doc, and
each of these exists only because two worlds share it: `placeLayout`
re-parents and re-frames every piece and seat camera
(`tabletop/src/setup.js:292-322`); the game must not write the host's `view`
or title (`tabletop/src/table/template.js:76-85`); `lay` writes seats "only
where the scene has none" (`seats/src/model.js`, `lay`); sailing tells
her fittings from a game's pieces by a `sailing.` prefix and "locked
furniture", and asks `camera.riding()` whether a game has seated the viewer
(`sailing/src/crew.js:87-140`). Scene-wide singletons are already wrong for
two games in one doc: one seats map, the joint keeper waiting on any
open seat (`card-table/src/deck.js:255-262`), `facing` reaching another
table's player.

**Much already composes**: a table written as a standalone doc
(`tabletop/src/tool.js:128-134`), keepers finding containers by URL, the bag
moving records between docs (`bag/src/moves.js`), pins at heads with `deps`
(`src/build.js:95-140`), conventions that are pure functions of a snapshot,
and an id-agnostic viewport, router and `ride.js`.

**One real hazard.** With a game open aboard and alone, a seat claim from
one reads as lapsed in the other, because presence runs on one handle. Two
views in one page never hear each other: automerge-repo doesn't echo a
broadcast within a page (`handle-registry.ts:376-381`). *Solved at step 12
by the page bus (section 6).*

## 1. What a link is

**Options.** A. A new top-level map (`links: {…}`). B. A new object
`kind: "link"`. C. An ordinary object whose source is a scene doc.

**Tradeoffs.** A duplicates everything an object has. B is a new branch in
every reader of objects. C needs nothing new in the doc.

**Recommendation: C.** `passthrough: true` on file-glb said what kind of
content a source makes. Make it a value with three cases (built at step 4,
with `"file"` and `"built"`; `"scene"` comes with links at step 11):

```js
{ type: "scene:source", id: "file-glb",   supportedDatatypes: ["file"],  content: "file",  … }
{ type: "scene:source", id: "scene.link", supportedDatatypes: ["scene"], content: "scene", … }
{ type: "scene:source", id: "openscad",   …,                             content: "built", … }
```

`content: "scene"` is the stage's one point of recursion: only the stage
shows it, by making a stage. At sync, content is routed by kind: `"file"` to
the GLB queue, `"built"` to the render manager, `"scene"` to a child stage.
A link is then:

```js
{ name, sourceUrl: <scene doc url>, providerId: "scene.link", renderUrl: null,
  parent?, group?, transform, visible, color, opacity, wireframe, locked?,
  hint: { bounds },        // the room the host gives it, in the link's frame
  at?: { heads, deps? },   // absent: live. Set: pinned (section 7)
  traits?, tags? }         // the host's facts about the link
```

- A link's traits are the **host's** facts about it (sailing locks it as
  furniture), never the linked root's. Display fields apply to everything
  drawn inside. A look may rename or veil a link, not replace its source.
  Things attach to a link as to any parent.
- **`hint.bounds` is the host's fact**, defaulted from the linked scene's box
  and refit by hand ("Fit"). A closed link is drawn as its hint, as any
  object is while its content hasn't arrived.
- **Dropping a scene doc makes a live link.** CAD and BIM do the same
  (Revit's linked model, Fusion's linked component). Pinning ("Fix at this
  version") and copying ("Make it its own") are explicit verbs on the link.

## 2. Nested stages

This is the decision that matters.

**Options.**
- **A. One stage, one composed snapshot, one instance per extension.** Ids
  become paths (`L/c7`); writes are routed by owning doc.
- **B. One composed snapshot, one instance per extension per doc**, each
  re-rooted to its doc, seeing descendants by path.
- **C. Nested stages.** One stage per open doc, each seeing only its doc,
  sharing a view.

**Tradeoffs.** A translates only the fields the stage knows are ids; an id
kept anywhere else (dice's `of`, a seat's `camera.in`) silently means
different things in different hosts, which is correct by audit, not by
construction. A link record would have two owners, and the audience must
still be computed per doc, since a released key can't be recalled. B binds
audience per doc openly, but every package speaks two id languages (its
own, and `L/x` below it). C keeps every API as it is: the game's extensions
can't tell whether it is open alone, aboard, or in two harbours. The price
is that a host can't read into what it contains (open question 1).

**Recommendation: C.** It is the only option where placement independence
(I4) holds by construction. No id grammar, routing, translation or
re-rooting.

| Concern | Where it lives |
|---|---|
| Identity | a live doc is its URL; a pinned value is (URL, heads); an object is (doc, local id). Occurrence paths exist only in the view, never stored or sent |
| State | each doc |
| Time | a link without `at` names an identity; with `at`, a value. A copy is a new identity |
| Frames | each stage works in its own root frame; the view converts at the link |
| Permissions | per stage, read from its handle |
| Input | the view's router; one segment per stage, innermost first |

**No reference crosses docs.** Under nested stages no extension holds an id
from another doc, so every id in a doc names an object of that doc: parent,
group and every `object` field. A relation lives in the doc that holds both
its ends. The view keys its nodes by occurrence path internally, and the
wire carries local ids on the owning doc's channel, which every viewer of
that doc understands whatever its host.

`src/stage/stage.js` splits in two:

```
View  (one per mounted tool)  DOM and edges, viewport, router, camera rig, labels, the body stack and held tool,
                              the view's atom, the session id, the fetch queue and its budget,
                              the focus, the expansion of links, the general parts
Stage (one per open doc)      handle, derive and snapshot, its extensions, claims, its channel,
                              packages reconcile, audience, lenses and veils, its own atom
```

`Stage(handle, element)` becomes `createStage({ handle, view })`; a child is
the same call with a `frame()` the view supplies.

## 3. Where code runs

**One rule.** An extension runs in a stage when that stage's doc has one of
its traits; nothing else decides it (TOOLS.md §1: no activities, no
`requires`). An extension with no traits is **general**: it belongs to the
view, which runs it once, at the **focus**. The focus is one stage: the
outermost, until Enter moves it (section 5).

So twenty linked games don't make twenty menus. A general part calls the
focus stage's api, so the editor edits the focus's doc, but it is in no
stage's running set. *As built (step 14):* each stage's host can run the
general parts, and the view has the focus stage's alone do so; Enter and
Leave stop them in the stage left and start them in the one entered, at
once (`host.setGeneral`), what each doc runs untouched (H1). Carrying shows the other case: it is a trait part
(`scene.carry` on the things that can be carried), so each stage whose doc
has carryable things runs its own, and a card aboard is carried by the
game's stage, in the game's doc.

The general parts that present others' contributions (STAGE.md's surfaces:
the key map, menu, notices, the packages card) run in every view, showing
nothing when nothing offers them anything. The view offers the union of
what its acting stages offer: commands, tools and bodies. The outermost doc
gives the defaults: the atmosphere and `view.start`, the body and place a
viewer starts in. Inner docs' spawns serve arrivals (section 9).

**`collect` is the caller's.** A stage's extension collects from its own
stage. A general part collects from every stage on the **input path**, the
stages from the hit's innermost out to the outermost (under pointer lock
the hit is the look ray's), then the focus stage if it isn't among them,
each tagged with its stage. A command runs
as `api.run({ stage, ext, command, target })`, in its own stage and frame. A
target never leaves its stage.

**Local state: two atoms, two names.** `api.view` holds the viewer's keys:
the body stack, the held tool, `theme`, `notices`, `packages`, `prefs`,
`focus`, selection and hover. `api.local` holds the stage's: `running`,
`status`, `<ext>.*`. A pref falls back to the calling stage's doc:
`view.prefs[k] ?? doc.view[k] ?? fallback`, so a game's display prefs hold
in the game unless the viewer chose. Material rules are each doc's, applied
to its own objects.

**Selection and hover are one value each**, `{ path, target }`, in the view.
`api.selected()` returns the calling stage's element of the path: its
target if it holds it, the link the path leaves through, else null.
`api.select(target)` stores the caller's path. Hovering a card aboard, the
game sees the card and the boat sees the link.

**Link state** is the view's, since it owns the expansion. A stage reads its
own links' with `api.link(id)` → `{ state, reason? }`.

## 4. Frames and the camera

**Each stage lives in its own root frame.** In stage S, everything spatial
is in S's root frame: `world`, `worldOf`, `box`, `sceneBox`, `raycast`,
`pick`, `project`, `extent`, `camera.*`, labels, and an event's ray and hit.
`frame(S)` is the parent's `worldOf(link)` as drawn, held poses included,
composed up the path.

**Frames are similarities.** A link's frame is the similarity part of its
drawn placement, by one fixed projection (rotation from the polar
decomposition, scale the cube root of the determinant). Then points convert
by the frame, directions and normals by its rotation, distances by its
scale, exactly. Boxes are computed in S's own frame. So the game never knows
it's on a ship: face up is the game root's +Y, the table's up, which heels
with her.

**"Not mine" is one value.** A hit on anything that isn't one of S's
objects (the host's deck, a sibling link, the ground) returns
`{ id: null, point, normal, distance }` in S's frame. The ground is the
outermost root's y = 0. A card set down off the table rests on the deck; a
walker in a linked level stands on the host's floor.

**The view answers space; no doc's code runs for another.** Rays, hits, the
ground and published frames (section 9) cross a doc boundary because the
view computes them. A sea's water height doesn't, because only sailing
knows it.

**The camera is the body's** (TOOLS.md §4). The current body's ride
applies; the stage's Look and Edit (the orbit camera) ride the focus stage's latest base ride. A seat
body rides the game's root; sailing's follow on her hull is base, and
gives way to any other body with no flag. `camera.ride(null)` rides the
stage's root, which is the link. `fallback` and `camera.riding()` go, and
sailing's `seatedView` with them: sailing learns it isn't driving because
its body isn't the current one.

## 5. Input

SCOPE.md §2 orders holders by nearness. Nested stages make that hold across
docs: the doc boundary is one more step out.

```
segment(S) = S's holders, nearest first; then extensions on S's root
order      = held tool → widget owner → segment(innermost on the path) → … → segment(outermost) → body's default
```

Each `(stage, extension)` is offered an event once, with `ev.hit` as that
stage's element of the path, in its frame.

A press on a card aboard goes to tabletop, seats, then the game's carry, and
only then to sailing, the boat's root and the body's default. A press on
the deck never reaches the game: the doc boundary is the scope.

The general parts come after every segment, wherever the hit is (they are
the view's, in the focus stage): so with the focus inside a game aboard, a
press on the deck still reaches the menu, the key map and the prompt.

**The focus scopes selection, not input** (TOOLS.md §3, superseding
decision 2's "edit stops at the focus"). Selecting a linked game's card
from outside selects the link, as CAD selects a component before its
parts. Enter on a link (double-click) moves the focus into it; Leave, Esc
or a breadcrumb moves it out. Moving the focus moves the general parts and
the selection, and puts down a held tool whose stage leaves the focus path;
it cuts no segment, so verbs and carries outside the focus still work.
Where an inner holder takes a press (a card's carry), the menu's Select
still selects the link.

**Keys** go to the view's one target of attention: the selection if any,
else the look. They visit its path innermost first; in each stage the key
map tries its element of the path, then that stage's null target. The
prompt and halo show hints from the same resolver, so a shown key works.
With a crate selected and the pointer on the game, D reaches the crate's
path, not the game's Draw: deselect first.

## 6. Channels, claims and the audience

**One channel per open live doc.** Everything about an object travels on its
doc's channel, in its own ids: claims, sends, presence keys and pose holds.
A seat claim lapses only when its holder leaves the game's channel, so a
viewer of the game alone and one aboard hear each other, and each replays a
carry under its own placement. The view owns one session id (and its
bfcache rotation) for all its channels. **A page bus** per doc URL delivers
a broadcast to every other stage of that doc in the page; its consumers are
split panes and mirrors (section 7).

**An object's audience is a function of its own doc.** The stage asks
`audience` and `looks` only of a stage's own extensions. General parts are
the view's, so they are never asked, and the focus can't change what an
object is. The same game alone, aboard and in a tavern releases the same
keys. Fail-closed is per stage: the game's audience is unknown while a
package the game lists is missing, never because of the boat. A host can't
screen a linked doc's secrets: a cabin wall hides the game from sight, not
from knowledge. The roster, `seatPlaces`, keepers' readiness and dice's
cups become per doc with no API change, since each is a pure function of
the snapshot its stage passes; the stalled deck, colliding p1/p2 and
`facing` across tables go with them.

**The stage knows no seats.** A seat is a sitting pose on an object, and
roles are a game's map onto seats (OMI_seat has the same shape). Walking up
to a seat crosses docs through what the view owns: sitting pushes the
game's seat body onto the view's body stack, over the walk body; standing
pops it and walking resumes from the eye. So `firstPerson` goes.

## 7. Permissions, live, pinned and mirrored

**Packages** are listed per doc (`neededPlugins(doc)`) and loaded as a
union: one prompt, naming which doc asks. A part run in the game's stage is
noted against the game.

**Read-only is the stage's.** A stage is read-only when its handle is, or
when it is a pin or a mirror. It refuses `change`, `addObject`, `claim`, `send` and `pose.hold`, reconcile
writes nothing, and its `api.repo` hands out read-only handles, so a keeper
in it can't write its container either. `api.writable` is there for hiding
verbs; nothing depends on an extension checking it.

**A doc the viewer can't open** is a closed link, drawn as its hint, with no
stage, channel or packages. A URL is a bearer capability in automerge-repo,
so "can't open" means *unavailable*, and the closed box enforces nothing.
When the core can say "forbidden", that case gets a padlock and nothing
else changes.

**Live and pinned.** `at` means what it means on a render object.
- **A live link is a place.** Everyone who links it live shares its state.
- **A pinned link is a value**: a read-only stage on `handle.view(heads)`.
  Every extension runs, so it looks as the place did, lenses and dressing
  included; nothing is claimed, so nobody is seated.
- **A pin is whole.** `fixPoint(link)` holds the heads of every doc reached
  through it in `deps`; a link inside the pin whose doc is missing there is
  closed `"unpinned"`. Renders show as of `deps`, never judged or rebuilt,
  so two hosts pinning one game at different heads don't fight over its
  render docs. *As built:* "reached through it" is what the stages under
  the link found through their repos **and** the pin's docs name by URL,
  transitively (the game names its deck, the deck its card files). A doc an
  extension finds that nothing in the pin names is the viewer's, not the
  pin's (a player's secret): `fixPoint` never records it, and a pin's repo
  finds such a doc as it is now (Decisions, step 13, 10 and 17).

**Linearity.** Runtime state (a helm's angle, a keeper binding, a claim) has
at most one writable holder among the docs a view reaches. A live link
shares the one holder; a pin can't write; copy, extract and bundle drop
runtime traits and `copy: "drop"` fields. There is no override layer: any
host opinion read inside a linked doc would let one game answer its
audience, looks or running set differently in two hosts (I4).

**Expansion** is a pure function in a new `src/stage/links.js`:

```js
expand(root, open) → [{ path, url, heads | null, role: "acting" | "mirror" | "pinned" | "closed", reason? }]
```

- **No identity repeats on a path.** A live URL already live on its path, or
  a pinned (URL, heads) already on it, is closed `"cycle"`. Checked at
  expansion, since a peer can close a loop later. A pin of an older version
  of the scene itself is allowed: its heads strictly precede.
- **A live doc acts at one occurrence per view**: the shallowest, then the
  smallest link id where two paths first differ. One viewer acting at two
  placements would run every extension twice under one session: two sims
  stepping, two keepers dealing, two seats. *As built (step 13):* every
  stage is keyed by its occurrence (path, role and identity), so when a doc
  arrives and the choice changes, the stage that acted closes (its claims
  go) and one opens where it acts now, with the mirror's stage closing in
  its turn (Decisions, step 13, 7).
- **Every other live occurrence is a mirror**: a read-only stage on the same
  live handle. It runs its extensions, so it looks the same, at its own
  placement. It is drawn, not acted on: its segment is never in the chain,
  it offers no tool or body, and it never computes its clock. *As built:*
  it draws into the world and nothing more (no chrome, camera, notices or
  processes: one facet of the api), and hears its channel without speaking
  on it. Its extensions read their own stage as anywhere (`api.collect`,
  audience, looks), so a mirrored hand is shown to whoever its seat says. By the page
  bus it hears its own view's acting stage, so a carry shows in both. A
  part used twice in an assembly follows latest twice; a copied link shows
  the same game, not a dead box.
- **Pinned values may repeat**, each its own read-only stage. Read-only
  stages are keyed by occurrence.
- Hiding a link stops drawing it and doesn't close its stage, so hiding the
  table can't unseat anyone.
- **The budget is the view's.** Expansion terminates without one, but a
  diamond of pins is exponential in paths, so the view opens at most N
  stages, nearest first.

Closed reasons are exactly `"unavailable"`, `"cycle"` and `"unpinned"`.

## 8. Making and moving things

**A child lives in its parent's doc.** Parts, drops, templates and paste
write the stage's own doc. From the boat, a part dropped on the link goes
into the boat, attached to the link; to put it into the game, enter the
game. A game part makes a game doc, as "Set up a table" does, and links it
onto the table. `ctx.file` keeps files in the stage's own `assets`.

**Carrying never moves an object to another doc.** Carry works in the
frame of the object's doc parent and never changes its doc. A card set
down off the table rests on the deck, rides the boat, and stays the game's
(open question 3). Moving between docs already has a mechanism: **one bag
doc placed in two scenes** moves pieces between them with the bag's
guarantees. Its harness checks one scene today; two is the work. A direct
move (a drag across a link, cargo between boats) waits for two consumers
being built; it would then be a view operation in which the source decides.

**Extract and bundle are one copy rule used in two directions**, each
followed by one host change. Both are edits and take an explicit set K of
root trait keys (checkboxes in the inspector, none ticked; nothing infers
K). Both drop runtime traits and `copy: "drop"` fields.

- **Extract(S, K)**, S siblings under `p`: write a new doc T whole, before
  anyone can know of it, with **ids kept** (a fresh doc has no collisions),
  transforms unchanged (`p`'s frame becomes T's root), `object` references
  to `p` set to `null`, the assets used, K's traits and reconciled
  packages. Then one host change: delete the subtree and K's traits, add a
  link at `p` (identity transform, `hint.bounds` from S's box), and clear
  references that now cross, with paste's notice. A crash between the two
  leaves an orphan doc and loses nothing.
- **Bundle(L, K)**: copy the linked doc's records in with `planCopy`, ids
  kept unless they collide, top-level transforms = link · local, K's traits
  onto the host root (refused per key the host has: "This scene already has
  Seats"), assets merged; remove the link. The linked doc is never written.

Since neither carries runtime state, linearity holds under any
interleaving, concurrent extracts included. `planCopy` gains
`{ traits: K }`; paste passes none, so nothing adds a root trait for you.

## 9. Named frames, and going elsewhere

**A scene doc may publish named frames**: `frames: { <name>: <local id> }`
on its root. A GLB connector with a `name` is the same thing. Two consumers:

- **Landing.** To its host, a linked scene's named frames are the link's
  connectors, as a GLB's `extras.connectors` are a file object's: carry
  snaps to them, and the view answers them in the host's frame. A station
  snapped to a fit-out's winch sits where the winch is. It doesn't follow
  the winch if the fit-out changes, because no reference crosses docs.
- **Traversal.** A Doom exit, a teleporter, an OMI link or crossing a
  Croquet portal is a package's field holding `url#name`. Going there is
  the view's: `api.go(url)` opens that doc as the outermost (with the
  `patchwork:open-document` event the inspector already sends) and puts the
  eye at the named frame, as standing up puts the walker at the eye. The
  arriving doc reads its own frame, so nothing crosses.

A name the doc doesn't publish resolves to its root.

## 10. The private layer

The hiding design's S4 puts private objects in a scene with `"own:<k>"`
ids, `scene().own`, a parent edge from private to public, and a presence
guard dropping any `"own:"` payload. That contradicts I2.

**Proposal:** the viewer's private doc for a scene is a scene doc, linked at
that scene's root by the view and found through tool storage. Private
objects get plain local ids; its channel is one only this viewer's devices
open, so the guard goes by construction; it adds and never overrides.

**What it costs.** A private piece can't attach to a public one: it rides
the scene, not a moving board. Its link lives in the view, so I3 becomes
"fixed by the graph and the view's one private link". And nothing acts on a
doc with no traits, so the package that makes a private doc writes its own
traits on its root (Battleship's `fleet`), and its extensions run there,
with carry wherever its pieces have `scene.carry`. Open question 4.

## 11. What leaves `scene/` and its consumers

Besides what the sections above delete: input's scope classes and the
`local.running` labels (nearness within segments replaces them), both
`url === handle.url` checks (the cycle rule), and seats, the roster and
`lay`, to a `seats/` package (open question 5). In the consumers, when they
choose: tabletop drops `placeLayout`, the `view` flag and the title guard
(host-titled decks went with games as data: a container is titled by its
game and deck, tabletop/GAME-FORMAT.md); every package's `requires` goes (TOOLS.md §1); sailing
drops telling a game's pieces from hers, since only carryable things carry;
publish-aboard walks the link graph. Once this note is accepted, SCOPE.md
shrinks to nearness within one doc.

## Prior art

| System | What it does | We take | We don't, and why |
|---|---|---|---|
| **USD** | References and payloads place assets; `kind` marks assembly, group, component; overs, variants, inherits and sublayers specialise what they reference | Payload drawn as its hint (`extentsHint`); assemblies are links, components are content | Overrides, variant selection, inherits across a link: any host opinion inside a linked doc breaks I4. Sublayers: docs split by object, never by field. Our hint is the host's, since a closed link may be unreadable |
| **IFC federation** | One file per discipline; STEP refs local to a file; shared hierarchy repeated by GlobalId; each file georeferenced | Ownership per doc; relations within one doc; sibling links | A spatial tree merged by GlobalId across files; georeference as a stage concept (the host places a doc, until a second consumer reads a doc's own frame) |
| **Doom, Quake** | Tags and `target`/`targetname` wire entities within one map; exits name a map | A relation lives in the doc with both ends; traversal is a `url`, not a link | — |
| **OMI glTF** | `OMI_seat` is a pose on a node with no roles; `OMI_link` is `{ uri }`, `#name` a place there; spawn points per node | Seats as poses on objects, roles the game's; `url#name` for traversal; spawns are the outermost doc's | — |
| **Croquet** | A session is one replicated model; Microverse portals show another world, in its own frame, through an opening | A live doc is one world on one channel, whoever holds it | Croquet never nests worlds: nesting is ours. A portal is a window, a different relation from placement, and belongs to the view; mirrors cover "seen twice" inside one view |

The name "link" follows CAD and BIM (Revit, Fusion, Blender's linked
libraries), where it means placement. OMI and HTML use it for traversal,
which is why section 9 keeps traversal a `url`.

## Worked examples

**1. Lost Cities aboard a moving ship.** Boat doc B: the hull, stations, the
card table, `sailing.sea`, and a link to game doc G on the table top,
locked. G: 60 cards bound to the deck container, piles, two trays, seats p1
and p2 in G's root frame, its own title, `scene.carry` on its cards, its
art and packages.
- B is the focus and runs sailing; one peer holds B's `"clock"` claim,
  steps the sea and the hull, and holds the hull's pose on B's channel.
  G's stage opens with the link and runs tabletop, its rule, the keeper,
  seats and carry. Cards ride the ship; face up is the table's up.
- Ana walks the deck (the walk body; as built, sailing's `aboard`), looks at p1, and the prompt folds in
  G's "Sit as Player 1". F claims `seat:p1` in G and enters G's seat
  body, which rides G's root, over the walk body.
- The deck waits on G's roster alone. A press on a card goes to G's
  segment, on the wheel to B's. A viewer without sailing still plays.

**2. A CAD assembly, one part pinned.** Assembly S: the hull (a render
object, `sailing.ship`), the rig (a render object following the hull), and
a link to fit-out F, pinned. F's stage is read-only at those heads; its
extensions run, so it looks as it did; camber can't change it, because the
stage refuses the write. Entering F offers "Follow latest". **Stations go in
S, not F**: a helm in a pinned F would be inert, and in a live F shared by
two harbours, one helm. A station snaps to F's published `winch` frame and
stays where it was put.

**3. One game, three places.** G is linked live in boat X and tavern Y; Cara
has G open alone. All three run a stage for G on G's channel. Ana's p1 and
Ben's p2 are both live for everyone, and all three keepers release the same
keys. X heels and Y doesn't; G can't tell. X's storm can't scatter Y's
cards, and a screen in Y can't hide Ana's hand. *Built and probed*
(`sailing/probes/links-run.mjs`, 20/20): one page, one repo, three views
(the room, the boat, G alone) sharing G's one handle, so only the page bus
carries G's channel between them; Ana at p1 in the room and Ben at p2
aboard, each hearing the other two; the secure deck dealt, each seeing only
their own hand's faces and Cara neither; each plays and draws through their
own room's or boat's key map; with her world running G's table leans up to
9.3° in Ben's view and not at all in Ana's or Cara's, and Ben's camera's up
is the table's.

## Invariants

Each is argued above and checkable over finite cases.

| | Invariant | Finite check |
|---|---|---|
| I1 | **One doc per extension.** Every read and write through an api goes to its stage's handle | Spy handles; run the scene parts', tabletop's, sailing's and the keepers' tests in a child stage; no other handle is touched |
| I2 | **No reference crosses docs.** Parent, group and every `object` field name an object of the same doc; a link is the only edge between docs | Every assignment over ≤3 docs × ≤3 objects, foreign ids included: the composed relation is intra-doc plus link → child roots, and acyclic |
| I3 | **Expansion is finite and fixed by the graph.** No identity repeats on a path; each live doc has exactly one acting occurrence, chosen by path order; the rest are mirrors; closed reasons are exact | Every link multigraph on ≤4 docs (live, pinned, self-pins, ≤2 links per pair) × every arrival order: terminates, and the final expansion is the same |
| I4 | **Placement independence.** A stage's snapshot, running set, `audience`, `looks` and `shown` are functions of its doc and the registry: never of its host, the focus, the viewer's body or held tool, or whether it acts or mirrors | Lost Cities G × seats {none, p1, p1+p2} × card states × body {look, edit, walk, seat} × held tool {none, measure} × clock {running, paused}: G alone, in X at 0° and 20° heel, in Y, mirrored, focus inside and outside: identical |
| I5 | **Channels.** An object's claims, holds and sends travel on its doc's channel | Three views of G (alone, in X, in Y; two in one page) on in-memory Automerge × every claim/release/leave order: `claimedBy` agrees once delivered; a carry in one shows in the others and in a mirror |
| I6 | **A read-only stage writes nothing**, through its api or its repo | Read-only handles whose `change` and `broadcast` throw; the Lost Cities probe against G pinned, unwritable and mirrored: no throw |
| I7 | **Frames.** For a similarity frame of S, points map by it, directions and normals by its rotation, distances by its scale; boxes are S's own | Property test over depth ≤3 × held and moving link poses × every spatial call and event field |
| I8 | **Chain and camera.** Inner segments before outer, out to the outermost whatever the focus; each (stage, extension) once; no segment, tool or body from a mirror; no held tool from a stage off the focus path; the applied ride is the current body's, and Look's and Edit's is the focus's latest base ride | `chainOrder` over depth ≤3 × hit × holder placement × focus × held tool; every body stack ≤3 × rides in each stage role |
| I9 | **Extract and bundle.** Each is one host change and writes no other existing doc; `bundle(extract(S, K), K)` equals the original on every non-runtime field when S has no edge outside | Every sibling set of a fixed 6-object scene with traits, refs, groups and a seats map × K ⊆ the root's traits |
| I10 | **Selection, hover and keys.** Each stage sees its own element of a path or null; keys visit attention's path (the selection's, else the look's), innermost first, and every hint is computed by the same resolver | Every pair of paths of depth ≤3 × target × body × held tool |
| I11 | **Linearity.** Runtime state has at most one writable holder among reachable docs | Every sequence and every interleaving of ≤3 of link, pin, copy, extract, bundle on ≤3 docs with one bound object and one claim |

## Build order

One order for this note and [TOOLS.md](TOOLS.md) ([T]), which replaces this
note's old step 2 ("generals are the view's; rides by arm"). Each step
ships alone and proves something.

1. **Nearness in `chain.js`** (SCOPE.md §2). Needed either way.
2. [T] **`api.dock`.** Camber, dice and bag move onto it.
3. [T] **Selection and carrying**: the halo, Select, `scene.carry`;
   `local.tool` goes.
4. **`content` in place of `passthrough`**, routed at sync. *Proves:*
   nothing changes for GLBs. *Built:* every `scene:source` declares
   `content`, and one that declares no kind is never offered (the stage
   warns once). `routeOf` (`src/providers.js`) routes at sync: an object
   with a render doc is `"built"` (only built content has one, and the
   manager shows what was built where the provider is missing); one
   without goes where its provider's kind says, `"file"` to the GLB queue;
   anything else loads nothing and is drawn as its hint, "no provider"
   while the registry lacks the id. That last is the one behaviour that
   changed: a render-less object used to be read as a GLB whatever its
   provider, which a link's scene doc must never be. Every GLB object
   names `file-glb`, so GLBs route as before, and the stage now imports
   the registry statically so the first sync routes them: the Solander
   probe (135 GLBs open, 378 in all) fetches, subscribes, draws and times
   the same as before. Routes are recomputed when the registry changes,
   and `api.loadState(id).content` says which
   (the inspector's "Open file" and status line read it). `"scene"` is
   not a kind yet: it arrives with the `scene.link` source at step 11,
   so no branch exists for a source nothing registers.
5. **Seats to `seats/`**, with the seat body's home ready for step 6.
   *Built:* `seats/` is its own package, one `scene:extension` (`seats`,
   `roster: true`) with the picker, name tags, the seat as a station, the
   roster and `lay` (`model.js`, pure), and the seat body (`body.js`:
   `seatPose`, pure, and `seatBody(api).enter(sid) → { seat, leave }`).
   The part enters the seat body itself through `api.camera` until step 6
   contributes it as `bodies` and drops the part's waiting on first person
   (`local.immersive`, `firstPerson`). The trait is `seats` and the claim
   `seat:<id>`, no longer `scene.`: that prefix is the scene package's.
   Old docs are ditched. The scene keeps no trace of seats (its plugin,
   part, CSS, fake world and README section went; STAGE.md's
   "Conventions" names the package). Every publisher of a table people sit
   at lists `seats` in `packages` (tabletop's tables, Lost Cities aboard,
   Liar's dice, Santorini since step 8 gave it seats), and every probe
   page that seats people installs it; in a shell the stage lists it
   itself, from the trait. *Proves:* the scene suite passes with no seats
   in it; `seats/` installs, builds and passes its suite copied out of the
   repo alone.
6. [T] **Bodies and the held tool**; rides by body, so `fallback` and
   `riding()` go. *Built:* see TOOLS.md's build order; the camera is the
   body's as section 4 says (a seat's ride is the only one while seated,
   Look and Edit ride sailing's base follow), and sitting from walking pushes the
   seat body over the walk body, so `firstPerson` went. Sailing walks her
   deck in a body of its own (`aboard`), not the walk body (TOOLS.md says
   why).
7. [T] **The clock**: one `"clock"` claim per doc, processes, ordered holds.
   *Built:* see TOOLS.md step 7 and §7's *Built* notes. One clock, one
   stage, until step 12 gives each linked doc its own.
8. [T] **Activities and `requires` go**, with `always` and `general:
   false`. *Proves:* every suite passes with less stage. *Built:* see
   TOOLS.md step 8: traits alone decide what runs, chrome follows
   attention (the inspector and outline are drawer tabs), `view.start` is
   read once on arrival, and undo takes back the stage's own edits.
9. [T] **STAGE.md, DESIGN.md and SCOPE.md** follow; old docs ditched,
   examples republished. *Begun ahead of step 8:* see TOOLS.md step 9.
10. **Split View from Stage, with one stage**: `api.view` with the body
    stack, held tool, focus and selection; the session in the view.
    *Proves:* suites pass; the I1 harness exists. *Built:* `src/stage/view.js`
    is the view: the mount, the viewport, the router, the camera and its
    saving, the body stack and the held tool, notices, prefs, the drawer, and
    the selection and hover as **paths**; `createStage({ handle, view, n,
    path, frame, under, general })` is a stage. `api.view` is `get()` (the
    view as this stage sees it: the selection and hover its element of their
    paths, the body's and held tool's owner its own extension id where they
    are its own), `watch`, `select(target)`; `api.local` keeps `running`,
    `status`, `edits`, `clock`, `packages` and extensions' keys. `update`
    is `update(scene, local, prev, view)` with `prev.view`, and the command
    context carries `view`. One key grammar (`src/stage/paths.js`) names a
    stage's object in the viewport and a stage's extension at the router:
    the outermost's ids are their own, any other's `SEP n SEP id`, injective
    whatever a doc puts in its ids. `src/stage/scope.js` is the frame choke
    point: a stage's ids and frame onto the viewport, every spatial call
    through it (boxes in the stage's own frame, by premultiplying each body's
    matrix; "not mine" is `id: null`); the viewport keeps groups and material
    rules per stage, and layers and labels may hang under a node. Every
    event reaches a stage's input, session, body or tool in its frame. The
    I1 harness is `src/stage/one-doc.test.js` (`src/test/spy.js`).
11. **Links, closed only**: the `scene.link` source, `links.js` and I3.
    *Built:* `expand(root, docOf, { budget })` as section 7 says, the
    closed reasons exactly three; inside a pin a live link is held at the
    pin's `deps` (a pinned link's own `deps` else the pin's). `scene.link`
    is a `scene:source` with `content: "scene"` for the `scene` datatype; an
    object through it is a link, with no render doc, routed `"scene"` at sync
    and drawn as its hint. Heads make it a pinned value. Both `url ===
    handle.url` checks went; the add part still refuses a scene in itself
    live (it would only be closed). I3 (`links.test.js`): every graph on 2
    docs with up to two links per ordered pair and an unavailable doc,
    every graph on 3 docs (one live or pinned link per ordered pair), every
    live graph on 4 docs, and every subset of a pin's deps, each over every
    arrival order.
12. **Links, open and live**: child stages, path keys in `viewport.js`, one
    frame choke point (I7), segments and `collect` on the path (I8),
    channels and the page bus (I5), audience per stage (I4), each doc's
    clock and carry in its own stage. *Proves:* Lost Cities aboard with G
    its own doc, cards carried without entering G, and G in two scenes, in
    a probe. The choke point can't catch code reading three.js
    `matrixWorld` directly (`dimensions.js`, camber's dressing); those need
    an audit. *Built:* the view expands the outermost doc's links whenever a
    doc changes or a linked doc arrives (`relink`), and opens a stage for
    each live doc where it acts, keyed by URL, its root under the link's
    node, its frame the link's drawn placement composed up the path; an
    acting occurrence that moves closes its stage and opens another (its
    claims go: the "acting occurrence can move" cost). A host draws an open
    link as its doc, else as its hint; `api.link(id)` says which. General
    extensions run in the focus (the outermost) only. The chain is a
    segment per stage on the hit's path, innermost first; a general part
    collects from every acting stage (the input path's first), items tagged
    with `stage`, and `api.run({ stage, … })` runs in that stage; `api.path()`
    gives the input path's stages, and the key map, use prompt and menu go a
    stage at a time (`keymap.js` `segmentsOf`). Presence, claims and holds
    are per doc; the **page bus** (`presence.js` `pageBus`) delivers each
    broadcast to every other presence on the same handle in the page (a
    copy, a microtask later), which is exactly where automerge-repo doesn't
    echo; presences on different handles are left to the network, so
    nothing is heard twice. One session per view, rotated on bfcache. Each
    stage has its clock. A ride may `tilt` (roll and pitch followed, the
    camera's up its object's), and the seat body rides its doc's root
    tilting, so a seat aboard rolls with its table (the lead's call: "roll
    with the table; the boat is how the boat is"). Retired with it:
    tabletop's `placeLayout`, the `view` flag and title guard, and "Sit at
    this table" (a game part makes a game doc and links it, locked);
    seats' `lay` renaming, `seatIds`, `seatsAround`, `roster.around` and
    the picker's groups (the picker follows attention); card-table's keeper
    waits on its doc's seats; sailing's prefix test (`sailingThing`) and
    "not hers" in `boardsOn`, and `seatedView` asks whether the current
    body is another extension's. *Proved* by `sailing/probes/links-run.mjs`
    (below, worked example 3). Not done here: mirrors and pins open (13),
    Enter/Leave (14); the packages card shows the focus doc's asks only; a
    hidden link hides only its hint (its doc's stage still draws); "who's
    here" shows people at a linked placement as "look" to a viewer of the
    game alone (the body chip publishes on the focus doc's channel).
13. **Pins and mirrors** (I6), which never compute. *Proves:* example 2; a
    part repeated live. *Built:* the view opens a stage for every occurrence
    the expansion doesn't close, keyed by its path, role and identity
    (`view.js` `relinkNow`): a live doc acts at the first in path order and
    is a mirror (`role: "mirror"`, a read-only stage on the same live
    handle) at the rest; a pinned link is a read-only stage on its doc at
    the pinned heads (`pinHandle`: `handle.view(heads)`, drawn as its hint
    until those heads arrive). `createStage({ role, deps })`: a stage that
    doesn't act (pin, mirror) is **drawn**: its extensions run and draw into
    the world, but it has no segment, body, tool, command or widget, puts no
    chrome in the DOM, doesn't move the camera, select, notify or set
    prefs, and starts no process; `view.acting()` and the input path pass
    over it. A stage that doesn't act, or whose handle refuses writes, is
    **read-only by construction**: its handle and repo come through
    `stage/readonly.js`, whose writes and sends throw, and every write path
    checks `writable()` first (change, addObject, remove, claim, pose.hold,
    the own parts' edits, parts, templates, drops, files); package
    reconcile writes nothing, the render manager builds nothing
    (`readOnly`), and presence only listens (`listen: true`: no hello, keys,
    sends, holds or bye; it hears its own session, which is how a mirror
    hears its view's acting stage over the page bus). A pin has no channel:
    no claim counts in it. `api.link(id)` → `{ role, open, reason? }`; the
    stage's role is the view's (`stage.role`), not an extension's. **A pin is whole:** a stage's repo notes every doc it finds,
    and `api.fixPoint(link)` (the view's `fixPointAt`) is the linked doc's
    heads with, in `deps`, the heads of every live doc opened under it and
    every doc their stages reached (render docs, files, a keeper's
    container); a pin's repo finds those at their heads. The inspector's Fix
    at this version and Follow latest take links as they take built
    content. I6 (`readonly-stage.test.js`): a pin, a mirror and a live doc
    whose handle refuses writes × every write, send, hold, claim, process,
    own edit, part, template, drop, `api.handle` and `api.repo` write, then
    a checkpoint's worth of world time, over docs whose `change` and
    `broadcast` throw: nothing reaches them and the stage never reaches its
    own refusal (no warning, no throw); for the drawn two, everything that
    would act; the wrappers over every refused method. Pins and mirrors in a
    view (`links-drawn.test.js`): roles and placements, an edit and a carry
    shown in the mirror over the page bus, a press on a mirrored card
    reaching the host as the link, the mirror acting once the acting link
    goes, a pin unmoved by its doc going on, fixPoint holding a nested doc
    and a container, Fix and Follow round trip. Presence's listening (every
    way it could speak × a minute) and the render manager's read-only (six
    reasons to build) have their own. *Proved* in Chrome by
    `sailing/probes/pins-run.mjs` (27/27; "Fitting out": a sloop at anchor
    whose companionway is a fit-out F fixed at a version, and one hatch W
    that closes itself, linked live twice): F changed live in its own view
    and the boat still shows it as fixed, with nothing written through the
    pin; looking at the pin or the mirror S offers nothing; F on the acting
    hatch opens it and the mirror shows it open at its own placement, then
    both close two seconds on, W's clock computed by the acting stage alone;
    writes through the pin and the mirror refused, quietly; Follow latest
    shows F as it is, and Fix at this version pins it again with its files
    in deps; under way, F and both hatches ride the hull to 9e-16.
    `publish-fitout.mjs --dry-run` 9/9 (22 docs). The audit step 12 asked
    for: the readers of three.js `matrixWorld` outside the viewport
    (`dimensions.js`, `gltf-content.js`, sailing's `sim.js`) all take it
    relative to a root, which is frame-invariant; `axes.js` reads
    `camera.object` as a general part (the focus, the outermost); sailing's
    `sea-view.js` takes `camera.object.position` in the world, wrong only
    for a sea in a linked doc. Camber's dressing is Rising Tide's and wasn't
    audited here. Not done here: Enter on a pin offering Follow latest
    (14). *Review fixes* (Decisions, step 13, 16–24): a drawn stage's
    extensions collect from their own stage (the roster reached a mirror as
    nothing, so a mirrored hand was shown to nobody), and the drawn api is
    one facet; `api.role` is gone; the stage's repo is an allowlist;
    `fixPoint` records only what the pin's docs name, packages are read
    through the view's repo, and a pin's stage is keyed by its deps too;
    card-table's keeper takes no part where it may not write, and a deck is
    the same deck at any version. Tested: I4 across acting, mirror and pin
    × seats {none, p1, p1 + p2} (`links-drawn.test.js`); the I6 harness
    with a spy on every read-only handle (the mirror's own output asserted
    empty, and a mirror beside a silent acting stage); the keeper × its
    writable twin {mine, mine pinned, theirs, none} (`card-table`). I6 as
    the invariant names it is *proved* in Chrome by `links-run.mjs` step 6
    (25/25): mid-play, the room links G again live and fixed, and Ana opens
    G through a handle that refuses writes; the mirror and that view show
    her exactly her acting stage's faces, the pin what she saw when it was
    fixed, through her play and draw, with no warning or error.
    `pins-run.mjs` 27/27 after the fixes.
14. **Edit in context**: Enter, Leave, link rows in the outline and
    inspector; H10 across docs. *Built:* the view's focus is a path of
    links entered; focus and selection change only through `selectionStep`
    (`src/selection.js`), so a selection is an element of the focus stage
    whoever asks: an extension of any stage (`api.view.select` is cut at the
    focus), Edit's click, the ladder, a link going. `api.view.enter(link)`
    goes where the link's doc acts (a mirror's: where it's live; a pin and a
    closed link aren't entered) and `api.view.leave()` out a link; the view
    reaches any focus whose every link acts by leaves and enters
    (`focusSteps`). A link that goes, is pinned or stops acting there leaves
    the focus out to the deepest stage still acting. The general parts run
    in the focus stage and no other (`host.setGeneral`), offered after every
    segment wherever the hit is, and the input path always ends at the focus,
    so outside an entered link verbs, carries, keys and the menu still work;
    Edit's click outside the focus isn't Edit's and goes down the chain. The
    resolver and the menu take a segment per stage on the input path
    always, each stage's commands in its own context and run there (the
    "outermost is the caller's" assumption went; a held verb pins attention
    in the stage it was held in); the toolbar holds the scene commands of
    the stages on the focus path (TOOLS.md §6), not the pointer's, so it
    doesn't change under the pointer (`api.path({ focus: true })`). A stage never sees the focus. `scene.focus`
    offers Enter on a link (menu, inspector; everyone's, every body) and
    takes a double-click on one; the outline's link rows say what the link
    is here (linked, shown again, fixed, closed) and enter (→, or a
    double-click); the inspector's Linked scene row says the same, with
    Open and what the host sets of it. The trail, the view's own chrome
    along the top while the focus is inside a link, names the outermost doc
    and each link entered (each crumb a way out) and has Leave; Escape's
    last rung leaves. Drawer tabs open as the focus moved open again inside.
    *Proves* (`stage/focus.test.js`): H10 across docs over every reachable
    focus and selection × every press (Edit's click), Select (each stage's
    api), Enter, Leave and Escape, in a view of a host with a live link L to
    B (B linking C live), a mirror R of B, a pin P of B and a closed link:
    11 states × 37 events, each transition what the pure model says, the
    focus and every link on its way a stage that acts, each stage seeing
    its own element and never the focus, the general parts in the focus
    stage alone, nothing written; a raw `select` fails it at the first
    transition. Every way a link can go while entered (removed, pinned, a
    link ahead of it) × the focus at B or C; another view of the same scene
    untouched (its focus, parts and running sets, no doc written); a press
    outside reaching its own parts then the general ones; double-click;
    the host's toolbar command shown and run in the host while entered, the
    bar unchanged as the pointer moves (the old toolbar fails it); the
    Objects tab reopened inside. `focusSteps` over every pair of foci
    in a two-wide, three-deep tree; every link state's labels. In Chrome:
    `sailing/probes/aboard-run.mjs` step 13 (A, under way, picks Edit,
    double-clicks a card to enter G, clicks it to select it, and drags its
    halo's X arrow: along the table's X only while she heels, written to G,
    the boat's link untouched; B untouched; Escape twice back out) and
    `links-run.mjs` step 6b (Ana, seated in her room, enters G by its
    mirror's link, where it acts; nothing else changes for anyone; she
    draws entered; Escape leaves). Decisions, step 14. Not done here: the
    clock chip and the packages card show the focus doc's only (TOOLS.md
    §6 wants a chip per doc on the focus path); "who's here" is announced
    on the focus doc's channel (as since step 12), so entering a game moves
    a viewer's body chip there and viewers of the host see them as "look"
    meanwhile; out of focus isn't tinted; in Edit the first click of a
    double-click selects the link and opens the inspector, which narrows the
    canvas under the second click (the probe aims again; a person on a small
    part of a link may miss).
15. **Extract and bundle** (I9, I11).
16. **Named frames and traversal**, when doom's exits or stations need them.

## What the stage doesn't do, and what it costs

- **Reason over two docs.** A boat rule reading the game, a sim reading a
  helm in a linked fit-out, a lever naming a game piece. An extension may
  open another doc by URL itself, at its own risk.
- **Reference, attach or group across docs.** Changing doc is extract,
  bundle or a container.
- **Screen a linked doc's secrets from its host.**
- **Specialise a linked doc.** No host opinion reaches inside it. A red
  wheel on one linked sedan is a copy of the sedan, which stops following
  it.
- **Split a doc by field.** Physics that names geometry lives with the
  geometry.
- **Act on a mirror or play a pin**, or give one live doc state per
  placement. Live is shared; copy to differ.
- **Run another doc's code for you.** Space crosses; water height doesn't.
- **Read a doc's own statement of where it is** (IFC's georeference). The
  host places it.

The costs:
- **Per-stage overhead.** N open links are N stages, N channels (about four
  messages a second at rest for twenty), N reconciles, and each mirror runs
  its extensions again. General parts are not multiplied.
- **A pinned or mirrored doc needs its packages**, since its extensions run.
- **Frame conversion is broad.** A missed one fails silently; the choke
  point and I7 are the defence.
- **Edit in context is the focus**, which scopes selection only
  (TOOLS.md §3).
- **A closed link discloses** its name, bounds, the host's traits on it, and
  the linked URL to anyone who can read the host.
- **Placement leaks into positions** (open question 3).
- **Extract drops runtime state.** An extracted game is dealt again. Only
  described `object` references are remapped, as with paste today.
- **The acting occurrence can move** when a shallower path arrives, and a
  seated view moves with it.

## Decisions (2026-11-11)

The five open questions were put to the project lead and answered:

1. **A host never reads into what it contains.** Accepted. The only
   couplings across a link are space and published frames.
2. **One activity per view, and edit stops at the focus.** Accepted for now;
   an activity per stage stays possible later. **Superseded by
   [TOOLS.md](TOOLS.md)**, whose decisions the project lead made on
   2026-11-12: there are no activities, and the focus scopes selection, not
   input.
3. **A piece set down outside its doc stays in its doc.** Accepted. Moving
   between docs goes through a container placed in both, until two direct
   moves are being built.
4. **The private layer is a doc the view links** (section 10). Accepted,
   before the hiding work's steps 5 and 6 are built.
5. **Seats leave `scene/`** for a `seats/` package, with the roster and
   `lay`. Accepted; the seats step goes ahead (build step 4 then, 5 now;
   built).

## Decisions, step 14 (2026-11-14, made unattended)

Made while building Edit in context, with the project lead away.

1. **The general parts move with the focus by stopping and starting.** Every
   stage's host can run them; the view has the focus stage's alone do so
   (`host.setGeneral`), and they stop at once in the stage left, not
   lingering, since the view moved them, not the doc. Why: §3's "the view
   runs it once, at the focus" with the one mechanism that exists (start,
   stop); pointing a running part's api at another stage would be a second.
   Cost: the chrome is made again on Enter and Leave.
2. **The general parts come after every segment, wherever the hit is, and
   the input path always ends at the focus.** Why: with them only in the
   focus stage's segment, entering a game would cut the boat's verbs off
   from the menu, the keys and the prompt (TOOLS.md Decisions 4: outside
   stays live), and the focus's scene commands (Frame all, Measure, Undo)
   would leave the surfaces whenever the pointer was outside. It also
   retired the resolver's, the menu's and the toolbar's assumption that
   the caller's stage is the outermost: a segment per path stage always,
   each stage's commands worked out in its own context and run in it (the
   toolbar used to run another stage's command in its own, where it isn't),
   and a held verb pins attention in the stage it was held in. The toolbar
   takes the focus path, not the input path (TOOLS.md §6 says so, and a bar
   that followed the pointer would change, and move the canvas, under it:
   the aboard probe found that).
3. **Enter goes where the doc acts.** A live link's there; a mirror's where
   its doc is live (the same doc, drawn again: edited where it's played);
   a pin and a closed link aren't entered, and Enter says why (a pin: Follow
   latest to go inside). Why: a drawn stage has no chrome by construction
   (step 13, 1), and a value isn't edited. Worked example 2's "Entering F
   offers Follow latest" is that disabled Enter and the inspector's Follow
   latest.
4. **The focus can be any path whose every link acts**, reached by leaves
   then enters, each a `selectionStep` (`focusSteps`). `api.view.enter`
   from any stage moves it there. Why: one mechanism keeps H10, and a
   mirror's Enter and the trail's crumbs move it more than a level.
5. **No stage sees the focus**: `projectView` leaves it out. Why: an
   extension that read it could act differently entered than not (I4), as
   step 13's 21 removed `api.role`.
6. **Selecting from any stage is cut at the focus.** `api.view.select` in a
   game's stage with the focus on the boat selects the link (it used to
   store the game's path). Why: H10 by construction, whoever asks.
7. **Edit's click outside the focus isn't Edit's**: it goes down the chain.
   Why: Edit can't select there, so it's Edit's to ignore, as a click on
   nothing with nothing selected is (TOOLS.md Decisions 6), and the verbs
   out there stay live.
8. **A link that goes, is pinned or stops acting while entered leaves the
   focus** out to the deepest stage still acting, the selection cleared.
   Why: the focus is a stage that acts; the same cost as "the acting
   occurrence can move".
9. **The trail is the view's chrome, not a part.** Why: it names links in
   several docs (each host's name for its link), which no stage's extension
   may read; the view holds the stages and the focus. Shown only while the
   focus is inside a link.
10. **Drawer tabs reopen where the focus went**, through the view's
    `reopen` (the tabs' titles as the focus moved), read once by a tab as
    its part starts. Why: entering from the outline would otherwise close
    the outline it was entered from.
11. **A link's outline row is entered, not expanded in place.** Why: the
    outline shows the focus doc, where the selection lives; a linked doc's
    rows shown from outside could be neither selected nor edited there.
    Entering is one click (→) or a double-click, and the tab reopens inside.
12. **Enter is everyone's, in every body**, and a double-click on a link
    enters it in every body. Why: the selection is everyone's (TOOLS.md
    §3), so is where it's scoped; §3 says a double-click on a link enters
    it, with no body named. Cost: seated aboard, a double-click on a card
    enters the game (play goes on: verbs reach through).
13. **The camera stays where it is on Enter and Leave**, and Look and Edit
    keep riding the latest base ride of any acting stage. Why: entered into
    a game aboard, the boat's follow should still carry the camera; I8's
    "the focus's latest base ride" is read as the latest on the focus path,
    which is that in every example (nothing off the focus path rides the
    camera). Since `scene.autoframe` is a general part, it starts again in
    the stage entered, and would frame an untouched camera there; so a focus
    move counts as placing the camera, as restoring it does
    (`api.camera.touched()`: moved by the viewer, restored on opening, or
    carried across a focus move).
14. **The clock chip and the packages card show the focus doc's**, being
    general parts. Deferred: TOOLS.md §6's chip per doc on the focus path,
    and every open doc's packages in one prompt (FOLLOWUPS).

## Decisions, step 13 (2026-11-14, made unattended)

Made while building pins and mirrors, with the project lead away; each is
the simplest reading of section 7 that held up, and says why.

1. **A drawn stage draws into the world, and nothing more.** A pin's or a
   mirror's extensions run, so it looks as its doc does (layers, labels,
   styles, looks, lenses), but `overlay`, `edge`, `dock` and `popover` stay
   out of the DOM, and it doesn't move the camera, select, notify, set a
   pref, set the cursor, enter a body, hold a tool or run a command. Why:
   chrome is input, and section 7 says a mirror is drawn, not acted on; a
   seat picker or a HUD would otherwise appear once per repeat, and a pin's
   would offer acts on a value.
2. **Read-only by construction.** A read-only stage is handed its doc and
   its repo through wrappers (`stage/readonly.js`) whose writes and sends
   throw. The stage checks `writable()` before every write, so it never
   reaches them; the I6 harness counts a warning or a throw as a failure.
   Why: the property holds whatever an extension calls (`api.handle`, a
   handle from `api.repo`), and a guard someone forgets shows up loudly.
3. **Read-only is silent.** Every read-only stage's presence only listens,
   including a live doc acting where its handle refuses writes (a
   spectator). Why: section 7 has a read-only stage refuse `send` and
   `pose.hold`; presence keys are speech on the same channel; one rule.
4. **A pin has no channel.** No claim counts in it (nobody is seated) and
   it hears nobody. Why: a value has no participants; on the live doc's
   channel it would show today's people over an old version.
5. **A mirror hears its own session.** Listening only, it accepts messages
   from the view's own session. Why: one session per view, and that is how
   it hears its view's acting stage of the same doc; it never speaks, so
   nothing echoes.
6. **No processes in a drawn stage**, replicated ones included:
   `api.clock.process` is refused there and the spec is never started. Why:
   "it never computes its clock". Its t is still read: a mirror follows the
   computer, a pin reads the doc's `clock.t`.
7. **Stages are keyed by occurrence** (path, role, identity). When one
   changes (the acting link removed, a link pinned or followed), its stage
   closes with everything opened under it, and another opens. This keeps
   step 12's close and reopen rather than section 7's "keyed by URL, its
   claims go on". Why: moving a live stage's nodes, frame and segment to
   another placement is a second mechanism for a rare event, and "the
   acting occurrence can move" is already a listed cost.
8. **`api.link(id)` is `{ role, open, reason? }`**: the expansion's role
   (acting, mirror, pinned, closed) and whether its doc is drawn. Why: the
   old `state` folded two facts into one value.
9. **A pin is whole without knowing any package.** `fixPoint` of a link
   holds its doc's heads and, in `deps`, the heads of every live doc opened
   under it and every doc their stages found through their repos (each
   stage's repo notes what it finds): render docs, files, a keeper's
   container. A pin nested under it is skipped (its own `at` holds it). Why:
   the general reading of "every doc reached through it"; no package
   declares its references.
10. **A pin's repo finds listed docs at their heads and others as they
    are**, read-only (the render pins' `pinnedRepo`). Why: the precedent,
    and refusing an unlisted doc would starve a keeper of what it shows.
11. **A drawn stage's render manager builds nothing** and writes no render
    doc; it shows what is built. Why: the acting stage keeps renders built,
    and two hosts pinning one doc at different heads must not fight.
12. **Fix at this version and Follow latest apply to links** as to built
    content: one verb (the inspector's), two consumers.
13. **A pin at heads this replica hasn't got** is drawn as its hint
    (`{ role: "pinned", open: false }`) until the live doc's changes bring
    them.
14. **The example's fit-out holds no stations.** Its companionway (a
    joints slide, a traversal exit) is drawn in the pin and never acted on.
    Sailing's stations are bound to a ship's simulation in their own doc,
    so a fit-out of stations would be inert by design: worked example 2
    puts stations in S.
15. **Publishing a pin re-creates its doc's history.** Heads don't travel
    between repos, so `publish-fitout.mjs` makes F as it was fixed, then
    F's change, and writes the pin at F's server heads (its deps at the
    files' server heads).


Then, fixing the step's review (2026-11-14, also unattended):

16. **A drawn stage's extensions collect from their own stage.** `reader.collect`
    is ungated; only the view decides who is acted on (`view.acting()`,
    `onPath`, `bodyDefs`, a cross-stage `api.run`). Why: gating collect hid a
    roster from tabletop's audience in a mirror, so a mirrored hand was shown
    to nobody (I4); input was already the view's to withhold.
17. **What a pin holds is what its docs name.** `fixPoint` keeps a found doc
    only if a doc of the pin names its URL (transitively). Why: a stage's
    repo also finds a viewer's own docs (card-table's player secret, through
    `api.repo`); recording those would publish a player's secret URL in the
    host doc, and the found-set otherwise depended on load order. Naming is
    data the docs already carry, so no package declares anything. Decision
    10 stands (an unlisted doc is found live): it is how a pin can still
    reach a viewer's secret, and §7 is reworded to match.
18. **Packages are read through the view's repo.** Why: a package is the
    viewer's to load, at live heads; it is never part of a pin.
19. **A pin is keyed by its deps too.** Same heads, other deps: the stage
    opens again. Deps written in another order are the same key. Why: a
    stage should be a function of its occurrence.
20. **The drawn api is one facet** (`drawnApi`), not a guard per method;
    writes keep one check, `writable()`, at each write site, and the
    read-only handle and repo beneath them. Why: the facet puts "what a
    drawn stage may not do" in one table, so a new method is either
    harmless or listed there. The write checks are not a second mechanism:
    the wrappers are the guarantee, `writable()` is the stage asking before
    it writes so it never reaches them (I6 counts reaching them as a
    failure). The clock's reason for not computing in a drawn stage is
    `"drawn"`.
21. **No `api.role`.** Where a stage is placed is the view's to know;
    `api.writable()` is the one question an extension may ask. Why: a role
    invites branching on placement, which I4 forbids.
22. **The stage's repo is an allowlist**: `find`, `create`, `create2`,
    `peerId`. Why: anything else (`handles`, `findWithProgress`) hands out
    raw writable handles and bypasses `reached`, so "read-only by
    construction" held only by convention.
23. **A read-only stage's presence holds the read-only handle.** It could
    not speak if it tried; the page bus is keyed by the raw handle
    (`rawHandle`), so it still hears its view's acting stage. Why: one
    mechanism for silence, and the I6 harness can then tell a read-only
    stage's own output from an acting stage's on the same doc.
24. **A keeper takes no part where it may not write** (card-table): no
    join, turn, key or secret is made there; it only reveals with what the
    deck and the viewer's secret already hold. A deck's identity for its
    keys is its doc URL without heads. Why: I6 failed on the real keeper in
    a mirror and a pin; and a pin's deck handle names its heads in its url,
    so keys derived from it differed and a pin showed every card's back.
    Both are card-table's facts, not the stage's.
