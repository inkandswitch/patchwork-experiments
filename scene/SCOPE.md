# Scope from traits: a design note

A note to decide from, not a contract. [STAGE.md](STAGE.md) says what the
stage does today; this asks what an extension's **scope** should be once
scenes nest, and recommends answers. Each section gives the options, what
they cost, a recommendation, and what it would change in the code.

## Where we are

Today an extension's scope comes from its own reasons (`activeSet` in
`src/stage/activation.js`, `chainOrder` and `holdersFor` in
`src/stage/chain.js`):

| Scope | Reason | Hears input |
|---|---|---|
| `scene` | a trait on the scene | step 5, every pointer event; step 4 as well when one of its objects is in the hit chain |
| `objects` | only traits on objects | step 4, and only when the hit chain reaches one of its objects, with `ev.holder` set to the nearest |
| `viewer` | a kit, `always`, or only `requires` | step 6 |

`requires` makes an extension run but lends it no scope. Three details of
the code matter below:

- **Holders come in running order, not by nearness.** Step 4 offers every
  extension with a holder in the chain in running order. So when the table
  and the boat both hold something under the pointer, it's registry order
  that picks between them, not which one is nearer.
- **Key events have no hit** (`noHit` in `router.js`). An `objects`
  extension never hears a key unless it has armed or has a session open.
- **A scope is one per extension.** Tabletop keeps its seats in one scene
  trait, so a scene has at most one table.

## The cases

| Case | Traits today | What it needs from scope |
|---|---|---|
| CAD boat editor | none of its own; the model kit (`viewer`) | the editing kit has to win while you're editing, even over play traits on the same objects |
| Game table | `tabletop.seats` on the scene; `tabletop.zone` and `tabletop.hidden` on objects | seats, zones and face-up all relative to the table |
| Arena | `arena.level` on the scene; `arena.target` and `arena.spawn` on objects | walk and shoot anywhere; spawns where their objects are |
| **Sailing sim** | (planned) | a boat that moves as one; a tiller and sheets on it; players walking the deck; a card table in the saloon; the whole thing inside an arena level |

The sailing sim is the case that breaks today's model. Here is its chain
when you point at a card on the saloon table:

```
card (tabletop.hidden) → table (tabletop seats) → saloon sole → hull (sailing.boat) → [groups] → scene (arena.level)
```

Three extensions have a claim on that card. Today the tabletop and arena
are both `scene` scope, and with two scene traits only registry order
decides which of them goes first.

## 1. Is scope a property of an extension or of a trait?

**Options.**
- **A. Of the extension (today).** One class per extension, derived from
  where its traits happen to be.
