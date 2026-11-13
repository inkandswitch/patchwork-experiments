# Tools in hand: a design note

A note to decide from, not a contract. [STAGE.md](STAGE.md) says what the
stage does today; [COMPOSITION.md](COMPOSITION.md) places scenes inside
scenes. This note removes **edit** and **play** as modes and says what
replaces them. It weighs three drafts and recommends a hybrid, revised
after three adversarial reviews (simplicity, correctness, interface).

The bar is the composition note's: few concepts, each general; nothing in
`scene/` that makes sense for one domain; two unrelated consumers for every
addition. No Patchwork core change, no back-compat, invariants checked over
finite cases, permissions left to Keyhive.

## The answers

- **Brought by the user, or part of the scene?** The scene holds content,
  traits and the behaviours they call for, its **processes** (sea, wind,
  door timers) and its **clock**. The viewer has a **body** (orbit, walk,
  seat, station), a **held tool** (none, or one), a selection and prefs.
  Tools and bodies come with packages; which you hold or are in is yours.
  A scene may suggest where to start, never a tool.
- **How do play sessions relate to edit sessions?** There are none.
  Playing is the empty hand. Editing is selecting a thing (its halo shows
  handles where you may write) or holding a tool. Both at once, by one
  person or many, is ordinary.
- **How does a user move between them?** They don't. They pick up a tool
  (the bar, or its key) and Esc puts it down. They change body with a
  thing's verb ("Sit", "Take the helm"), the body chip, or Leave.
- **When does the sea model run?** When its doc's clock runs and a view
  present can compute it: one holds the doc's clock claim and steps every
  process, the others follow. Nobody present, no time passes. Editing never
  stops the sea; pausing does, visibly ("Paused by Ana").
- **What does the interface look like?** The world, a world bar, a bar of
  tools and one drawer (§6).

## Where we are

*As written, before build step 2; the "Today" column is the code then.
Steps 2, 3, 6, 7 and 8 have since been built (Build order, below), so all
of it has gone where the last column says.*

"Activity" is one value per view that decides four things:

| Strand | Today | Goes to |
|---|---|---|
| What runs | `activeSet(metas, doc, activity)` (`activation.js:99-116`) | traits only |
| What input does | `local.tool` polled by parts; arms; `state()` reading the activity | the held tool, the selection |
| Who you are in space | `local.immersive` from an arm flag; `firstPerson`; four REACH constants (stations, seats, joints, traversal) | the body |
| Whether the world moves | sailing's play-only sim and its `sailing.edit` twin | the doc's clock |

It was never one thing: `requires` overrides it both ways
(`activation.js:107-111`); whatever must keep working declares none;
Santorini plays in edit (`tabletop/src/setup.js:263`); in edit the water
runs on a private clock while the ships stop.

## Judging the three drafts

- **Tools in hand**: its `Edit` tool bundles gizmo, handles, Delete and
  transfer, and verbs must name it (`with`): "edit" returns as a hub.
- **Places and vantages**: editing is the selection's, but Tab between
  vantages is a mode switch renamed.
- **Capabilities**: grants fix one symptom of twenty-one, and `acts:
  "author"` is "edit" as a field. But **can** (the thing) is not **may**.

**Recommendation: a hybrid.** Editing is the selection's halo, with no
switch and no pref; bodies, the clock, the Escape ladder, `api.dock` and
the end of `requires` come from tools in hand; can versus may, with "can be
carried" a trait. Rejected: grants, act classes, belt digits, Tab, `with`.

The test for a tool: **it is held only if it takes input outside its own
widgets.** Handles take presses only on their arrows and rings, drawn
outside the thing's box, so a press on the thing still reaches its holders:
they are display. Measure, a brush, Camber's Shape and a gun take every
press, so they are held, one at a time.

Weighed and kept out: a stage `carry` service that holders call (Santorini
has no holder to call it; a trait needs no API); a water `surface` the walk
body reads (the floor is the ray's hit: water height doesn't cross docs);
`units` as content (the model is metres; units are a viewer's reading).

## 1. What runs: traits only

`activeSet(metas, doc)`. A scene trait gives scene scope, only object traits
give object scope, none gives general, run once at the focus. Nothing the
viewer holds, where they stand, or the clock changes it. `requires`,
`activities`, `always` and `general: false` go; doom's drop-only extension
declares the marker trait its layout writes. The host keeps one stop rule:
a doc change lingers 2 s, or while busy.

**Carrying is a trait.** `scene.carry` on an object says it can be picked
up: "can", as data. The carry part (`scene.hand`, renamed) declares it, so
it runs with object scope in every stage whose doc has carryable things,
a linked game aboard included. Tabletop, dice, bag and Santorini's setup
write it; arena's walls and a hull lack it. The `carryable(id)` veto stays
for passing states (a die under a cup). Flip is carry's verb.

**Chrome follows attention, never the doc.** Twenty edit-only parts are
what keep the outline, grid and axes out of a game today. Instead the
inspector is a drawer tab while something is selected, the outline a tab
the viewer opens, and grid, axes and bounds are the orbit body's (§4). A
doc may still suggest display prefs (grid, units, snap), as it suggests
atmosphere; no game needs one to work.

## 2. Part of the scene, brought by the viewer

| Part of the scene (the doc, the same for all) | The viewer's (local) |
|---|---|
| Content, traits, every behaviour they call for | The body stack (§4) |
| Processes: sea, wind, ship physics, door timers | The held tool: none, or one |
| The clock: running or paused, t, who paused | Selection, hover, camera, focus |
| `view.start = { body, place, home }`, read once | Prefs, falling back to the doc's display prefs |

A **place** is not a type: it is the object given to a body's `enter` (a
seat, a station), or null for "here". `view.start` is read on arrival, and
the scene's package list must include its body's package. Prefs keep
today's live rule, `local.prefs[k] ?? doc.view[k] ?? fallback`.

## 3. Attention, selection and handles

**Attention** is one target per view: the selection if any, else the look
(the pointer's hit, or the eye ray under lock). The prompt and the halo are
one surface over it, and keys go to it (§5): what is shown is what keys do.

**A press** runs COMPOSITION §5's chain: the held tool, the widget owner
(handles), the holders nearest first along the hit's path, then the body's
default: orbit's selects (its drag orbits); walk, seat and station have
none. So in CAD a click selects a crate, and at a card table it draws. A
holder's `cursor(ev)` may name its click ("Draw"), shown at the pointer.

**Select** is also the first entry of every target's menu (right-click,
long-press, the context-menu key; under lock, at the crosshair): the
deliberate select in a game. The outline is the keyboard's. Alt keeps its
one meaning: place freely during a carry.

