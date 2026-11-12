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

**One stack, one slot.** The router's arm stack keeps its mechanism
(`router.js:575-633`: suspended, resumed) and holds only bodies, orbit
always at the bottom. Entering a body pushes it; Leave pops it (standing up
returns to walking); a body whose stage closes is popped; focus moves don't
touch it. Over the stack is one slot, the held tool `{ stage, ext, command }`:
picking one replaces it, Esc empties it. `local.tool`, `effectiveTool` and
`view.tool` go; the add chooser becomes a focused DOM dialog.

```js
bodies: [{ id, label, keys: [{ code, label }], lock, reach,          // metres | Infinity
           enter(place) → { input, eye() → { position, direction }, ride?, leave() } }]
// a tool: a command whose run arms the slot, declaring { keys: [{ code, label }], pointer? }
```

- **orbit**, the stage's: OrbitControls, `frame`, `autoframe` and the aids.
  Reach ∞. It rides the focus stage's latest base ride (sailing's follow on
  her hull). `.` frames the selection, Home goes home; F is free.
- **walk**, one package's, replacing arena's and sailing's walkers. It
  starts at the eye, else the spawn; its floor is whatever the ray hits.
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
field, popover or dock field, the gesture, the held tool, the selection,
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
doc.clock = { running, t, by? }                  // absent: running from 0
api.clock = { t(), running(), pause(), resume(),
              process({ start(t), step(dt, t), save(d) }) → remove }