- **B. Of the trait's placement.** A trait key means the same thing on the
  scene or on any object. Where it sits is the scope: the subtree of that
  object (what's attached to it, and what's filed in it if it's a group). The
  scene is just the outermost holder.
- **C. Declared in metadata** (`traits: { "tabletop.table": "object" }`).

**Tradeoffs.** A is what we have, and it collapses as soon as one
extension has traits in two places: the tabletop with one scene trait hears
every click on the boat at step 5, as if the arena were a card table. C
fixes the class but still allows only one scope per extension. B lets one
extension have many scopes (two tables in a saloon), and it reads the doc
the way people do: this table has seats.

**Recommendation: B, with one instance per extension.** The extension keeps
one instance and handles many holders, rather than the stage creating an
instance per holder. Per-holder instances look simpler, but they make
cross-scope moves awkward (a card carried from one table to another, or
onto the deck), they duplicate shared resources (deck resolvers), and they
multiply overlays and HUD lines. The `scene`, `objects` and `viewer` labels
stay in `local.running` as a summary (and still decide who may migrate), but
input stops reading them.

**Code.** `api.holders()` returns the ids carrying any of this extension's
traits, with `null` for the scene. `api.holderOf(id)` returns the nearest
object in `id`'s chain that carries one of its traits, `null` for the
scene, or `undefined` if there's none. Both go in `host.js`, built on
`hitChain` and `holdersFor`. `activeSet` doesn't change.

## 2. Nested scopes and precedence

**Options.**
- **A. By scope class (today).** Object holders, then scene, then viewer;
  among holders, running order.
- **B. By nearness.** Holders are ordered by their position in the hit
  chain, nearest first. The scene counts as the last link, so scene-placed
  extensions come after every object holder. Viewer comes last.
- **C. Explicit priority** in metadata or on the trait.

**Tradeoffs.** B is what bubbling means, and it's what DESIGN.md's
arbitration list already says ("the object under the pointer; what that
object is attached to, then its group; the scene's traits"). With B, the
card goes to the tabletop, a press on the tiller goes to sailing, and a
press on a bare wall goes to the arena. Nobody has to know about anybody
else. C is a global ranking that every new package would need to fit into,
and it never stays right.

**Recommendation: B.** Running order breaks ties only between extensions
with the same holder.

**Code.** `holdersFor` returns each holder's depth in the chain.
`chainOrder` sorts step 4 by depth and then by running order, and treats a
scene placement as depth = chain length. That merges steps 4 and 5 into a
single walk up the chain. It's a few lines in `chain.js`, plus tests: a card
on a table on a boat, and two extensions on one object.

## 3. An object in several scopes

A crate on the foredeck with `arena.target` is in three scopes: its own
(arena), the boat's (sailing, through attachment) and the scene's (arena
again). The table object might carry `tabletop.seats` and also be a sailing
"station you can sit at".

**Options for two extensions on the same holder.** Use running order
(today); order the traits on the object (but Automerge map keys have no
order); or add a per-object `order` field.

**Recommendation.** Use running order, and as a rule extensions claim only
presses they're sure of. Each extension is offered an event once, at its
nearest holder, so an extension can't be both near and far. Add a
per-object order only if a real conflict turns up. Input is local, so if
two peers order the same pair differently, nothing diverges in the doc.

## 4. Scene traits versus traits on an object

The rule: **anything that belongs to a thing lives on that object, in its
frame.** Scene traits are for what really is about the whole document:
rules of the world, catalogues and scoreboards.

| Trait | Today | Should be |
|---|---|---|
| `tabletop.seats` (with each seat's `camera` in world coordinates) | scene | on the table object, with cameras in the table's frame. A scene placement still works and means "the whole scene is the table" |
| `tabletop.zone` (a box in its object's frame) | object | already right |
| face up (`isFaceUp`: +Y in the world) | implied | +Y in the table's frame, so cards on a heeling boat don't flip |
| `arena.level` (the block catalogue) | scene | scene: it's a catalogue, not a place |
| `arena.spawn`, `arena.target` | object | already right: attach them to the boat and they sail |
| `doc.view.tool` and other view defaults | scene | allow a `view` on an object (below) |

**View defaults per scope.** `local.tool` is one value for the whole view.
On a table a drag should carry, on the boat it should pull a sheet, and in
the editor it should move. *Option:* `api.pref(key, fallback, at?)` reads
`local` → the nearest object in `at`'s chain with a `view[key]` →
`doc.view` → fallback. The hand would ask with the pressed object's id.
*Recommendation:* do it, but only for keys a part asks about with a target
(`tool`). The camera and display toggles stay per view.

**Code.** Tabletop: seats move to `tabletop.seats` on a table object, with
a migration that leaves old scenes on the scene placement (still valid).
`seatsOf` and `isFaceUp` become per holder. The seat picker becomes a
"Sit here" command on the table (from the menu) plus a picker for the table
you're at. Stage: `pref` takes `at`. `effectiveTool` takes the doc view it
resolved.

## 5. Does a scope move?

Yes. The boat moves as one, and everything on board moves with it
because it's attached: world = parent's world · local. That covers seats,
zones, stations and spawns, once their coordinates are in their object's
frame (section 4). Groups give scope but not motion, since a group has no
transform. **Being on board means being attached, directly or not.**

Most of the work is in what moves the boat, and in what reads positions
while it moves:

- **Motion is a pose, not doc writes.** One peer runs the sim and holds the
  hull's pose (`api.pose.hold`, which peers already see at 50 ms). The doc
  keeps where the boat is moored, and is written only when it comes to
  rest. Two peers holding the same hull already resolve by Lamport stamp.
- **Readers must use the displayed world.** The hand works out a carried
  object's local pose from the doc's world for its parent (`hand.js`, "not
  one a peer is holding"). That's right against a peer's brief carry, but
  wrong for a sailing hull: the card would jump by however far the boat has
  sailed since it was moored. The rule should be to use `worldOf` for a
  parent held by a running loop. *Option:* a held pose says it's
  `continuous` (simulation, not a carry), and then readers use the
  displayed world.
- **Landing attaches.** A card put down on the table today keeps its old
  parent. It should be attached to what it landed on, or to the nearest
  holder (the table), or it gets left behind in the sea. *Option:*
  `landing()` may return `{ attach: id }`, and the hand writes `parent`.
- **The camera rides along.** Seat cameras, a tiller view and an orbit
  around a moving boat all want the camera rig in an object's frame.
  *Option:* `api.camera.follow(id | null)`: the stage carries the camera's
  position and orbit target with that object's displayed world each frame,
  and `limit` applies in that frame ("not under the table").
- **People stand on things.** The walker (arena `walk.js`) keeps its body in
  world coordinates, so the deck slides out from under it. The body should
  be stored relative to what it stands on (the attachment root of the
  ray-down hit), and published to presence that way (`{ on, position }`),
  so peers whose view of the hull lags 50 ms still see you on the deck and
  not in the water.

## 6. Keys, hover, menus and arms with nested scopes

- **Keys have no hit**, so scope can't pick who gets them, and it shouldn't.
  The key map runs commands against selection → scene → hovered, and that
  order stays. What's missing is a way for a command to know which of its
  scopes a target is in: sailing's "R: reef" with the pointer over a deck
  plank gets the plank as its target. **Recommendation:** commands resolve
  this themselves with `api.holderOf(target)`; no new key order.
- **Menus** show every command that applies to what was right-clicked.
  With nesting that's the card's, the table's, the boat's and the scene's.
  **Recommendation:** the menu groups them by holder, nearest first. That
  needs `holderOf` (above) to be readable through `collect`, so menu
  sections show "Card", "Table", "Boat"; the order of commands within a
  section doesn't change.
- **Hover** stays one id (`local.hovered`). Each extension asks
  `holderOf(hovered)` to decide whether the hover is in one of its scopes
  (the table enlarging a hovered card).
- **Where a person is, as opposed to where the pointer is, is an arm.**
  Standing at the tiller, seated at the table and walking the deck are
  modes, and modes are arms: walking (arena) is pushed first, and taking the
  tiller pushes a sailing arm over it. Getting up pops it, and walking
  resumes. Two things are missing. First, a suspended walker still has to
  ride the deck (its loop keeps running, which is allowed). Second, a
  pointer-locked walking arm claims every press as a shot. **Recommendation:**
  give an armed handler `ev.holders` (`[{ ext, holder }]`, nearest first),
  so the walker can pass a press whose nearest holder belongs to another
  extension. Then the press falls down the chain, and clicking the tiller
  while walking takes the helm.

## 7. `requires` and the parts it pulls in

`requires` lends no scope, so a required part is `viewer` scope and runs
everywhere. In the sailing scene the tabletop requires `scene.hand`, a
table's doc suggests the hand as the tool (`view.defaultMode: "hand"`), and
now a drag carries the arena's walls.

**Options.**
- **A.** Lend the requirer's scope. But the key map and notices are
  required too, and they must not be limited to hovering a table.
- **B.** Leave `requires` alone, and let object parts ask which objects are
  theirs to act on, through a collected rule (`carryable(id) → true | false | null`)
  that holders answer for their subtree.
- **C.** Per-scope tool (section 4) only.

**Recommendation: B together with C.** The table says its pieces are
carryable, the arena says its blocks aren't while a level is being played,
and with no opinion from anyone it behaves as it does today. **Code:** the
hand collects `carryable` and checks it beside `canCarry`; tabletop and
arena each add a few lines.

## 8. What the sailing sim needs, in short

| Need | Comes from |
|---|---|
| a boat is a scope | `sailing.boat` on the hull; everything on board attached under it (sections 1, 5) |
| it moves as one | a continuous pose hold by one peer; readers use the displayed world (5) |
| tiller and sheets | `sailing.station` objects on the boat; nearest holder wins the press (2); taking one is an arm (6) |
| walking the deck | the walker's body in the frame of what it stands on, and presence that way (5) |
| card table in the saloon | `tabletop.seats` on the table object, seats and face-up in its frame, landings attach (4, 5) |
| inside an arena | `arena.level` stays a scene trait; targets on the boat just work (4) |
| the tool fits the place | `view.tool` on the table and the boat (4); `carryable` (7) |
| cameras that ride | `camera.follow` (5) |

## Summary of changes, if all are taken

| Where | Change |
|---|---|
| `stage/chain.js` | holders ordered by depth in the chain; scene placement is the last link; steps 4 and 5 merge |
| `stage/router.js` | `ev.holders` for armed handlers |
| `stage/host.js` | `api.holders()`, `api.holderOf(id)`; `pref(key, fallback, at)`; `camera.follow` |
| `stage/presence.js` | a held pose can be `continuous`, so readers use the displayed world |
| `parts/hand.js` | `carryable`; attach on landing; displayed world for moving parents |
| `parts/menu.js` | sections by holder, nearest first |
| tabletop | seats on the table object, per-holder seats, zones and face-up; migration |
| arena | the walker's body relative to what it stands on; `carryable` for blocks |
| STAGE.md | "Activation" and "The input chain" rewritten around placements |

None of this changes what runs (`activeSet`) or the stopping rules. The
first two rows are the decision that matters: once scope is where a trait
sits, and precedence is nearness, the rest can follow one case at a time.
