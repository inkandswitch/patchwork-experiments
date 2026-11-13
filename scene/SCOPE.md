# Scope from traits: a design note

A note to decide from, not a contract. [STAGE.md](STAGE.md) says what the
stage does today; this asks what an extension's **scope** should be once
scenes nest, and recommends answers. Each section gives the options, what
they cost, a recommendation, and what it would change in the code.

## Where we are

*Since written:* §2 is built (build step 1), and so are TOOLS.md's bodies,
held tool and carry trait (steps 3 and 6), which answer §4, §6 and §7 in
their own way; each section says what was built. [STAGE.md](STAGE.md),
"Activation" and "The input chain", is the code as it is now.

An extension's scope comes from its own reasons (`activeSet` in
`src/stage/activation.js`, `chainOrder` and `holdersFor` in
`src/stage/chain.js`). The input chain is: the held tool, the widget's
owner, the holders nearest first, the general extensions, the top body.

| Scope | Reason | Hears input |
|---|---|---|
| `scene` | a trait on the scene | step 3, every pointer event, at its holder: the nearest link of the hit chain carrying its trait, the scene itself last |
| `objects` | only traits on objects | step 3, and only when the hit chain reaches one of its objects, with `ev.holder` set to the nearest |
| `general` | no traits declared at all | step 4 |

(`always`, and `requires`, which made an extension run but lent it no
scope, went at TOOLS.md step 8: traits alone decide.) Three details of
the code mattered when this was written:

- **Holders came in running order, not by nearness**, so when the table
  and the boat both held something under the pointer, registry order
  picked between them. (Settled by §2: holders go nearest first.)