pose.hold(id, transform, { yields })             // false while a person's hold stands
```

- **Computing.** The stage holds one `"clock"` claim per doc, under the
  usual rules. A view is eligible when its stage acts (not a pin or
  mirror), is writable, visible and settled (`host.js:396-404`), and has a
  process. The computer calls `start(t)`, which continues from what the
  process has followed (warm, as sailing takes over, `sim.js:9-11`) or else
  from the doc (cold); then `step` in fixed substeps, at most 0.25 s of
  world time a frame. It lets go when hidden, paused or ineligible.
- **Checkpoint.** On pause, on letting go and every 30 s while running, the
  stage writes `clock.t` and calls each `save(d)` in the same change. A
  process saves only what it still holds.
- **Followers** slew to the computer's t (`sea-view.js:45-132`, moved to
  `src/stage/clock.js`); with no computer a view draws at `clock.t`, still.
- **Timers are steps**: joints closes a door once `t ≥ since + wait`.
- **One clock per doc.** Pausing the boat doesn't pause a linked game; a
  pin never computes. A concurrent pause and resume settle by last writer
  on `clock.running`, and the chip names who won.

| Case | What happens |
|---|---|
| Nobody present | Nothing computed, no time passes (Croquet). The first arrival starts cold at `clock.t`; an open door's remaining wait resumes, where today it slams 1.5 s after arrival. |
| Running, nobody able | Only read-only viewers or ones missing a package: t stays and the chip says so. Spectators never advance a world. |
| The computer crashes | Followers keep the last held poses until presence drops it (15 s, `presence.js:35`), then one takes over warm. Alone, the next arrival starts cold from the last checkpoint. |
| A pinned copy | Never computes. A sea trial of version N is a live scene whose hull's source is fixed at N's heads. |

**A person and a process on one object.** Holds are ordered by (a person's
before a yielding one, then `since`): one total order. A process holds
with `yields: true` unless someone drives the object, so sailing yields a
hull nobody steers and keeps one at the helm ("moving: sailing, Ana at the
helm"). While a person holds it, the process doesn't step it. Writes
without a hold (inspector, paste, a peer's merge) are the process's to
notice: sailing's motion stamp (`sim.js:273-283`) is the rule, and an
object moved by anything else restarts at rest from the doc. This replaces
the silent last-hold-wins in one view (`stage.js:947-960`). Consumers:
sailing and joints; arena's respawns next.

## 8. Permissions

**Who may write is the handle's** (`api.writable`), and Keyhive's when it
lands; a read-only or pinned stage offers nothing that writes (I6). **Can
is not may**: "can" is the thing's (`locked`, `scene.carry`, a door's
travel), component physics in packages; "may" is the person's, Keyhive's
to answer. **No grants**: a grant inside a doc is an offer a modified
client ignores; a boundary that matters is a doc (COMPOSITION's private
layer, a level's walls in a doc players only link). Until then any writer
may open a door, move a wall, pause, or take an unsteered ship, by name.

## 9. Stage changes, and what leaves scene/

**New.** `api.body` (`current`, `enter(id, place)`, `leave`, `eye`,
`reach`); `api.clock`; `api.dock(el, { title }) → close`, replacing
Camber's, dice's and bag's copies; `api.writable`. The `bodies`
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
tools and G, R; the hand's H; `standingDown`; `editing()`; `SEAT_REACH`.

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
| H7 | **Clock**: ≤1 computer per doc once claims arrive, only eligible views; t monotone per view except a cold start after a crash; once a view has seen paused, no `step` | ≤3 views × {visible, hidden, gone} × {writable, read-only, missing a package} × every order of ≤5 of join, leave, hide, crash, pause, resume, save, on in-memory Automerge |
| H8 | **Three times**: a pause changes no actor or liveness outcome | Each dice, lots and cup protocol test, and joints' slide, paused at every step |
| H9 | **Reach**: a `reach` command runs ⇔ distance ≤ body.reach, else shows "too far" | {prompt, menu, key map} × body × {hit, no hit} × {in, out} |
| H10 | **Selection at the focus**: the selected path ends at an element of the focus stage | Paths of depth ≤3 × every sequence of ≤3 of press, Select, Enter, Leave, Esc |
| H11 | **Carry**: only with `scene.carry`, no veto, no holder, in its own doc's stage | Object × trait × veto × held × depth ≤2 × focus |

COMPOSITION's I4 trades "× activity" for "× body × held tool × clock"; I8
loses "nothing outside the focus"; I10 follows attention.

## Build order

The combined order is COMPOSITION's; this note's steps are its 2, 3, 6, 7,
8 and 9, each shipping alone.

- **2. `api.dock`.** Camber, dice and bag move onto it.
- **3. Selection and carrying.** The halo; Select in the menu and as
  orbit's default; `scene.carry`; `local.tool` and the forced-hand
  workarounds go; activities remain. *Proves:* dice's R rolls; a drag
  under a moving parent; H10, H11.
- **6. Bodies and the held tool.** Stack and slot, four bodies, `from` and
  `reach` everywhere, declared keys, attention, the pointer, the Escape
  ladder; rides by body. *Proves:* H3-H5, H9; Doom with one walker.
- **7. The clock.** `src/stage/clock.js`, the claim, processes,
  checkpoints, ordered holds; sailing and joints move on. *Proves:* H6-H8.
- **8. Activities and `requires` go**, with `always` and `general: false`.
  Only now does editing stop freezing the sea, with pause to replace it.
  *Proves:* H1, H2.
- **9. The other notes.** STAGE.md: Activity leaves Words; Body, Held
  tool, Clock and Process arrive; Activation, the chain and Arming are
  rewritten. DESIGN.md: "Activities" becomes "Bodies, tools and the
  clock". SCOPE.md: §4's per-scope tool goes; §7's walls are
  `scene.carry`'s. Old docs ditched, examples republished.

## What it costs

- Every piece carries a trait; a plain CAD scene moves things by handle
  until someone ticks Carryable. Selecting in a game takes the menu.
- Keyboard bodies have no touch controls yet (`keys` carry labels for one).
- One computer per doc: a weak machine slows everyone; a crash freezes the
  world up to 15 s; a running world adds a checkpoint every 30 s while
  anyone is present (~120 changes an hour) to its history.
- Pausing a host doesn't pause a linked doc's processes.
- No time passes with nobody present. Churn: ~40 test files change.

## Open questions

1. **Nobody present: no time, or fast-forward?** Fast-forward means running
   each process headless over the gap. *Recommend no time*, with
   fast-forward a process's own option later.
2. **Undo.** Automerge has no user-level undo. *Recommend* the stage's own
   editing writes only (handles, inspector, transfer, add, remove), per
   person and per focus doc, as inverse changes; package verbs, clock acts
   and process saves are never on it, so undo can't un-roll a die.
3. **Selecting in a game: the menu only, or an accelerator too?** Alt-click
   is taken by "place freely" and by Linux window managers. *Recommend the
   menu and the outline*, adding a modifier only if play-testing asks.
4. **Outside an entered link: live, or dimmed and inert as in CAD?**
   *Recommend live*: others still play there, and verbs aren't edits.
5. **A finer capability from Keyhive**: use versus author, and who may
   pause. In-doc grants were rejected (§8). *Recommend asking Keyhive*,
   accepting until then that any writer may pause or move a wall, by name.