**The halo.** A selection shows its verbs and, where its doc is writable,
handles: move arrows, rotate rings and scale corners around its box,
screen-sized as in Morphic, plus build-param knobs, in the parent's drawn
frame, so a winch's handles heel with the hull. This is new work:
TransformControls is world-space and one mode at a time (`gizmo.js:45,113`);
the drag converts as the hand does (`hand.js:63-98`). G, R and H stop being
keys; move, rotate and "no gizmo" stop being tools; there is no pref.

**Focus scopes selection only.** Selection lives at the focus (COMPOSITION
§3): with the focus on the boat, selecting a card aboard selects the link.
Double-click on a link enters it (elsewhere it frames); Leave, Esc or the
breadcrumb moves out. The chain always spans the whole path, so outside
the focus verbs and carries still work; a Select there does nothing.

## 4. The body and the held tool

**One stack, one slot.** The router's stack (once the arm stack; now
`stack`, `pushBody` and `popBody` in router.js, keeping the old mechanism:
suspended, resumed) holds only bodies, orbit
always at the bottom. Entering a body pushes it; Leave pops it (standing up
returns to walking); a body whose stage closes is popped; focus moves don't
touch it. Over the stack is one slot, the held tool `{ stage, ext, command }`:
picking one replaces it, Esc empties it. `local.tool`, `effectiveTool` and
`view.tool` go; the add chooser becomes a focused DOM dialog.

```js
bodies: [{ id, label, keys: [{ code, label }], lock, reach,          // metres | Infinity
           enter(place) → { input, eye() → { position, direction }, ride?, leave() } }]
// a tool: a command whose run fills the slot, declaring { keys: [{ code, label }], pointer? }
```

- **orbit**, the stage's: OrbitControls, `frame`, `autoframe` and the aids.
  Reach ∞. It rides the focus stage's latest base ride (sailing's follow on
  her hull). `.` frames the selection, Home goes home; F is free.
- **walk**, one package's, replacing arena's and sailing's walkers. It
  starts at the eye, else the spawn; its floor is whatever the ray hits.
  (Built in `walk/`, replacing arena's; sailing keeps its navmesh walker as
  a body of its own for now: see build step 6.)
- **seat**, `seats/`'s (COMPOSITION decision 5), rides the seat: no
  movement keys, so D draws. **station**, sailing's: A/D steer.

`enter` runs in the stage that called `api.body.enter(id, place)`, in its
frame; the view converts the eye. The body's ride is the only ride. The
body is the source of `from` and `reach`, and every surface (prompt, menu,
key map) passes both to `state` and `run`; with no hit, distance is from
the eye to the target's box. Reach is ergonomics, not permission: orbit
reaches everything.

**The pointer.** The top body asks for lock; the view grants it while
nothing else wants the pointer (a held tool with `pointer: true`, a
selection, an open menu, dialog or dock). The browser's Esc **releases** it
unseen by the page; the next press on the world only relocks. A **refused**
lock leaves the body looking by drag, as arena does (`play.js:90-95`).
**locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused.**

## 5. Keys and Escape

**One key order**: a focused field (DOM), the open gesture (a carry's Q/E/F),
the held tool's declared keys, the body's, then the key map over
attention's path (its element in each stage, then that stage's null target,
innermost first). Keys have no position, so what reserves them comes before
what offers verbs; presses have one, so the body comes last there.

**A shown key works, by construction**: the prompt, halo and bar compute
each hint with the resolver that dispatches keys. A verb whose key is
reserved shows without one and is in the menu (walking, Draw is a button,
not D). The prompt shows three verbs, the menu all; verbs are buttons, for
touch. Held-key sessions (`use.js:20-33`) move into the one key map, the
only `input.key` implementer (STAGE.md:659-662 becomes true).