- **Key events have no hit** (`noHit` in `router.js`), so an `objects`
  extension never hears a key in the chain. (Now keys go by the one key
  order of TOOLS.md §5: the gesture's, the held tool's and the body's
  declared keys, then the key map, which runs commands on attention's path.)
- **A scope is one per extension.** Seats are one scene trait (`seats`, now
  the seats package's), so a scene has at most one table of seated
  players. (COMPOSITION.md's answer: each game its own doc.)

## The cases

| Case | Traits today | What it needs from scope |
|---|---|---|
| CAD boat editor | none of its own; the editor's parts (`general`) | editing in the running world, play traits on the same objects running too: the selection's halo and the drawer's inspector edit, and a game's holders take presses on their objects first (Select is every menu's, and orbit's click where no holder takes it); no activity settles it (TOOLS.md §3) |
| Game table | `seats` (the seats package's) on the scene; `tabletop.zone` and `tabletop.card` on objects | seats, zones and face-up all relative to the table |
| Arena | `arena.level` on the scene; `arena.target` and `walk.spawn` (the walk package's) on objects | walk and shoot anywhere; spawns where their objects are |
| **Sailing sim** | `sailing.sea` on the scene; `sailing.ship` on the hull, `sailing.helm`, `sailing.winch` and the rest on her fittings | a boat that moves as one; a tiller and sheets on it; players walking the deck; a card table in the saloon; the whole thing inside an arena level |

The sailing sim is the case that breaks today's model. Here is its chain
when you point at a card on the saloon table:

```
card (tabletop.card) → table → saloon sole → hull (sailing.ship) → [groups] → scene (seats, sailing.sea, arena.level)
```

Three extensions have a claim on that card. When this was written the
tabletop and arena were both `scene` scope, and with two scene traits only
registry order decided which of them went first. (§2 settled it: nearest
first.)

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
multiply overlays and HUD lines. The `scene`, `objects` and `general` labels
stay in `local.running` as a summary, but input stops reading them.

**Code.** `api.holders()` returns the ids carrying any of this extension's
traits, with `null` for the scene. `api.holderOf(id)` returns the nearest
object in `id`'s chain that carries one of its traits, `null` for the
scene, or `undefined` if there's none. Both go in `host.js`, built on
`hitChain` and `holdersFor`. `activeSet` doesn't change.

## 2. Nested scopes and precedence

**Options.**
- **A. By scope class (today).** Object holders, then scene, then general;
  among holders, running order.
- **B. By nearness.** Holders are ordered by their position in the hit
  chain, nearest first. The scene counts as the last link, so scene-placed
  extensions come after every object holder. General comes last.
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

**Done** (build step 1). One difference from the plan above: the scene's placement is found
by `holdersFor`, which walks the hit chain with the scene appended as its last
link (`traitsOf(null)` is the scene's traits, holder id `null`), rather than by
`chainOrder` reading the `scene` label. So input reads no scope label but
`general`, and a scene-placed extension's `holder` is `null`, as `api.holderOf`
will have it. The tests check the order against the literal walk over every
placement of three extensions on chains of up to three objects plus the scene,
in every running order.

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
| Trait | When written | Should be | As built |
|---|---|---|---|
| seats (then `tabletop.seats`, with each seat's `camera` in world coordinates) | scene | on the table object, with cameras in the table's frame | `seats`, the seats package's, still on the scene; a seat's camera may be given `in` an object's frame (the table), so it rides a table aboard a ship. One table per doc is COMPOSITION.md's to lift, a game being its own doc |
| `tabletop.zone` (a box in its object's frame) | object | already right | unchanged |
| face up (`isFaceUp`: +Y in the world) | implied | +Y in the table's frame, so cards on a heeling boat don't flip | built: +Y in the frame the card lies in, its parent's (tabletop's `faceUpIn`) |
| `arena.level` (the block catalogue) | scene | scene: it's a catalogue, not a place | unchanged |
| `arena.spawn`, `arena.target` | object | already right: attach them to the boat and they sail | the spawn is now `walk.spawn`, the walk package's |
| `doc.view.tool` and other view defaults | scene | allow a `view` on an object (below) | `view.tool` is gone (below) |

**View defaults per scope**, as proposed: `local.tool` was one value for
the whole view, but on a table a drag should carry, on the boat it should
pull a sheet, and in the editor it should move; so `api.pref(key, fallback,
at?)` would read a `view[key]` on the nearest object in `at`'s chain.

**As built** ([TOOLS.md](TOOLS.md) §1, §3, §4; build steps 3 and 6):
there is no tool to default, per scope or per view. `view.tool`,
`local.tool`, `effectiveTool` and the hand part are gone. The empty hand is
the default everywhere, and what a press does follows from the chain: a
press on a card carries it because the card has the `scene.carry` trait; a
press on a station is sailing's; an unclaimed click selects in the orbit
body and does nothing walking. A tool is held only when picked up: one
slot per view (`local.held`), filled by a tool command (measure, arena's
gun) or `api.hold` (a bag's drawn piece), emptied by Escape. `pref` takes
no `at`.

## 5. Does a scope move?

*Since built:* the camera rides as `camera.ride` (a base ride) and a body's
own ride, which wins (STAGE.md, "Riding"); the carry and the halo work in
the frame of the object's doc parent as drawn this frame, so a card on a
sailing hull doesn't jump; the walk body rides what it stands on, and
sailing walks her deck in her own frame. Landing doesn't attach: a carried
thing keeps its doc parent.

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

> Superseded in part (build step 6): arms became bodies on one stack and the
> held tool in one slot (TOOLS.md §4); there is no `api.arm`. Read "arm"
> below as the note's earlier word. Keys go by TOOLS.md §5's one order (the
> gesture's, the held tool's and the body's declared keys, then the key map
> over attention's path: the selection, else the look's hit and what it's
> attached to, then the scene), not selection → scene → hovered. A walker
> passes a press it doesn't want down the chain without `ev.holders`: the
> top body is offered presses after the chain, so a station's holder gets
> the press first.

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

**As built** ([TOOLS.md](TOOLS.md) §1, build step 3): "can be carried" is
data, the `scene.carry` trait on the object. The carry part
(`src/parts/carry.js`, `scene.carry`, which replaced the old `scene.hand`)
declares that trait, so it runs by trait, with object scope, wherever the
doc has something carryable, and nothing requires it. Tabletop's pieces,
dice, cups and whatever comes out of a bag carry the trait; an arena's
walls, a hull and her fittings simply lack it, so a drag on them never
carries them. `carryable(id)` stays as a veto for passing states only (a
die under a cup). A press carries `ev.holder`, the nearest link of the hit
chain with the trait, so a press on what's attached to a card carries the
card.

`requires` went at TOOLS.md step 8: the use prompt, the key map, notices,
the menu and the framing are general and run in every scene, and the carry
runs by its trait, so nothing has to bring anything in.

**The problem it answered.** When this was written the tabletop required
`scene.hand`, a required part is `general` scope and runs everywhere, and a
table's doc suggested the hand as the tool (`view.tool: "hand"`), so in a
sailing scene with a table aboard a drag carried the arena's walls. The
options were:
- **A.** Lend the requirer's scope. But the key map and notices are
  required too, and they must not be limited to hovering a table.
- **B.** Leave `requires` alone, and let object parts ask which objects are
  theirs to act on, through a collected rule (`carryable(id) → true | false | null`)
  that holders answer for their subtree.
- **C.** Per-scope tool (section 4) only.

The recommendation was B with C. The trait does B's job as data instead of
a collected rule, and needs no C.

## 8. What the sailing sim needs, in short

What this note asked for, and what sailing is built on now.

| Need | Asked for | As built |
|---|---|---|
| a boat is a scope | `sailing.boat` on the hull; everything on board attached under it (sections 1, 5) | `sailing.ship` on the hull, her fittings attached under her with traits of their own |
| it moves as one | a continuous pose hold by one peer; readers use the displayed world (5) | a pose hold by the view computing the clock; `worldOf` and rays see what's drawn |
| tiller and sheets | `sailing.station` objects; nearest holder wins the press (2); taking one is an arm (6) | `sailing.helm`, `sailing.winch`, `sailing.mainsheet`…; nearest holder (2); taking one pushes sailing's `station` body |
| walking the deck | the walker's body in the frame of what it stands on (5) | sailing's `aboard` body, her navmesh walker in her frame |
| card table in the saloon | seats on the table object, face-up in its frame, landings attach (4, 5) | seats on the scene with cameras `in` the table; face up in the card's parent's frame; landings don't attach |
| inside an arena | `arena.level` stays a scene trait; targets on the boat just work (4) | the same |
| the tool fits the place | `view.tool` on the table and the boat (4); `carryable` (7) | no tool to fit: what carries has `scene.carry` (4, 7) |
| cameras that ride | `camera.follow` (5) | `camera.ride`, and the top body's ride |
| one player per station; items in one person's hands; who simulates | claims in the doc, lapsing with their holder's presence (9.1) | claims (STAGE.md, "Claims"); who simulates is the doc's `"clock"` claim |
| "F to use", reach, verbs you hold | `scene.use`; `from` and session-returning commands (9.2) | `scene.use`; `reach: true` measured from the body's eye against its reach (2.5 m aboard); held verbs |
| crew you can see, holding things | avatars as presence in their frame, one shared part (9.3) | sailing draws its crew and the walk package its walkers, each its own; nothing is held in a hand |
| the ship moves for everyone | one peer claims the simulation and streams the pose (9.4) | her physics is a process on the doc's world clock (TOOLS.md §7) |
| cannonballs, spray | sends, simulated locally (9.5) | not built |
| the sea | an ocean extension: a surface layer, atmosphere, a water-height contribution (9.6) | sailing draws the sea at the clock's t; water height doesn't cross extensions |

## 9. Local interaction, the Sea of Thieves way

The sailing sim should feel like *Sea of Thieves*: you walk up to something
on a moving ship and use it, with your own hands, and everyone aboard sees
you do it. Almost every interaction is local and physical. Sections 5 and 6
already cover people riding in their object's frame and stations as arms;
this section covers the rest. Each item is meant as a general capability of
the stage or a shared part, not a ship feature: claims serve a review tool,
the use prompt serves a table, frames serve the arena.

**What already fits.**
- **Taking a station is an arm** (section 6). The helm, a cannon or the
  capstan pushes over walking, takes the keys (A/D steer, the mouse aims) and
  perhaps the camera; Esc pops back to walking.
- **Stations are objects with traits** (`sailing.helm`, `sailing.cannon`), so
  their extensions hear events aimed at them. In first person the event's ray
  is the crosshair, so what you're looking at is the hit chain.
- **Effects are sends; damage is doc.** A shot fired, a splash or a shout is
  `api.send`. A hole in the hull, the water in it, the sails' trim and the
  anchor are fields on the ship's objects.
- **Walking a moving deck** works against raycasts that see displayed poses.

**What was missing.** Items 1 and 2 have been built since, as recommended
here: claims are in [STAGE.md](STAGE.md), "Claims", and the use prompt is
the shared part `scene.use` (`src/parts/use.js`). The rest still stand.

1. **Claims, in the doc.** One player at the helm; a bucket in one
   person's hands; one peer simulating the ship. These are facts about the
   shared world, so they live in the Automerge doc, not in presence.
   *Recommendation:*
   - **A claim is a field on the claimed object**: `claims: { [kind]: {
     viewer, session } }` (kind: `"station"`, `"held"`, `"sim"`…). Taking
     one writes it, letting go deletes it. `api.claim(id, kind) → release`,
     `api.claimedBy(id, kind) → { viewer, session } | null`.
   - **Concurrent claims are Automerge's to settle.** Two people taking the
     helm at once both write the field; the merge picks the same winner on
     every peer, and the one who lost it steps away when the merge arrives.
     No ranking protocol of our own.
   - **A claim counts only while its holder is here.** Readers treat a claim
     whose session has no presence record as lapsed, so a tab that died at
     the helm doesn't hold it forever, and nothing has to write a cleanup.
     The next person to take it overwrites it. Releasing on stop and the
     goodbye on tab close delete it at once.
   - **Motion stays in presence.** A pose streamed while something moves
     (a carried card, a sailing hull) is presence, as now; it would flood the
     doc's history. A claim says who; the pose says where, right now.
   - **Short drags may stay unclaimed.** Carrying a card across a table is
     a gesture, not a fact worth recording, and the put-down is already one
     write. The current presence holds (ranked by Lamport stamp) remain for
     those, and an extension that wants a durable claim on a carried object
     takes one.
2. **A use prompt.** "F to raise the anchor" is a surface over commands:
   what the crosshair is on, within reach, offers its verbs as a prompt, and a
   key runs one. Two additions to the command shape:
   - **reach:** `state(target, { …, from })` gets where the viewer is (the
     eye, in world space), so a verb can say it applies only within arm's
     length;
   - **held verbs:** winding the capstan, bailing, pulling a sheet last as
     long as the key is down. A command may return a session from `run`
     (`move`, `end`, `cancel`, like a press), and the use surface keeps it
     open while the key is held.

   *Recommendation:* a shared part, `scene.use`, taking part in "play": it
   reads the centre ray each frame, shows the nearest applicable verb, runs it
   on its key, and keeps a held verb's session open. It's the first-person
   counterpart of the right-click menu, over the same commands.
3. **People and what they hold.** A bucket, plank or lantern goes in a
   player's hands, so it attaches to a person, not a scene object, and
   people are presence, not doc objects. *Recommendation:* an avatar is a
   presence record (`{ on, position, yaw, pitch }`, in the frame of what it
   stands on, section 5). A held item stays a doc object with a `"held"`
   claim naming its holder (item 1), and its displayed pose follows that
   holder's hands on every view.
   Put down, it lands and attaches like anything carried (section 5). The
   avatar drawing becomes a shared part, so the arena's avatars and the
   ship's crew are one thing.
4. **Who owns time.** The ship's motion (wind, heel, leeway, buoyancy) is
   simulated by one peer and followed by the rest. *Recommendation:* the
   simulating peer **claims the ship's simulation** in the doc (item 1,
   kind `"sim"`) and streams its pose continuously (section 5). (Built
   so, then generalised by TOOLS.md §7: the doc's world clock, whose
   `"clock"` claim the stage holds for whoever computes every process.) The others
   render the pose stream and send their inputs (the helm's angle, the
   sails' trim) as presence of whoever is at that station; the simulator
   reads them. When the simulating peer leaves, its claim lapses (its
   session is gone from presence), any peer still here writes a new claim,
   and Automerge settles who won; the winner starts from the last pose it
   saw. The doc also records where the ship is now and then, so a scene
   opened later starts in the right place. A one-person ship simulates on
   its own client.
5. **Ephemeral things.** Cannonballs in flight, spray and splashes are
   simulated by each peer locally from a send. Nothing is written until
   something lasting happens (a hole), and then only by the peer who fired.
6. **Water.** An ocean is an extension: a world layer drawing the surface,
   the atmosphere for the sky, and a contribution that answers "how high is
   the water here, now" for buoyancy and for the walker (wading, falling in).
   Time-varying, so its clock comes from the simulation's owner.
7. **Sound** is a new stage capability (positional audio attached to objects
   and avatars). A first version doesn't need it.

**How this bears on the earlier questions.**
- Precedence by nearness (section 2) is what makes the use prompt right:
  looking at the helm offers the helm's verbs before the ship's, and the
  ship's before the world's.
- Scopes move (section 5): stations, seats, spawns and held items all live in
  the ship's frame.
- Nesting has to hold all the way: a card table in the saloon of a ship
  sailing through an arena level.

## Summary of changes, if all are taken

| Where | Change | Now |
|---|---|---|
| `stage/chain.js` | holders ordered by depth in the chain; scene placement is the last link; steps 4 and 5 merge | done (build step 1) |
| `stage/router.js` | `ev.holders` for armed handlers | not needed: the body is offered presses after the chain (§6) |
| `stage/host.js` | `api.holders()`, `api.holderOf(id)`; `pref(key, fallback, at)`; `camera.follow` | `camera.ride` and body rides instead of `follow`; `holders`, `holderOf` and `pref(…, at)` not built |
| `stage/presence.js` | a held pose can be `continuous`, so readers use the displayed world | not needed: readers that care read `worldOf`, which is always what's drawn |
| `stage/stage.js` | `api.claim` / `api.claimedBy` (claims as doc fields, lapsing with their holder's presence) | done |
| new part `scene.use` | the first-person use prompt over commands, held verbs; it passes commands' `state` a `from`, and `run` may return a session | done; `from` and `reach` now come from the body, on every surface |
| new part for avatars | drawing people from presence, in their frame, with what they hold (shared by the arena and the ship) | not built: the walk package and sailing each draw their own |
| `parts/hand.js` | `carryable`; attach on landing; displayed world for moving parents | `parts/carry.js` (`scene.carry`, by trait); `carryable` a veto; displayed parent frame; no attach |
| `parts/menu.js` | sections by holder, nearest first | not built |
| tabletop | seats on the table object, per-holder seats, zones and face-up | face-up in its frame; seats moved to `seats/`, still on the scene |
| arena | the walker's body relative to what it stands on; `carryable` for blocks | the walk body (`walk/`) rides what it stands on; blocks lack `scene.carry` |
| STAGE.md | "Activation" and "The input chain" rewritten around placements | done |

None of this changed what runs (`activeSet`) or the stopping rules. Section
9's items are additions: each can land on its own, and the arena or the
table can use each before the ship does. The first two rows were the
decision that mattered: once scope is where a trait sits, and precedence is
nearness, the rest can follow one case at a time.
