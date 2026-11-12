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
pointer, the arm stack, the viewer's local state.

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
where the scene has none" (`src/parts/seats-model.js:86-110`); sailing tells
her fittings from a game's pieces by a `sailing.` prefix and "locked
furniture", and asks `camera.riding()` whether a game has seated the viewer
(`sailing/src/crew.js:87-140`). Scene-wide singletons are already wrong for
two games in one doc: one `scene.seats` map, the joint keeper waiting on any
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
broadcast within a page (`handle-registry.ts:376-381`).

## 1. What a link is

**Options.** A. A new top-level map (`links: {…}`). B. A new object
`kind: "link"`. C. An ordinary object whose source is a scene doc.

**Tradeoffs.** A duplicates everything an object has. B is a new branch in
every reader of objects. C needs nothing new in the doc.

**Recommendation: C.** Today `passthrough: true` on file-glb says what kind
of content a source makes. Make it a value with three cases:

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
View  (one per mounted tool)  DOM and edges, viewport, router, camera rig, labels, the arm stack,
                              the view's atom, the session id, the fetch queue and its budget,
                              the focus, the expansion of links, the general parts
Stage (one per open doc)      handle, derive and snapshot, its extensions, claims, its channel,
                              packages reconcile, audience, lenses and veils, its own atom