**Escape pops exactly one layer**: the lock (the browser's), a focused
field, popover or dock field (a search field with text clears first, then
leaves: its query is a layer), the gesture, the held tool, the selection,
the focus (Leave). Never the body, never the clock. The Esc hint names the
next layer. Escape is handled in eleven files today; the ladder is the one
place it is decided.

## 6. The interface

```
+-- Harbour > Wanderer -- ▶ sea -- o Ana · helm  o Ben · walk -- | [Walk v] [View v] -+
|              ~ ~ ~   Wanderer heels, the sea runs   ~ ~ ~        + (eye ray)          |
|                  .- Winch ---- [Q] Haul  [E] Ease -.   the prompt: attention's verbs  |
| [ Measure | Dimensions | Paint ]                              Esc: release pointer   |
+--------------------------------------------------------------------------------------+
```
*Walking aboard, empty hand. Left of the bar is the world's, right is yours.*

```
+-- Harbour > Wanderer -- ▶ sea -- o Ana · helm  o Ben · walk -- | [Walk v] [View v] -+
|    <-> () [] .- Winch (selected) ------.  handles round its box,   .- Inspector ---. |
|              |  Haul  Ease  Delete  ... |  in the hull's drawn frame | x 1.20 y 0.84 | |
|  hull, on hover: "moving: sailing, Ana at the helm"   pointer free   Esc: deselect   |
+--------------------------------------------------------------------------------------+
```
*Ben edits while walking: right-click, Select. The pointer frees; WASD still walk.*

```
+-- Wanderer -- ▶ sea -- o Cara · p1  o Dan · p2 ----------------------- | [Seat p1 v] -+
|     [Y3][Y5] [B2]     discard [G4]     deck [##] 32     (the table heels with her)   |
|     [R6][R9][Y2][B7][Bh][G3][W5][W8]   click: Play    [D] Draw     Leave: stand up   |
+--------------------------------------------------------------------------------------+
```
*Seated: D reaches Draw; the game has no processes, so no clock of its own.*

```
+-- Wanderer > [Lost Cities] (Leave) -- ⏸ Paused by Ben [Resume] -- o Eve -- | [Orbit v] -+
|  (tinted) the boat, as it is: verbs and carries reach it; selection does not            |
|        .-- table felt (selected, the game's object) --.            Felt [green v]       |
+------------------------------------------------------------------------------------------+
```
*A linked scene entered while the boat is paused: the focus moves in; tools and body stay.*

- **The bar of tools** holds the general tools and those of the stages on
  the focus path. **Who's here** shows each person's body and held tool,
  from presence (today only selection and hover, `select.js:143-146`).
- **The clock chip** is ▶ or ⏸ for each doc on the focus path that has a
  process, outermost first; its Pause acts on that doc. Who computes shows
  only on a stall ("waiting for Ben's machine") or when nobody here can.
  *Built (step 7):* `scene.clock`, one chip in a slim bar on the stage's
  top edge (the world bar's seed: the view's corners and top middle are
  games' HUDs) for the one doc there is until step 12, shown while this view has a process, someone
  computes, or the doc is paused: "▶ Running", "⏸ Paused by Ana" with
  Resume, "▶ Waiting for Ben's machine" (no word from the computer for
  1 s), "▶ Nobody here can run it (view only)"; the button only where this
  view may write.
- **Can't** shows: a verb out of reach or on a read-only doc is disabled
  with its reason ("too far", "view only").
- **Try a copy**, on the world bar: the scene copied at its heads, opened,
  then discarded: play-testing without spending the real doors.
- **One drawer** with tabs: inspector, outline, and an object's own editor
  (Camber, a dice table, a bag), docked by its verb with `api.dock` and
  closed by its × or its caller; the pane with the keys shows a focus ring.
- **Narrow**: the world bar collapses to the breadcrumb and one menu.
  "Paused by" and notices are `aria-live`.

## 7. World time and processes

| Kind | Pauses | Shared | Uses | API |
|---|---|---|---|---|
| **World** | yes | one t per doc | sea and wind phase, ship physics, float bob, a door's `since` and `wait`, respawns | `api.clock` |
| **Actor** | no | the actor's view | dice tumble, cup shake, card glide, flip, carry, walking, station input | `api.loop(dt)` |
| **Liveness** | never | per view | presence TTL, claim grace, LINGER, HEAR_MS, lots deadlines, dice THROW/TOLD, bag RECENT | `Date.now` |

An act begun during a pause finishes. Lots never sees the clock, so a
pause can't deadlock a roll. Station input is actor time, read from
presence (`sim.js:389-395`); the sim integrates it on world time.

```js
doc.clock = { running, t, by? }                  // made with the doc; written field by field
api.clock = { t(), running(), computer(), pause(), resume(),
              process({ start(t), step(dt, t), save(d), stop(), replicated? }) → remove }
pose.hold(id, transform, { yields })             // false while a hold ahead of it stands
```

*Built (step 7):* `stop()` joined the three: the computer letting go (or
losing the claim) has to tell a process to let go of its holds, landed
where its last `save` put them, and a process can't hear that from
anything else. `heldBy(id, { yields })` asks of the kind of hold the caller
would make. Objects a checkpoint's saves moved are stamped `saved: t` by
the stage (below). A `step` moves world state only; what a process shows
(its pose holds, what it publishes) goes once a frame, from its own loop,
where the steps left it: a slow frame is many steps (at 3 fps, fifteen),
and sailing holding her poses at each step cost as much again as her
physics and dropped a headless probe from 3.1 to 2.4 frames a second.
`computer()` (`{ viewer, session, mine }` or null) joined too: sailing's
followers read the ships the computer publishes from its presence, and
asking who computes is the clock's to answer, not a reading of the
stage's claim. `doc.clock` is made with the doc (the scene datatype's
`init`, STAGE.md "Shared maps") and the stage writes its fields one by
one: the first checkpoint of a doc without one made the map, and a pause
made at the same moment made another, so the merge could keep the
checkpoint's and lose the pause.

- **Computing.** The stage holds one `"clock"` claim per doc, under the
  usual rules. A view is eligible when its stage acts (not a pin or
  mirror), is writable, visible and settled (`host.js:396-404`), has every
  listed package, and has a process. The computer calls `start(t)`, which
  continues from what the process has followed (warm, as sailing takes
  over) or else from the doc (cold); then `step` on a fixed grid of world
  time (1/60 s: two views stepping one process from one t step it alike),
  at most 0.25 s of world time a frame. It lets go when hidden, paused or
  ineligible, and on `pagehide`.
- **Checkpoint.** On pause, on letting go and every 30 s while running, the
  stage writes `clock.t` and calls each `save(d)` in the same change. A
  process saves only what it still holds. The stage stamps each object a
  save moved `saved: t`, which is the motion stamp generalised (below).
- **Followers** run toward the computer's t at the moment whose holds they
  draw (sailing's sea clock, moved to `src/stage/clock.js`): they slew,
  jump only forward, and never pass the newest t the computer has said, so
  a view's t never goes back and, once the computer's pause checkpoint
  arrives, every view's paused t is `clock.t`. With no computer a view
  draws at `clock.t`, still.
- **Timers are steps**: joints closes a door once `t ≥ since + wait`, from
  its process's step, and `since` is world t. Its motion stays an act.
- **Replicated processes.** `process({ replicated: true, step })` is a
  process every present peer runs itself, from shared inputs: a
  deterministic engine (machine/HOST.md's host, a WASM Doom stepped from
  per-seat input logs), not one view's to keep. It uses the clock without
  being the claim holder's alone: it counts as a process, so its view is
  eligible and someone computes t (if only engines are running, the claim
  holder computes nothing but t); every view that has it steps it at its
  own t, on the same grid, from `start(t)`; only the computer calls its
  `save`; `pause` and `resume` are anyone's, as for every process. A pull
  engine reads `t()` and `running()` instead of taking steps (the host's
  `Host.open(…, { clock: api.clock })` steps to `floor(t · hz)` itself),
  and registers `{ replicated: true }` only to be counted. Two things it
  can rely on: a view's t never goes back; and paused, every view's t is
  `clock.t` once the computer's checkpoint arrives, because no follower
  passes what the computer has said, so every peer stops at the same tick
  without the session clock's quarter-second margin (a peer whose computer
  crashed before checkpointing may stop a few ticks further, and agrees
  again on resume from inputs). Running, a follower's t trails the
  computer's by its playout delay (latency and 1.5 pose intervals, at most
  200 ms; with no poses, 150 ms): the host's rollback absorbs it, at the
  cost of the computer re-stepping that many ticks when a follower's input
  lands. Paused, a replicated process is stepped only up to `clock.t`:
  that catches a follower up to the pause point every view has, the one
  step H7 lets a view take after it has seen paused.
- **One clock per doc.** Pausing the boat doesn't pause a linked game; a
  pin never computes. A concurrent pause and resume settle by last writer
  on `clock.running`, and the chip names who won. Two pauses at once (the
  computer's and a follower's) each write a `t`; if the merge keeps the
  follower's, the view that was computing writes its own again, so paused,
  every view still meets at one t.