```

`Stage(handle, element)` becomes `createStage({ handle, view })`; a child is
the same call with a `frame()` the view supplies.

## 3. Where code runs

**One rule.** An extension runs in a stage when that stage's doc has one of
its traits, or something running there requires it. An extension with no
traits is **general**: it belongs to the view, which runs it once, at the
**focus**, in the activities it takes part in. The focus is one stage: the
outermost, until Enter moves it (section 5).

So twenty linked games don't make twenty menus. A general part calls the
focus stage's api, so the editor edits the focus's doc, but it is in no
stage's running set. The hand shows both cases: in edit it is general, at
the focus; in play, each stage that requires it gets its own.

**Only a doc's own extensions offer activities**, so `general: false` (the
use prompt's) and `always` (`scene.activity`'s) go. The general parts that
present others' contributions (STAGE.md's surfaces: keys, menu, notices,
the packages card, the activity switcher, autoframe) drop `activities` and
run in every activity, showing nothing when nothing offers them anything.
The use prompt keeps `activities: ["play"]`. Packages stop requiring any of
these. The view offers the union of what its acting stages offer. The
activity is one value per view (open question 2), and the outermost doc
gives the defaults: the activity, the atmosphere, and where a viewer starts
and so which walker arms first. Inner docs' spawns serve arrivals (section
9).

**`collect` is the caller's.** A stage's extension collects from its own
stage. A general part collects from every stage on the **input path**, the
stages from the hit's innermost out to the focus (in first person the hit is
the look ray), innermost first, each tagged with its stage. A command runs
as `api.run({ stage, ext, command, target })`, in its own stage and frame. A
target never leaves its stage.

**Local state: two atoms, two names.** `api.view` holds the viewer's keys:
`activity`, `immersive`, `theme`, `notices`, `packages`, `prefs`, `tool`,
`focus`, selection and hover. `api.local` holds the stage's: `running`,
`status`, `<ext>.*`. A per-viewer key falls back to the calling stage's doc:
`view.tool ?? doc.view.tool`, `view.prefs[k] ?? doc.view[k] ?? fallback`. So
the game's `view.tool: "hand"` holds in the game unless the viewer chose.
Material rules are each doc's, applied to its own objects.

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

**The camera is the focus's, except while an arm holds it.** A ride belongs
to the arm that made it, or to the stage's base. The ride of the topmost
arm that rides applies; with none, the focus stage's latest base ride. A
seat pushes its arm and rides the game's root; sailing's follow on her hull
is base and gives way with no flag. `camera.ride(null)` rides the stage's
root, which is the link. `fallback` and `camera.riding()` go, and sailing's
`seatedView` with them: sailing learns it isn't driving from its walker's
`suspended`.

## 5. Input

SCOPE.md §2 orders holders by nearness. Nested stages make that hold across
docs: the doc boundary is one more step out.

```
segment(S) = S's holders, nearest first; then extensions on S's root; at the focus, the general parts
order      = armed → widget owner → segment(innermost on the path) → … → segment(focus) → default
```

Each `(stage, extension)` is offered an event once, with `ev.hit` as that
stage's element of the path, in its frame.

A press on a card aboard goes to tabletop, seats, then the game's hand, and
only then to sailing, the boat's root and the general parts. A press on the
deck never reaches the game: the doc boundary is the scope.

**In edit, input stops at the focus.** Only the focus's segment hears it, so
a press on a linked game selects the link, as CAD selects a component before
its parts. Enter on a link moves the focus into it; Leave, Esc or a
breadcrumb moves it out. Moving the focus moves the general parts, cuts
every segment outside it and drops arms from stages outside it. In every
other activity the chain runs from the innermost stage out to the focus.
Otherwise inner stages' edit-time extensions (tabletop's zones, camber's
hull) would take every press first, and the editor could never select a
link.

**Keys** visit the selection's path innermost first, then the hover path's
stages not yet visited, innermost first (in edit, the focus only). In each
stage the key map tries its selected element, its null target, its hovered
element, as today. With a crate selected and the pointer on the game, D
still reaches the game's Draw.

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
to a seat crosses docs through what the view owns: sitting pushes the seat's
arm and the walker is `suspended`; standing pops it and the walker resumes
from the eye. So `firstPerson` goes.

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
  through it in `deps`; a doc missing there is closed `"unpinned"`. Renders
  show as of `deps`, never judged or rebuilt, so two hosts pinning one game
  at different heads don't fight over its render docs.

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
  stepping, two keepers dealing, two seats. The acting stage is keyed by
  URL, so when a doc arrives and the choice changes, its frame moves and
  its claims and channel go on.
- **Every other live occurrence is a mirror**: a read-only stage on the same
  live handle. It runs its extensions, so it looks the same, at its own
  placement. It is drawn, not acted on: its segment is never in the chain,
  and it takes no arm and no camera. By the page bus it hears its own view's
  acting stage, so a carry shows in both. A part used twice in an assembly
  follows latest twice; a copied link shows the same game, not a dead box.
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

**In play, no stage moves an object to another doc.** The hand carries in
the frame of the object's doc parent and never changes its doc. A card set
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
  connectors, as a GLB's `extras.connectors` are a file object's: the hand
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
traits on its root (Battleship's `fleet`), and its extensions and the hand
they require run there. Open question 4.

## 11. What leaves `scene/` and its consumers

Besides what the sections above delete: input's scope classes and the
`local.running` labels (nearness within segments replaces them), both
`url === handle.url` checks (the cycle rule), and seats, the roster and
`lay`, to a `seats/` package (open question 5). In the consumers, when they
choose: tabletop drops `placeLayout`, the `view` flag, the title guard,
host-titled decks and every required general but `scene.hand`; dice, bag,
sailing, arena and joints drop required generals; sailing drops telling a
game's pieces from hers; publish-aboard walks the link graph. Once this
note is accepted, SCOPE.md shrinks to nearness within one doc.

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
and p2 in G's root frame, its own title, `view.tool: "hand"`, its art and
packages.
- B is the focus and runs sailing; one peer claims `"sim"` in B and holds
  the hull's pose on B's channel. B's own `view.activity` is play, as a
  sailing sim's is. G's stage opens with the link and runs tabletop, its
  rule, the keeper, seats and a hand. Cards ride the ship; face up is the
  table's up.
- Ana walks the deck (sailing's arm), looks at p1, and the use prompt folds
  in G's "Sit as Player 1". F claims `scene.seat:p1` in G; the seat's arm
  rides G's root and the walker is suspended.
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
cards, and a screen in Y can't hide Ana's hand.

## Invariants

Each is argued above and checkable over finite cases.

| | Invariant | Finite check |
|---|---|---|
| I1 | **One doc per extension.** Every read and write through an api goes to its stage's handle | Spy handles; run the scene parts', tabletop's, sailing's and the keepers' tests in a child stage; no other handle is touched |
| I2 | **No reference crosses docs.** Parent, group and every `object` field name an object of the same doc; a link is the only edge between docs | Every assignment over ≤3 docs × ≤3 objects, foreign ids included: the composed relation is intra-doc plus link → child roots, and acyclic |
| I3 | **Expansion is finite and fixed by the graph.** No identity repeats on a path; each live doc has exactly one acting occurrence, chosen by path order; the rest are mirrors; closed reasons are exact | Every link multigraph on ≤4 docs (live, pinned, self-pins, ≤2 links per pair) × every arrival order: terminates, and the final expansion is the same |
| I4 | **Placement independence.** A stage's snapshot, running set, offered activities, `audience`, `looks` and `shown` are functions of its doc, the registry and the view's activity: never of its host, the focus, or whether it acts or mirrors | Lost Cities G × seats {none, p1, p1+p2} × card states × activity {edit, play}: G alone, in X at 0° and 20° heel, in Y, mirrored, focus inside and outside: identical |
| I5 | **Channels.** An object's claims, holds and sends travel on its doc's channel | Three views of G (alone, in X, in Y; two in one page) on in-memory Automerge × every claim/release/leave order: `claimedBy` agrees once delivered; a carry in one shows in the others and in a mirror |
| I6 | **A read-only stage writes nothing**, through its api or its repo | Read-only handles whose `change` and `broadcast` throw; the Lost Cities probe against G pinned, unwritable and mirrored: no throw |
| I7 | **Frames.** For a similarity frame of S, points map by it, directions and normals by its rotation, distances by its scale; boxes are S's own | Property test over depth ≤3 × held and moving link poses × every spatial call and event field |
| I8 | **Chain and camera.** Inner segments before outer; each (stage, extension) once; nothing outside the focus; in edit, the focus only; no arm from outside the focus or from a mirror; the applied ride is the topmost riding arm's, else the focus's latest base ride | `chainOrder` over depth ≤3 × hit × holder placement × focus × activity; every arm stack ≤3 × rides in each stage role |
| I9 | **Extract and bundle.** Each is one host change and writes no other existing doc; `bundle(extract(S, K), K)` equals the original on every non-runtime field when S has no edge outside | Every sibling set of a fixed 6-object scene with traits, refs, groups and a seats map × K ⊆ the root's traits |
| I10 | **Selection, hover and keys.** Each stage sees its own element of a path or null; keys visit the selection's path, then the hover's remaining stages, innermost first | Every pair of paths of depth ≤3 × target × activity |
| I11 | **Linearity.** Runtime state has at most one writable holder among reachable docs | Every sequence and every interleaving of ≤3 of link, pin, copy, extract, bundle on ≤3 docs with one bound object and one claim |

## Build order

Each step ships alone and proves something.

1. **Nearness in `chain.js`** (SCOPE.md §2). Needed either way.
2. **Generals are the view's; rides by arm.** In `activation.js`, `always`
   and `general: false` go and the folding parts drop `activities`; in
   `ride.js`, `fallback` and `riding()` go. *Proves:* every suite passes
   with less stage.
3. **`content` in place of `passthrough`**, routed at sync. *Proves:*
   nothing changes for GLBs.
4. **Seats to `seats/`**, if open question 5 is yes.
5. **Split View from Stage, with one stage**: `api.view`, the session in the
   view. *Proves:* suites pass; the I1 harness exists.
6. **Links, closed only**: the `scene.link` source, `links.js` and I3.
7. **Links, open and live**: child stages, path keys in `viewport.js`, one
   frame choke point (I7), segments and `collect` on the path (I8),
   channels and the page bus (I5), audience per stage (I4). *Proves:* Lost
   Cities aboard with G its own doc, and G in two scenes, in a probe. The
   choke point can't catch code reading three.js `matrixWorld` directly
   (`dimensions.js`, camber's dressing); those need an audit.
8. **Pins and mirrors** (I6). *Proves:* example 2; a part repeated live.
9. **Edit in context**: Enter, Leave, link rows in the outline and
   inspector.
10. **Extract and bundle** (I9, I11).
11. **Named frames and traversal**, when doom's exits or stations need them.

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
- **Edit in context is a mode** (open question 2).
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
   an activity per stage stays possible later.
3. **A piece set down outside its doc stays in its doc.** Accepted. Moving
   between docs goes through a container placed in both, until two direct
   moves are being built.
4. **The private layer is a doc the view links** (section 10). Accepted,
   before the hiding work's steps 5 and 6 are built.
5. **Seats leave `scene/`** for a `seats/` package, with the roster and
   `lay`. Accepted; build step 4 goes ahead.