| Case | What happens |
|---|---|
| Nobody present | Nothing computed, no time passes (Croquet). The first arrival starts cold at `clock.t`; an open door's remaining wait resumes (it used to slam 1.5 s after arrival). |
| Running, nobody able | Only read-only viewers or ones missing a package: t stays and the chip says so. Spectators never advance a world. |
| The computer crashes | Followers keep the last held poses until presence drops it (15 s, `presence.js:35`), then one takes over warm. Alone, the next arrival starts cold from the last checkpoint. |
| A pinned copy | Never computes. A sea trial of version N is a live scene whose hull's source is fixed at N's heads. |

**A person and a process on one object.** Holds are ordered by (a person's
before a yielding one, then `since`): one total order. A process holds
with `yields: true` unless someone drives the object, so sailing yields a
hull nobody steers and keeps one at the helm ("moving: sailing, Ana at the
helm"). While a person holds it, the process doesn't step it. Writes
without a hold (inspector, paste, a peer's merge) are the process's to
notice: sailing's motion stamp is the rule, generalised: the stage stamps
what a checkpoint's saves moved `saved: t`, so a transform that changed
without its stamp was moved by something else, and one that changed with
it was a checkpoint (a late one, after a handoff); an object moved by
anything else restarts at rest from the doc. This replaces the silent
last-hold-wins in one view. Consumers: sailing and joints (a door's
motion yields: carrying it stops it); arena's respawns next.

*Built:* `src/stage/holds.js` keeps this view's holds in that order (a
hold by another extension here stands unless it yields and the new one
doesn't; a peer's that ranks ahead is a refusal, and takes a hold we had,
so its holder's next `hold` returns false); `presence.js` `ranksAhead` is
the order, with `yields` on the wire. Sailing's motion-based
`movedByEditor` reads the `saved` stamp now. Every holder reads what
`hold` answers, and a refused hold is an object it doesn't have: sailing
doesn't step a hull whose hold was refused (she waits where she was
taken, with her motion: put back she goes on from there, put down the
stamp rule starts her at rest where she landed); a door's motion lets go
without writing (a carry or a halo drag in the opener's own view takes the
door, which `heldBy`, a peer's, never sees); carry and the halo put back
what something here holds ahead of them (a roll, a glide). Dice, the cup,
tabletop's glide and the stations' wheel still don't read it: each holds
first, ahead of a carry, so only one started under a carry would be
refused unheard.

## 8. Permissions

**Who may write is the handle's** (`api.writable`), and Keyhive's when it
lands; a read-only or pinned stage offers nothing that writes (I6). **Can
is not may**: "can" is the thing's (`locked`, `scene.carry`, a door's
travel), component physics in packages; "may" is the person's, Keyhive's
to answer. **No grants**: a grant inside a doc is an offer a modified
client ignores; a boundary that matters is a doc (COMPOSITION's private
layer, a level's walls in a doc players only link). Decided (5 below):
any writer may open a door, move a wall, pause, or take an unsteered ship,
by name; integrity beyond the secret-keeping work is not sought.

## 9. Stage changes, and what leaves scene/

**New.** `api.body` (`current`, `enter(id, place)`, `leave`, `eye`,
`reach`); `api.clock`; `api.dock(el, { title, onClose }) → close`,
replacing Camber's, dice's and bag's copies (built: `onClose` is how a
caller hears its pane's × — Camber's Shape ends, a die's panel unmounts —
and only the × calls it); `api.writable`. The `bodies`
contribution; `keys` and `pointer` on tools; `reach: true` on commands;
`yields` on holds, on the wire and in `winningHold` (`presence.js:107-119`).
Doc: `clock`, `claims.clock`, `view.start`, the `scene.carry` trait. Local:
the body stack, `held`. Presence: body and held tool.

**Changed.** `activeSet(metas, doc)`; `from` and `reach` on every surface;
handles in the parent's drawn frame; `cursor(ev)` may name its click;
`scene.hand` becomes `scene.carry`, a trait part.

**Deleted.** `src/activities.js`, `src/parts/activity.js`,
`src/current-tool.js`, `scene.activity`; activities, `requires`, `always`
and `general: false` in `activation.js`, the seeding and immediate stop
rule in `host.js`, `setImmersive`, `router.js:517-522`. Fields: `activities`
on 26 parts; local `activity`, `immersive`, `tool`; `view.activity`,
`view.tool`; `firstPerson`; `camera.riding`, ride `fallback`. The gizmo's
tools and G, R; the hand's H; `standingDown`; `editing()`; `SEAT_REACH`
(in `seats/` since step 5, with `firstPerson`'s hand-off).

## 10. How each symptom goes away

| Symptom | Why it goes |
|---|---|
| Keepers, policies, lots, joints declare "no activities" | No activities; `tabletop.rule` merges back |
| dice's Roll hides in edit because R is the gizmo's | Handles have no keys; R rolls, on every surface |
| The edit tool outlives play (dice 616-624, tabletop 521-523) | No `local.tool`; both workarounds go |
| joints needs two commands for one verb; four REACH constants | `from` and `reach` on every surface; `body.reach` |
| `requires`, `always`, `general: false` route around activities | Gone; carry by trait; chrome follows attention |
| Sea t never saved; joints compare peers' `Date.now` | `clock.t` checkpoint; `since` in world t |
| Silent last-hold-wins in one view | Holds in one order; a yielding hold is refused |
| Three docked-editor copies; F means five things | `api.dock`; Frame moves to `.` |
| "One activity per view", "edit stops at the focus" | No activities; the focus scopes selection |

## Prior art

| System | What it does | We take | We don't |
|---|---|---|---|
| **Squeak / Morphic** | Any morph shows a halo round its bounds; the world never stops | The halo on a deliberate select | A handle for every operation |
| **Second Life** | Build tools edit the live world while scripts run; per-object flags | Editing in the running world; who holds what, shown | Per-object flags: Keyhive's, at doc grain |
| **Roblox, Dreams, Minecraft** | Play runs a copy; create stops time; creative bundles flight and permission | Trying a copy; pausing as its own act; a per-person body | Time or permission as a side effect of a mode |
| **CAD** | Workspaces swap toolbars; "Activate component" edits in context | Double-click to enter; focus scopes selection | Workspaces that change what you can do |
| **Croquet** | One replicated world; nobody there, nothing happens | One t per doc; no time without presence | Replicated computation |

## Worked examples

**1. Ana sails while Ben moves a winch.** Ana arrives first, computes the
clock and takes the helm (F, within 2.5 m): her body is `station`. Ben,
walking, right-clicks the port winch and selects it; the pointer frees and
he drags it aft in the heeling frame; the sheet station reads it next step.
Had he dragged the hull, it would not have yielded: Ana steers.

**2. Lost Cities aboard while Eve repaints the table.** Cara and Dan sit at
linked game G in G's seat bodies; cards carry in G's stage, on G's channel.
Eve, in orbit at focus Wanderer, clicks the table rim (the boat's) and
recolours it. For the felt (G's) she double-clicks G to enter it, where G's
rule and audience run unchanged: she sees backs.

**3. Hull design and sea trial.** Workshop K has no processes, so it is
still by construction; Ana docks Camber from the hull's verb and holds
Shape. Trial T sails two copies of C fixed at heads h1 and h2 meanwhile.

**4. A Doom level.** E1M1 starts people walking at its spawn and lists the
walk body's package. Dee picks up the gun by its key: a click shoots, R
reloads, so a die's Roll there shows without R. F opens a door, reach from
her body; joints' step closes it once the wait has passed in world t. Eli,
in orbit, clicks a wall and fixes its material; if he pauses, doors hold
and Dee still walks. To try his changes, he plays a copy.

## Invariants

| | Invariant | Finite check |
|---|---|---|
| H1 | **What runs is the doc's.** The host resyncs only on a registry or doc change | Over each fixture doc, every change to body, held tool, selection, focus, prefs or clock triggers no sync |
| H2 | **One stop rule**: stop only when the doc stops calling, after LINGER or while busy | Host transitions over (wanted, busy) × every order of ≤3 events |
| H3 | **A shown key works**: hints come from the dispatching resolver; each key reaches ≤1 invocation | Every command × body × held tool × gesture {none, carry} × attention {selection, look, null} × reach: hint ⇔ dispatch |
| H4 | **Escape** pops exactly the top of lock, field, gesture, tool, selection, focus; never body or clock; the hint names it | All 2⁶ states × focus depth ≤3 |
| H5 | **Pointer**: locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused; after a release the next press only relocks | All 2⁴ cases × each body × {press, key} |
| H6 | **One holder** per object, by (person before yielding, `since`); a yielding hold is refused while a person's stands; a process saves only what it holds | Every sequence of ≤4 of {A, B, process driven or not} × {take, land, leave, pause}, in one view and across |
| H7 | **Clock**: ≤1 computer per doc once claims arrive, only eligible views; t monotone per view (a cold start after a crash is a new view's first t); once a view has seen paused, no `step` of a kept process (a replicated one only up to `clock.t`) | ≤3 views × {visible, hidden, gone} × {writable, read-only, missing a package} × every order of ≤5 of join, leave, hide, crash, pause, resume, save, on in-memory Automerge |
| H8 | **Three times**: a pause changes no actor or liveness outcome | Each dice, lots and cup protocol test, and joints' slide, paused at every step |

*Built (step 7), what runs:*
- **H6** (`src/stage/holds.test.js`): real presences on a bus whose
  messages wait for delivery, real hold tables; A and B people in two
  views, the process in A's view (one view) or B's (across), driven or
  not, each event heard before the next or in concurrent pairs: every
  sequence of ≤4 of the ten events (A, B: take, land, leave; the process:
  take, land, leave; pause), 11,111 each, 88,888 runs. One holder across
  views, every view agreeing on it; a refused person refused only by a
  person's hold or a driven process's; a yielding process gets it whenever
  no person does; with every hold heard, no process write while a person
  holds it. Plus the order itself, total and transitive over every pair and
  triple of 16 holds. Three mutations (last-hold-wins here, yields ignored
  in the order, no reconcile) each fail it.
- **H7** (`src/stage/clock.test.js`): three views of every capability
  (writable, read-only, missing the package: 27 configs), each with its own
  Automerge replica merged every frame, the first two joined: every
  sequence of up to 3 of join, leave, crash, hide, pause, resume, save,
  applied to whichever view each may apply to (17,673 sequences, ~10 s),
  checked after every event: ≤1 computer, only an able one, exactly one
  while the world runs and someone can, none paused, a kept process never
  stepped while paused or by a non-computer, t never back in any view, a
  joiner starting at `clock.t`, and, paused with no crash, every view at
  `clock.t`. The note asks for ≤5, which is run but not by default:
  `H7_DEPTH=4` is 131,568 sequences (~95 s) and `H7_DEPTH=5` 961,400
  (~14 min, one worker), each count pinned, and both pass (2026-11-13).
  Each world frees its Automerge replicas when it's done (the deep runs
  used to wear out Automerge's wasm memory and fail on it, not on an
  invariant), and the search yields to the event loop so vitest's worker
  stays answerable. Plus pairs made at once, unmerged: every order of
  every set of the computer's checkpoint, its pause and a follower's pause
  (15), merged: no pause lost, and paused, every view at the larger t.
  Plus replicated processes (both views step one on the same
  grid; paused, both end on the same step), a stall, and the cold start.
- **H8**: dice, lots and the cup run on actor time and liveness only, so a
  pause can't reach them as long as nothing in the package reads the world
  clock; `dice/src/h8.test.js` holds every source file to that (it fails on
  any `api.clock`, `claims.clock` or `doc.clock`). The one channel a pause
  does use is a doc change (the clock's fields), which runs every view's
  `update()` again: a roll is run paused at each of its 76 frames, from the
  press to the told landing, and lands, writes, lets go and is told the
  same as unpaused (`dice/src/extension.test.js`). The cup and lots are
  held only by the static check. Joints' slide is run
  for real: a plain cycle and two pressing at once, both doors, the world
  paused 0.5 s or 3 s from every 250 ms of the first 12 s (392 cases), the
  same writes by the same views as unpaused, each open landing when it
  would have, every write after HEAR_MS, no close started while paused,
  every close at the first tick its wait had passed in world time.
| H9 | **Reach**: a `reach` command runs ⇔ distance ≤ body.reach, else shows "too far" | {prompt, menu, key map} × body × {hit, no hit} × {in, out} |
| H10 | **Selection at the focus**: the selected path ends at an element of the focus stage | Paths of depth ≤3 × every sequence of ≤3 of press, Select, Enter, Leave, Esc |
| H11 | **Carry**: only with `scene.carry`, no veto, no holder, in its own doc's stage | Object × trait × veto × held × depth ≤2 × focus |

COMPOSITION's I4 trades "× activity" for "× body × held tool × clock"; I8
loses "nothing outside the focus"; I10 follows attention.

## Build order

The combined order is COMPOSITION's; this note's steps are its 2, 3, 6, 7,
8 and 9, each shipping alone.

- **2. `api.dock`.** Camber, dice and bag move onto it. *Built:* the
  drawer holds docked panes only; the inspector and outline stay in the
  sidebar for now (step 3 left them: see its note). One width for every
  pane (Camber had its own, wider); a pane gets no resize handle yet.
- **3. Selection and carrying.** The halo; Select in the menu and as
  orbit's default; `scene.carry`; `local.tool` and the forced-hand
  workarounds go; activities remain. *Proves:* dice's R rolls; a drag
  under a moving parent; H10, H11. *Built:* `scene.halo` replaces the
  gizmo (`parts/halo.js`, its maths `halo-math.js`): arrows, rings and
  corners along the parent frame's axes, scale uniform about the box's
  middle, a handle 2% of its distance from the eye; drawn in the main pass
  and offered as a widget at its distance, so a handle behind the thing
  loses to it; an arrow seen end on or a ring edge on is neither drawn nor
  offered (an edge-on ring would lie across the thing's middle). It
  follows the frame after each frame drawn, and before every frame while
  what it's on is moving. Handles only: verbs stay in the menu and the use
  prompt. `api.writable()` (§9) arrived with it. `scene.carry` is a trait
  part with `describes` (*Carryable*); a press carries `ev.holder`, the
  nearest link with the trait; `carry(id)` carries only what has it.
  Tabletop (every table, an imported game's included), dice (dice, cups) and bag write it; only what has it
  goes into a bag, so what comes out can be carried. Sailing's veto went
  (her fittings lack the trait); the cup's stays. `view.tool`, `local.tool`,
  `effectiveTool`, G, R and H went, and with Flip carry's on every surface,
  Frame moved to `.` now (the selection, else everything), not at step 6.
  Select, the menu, the halo and the knobs run in every activity; until
  bodies, "the orbit view" whose plain click selects is the editor's
  activity, not first person. H10's model is `src/selection.js`, with
  Enter and Leave in it though the focus is the scene's own until step 14.
  H11 is checked at focus `[]` only, there being one stage until step 12;
  its "× focus" cases follow at step 12/14. Select's plain click comes
  after the holders and last of the scene's own general extensions by
  registration order alone; step 6's bodies make the default press
  structurally last. Carry now holds a piece at its own depth, so where a
  game's extension holds the same object, running order puts carry's Flip
  ahead of the game's verbs: on a boneyard domino the prompt's three are
  Flip, Draw and Wash, and Stand on edge is U's and the menu's. That is
  the queued three-verb cap; ordering generic holders after the others at
  a tie is left to it.
  The inspector and outline stayed sidebar panels of the editor's activity
  until step 8 made them drawer tabs that follow attention.
- **6. Bodies and the held tool.** Stack and slot, four bodies, `from` and
  `reach` everywhere, declared keys, attention, the pointer, the Escape
  ladder; rides by body. *Proves:* H3-H5, H9; Doom with one walker.
  *Built:* the router's stack holds only bodies, orbit (the stage's,
  `ORBIT` in `stage.js`) at the bottom, whose default press is Select,
  offered after the held tool and the whole chain: structurally last
  (`scene.select` lost its click). `api.body` is `current`, `enter`,
  `leave`, `eye`, `reach`; a body popped from under another takes those
  over it, and an extension stopping pops its own. The held tool is
  `local.held`; a command that declares `tool: { keys, pointer }` holds the
  input its run returns (run again: put down), and `api.hold({ name, keys,
  pointer }, input)` holds one not picked up through a command (bag's drawn
  piece; the slot's `command` is then null). `api.arm`, `relock`, `local.armed`,
  `local.immersive`, `camera.riding` and ride `fallback` went. Declared
  keys (`[{ code, label }]`) on the gesture (carry's `CARRY_KEYS`), the
  tool and the body make the key order (`src/keymap.js`) decidable before a
  press, and every surface (prompt, menu, bar) shows a key only through
  `hintFor`, the dispatching resolver; the key map is the only
  `input.key`, and held verbs moved into it. The prompt still runs only in
  play (activities go at step 8). `from`, `reach` and `distance` are on
  every surface's context (`api.context`), passed to `state` and to `run`
  (its third argument); keys and every key hint are decided in one
  context, attention's (`src/parts/resolver.js` `keyContext`: its hit,
  else the look), and `reach: true` on a command
  is checked once, in `commandState`: beyond reach it is disabled, "too
  far". The four REACH constants went as verb checks: joints and
  traversal have one command each; seats' verb says `reach: true`;
  sailing's station verbs do too (`SEAT_REACH` stays in `seats/` as the
  seat body's reach). Reaches: orbit Infinity, walk 2 m, seat 2 m, sailing's crew 2.5
  m. The pointer is `src/stage/pointer.js` (an open drawer also wants it),
  the ladder `src/stage/ladder.js` with seven rungs (a popover, `api.popover`,
  between the field and the gesture: the menu, the add dialog and the body
  chip's menu are popovers, so the eleven Escape handlers are one; the
  parts and outline filters' own Escape went to the field rung, which
  clears a search field's text before it leaves the field). The
  body chip, who's here (body and held tool from presence) and the Esc hint
  are `scene.body`, bottom right; the world bar of §6 is not built. Tabletop's
  verbs no longer hide walking: their keys are the walk body's, so they show
  without them. Bag's drawn piece in hand is a held tool.
  Three deviations, each the smaller step: (1) **walk** is a new package,
  `walk/`, replacing arena's walker only, with the spawn trait renamed
  `walk.spawn` (arena's pad part writes it; doom asks for that part); it
  rides what it stands on. (Then E1M1 listed `walk` only because its
  publisher said so: the walk extension declared no traits, so nothing in
  a doc called for its package. Step 8 gave `walk.spawn` a trait part of
  its own in `walk/`.) **Sailing keeps its
  navmesh walker as its own body, `aboard`**, with `station` pushed over
  it: the walk body stands on what rays hit and knows nothing of her
  ladder, the water or a vault over her rail, which the navmesh walker
  proves invariants for; folding them into one walker waits until the walk
  body can stand on a moving deck as well as the navmesh does. (2) A body
  says `here: false` when it needs a place (a seat, a station), so the chip
  doesn't offer it, and a sitting may carry its own `keys` and `label` (a
  station's keys differ by kind; its label is "Helm", "Winch": read since
  step 8, the chip having said "At a station" until then). (3) The key map tries attention's whole
  path, the look's hit then what it's attached to, before the scene, so
  Delete on a spoke removes the spoke and F on it takes the helm; the prompt
  shows the first target along that path with verbs. Gun, arena's, is a
  held tool (G; a click shoots, R reloads). `view.start` is not built: the
  arena's Play enters walk at a spawn. Sailing's where-to-go verb stays,
  first in its order, ahead of the station's greyed verbs.
- **7. The clock.** `src/stage/clock.js`, the claim, processes,
  checkpoints, ordered holds; sailing and joints move on. *Proves:* H6-H8.
  *Built:* as §7 says, with its *Built* notes: `stop()` on a process, the
  `saved` stamp, `heldBy(id, { yields })`, replicated processes, and the
  chip as `scene.clock`. Sailing's ships are a process (warm from the poses
  it followed); its sea is drawn at `api.clock.t()` and its own clock, the
  `"sim"` claim and the ten-second saves went. Joints' closing is a process
  registered while a part closes itself, `since` is world t, and the
  `here` key, the opener's duty and the grace period went: the computer
  closes every door. Activities remained until step 8: a view in edit had
  no sailing process, so alone in edit the sea stood still (it had run on a
  private clock), and editing stopped the ships. And any process
  makes a view eligible, but a kept process is stepped only by the
  computer: an editor whose only process is joints' (a self-closing hatch)
  who took the claim first computes for a sailor too, and the sailor's
  ships stand still for as long as the editor is here and visible. That was
  this step's gap, not the design's, and step 8 closed it: with activities
  gone every view with every listed package runs the same extensions and so
  the same processes, and eligibility already asks for every listed package.
- **8. Activities and `requires` go**, with `always` and `general: false`.
  Only now does editing stop freezing the sea, with pause to replace it.
  *Proves:* H1, H2.
  *Built:* `activeSet(metas, doc)`: a doc trait gives scene or object scope,
  none declared is general, and nothing else counts (`src/activities.js`,
  `parts/activity.js`, `scene.activity`, `local.activity`/`activities`,
  `view.activity` and `view.tool` went). **`always` went too**: it was
  declared only by `scene.clock` and `scene.activity`, both traitless and so
  general anyway, and nothing with traits needed it. The host has one stop
  rule (a doc change lingers 2 s or while busy; one still loading, or whose
  plugin is uninstalled, stops at once). Doom's drop-only extension declares
  the marker trait its layout writes on the map's static part (`doom.map`);
  walk's spawn point got a trait part of its own (`walk.spawn` in `walk/`,
  with a Walk from here verb), so a doc with spawn points calls for `walk/`.
  Every extension's `requires` and `activities` went, and the edit/play
  twins merged: sailing's `sailing.edit` (her sea while editing: the sea now
  runs for everyone, so editing never stops her; a pause does), arena's
  `arena.edit` (Stand targets up is the arena's menu verb), and
  `tabletop.rule` back into `tabletop` (its `audience`). The verbs that hid
  in edit or play (tabletop's Draw, Wash, Stand, Lay my hand face up; the
  cup's) apply whatever the viewer is in; bag's edit-only Empty out is a
  menu verb anyone may use. **Chrome follows attention:** the sidebar went;
  the inspector is a drawer tab while something is selected (its × shuts it
  until the selection changes; the toolbar's Inspector opens it on the
  scene), the outline (Objects), Dimensions and Parts are tabs the viewer
  opens from the toolbar (`src/parts/tab.js`, docked with `embed: false` so
  their keys are the stage's; the inspector following the selection docks
  with `show: false`, behind a pane in use such as the parts bin); while one
  of them is shown the drawer is a side panel's width, not a docked
  editor's; `local.drawer` says what's docked, so the toolbar's toggles hear
  a tab close. Grid, axes and bounds were already the orbit body's. The use
  prompt hides while a gesture is open (a carry: its keys come first). Every general part runs in a game too (the toolbar, the use
  prompt), showing what attention asks for. **`view.start = { body, place,
  home }`** (`view.home` went into it): read once on arrival and after a
  template, entered once a running extension offers the body and the
  content is in (or 20 s after it came on offer), never again; until it's
  on offer the wait lasts while the body may still come (a package loading,
  or asked about and accepted however much later), and ends once everything
  the doc calls for is here and started or failed without it (an extension
  that failed doesn't hold it open) (`startOf`, `tryArrive` in `stage.js`); the inspector's Starts in picks the body (Orbit, or one on
  offer). Publishers: tables start people in the seat body with no place,
  which seats/ reads as your own seat if the doc seats you, else watching
  from the first seat's view, labelled "Watching", writing nothing (a press
  on a piece there carries it or uses it; nothing selects; the picker or a
  seat's verb sits you down over it); a level starts them walking at a
  spawn point; ships, Cadboro Bay and a bag's new scene start in orbit at
  their home (a click on the ship comes aboard: sailing's holder takes it
  before orbit's Select; a bag's new scene is an empty scene to build on,
  not a table). Santorini gained three seats (Blue, Cream, Grey, by its
  workers' colours, each looking across from its workers' side), so every
  built-in game starts people where a press picks a piece up. The four notes-pass issues: a sitting's
  `label` is read (the chip says "Helm"); `walk.spawn` calls for walk; the
  stale comments went; `always` went.
  *Undo, built* (Decisions 2): `api.edit(fn, { label, handle })` and
  `api.edits(label)` (a step of several writes, passed as `{ edit }` to
  `addObject`, `remove`, `drop`, `part`) record a step from the change's own
  patches (`src/undo.js` `createEdits`); the halo, the build-param knobs (on
  the render doc), the inspector, the outline, Delete, add, the parts bin,
  transfer, dimensions and Set home view write through them, and nothing
  else does. `api.undo()`/`redo()` write a step's inverse in one change only
  when the doc still holds everything the step wrote (else it's dropped
  whole, and said), so undo never reverts a later write and never half an
  edit; the undo is the redo step. Per view, keyed by the focus doc. Only
  the stage's own parts have `edit`, `edits`, `undo` and `redo` on their
  api: a module this package marks (`src/stage/own.js`, a set only this
  package's code can reach), not an id, so a package's verb can't put
  itself on a stack. **Reveals and decides**: a step is judged when
  recorded, from the doc before and after it (`judgeEdit` in `stage.js`):
  it showed an object when that object's audience grew (unknown counts as
  grown), and decided one a running extension's `decided(before, after)`
  names (nothing answers it yet: no stage edit draws or rolls). Taking it
  back asks every running extension's `parties(scene)` (seats: whoever is
  seated, here or away) and is refused with a reason while anyone else has
  a stake; it stays on the stack, so a party standing up frees it. Nothing
  answering (or `null`): free (a CAD scene); a `parties` that throws: can't
  be told, refused. With a listed package missing or an extension not
  started no audience is known and every step counts as showing: a seated
  table with a declined package can't take back a stage edit while anyone
  else is seated, and says so ("…can't be told (a package the scene uses
  is missing or didn't start)…"). **Kept contents**: a step that removed
  objects bound by a keeper's trait (a plugin saying `keeper`) is undone as
  the doc held them, saying the kept part comes back as its keeper has it
  now. Bag contents (their own doc, not a keeper's) aren't named by this. ⌘Z /
  Ctrl+Z and ⇧⌘Z / Ctrl+Y (not in a field) and the toolbar's Undo and Redo
  (`scene.undo`). Checked exhaustively on real Automerge
  (`src/undo.test.js`): every sequence of up to 4 of five edits (move a die,
  a card, the hull; add; delete the die), a roll, a shuffle, a process save,
  a pause, undo and redo (16,104 sequences, ~12 s; `UNDO_DEPTH` for more):
  an undo or redo only ever changes leaves last written by an edit, no
  stack ever holds a leaf only a verb, a save or a pause writes, the order
  always lists exactly the objects, and an undo straight after an edit
  restores the doc. Making `inverse` skip its "still as left" check fails it
  at once (move the die, roll it, undo). Again with two people on two
  replicas (`UNDO_PAIR_DEPTH`, default 4: 22,620 sequences, ~23 s): A's
  edits, a roll and a save on A's, B's edits to the same field and to
  another on B's, each one's undo and redo, and a sync both ways, so B's
  edits arrive merged at once, later, or concurrent with A's own write to
  that field; every value is its writer's own, and an undo or redo of
  mine only ever changes a leaf holding a value I wrote. The agreement
  rule over every move of a card among four states (each hand, face up,
  face down) × who is seated (nobody, me, me and another): refused exactly
  when the move widened who may see it and someone else is seated (36
  cases, `parts/undo.test.js`).
  *H1* (`stage.test.js`): over three fixture docs, entering and leaving a
  body, holding and putting down a tool, selecting, a pref, pausing and
  resuming start and stop nothing; and `activeSet` over every subset of
  five kinds of extension × four docs (128 cases) is the rule and its
  order (`stage-pure.test.js`). *H2* (`host.test.js`): one extension, every
  sequence of up to 4 of want, unwant, busy, idle, wait 2 s and wait 250 ms
  (1,555): wanted ⇒ running; it stops only unwanted, not busy, at least
  2 s after the doc stopped calling; unwanted and idle a linger and a
  recheck on ⇒ stopped. Stopping at once on unwant, or ignoring busy, each
  fail it.
- **9. The other notes.** STAGE.md: Activity leaves Words; Body, Held
  tool, Clock and Process arrive; Activation, the chain and Arming are
  rewritten. DESIGN.md: "Activities" becomes "Bodies, tools and the
  clock". SCOPE.md: §4's per-scope tool goes; §7's walls are
  `scene.carry`'s. Old docs ditched, examples republished.
  *Begun, ahead of step 8* (2026-11-13): the three notes describe the code
  after step 7. STAGE.md's Words gain Body, Held tool, Selection, Halo,
  Attention, Carry, Clock, Process and Drawer; Activation and the chain are
  rewritten (no Arming section was left); DESIGN.md has "Bodies, tools and
  the clock"; SCOPE.md's §4 and §7 say what was built. Activity stays in
  Words, marked as what step 8 removes. Examples aren't republished.
  Step 8 brought the notes up to date for itself: Activity left Words,
  Start and Edit arrived, and STAGE.md has "Arriving" and "Undo".

## What it costs

- Every piece carries a trait; a plain CAD scene moves things by handle
  until someone ticks Carryable. Selecting in a game takes the menu.
- Keyboard bodies have no touch controls yet (`keys` carry labels for one).
- One computer per doc: a weak machine slows everyone; a crash freezes the
  world up to 15 s; a running world adds a checkpoint every 30 s while
  anyone is present (~120 changes an hour) to its history.
- Pausing a host doesn't pause a linked doc's processes.
- No time passes with nobody present. Churn: ~40 test files change.

## Decisions

The project lead decided the five open questions on 2026-11-12.

1. **Nobody present: no time passes.** No process fast-forwards over a
   gap; a process may offer that as its own option later.
2. **Undo covers the stage's own editing writes only** (handles,
   inspector, transfer, add, remove), per person and per focus doc, as
   inverse changes. Package verbs, clock acts and process saves are never
   on it, so undo can't un-roll a die. Two rules make that hold when
   writes interleave (added before step 8 was built):
   - **Compare-and-set.** An entry records, for each field it touched,
     the value its edit wrote, and applies only where the field still
     holds that value. If anything has written the field since (a roll, a
     carry, a process's save, another person), the entry is refused with a
     reason ("it has moved since") rather than applied. Undo only ever
     takes back my own edit, and only while it is still the last thing
     that happened to those fields. Tested over every interleaving of a
     stage edit with a package write, a process save and another person's
     edit to the same and to different fields.
   - **Kept contents don't come back.** Removing something whose contents
     a keeper holds outside the doc (a shuffled deck) can't be fully
     undone: undo restores what the doc held and says what it couldn't
     restore, or the remove is marked as not undoable. Undo never
     invents state it didn't see.
   - **Reveals and decides need the others' agreement** (the project
     lead, 2026-11-13). Some changes reveal information (they widen what
     someone else could see: a card from a hand to the table, a flip, a
     lifted cup) or decide it (their outcome came from shared randomness
     or hidden state: a roll, a shuffle, a draw). Undoing those can't
     un-learn what was seen, and undoing a decision hands its maker a
     second try, so they may only be taken back with the agreement of
     its **parties**: the people with a stake in the thing, not everyone
     who saw it (the project lead: "in a card game that would be players
     but not observers"). The stage can't know who has a stake, so it
     asks, as it asks who may see a thing: an extension answers for the
     objects it holds (seats: the people seated at that table; dice: the
     players in that roll's round, not the viewers who watched). Where no
     extension answers (two people editing a CAD scene) there are no
     parties and undo stays free. Parties are current: someone who has
     left their seat is no longer one; someone still seated but away is,
     and a take-back waits for them. Whether a change revealed anything
     the stage knows by comparing each touched object's audience before
     and after; whether it decided anything, the deciding package says.
     Step 8 classifies each entry as free or needing agreement and
     refuses the latter with a reason ("needs the others' agreement"); the
     take-back protocol (ask, agree or decline, how it shows, an absent
     party) is designed after step 8, and may extend take-backs to
     package actions whose effects the stage can invert.
3. **Selecting in a game is by the menu and the outline.** No modifier
   key; one may be added if play-testing asks.
4. **Outside an entered link stays live.** Others still play there, and
   verbs aren't edits.
5. **Any writer may pause, and move anything.** No finer capability is
   sought: game integrity is not secured beyond the secret-keeping work
   (the audience, the veil and keepers). Pauses and moves are attributed
   by name.
