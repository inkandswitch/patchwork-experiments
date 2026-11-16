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
  door timers) and its **clock**. The viewer has a **body** (Look, Edit,
  walk, seat, station), a **held tool** (none, or one), a selection and
  prefs. Tools and bodies come with packages; which you hold or are in is
  yours. A scene may suggest where to start, never a tool.
- **How do play sessions relate to edit sessions?** There are none: the
  world runs the same for everyone. **Editing is a body** (Decisions 6,
  reversing this note's first answer, "Editing is the selection's halo,
  with no switch and no pref"): Edit is the orbit camera with the editor
  on it, where a click selects and the selection's halo shows handles where
  you may write, the inspector follows the selection and the toolbar,
  grid, axes and bounds show. Look is the same camera without any of it.
  Playing is any other body, or Look, with the empty hand. One person
  editing while another plays is ordinary; one person can't do both at
  once.
- **How does a user move between them?** By body: the body chip's Look and
  Edit, a thing's verb ("Sit", "Take the helm"), or Leave. Entering any
  body from Edit leaves Edit (nothing stands on it), and Leave never comes
  back to it. They pick up a tool (its key, the bar in Edit) and Esc puts
  it down.
- **When does the sea model run?** When its doc's clock runs and a view
  present can compute it: one holds the doc's clock claim and steps every
  process, the others follow. Nobody present, no time passes. Editing never
  stops the sea; pausing does, visibly ("Paused by Ana").
- **What does the interface look like?** The world, a world bar, a bar of
  tools and one drawer (§6).

## Where we are

*As written, before build step 2; the "Today" column is the code then.
Steps 2, 3, 6, 7, 8 and 9 are done (Build order, below), so all of it has
gone where the last column says, and [STAGE.md](STAGE.md) describes the
result.*

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
switch and no pref (*reversed 2026-11-13*, Decisions 6: editing is the Edit
body); bodies, the clock, the Escape ladder, `api.dock` and
the end of `requires` come from tools in hand; can versus may, with "can be
carried" a trait. Rejected: grants, act classes, belt digits, Tab, `with`.

The test for a tool: **it is held only if it takes input outside its own
widgets.** Handles take presses only on their arrows and rings, drawn
outside the thing's box, so a press on the thing still reaches its holders:
they are display. Measure, a brush, Camber's Shape and a gun take every
press, so they are held, one at a time.

Weighed and kept out: a stage `carry` service that holders call (Santorini
has no holder to call it; a trait needs no API); a water reader the walk
body reads (deferred, water/WATER.md Decision 71: the floor is the ray's
hit until walk asks the water package's `water` contribution, which does
answer across docs for the world's open water);
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
inspector is a drawer tab a selection opens and that stays open (on the
scene when nothing is selected) until its ×, the toolbar or leaving Edit,
the outline a tab the viewer opens, and grid, axes and bounds are the Edit body's (§4). A
doc may still suggest display prefs (grid, units, snap), as it suggests
atmosphere; no game needs one to work. Since Decisions 6 the editor's
chrome is the Edit body's alone (§3, "What is Edit's"): the parts still
run in every body (what runs is the doc's), and show nothing outside it.

## 2. Part of the scene, brought by the viewer

| Part of the scene (the doc, the same for all) | The viewer's (local) |
|---|---|
| Content, traits, every behaviour they call for | The body stack (§4) |
| Processes: sea, wind, ship physics, door timers | The held tool: none, or one |
| The clock: running or paused, t, who paused | Selection, hover, camera, focus |
| `view.start = { body, place, home }`, read once | Prefs, falling back to the doc's display prefs |

A **place** is not a type: it is the object given to a body's `enter` (a
seat, a station), or null for "here". `view.start` is read on arrival, and
the scene's package list must include its body's package. A place that is
one of the doc's links arrives through it, as the linked doc starts people
(its own `view.start`, in its stage and only there, and on down): the host names its own
link and the linked doc its own place, so nothing crosses
(COMPOSITION.md, Decisions, step 16). Prefs keep
today's live rule, `view.prefs[k] ?? doc.view[k] ?? fallback` (since step 10
the viewer's keys are `api.view`'s, and a pref falls back to the calling
stage's doc).

## 3. Attention, selection and handles

**Attention** is one target per view: the selection if any, else the look
(the pointer's hit, or the eye ray under lock and for a lock body under
touch, where a finger hovers nowhere: `pointer.js` `looksFromEye`,
Decisions 12). A finger's hit is what it pressed, and a tap's stays the
look when it lifts, until the next press on the world (a drag's doesn't;
Decisions 13). The prompt and the halo are
one surface over it, and keys go to it (§5): what is shown is what keys do.

**A press** runs COMPOSITION §5's chain: the held tool, the widget owner
(handles), the holders nearest first along the hit's path, then the body's
default: Edit's selects (its drag orbits); Look, walk, seat and station
have none (Look's drag orbits too). So in CAD a click selects a crate, and
at a card table it draws. A holder's `cursor(ev)` may name its click
("Draw"), shown at the pointer.

**Select** is also the first entry of every target's menu (right-click,
long-press, the context-menu key; under lock, at the crosshair): the
deliberate select in a game, in every body. The outline is the keyboard's,
in Edit. Alt keeps its one meaning: place freely during a carry.

**The halo.** A selection shows its verbs and, in Edit where its doc is
writable, handles: move arrows, rotate rings and scale corners around its box,
screen-sized as in Morphic, plus build-param knobs, in the parent's drawn
frame, so a winch's handles heel with the hull. This is new work:
TransformControls is world-space and one mode at a time (`gizmo.js:45,113`);
the drag converts as the hand does (`hand.js:63-98`). G, R and H stop being
keys; move, rotate and "no gizmo" stop being tools; there is no pref.

**What is Edit's** (Decisions 6). The rule: *the stage's authoring is
Edit's: everything that writes through the edit stack (what undo takes
back), the tools that make those writes, and the aids drawn for them.
Everything packages bring (verbs, carries, bodies, seats, processes) and
how you look and get about is everyone's, in every body.* So someone at a
table or walking a level sees no editor.

| Edit's (shows and runs only in Edit) | Everyone's (every body) |
|---|---|
| a plain click selecting (Edit's click, ahead of the chain) | Select in every target's menu, Esc to deselect; the selection's box |
| the halo's handles and build-param knobs | carrying (press-drag, Q / E, F to flip), and every package's verbs |
| the inspector (opening on the selection; Starts in) and the outline, Dimensions and Parts tabs | menus, the use prompt and the key map (less Edit's commands) |
| the toolbar, all of it (Snap, Frame all, Objects, Inspector, Measure, Dimensions, Grid, Axes, Bounds, units, Parts, Undo, Redo) | the body chip, who's here, Leave, the Esc hint |
| grid, axes and bounds | the seat picker, the clock chip (Pause is anyone's: Decisions 5) |
| Measure; selecting and deleting a dimension (saved ones are drawn everywhere: the doc's annotation) | notices and HUD pills, legends, the packages prompt |
| Remove (Delete), Group, Ungroup, Fix at this version, Follow latest, Set home view, Copy, Paste | Frame (`.`) and a double-click to frame |
| dropping or pasting documents in, the empty scene's start screen | the orbit camera's drag, pan and zoom (in Look and Edit) |
| Undo and Redo (⌘Z, ⇧⌘Z) | |

A command says `edit: true` to be Edit's: `commandState` (the one every
surface and `api.run` ask) answers null for it outside Edit, so it is on
no surface, no key reaches it and it doesn't run; a package may mark its
own. A drawer tab (`parts/tab.js`) opens only in Edit and shuts when the
body leaves it. A tool held through an Edit command (Measure) is put down
when the body leaves Edit, and so is the selection (Decisions 6: attention
is the selection, so one kept from Edit would aim F and the use prompt at
what was last edited). A menu's Select works in every body, and that
selection stays until something clears it or Edit is left.
A package's command meant for the toolbar (arena's Play and Gun, the cups'
Lift all) shows there only in Edit; elsewhere it's in the menu and on its
key, until §6's bar of tools exists for games.

**Focus scopes selection only.** Selection lives at the focus (COMPOSITION
§3): with the focus on the boat, selecting a card aboard selects the link.
Double-click on a link enters it (elsewhere it frames); Leave, Esc or the
breadcrumb moves out. The chain always spans the whole path, so outside
the focus verbs and carries still work; a Select there does nothing.
*Built (COMPOSITION step 14):* Enter is `scene.focus`'s verb on a link (the
menu, the inspector) and its double-click, everyone's in every body, as the
selection is; it goes where the link's doc acts (a mirror's: where it's
live), and a pin or a closed link says why it can't be entered. The
breadcrumb is the view's trail along the top while the focus is inside a
link, with Leave; Escape's last rung leaves. The general parts (the
editor's chrome among them) move into the focus stage, so the halo, the
inspector and the outline act on the entered doc's objects in its frame;
one holding something (a walk's body, a held Measure) finishes it where it
was, so Enter and Leave never change the body or drop the tool (the tool
goes down only when its stage leaves the focus path);
they are offered input after every segment wherever the hit is, so the
menu, keys and prompt still reach outside. In Edit, a click outside the
focus is still Edit's: it selects nothing and goes no further, so no
package's click verb acts for it (COMPOSITION.md, Decisions, Edit's click
is Edit's, reversing step 14's "isn't Edit's"). The
outline's link rows say what each link is here and enter; drawer tabs
open as the focus moved open again inside. Select's menu entry is the
focus stage's alone, so it's offered only on what can be selected.

## 4. The body and the held tool

**One stack, one slot.** The router's stack (once the arm stack; now
`stack`, `pushBody` and `popBody` in router.js, keeping the old mechanism:
suspended, resumed) holds only bodies, the stage's Look or Edit
always at the bottom (the base). Entering a body pushes it; Leave pops it
(standing up returns to walking); a body whose stage closes is popped;
focus moves don't touch it. Nothing stands on Edit: entering any body from
Edit turns the base to Look first, so Leave from a walk, a seat or a
station entered there comes back to Look, never to Edit. Choosing Look or
Edit (the body chip, or `api.body.enter("look" | "edit")`) leaves every
body over the base and makes that one the base (router `setBase`). Over the stack is one slot, the held tool `{ stage, ext, command }`:
picking one replaces it, Esc empties it. `local.tool`, `effectiveTool` and
`view.tool` go; the add chooser becomes a focused DOM dialog.

```js
bodies: [{ id, label, keys: [{ code, label }], lock, reach,          // metres | Infinity
           enter(place) → { input, eye() → { position, direction }, ride?, leave() } }]
// a tool: a command whose run fills the slot, declaring { keys: [{ code, label }], pointer? }
// keys (a body's, a tool's, a gesture's): codes labelled alike do the same thing (walk's W and ↑
// are both "Forward"); touch shows them as one control (§5), so distinct actions need distinct labels.
// A label names the action, not its state ("Halyard", not "Hoist" turning "Lower" once hoisted),
// and an action may be unavailable in some states, its key declared and doing nothing then (the
// jib's sheet at the lazy winch): the keys are declared on entering, and the state changes under them.
```

- **Look** and **Edit**, the stage's (`src/stage/bodies.js`; they replace
  *orbit*, Decisions 6): both the orbit camera, OrbitControls, `frame` and
  `autoframe`. Reach ∞. Each rides the focus stage's latest base ride
  (sailing's follow on her hull). `.` frames the selection; F is free.
  **Look** has no default press, like walk, seat and station; **Edit**
  takes a click ahead of the chain and selects with it (Decisions 6), and
  the editor's chrome is its alone (§3, "What is Edit's"). Labels say what each is: "Look", "Edit".
- **Where people start** (`view.start.body`, §2): `"edit"` starts them in
  Edit; anything else, or nothing, starts them in Look, and a package's body
  named there (walk, seat) is entered over Look once it's on offer. A
  scene made new starts people in Edit, because they came to build: the
  scene datatype's `init` writes `view.start = { body: "edit" }` (and the
  `emptyScene` copies every package keeps of it), so the doc says so, not a
  guess from its being empty. A template or publisher that makes something
  to look at, play or walk writes its own `view.start`, replacing it: a
  table seats people, a level walks them, a ship, Cadboro Bay or a
  showcase names no body (Look). The inspector's Starts in offers Look (no
  key), Edit, then the bodies on offer.
- **seat**'s ride (since step 12) is its doc's root, at the spot the seat
  looks at, and it **tilts**: the camera moves with the table whole and its
  up is the table's, so a seat at a table aboard rolls with it (the lead,
  2026-11-13: "roll with the table; the boat is how the boat is"). Other
  rides keep the world's up.
- **walk**, one package's, replacing arena's and sailing's walkers. It
  starts at the eye if there is floor under it (within 10 m; decided unattended
  2026-11-14, so an eye over nothing doesn't fall out of the world first),
  else the spawn; its floor is whatever the ray hits.
  (Built in `walk/`, replacing arena's; sailing keeps its navmesh walker as
  a body of its own for now: see build step 6.)
- **seat**, `seats/`'s (COMPOSITION decision 5), rides the seat: no
  movement keys, so D draws. **station**, sailing's: A/D steer.

`enter` runs in the stage that called `api.body.enter(id, place)`, in its
frame; the view converts the eye. The body's ride is the only ride. The
body is the source of `from` and `reach`, and every surface (prompt, menu,
key map) passes both to `state` and `run`; with no hit, distance is from
the eye to the target's box. Reach is ergonomics, not permission: Look and
Edit reach everything.

**The pointer.** The top body asks for lock; the view grants it while
nothing else wants the pointer (a held tool with `pointer: true`, a
selection, an open menu, dialog or dock). The browser's Esc **releases** it
unseen by the page; the next press on the world only relocks. A **refused**
lock leaves the body looking by drag, as arena does (`play.js:90-95`).
While the input is **touch** there is no mouse to look with, so the body
looks by drag as when refused: every press on the view (on the canvas, on
anything over it, on its edges: the chip, the prompt's buttons, the clock's
bar) says whether it was a finger, before anything hears it, and a coarse
pointer starts as touch. Keys never change it. A finger on a locked view
lets the lock go, and leaves nothing released (there is no lock to take
back). A mouse after a finger finds the lock **released**, as after the
browser's Esc, wherever it pressed: the next press on the world only
relocks (Decisions 9). So the lock is only ever taken by a press on the
world that is nothing else, a new body, or the pointer no longer wanted;
never by a press on a button, and never halfway through a click.
**locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch.**

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
touch and for a mouse: the prompt keeps the look (`data-keeps-look`, the
router's) and stays put while the pointer is on it, so moving onto a button
to click it doesn't take the look, and the prompt, away (machine/HOST.md,
Decision 48). Held-key sessions (`use.js:20-33`) move into the one key map, the
only `input.key` implementer (STAGE.md:659-662 becomes true).

**A prompt button with a key is that key** (Decisions 13). A press on a
verb's button presses the key that does that verb on that target, as the
pad's controls press theirs (`src/hold-key.js`), and lifting it lets the
key up: so the verb goes the one key order and the key map, and a held
verb (winding a windlass, `hold: true`) lasts exactly as long as the finger
or the mouse button, its session the key map's (`end` on the lift, `cancel`
if the window goes or the target goes first). Which key is asked as it is
pressed (keymap.js `keyFor`, what `hintFor` names), so a press presses only
a key that does its verb then, by the same construction as a shown key. A
verb with no key that does it (reserved: walking, D) is a click, run on its
target; a held one has nothing to hold it by, so it shows disabled. A
button stays the one element under its finger while the prompt changes
round it (its key going down marks it held), as a pad control does.

**Touch controls are the declared keys** (`touch-keys.js`, pure;
Decisions 10). With no keyboard, the keys the gesture, the held tool and
the body declare become controls a finger holds, in the key order: a code
shows only under the reserver `reservedBy` names for it, so a shown control
works by the same construction as a shown key. Within one reserver, codes
shown alike are one control (the label, else the code's name: walk's W and
↑ are one "Forward"), pressing the first of its codes the earlier layers
leave it. A control with an arrow among its codes takes that arrow's place
on the pad, the rest are buttons: keyboard geometry, so the stage knows
nothing of "Forward". Look, Edit and a seat declare no keys and show none.
Labels are one per reserver, not across them (snes's "Right" and walk's
"Right" are both shown under a held pad), so the pad shows each control
under its reserver. A control presses its code with the key a US keyboard
sends (keymap.js `keyOfCode`, `codeOfKey` read the other way), since
handlers read `ev.key` as often as `ev.code`.

**The pad presses keys as a keyboard does** (`scene.touch`,
`src/parts/touch.js`; Decisions 11). While the input is touch (the view's
`pointer.touch`, §4) and there are controls, it shows them: the arrows'
places bottom left, the other buttons bottom right over the body chip, a
group per layer named for it (the body's label, the held tool's name; a
gesture's group is unnamed, since the stage knows no gesture's name). A finger down on a control
sends the keydown a keyboard sends for its code to the view's root, where
the router hears keys, and its finger coming up (or cancelled, or its
capture lost) the keyup (`src/hold-key.js`, which the Esc hint uses too).
So a pad key goes the one key order and a shown control works as a shown
key does; nothing is per body, and no new api. Fingers are each their own
(Forward, Run and a look drag on the canvas at once); a control held by
two is down until the last lifts. A control is a layer's key: that body,
that tool, that gesture (each its own `serial`, STAGE.md). When its layer
goes (the body left, even for one with the same id; a carry took its key;
another tool) or the pad hides, it lets go and is gone, so a lit control
is a key its layer holds; on a blur or a hidden page every finger lets go,
as the router lets go of every key. A pressed control keeps focus where it
is, so the key map's held verbs stay held. Modifiers are the router's, as
a keyboard has them: a modifier key down at the view's root (claimed or
not, by a keyboard or the pad) is in every event's `shift`, `alt`, `ctrl`,
`meta` until its keyup anywhere in the window, a blur or a hidden page, so
the pad's Alt places a carry freely, before the lift or after.

**With no keyboard, the Esc hint is the Escape key.** It says what it
does ("Put it back", "Put down Measure") and a finger on it presses
Escape, so each rung the hint shows (a carry put back, a tool put down,
a selection cleared, a link left) can be popped by touch.

**Escape pops exactly one layer**: the lock (the browser's), a focused
field, popover or dock field (a search field with text clears first, then
leaves: its query is a layer), the gesture, the held tool, the selection,
the focus (Leave). Never the body, never the clock. The Esc hint names the
next layer. Escape is handled in eleven files today; the ladder is the one
place it is decided.

**Against the split** (Decisions 6). The ladder is unchanged: Escape never
pops the body, so it never leaves Edit (or enters it); the chip and Leave
do. Its selection rung stands in every body, since Select is everyone's.
Its tool rung puts down whatever is held; leaving Edit has already put
down a tool held through an Edit command, and the selection. Keys: an `edit: true` command's
key reaches it only in Edit (Delete, M for Measure, ⌘C and ⌘V), so walking
or seated those keys are free for the game, and its hint shows nowhere
else. **Undo** (⌘Z, ⇧⌘Z / Ctrl+Y, the toolbar's Undo and Redo) is the
stage's edit undo, so it is Edit's: outside Edit the keys pass by. The
steps recorded in Edit stay on this view's stack (per focus doc) while it
looks, walks or sits; back in Edit ⌘Z takes the last one back if the doc
still holds what it wrote (undo's compare-and-set, Decisions 2), else
it's refused and said, as for any later write.

## 6. The interface

```
+-- Harbour > Wanderer -- ▶ sea -- o Ana · helm  o Ben · walk -- | [Walk v] [View v] -+
|              ~ ~ ~   Wanderer heels, the sea runs   ~ ~ ~        + (eye ray)          |
|                  .- Winch ---- [Q] Haul  [E] Ease -.   the prompt: attention's verbs  |
|                                                               Esc: release pointer   |
+--------------------------------------------------------------------------------------+
```
*Walking aboard, empty hand. Left of the bar is the world's, right is yours.
No editor: the bar of tools (Measure, Dimensions…) is Edit's.*

```
+-- Harbour > Wanderer -- ▶ sea -- o Ana · helm  o Ben · walk -- | [Walk v] [View v] -+
|    <-> () [] .- Winch (selected) ------.  handles round its box,   .- Inspector ---. |
|              |  Haul  Ease  Delete  ... |  in the hull's drawn frame | x 1.20 y 0.84 | |
|  hull, on hover: "moving: sailing, Ana at the helm"   pointer free   Esc: deselect   |
+--------------------------------------------------------------------------------------+
```
*As first drawn: Ben edits while walking. Since Decisions 6 he can't: he
picks Edit on the body chip (he stops walking; the camera is the orbit
camera), clicks the winch, and the handles and inspector show. Walking,
right-click Select still selects it (no handles, no inspector).*

```
+-- Wanderer -- ▶ sea -- o Cara · p1  o Dan · p2 ----------------------- | [Seat p1 v] -+
|     [Y3][Y5] [B2]     discard [G4]     deck [##] 32     (the table heels with her)   |
|     [R6][R9][Y2][B7][Bh][G3][W5][W8]   click: Play    [D] Draw     Leave: stand up   |
+--------------------------------------------------------------------------------------+
```
*Seated: D reaches Draw; the game has no processes, so no clock of its own.*

```
+-- Wanderer > [Lost Cities] (Leave) -- ⏸ Paused by Ben [Resume] -- o Eve --  | [Edit v] -+
|  (tinted) the boat, as it is: verbs and carries reach it; selection does not            |
|        .-- table felt (selected, the game's object) --.            Felt [green v]       |
+------------------------------------------------------------------------------------------+
```
*A linked scene entered while the boat is paused: the focus moves in; tools and body stay.*

- **The bar of tools** holds the general tools and those of the stages on
  the focus path. *Built* as the toolbar, which is Edit's (Decisions 6):
  outside Edit there is no bar, and a package's toolbar command is in the
  menu and on its key. Since COMPOSITION step 14 it is the focus path's:
  each stage's scene commands from the focus out, worked out and run in
  that stage, whatever the pointer is over.
- **The body chip** offers Look and Edit first, then the bodies that can
  start here (Walk), then Leave while a body stands over the base. **Who's here** shows each person's body and held tool,
  from presence: the view says its viewer's on every channel it acts on, so
  a person at another placement of this doc shows as what they're doing
  there (COMPOSITION.md, Decisions, links loose ends, 4). It is the focus
  doc's list (Decisions 8).
- **Other people in the world** (walk's avatars, others' selection boxes)
  are drawn wherever their doc is, each in its own frame, not only in the
  focus doc: `walk.people` and `scene.others` are parts of every doc
  (`traits: ["*"]`), run in every stage whatever the focus (COMPOSITION.md
  §3, "Presence where it is"). Ben, inside the game on the boat's table,
  still sees Ana walking the deck, heeling with her. A mirror draws them
  again; a pin, which has no channel, draws nobody.
- **The clock chip** is ▶ or ⏸ for each doc on the focus path that has a
  process, outermost first; its Pause acts on that doc. Who computes shows
  only on a stall ("waiting for Ben's machine") or when nobody here can.
  *Built (step 7):* `scene.clock`, one chip in a slim bar on the stage's
  top edge (the world bar's seed: the view's corners and top middle are
  games' HUDs) for the one doc there is until step 12, shown while this view has a process, someone
  computes, or the doc is paused: "▶ Running", "⏸ Paused by Ana" with
  Resume, "▶ Waiting for Ben's machine" (no word from the computer for
  1 s), "▶ Nobody here can run it (view only)"; the button only where this
  view may write. *Since COMPOSITION's presence step (2026-11-14):* one
  chip per doc on the focus path with a clock to show, outermost first,
  each naming its doc while the focus is inside a link (the trail's
  names: "Lost Cities aboard ▶ Running"), its button acting on that doc;
  the view gathers them (`view.clocks`), each stage pauses its own
  (its reader's `clock`).
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
| **Liveness** | never | per view | presence TTL, claim grace, LINGER, HEAR_MS, lots deadlines, dice THROW/TOLD, bag RECENT | `api.clock.now()`, `api.clock.after(ms, fn)` |

Actor time and liveness both run on the stage's one source of time
(STAGE.md "Time"; `src/stage/time.js`): the browser's in a browser, a
manual clock a probe steps in a probe, so every frame, timer and stamp in
a stage moves together and nothing reads `Date.now` or `setTimeout` itself.
World time ticks once a frame at that source's now.

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
Eve, in Edit at focus Wanderer, clicks the table rim (the boat's) and
recolours it. For the felt (G's) she double-clicks G to enter it, where G's
rule and audience run unchanged: she sees backs.

**3. Hull design and sea trial.** Workshop K has no processes, so it is
still by construction; Ana docks Camber from the hull's verb and holds
Shape. Trial T sails two copies of C fixed at heads h1 and h2 meanwhile.

**4. A Doom level.** E1M1 starts people walking at its spawn and lists the
walk body's package. Dee picks up the gun by its key: a click shoots, R
reloads, so a die's Roll there shows without R. F opens a door, reach from
her body; joints' step closes it once the wait has passed in world t. Eli,
in Edit, clicks a wall and fixes its material; if he pauses, doors hold
and Dee still walks. To try his changes, he plays a copy.

## Invariants

| | Invariant | Finite check |
|---|---|---|
| H1 | **What runs is the doc's.** The host resyncs only on a registry or doc change | Over each fixture doc, every change to body, held tool, selection, focus, prefs or clock triggers no sync |
| H2 | **One stop rule**: stop only when the doc stops calling, after LINGER or while busy | Host transitions over (wanted, busy) × every order of ≤3 events |
| H3 | **A shown key works**: hints come from the dispatching resolver; each key reaches ≤1 invocation. A touch control too: it reaches the reserver it's shown for, every label a reserver shows for its declared, reserved keys has one control (a label's later codes have none of their own: labelled alike is the same action, §4), none look alike in one reserver, no pad place twice | Every command × body × held tool × gesture {none, carry} × attention {selection, look, null} × reach: hint ⇔ dispatch. Touch: every keys declaration in the repo (every station's variants among them, each asserted in sailing's `stations.test.js`), 11 bodies × 5 held tools × 2 gestures, each control list written out (`src/touch-keys.test.js`); the pad presses each shown control's code into the key order, to the layer shown, and a lit control is one its layer holds (`src/parts/touch.test.js`; every finger sequence, `src/hold-key.test.js`); every modifier code × {claimed, reserved but passed, not reserved} × {let go at the root, elsewhere in the window, by a blur}: an event's flag is set iff that key is down, or the DOM's (`src/stage/router.test.js`); the Esc hint, by a finger, pops the rung it names |
| H4 | **Escape** pops exactly the top of lock, field, gesture, tool, selection, focus; never body or clock; the hint names it | All 2⁶ states × focus depth ≤3 |
| H5 | **Pointer**: locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch; after a release, or a finger, the next mouse press on the world only relocks; a finger never locks; nothing but a relock, a body or the pointer unwanted takes the lock | All 2⁵ cases × every event (pure); all 2⁵ cases × each body × {mouse press, touch press, key} (router); finger then mouse on a button, on an edge, on the world with the grant after the handler (router) |
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
| H10 | **Selection at the focus**: the selected path ends at an element of the focus stage | Paths of depth ≤3 × every sequence of ≤3 of press, Select, Enter, Leave, Esc. *Built:* the pure model over every sequence of ≤3 in a two-wide, three-deep tree (`src/selection.test.js`); across docs in a real view (`src/stage/focus.test.js`), every reachable focus and selection × all 37 events on nested live links, a mirror, a pin and a closed link (so every sequence of any length), the view agreeing with the model at each |
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
  (`scene.select` lost its click). (Since Decisions 6, Edit's click goes
  ahead of the chain instead: a body may name types it takes `ahead`.) `api.body` is `current`, `enter`,
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
  the inspector is a drawer tab a selection opens in Edit, and it stays
  open, on the scene when nothing is selected, until its × (shut until the
  selection changes), the toolbar's Inspector or leaving Edit shuts it, the outline (Objects), Dimensions and Parts are tabs the viewer
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
  *Done* after COMPOSITION's step 15 (COMPOSITION.md, build step 9 and
  "Decisions, step 9"): the three notes describe the code as it is, with
  no history in them.
- **Editing is a body** (Decisions 6, after step 8). *Built:*
  `src/stage/bodies.js` has `LOOK`, `EDIT`, `editing(local)` (the one
  question every piece of editing chrome asks), `inBody` (the `edit: true`
  rule `commandState` applies) and the stack's model (`enterStep`,
  `leaveStep`, `startBase`). The router's bottom entry is the base, and
  `setBase` replaces it after every body over it leaves; the stage keeps
  `base` (Look or Edit), enters a stage body by `setBase`, turns Edit to
  Look before pushing any other, and on arrival sets the base from
  `view.start.body` at once (`startBase`). The halo (`haloTarget`), the
  knobs (`knobsShown`), the inspector's follow, the drawer tabs, grid, axes
  and bounds, the toolbar (`toolbarShown`), add, transfer, undo's keys and
  dimensions' label select ask `editing`; the stage's editing commands say
  `edit: true`. The scene datatype's `init` writes `view.start = { body:
  "edit" }`, and so does every package's copy of `emptyScene`. Packages
  that asked "is this orbit?" ask the body's depth now (`depth === 0`: the
  stage's base): seats' walking, sailing's `seatedView` and `overOrbit`,
  the use prompt's loop. Also: a notice saying what one still showing says
  replaces it (`withNotice`), so three tables laid at once prompt "Pick a
  seat" once. *Proves* (finite, exhaustive): every body (Look, Edit, walk,
  seat, station) × nothing, an object or a ref selected × writable or not,
  on the real parts mounted together: handles, knobs, inspector on select,
  grid, axes, bounds and the toolbar show exactly in Edit (handles and
  knobs only where writable, the inspector only on an object; 30 cases,
  `parts/edit-body.test.js`); a click on an object or on nothing in each
  body from each selection (30, `parts/select.test.js`); every sequence of
  ≤5 enters and leaves from Look and from Edit on the model (18,662) and ≤4
  on the stage itself (3,110), the bottom always Look or Edit, nothing
  standing on Edit, Leave never landing in it, and the fall-back after
  Leave from every body (`stage/bodies.test.js`).

## What it costs

- Every piece carries a trait; a plain CAD scene moves things by handle
  until someone ticks Carryable. Selecting in a game takes the menu, and
  editing takes the Edit body (Decisions 6).
- Touch controls are digital keys, a d-pad and buttons: no stick, no
  analog walk (Decisions 10, 11). They cover what keys do, not what a
  locked press does: arena's gun shoots only on a locked press
  (`arena/src/play.js`, `ev.locked`), so under touch its pad shows Reload
  and nothing fires. Whether a tap fires from the eye is arena's call,
  open for the lead.
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
6. **Editing is a body** (the project lead, 2026-11-13). This **reverses**
   the hybrid's first answer, "Editing is the selection's halo, with no
   switch and no pref". In a game, selecting a piece gave it big
   translate, rotate and scale handles and, since step 8, opened the
   inspector; the lead: "a game shouldn't do that unless we've opted into
   some kind of editing view". Of three ways offered to opt in, the lead
   chose this one: split orbit into **Look** (the orbit camera, no select
   on click, no handles) and **Edit** (orbit as it was). You switch by the
   body chip, like Sit or Walk. Published scenes start in Look. Editing
   while walking or seated isn't possible. So:
   - The id `orbit` goes, with no back-compat; examples are republished.
   - The editor's chrome is Edit's alone, by one rule (§3, "What is
     Edit's"): the stage's authoring, whatever writes through the edit
     stack, the tools that make those writes and the aids drawn for them.
     Packages' verbs, carries, bodies and seats, menus with Select, and
     looking about are everyone's.
   - **In Edit a plain click selects, before any package's click** (the
     lead, 2026-11-14). A click on a card deck selects the deck rather than
     dealing; a click on the ship selects her rather than coming aboard.
     Edit takes `click` *ahead* of the chain: after the held tool and a
     widget under the pointer (a knob, a control drawn in the world), before
     every holder and general extension. A click on nothing with nothing
     selected is Edit's to ignore, so it goes down the chain as before. Only
     the click: a press (a drag, a carry) still goes down the chain first.
     A package's click verb is reached outside Edit, or by its key and the
     menu. This holds inside an entered link too: a click on the host there
     is Edit's, and does nothing (decided unattended, 2026-11-16,
     lane/bodyswitch; confirmed by the lead 2026-11-16, "fine for now":
     COMPOSITION.md,
     Decisions, Edit's click is Edit's).
   - **The inspector stays open** (decided unattended, 2026-11-14; lane/loose).
     It used to open on a selection and shut on deselecting, so the canvas
     changed width at every select and deselect and everything on screen
     shifted. Now in Edit a selection opens it and it stays open, showing
     the scene when nothing is selected, until its × or the toolbar's
     Inspector shuts it (shut until the selection changes) or Edit is left.
     Not an overlaid drawer: an overlay hides the scene under it, where the
     selected thing often is, moves the view's visible centre off the
     camera's, and the drawer also holds docked editors (Camber's Shape)
     that need their own width. Tested over every sequence of up to two of
     nine events and three of five (`parts/inspector.test.js`).
   - **Leaving Edit puts the selection down** (decided unattended,
     2026-11-14, final fixer; it was kept, "yours in every body", until
     then). Attention is the selection if any (§3), so after rigging in Edit
     and choosing Look, F and the use prompt still acted on the last part
     selected: the mast's halyard, at the wheel. Leaving Edit already put
     down what Edit holds (a held Measure, the drawer tabs); the selection
     is one more of those. The focus stays: it is where the viewer is, as
     the camera is. A menu's Select outside Edit still selects. One rule in
     the view's `setBase`, through `selectionStep`'s `clear`, so H10 holds;
     tested over every body changed from × to (Look, Edit, a walk, a seat)
     × every focus (the scene, one link in, two) × a selection or none
     (`stage/focus.test.js`, 96 cases).
   - **The toolbar is one row** (decided unattended, 2026-11-14, final
     fixer). In a narrow view it wrapped to a second row, so the canvas lost
     height whenever the view narrowed or a command came on offer. It now
     scrolls sideways and its controls keep their size; collapsing into the
     menu was rejected because the menu already holds every toolbar
     command, so a collapse would only hide them twice.
   - Nothing stands on Edit: entering any body from it turns the base to
     Look, and Leave falls back to Look, never to Edit (§4).
   - A doc names Edit to start people in it; naming nothing is Look. A scene
     made new names Edit (the datatype's `init`); a published example names
     its own: tables and rooms seat, levels walk, ships, terrain and
     showcases name nothing (Look).
   - Undo stays the stage's edit undo, so it is Edit's; steps recorded
     before leaving Edit stay, to take back on returning (§5).
   What it costs: editing a thing in a running game is a body change (Ben
   stops walking to move the winch, §6), and a package's toolbar command
   (arena's Play, the cups' Lift all) is in the menu and on its key outside
   Edit, until there is a bar of tools for games.
7. **No tie rule for verbs beyond running order** (decided unattended,
   2026-11-14, final fixer). The domino prompt shows Flip, Draw and Wash
   (the cap is three), and Stand on edge is on U and in the menu: carry's
   `scene.carry` and the table's trait sit on the same tile, so the two
   extensions tie there, and running order breaks the tie, for presses
   and verbs alike (SCOPE.md §2). Ranking "a game's own verbs" ahead of a
   "generic" holder at a tie was proposed and rejected: which holder is
   generic is a priority list by another name, and SCOPE.md rejects
   declared priority because every new package would have to fit into
   it. Presses and verbs keep one order, so the prompt never offers first
   what a press wouldn't reach first. What the cap costs stays: a fourth
   verb is on its key and in the menu.
8. **Presence is drawn where it is; the clock chips are the focus path's**
   (decided unattended, 2026-11-14, presence lane). Other people (walk's
   avatars, others' selection boxes) are drawn in every stage that hears
   their doc's channel (every one but a pin), not only the stages on the
   focus path: the focus scopes the selection and
   the editor, and a sibling doc (Games night's dice table while the focus
   is in the room) is as live and as visible as one the focus is inside, so
   hiding its people would make the focus change what the world looks like.
   The clock chips stay the focus path's, as §6 drew them: a chip is
   chrome, a way to pause a doc by name, and like the toolbar and the trail
   it speaks of where the viewer is; twenty linked boats should not make
   twenty chips. Who's here stays the focus doc's list for the same reason;
   the view already says each viewer's body on every channel it acts on, so
   it lists everyone with that doc open anywhere. Pause and Resume act on
   the chip's own doc, never the focus's.
9. **Touch is part of the pointer's state; a mouse after touch finds the
   lock released** (decided unattended (2026-11-16, lane/n9), for the lead).
   `touch` sits beside `refused` in the formula, set by every press on the
   view (`pointerType === "touch"`, heard on the view's root in the capture
   phase, so the edges count) and by a coarse pointer at the start; keys
   never change it, so a keyboard on a tablet leaves it be. A finger on a
   locked view lets the lock go as the page's own exit, and clears
   `released` (nothing to take back under touch, so the chip never says
   "Click the view to take the pointer back" to a finger). Going back to a
   mouse sets `released` where the formula would lock: the press that ends
   touch, wherever it lands, never asks for the lock itself, and the next
   press on the world only relocks, as after the browser's Esc, and the
   chip says so. Rejected: making that press ordinary and asking for the
   lock in its handler. A press on the chip or a prompt's button would then
   take the lock mid-click (Chrome grants it before the mouseup, so the
   click lands on the lock target and the button never hears it), and a
   press on the world would be half a press: dispatched unlocked, its click
   resolved locked at the crosshair. The cost: the first mouse click on the
   world after touch is swallowed, as the first after an Esc is.
   `pointerType === "pen"` counts as a mouse (a pen has a position to
   hover and usually a keyboard beside it); open for the lead whether a pen
   should be touch. Open for the lead: whether the touch controls show from
   the first touch, always on a coarse pointer, or by a toggle in the chip's
   menu (lane/n9's plan asks).
10. **Touch controls are derived from declared keys, grouped by what they
   show** (decided unattended (2026-11-16, lane/n9), for the lead).
   `touchControls({ gesture, held, body })` (`touch-keys.js`) is pure and
   per view, never per body. Codes group by the label a person sees: the
   declared one, else the code's name from one table (`nameOf`: KeyQ "Q",
   ShiftLeft "Shift", ArrowUp "↑", via keymap.js `labelOf`), so two
   unlabelled Shifts are one "Shift" and no reserver ever shows two
   controls that look the same; a control presses its first unshadowed
   code. The pad's places come from the arrow codes alone (a code is in at
   most one control, so no place is held twice), and geometry wins over
   the label: a "Forward" declared on ArrowDown sits in the down place. A
   body that declares only W A S D gets four buttons, not a pad: WASD is
   geometry too, but arrows alone is the smaller rule. Labels are unique
   per reserver only; across reservers two controls can read the same
   (walk's "Right" under snes's), so the pad shows each control under its
   reserver (`from`, reservedBy's names: "tool" is the view's `held`).
   `keyOfCode(code)` and `nameOfCode(code)` live in keymap.js beside
   `codeOfKey`, built from the same tables read the other way, and
   `declaredKeys` is the one reading of a declaration (`codesOf` and the
   touch controls both use it). `keyOfCode` is the US layout's
   `KeyboardEvent.key` (KeyQ "q", Space " ", AltLeft "Alt"), checked
   against what Chrome sends, since handlers read `ev.key` as often as
   `ev.code`. Grouping by label makes "labelled alike is the same action"
   part of the declaration contract, now stated where packages read it
   (§4's code block, STAGE.md's bodies). The cost: codes a declaration
   labels alike but that act differently collapse to the first. machine's
   doom pad labels Digit1–7 all "Weapon" (its controls panel reads one
   label as a row of keys, "Weapon: 1 2 3 4 5 6 7"), so its touch control
   picks weapon 1 only; the test asserts that loss as it stands. The fix
   is the declaration's ("Weapon 1"…), left to machine. Open for the lead:
   label-as-identity, or an explicit grouping field in the declaration
   (e.g. `{ code, label, same: "KeyW" }`), which would let machine keep
   one "Weapon" row and still show seven controls. Open for the lead: a
   digital d-pad from the arrow codes, or an analog stick (a new body input
   contract, an axis), and whether WASD should make a pad too.
11. **The touch pad presses keys as a keyboard does** (decided unattended
   (2026-11-16, lane/n9), for the lead). `scene.touch` presses a
   control's key by dispatching the DOM `keydown`/`keyup` a keyboard
   sends for its code (with the US key) on the view's root, so the router
   hears it as any key, in the one key order; nothing new in the api.
   Rejected: a router entry point (`api.input.key(code)`), which would
   make pad keys distinguishable and skip the DOM; it adds a second way
   in for no case that needs one. Where the pad is not a keyboard, and
   why: a control that goes lets go at once (a keyboard's key stays down
   till it's lifted, and its autorepeat presses it again for a new body;
   a finger presses nothing until it comes down again, so a lit control
   is always a key its layer holds); a pad key under a pad Shift sends
   the unshifted key (`q`, not `Q`); handlers already take both.
   Modifier state is the router's (§5): the modifier keys down at the
   root, claimed or not, as a keyboard's are, set every event's flags,
   and go on a keyup anywhere in the window, a blur or a hidden page.
   (Rejected: only claimed modifiers, which made a reserver that declines
   Alt before a lift lose the pad's Alt, and made "claimed" mean "set my
   flag".) Modifiers on the pad are momentary, held by a second finger,
   not latching. A control's identity is its layer (the body, tool or
   gesture's `serial`: the router counts each one taken, so the same body
   left and entered again is a new one), its code, its label and its
   place; kept across renders its element stays put (moving one can lose
   its pointer capture; only a change of order among kept controls moves
   one, and then its key is let go). Labels name the action, not its
   state (§4): a label that changed while held would be a new control.
   The gesture's group is unnamed: the stage knows no gesture's name, and
   one part's word ("Carrying") would be wrong for every other gesture.
   The Esc hint is the Escape key on touch (§5), since a finger can't
   press Escape and lifting it ends a carry where it is. The pad shows
   from the first touch to the next mouse press (`pointer.touch`,
   Decisions 9). Open for the lead: always on a coarse pointer, or a
   toggle in the chip's menu; whether a finger held still on the world
   while a body looks by drag should still open the menu after 500 ms
   (the router's touch hold), as it does now; the layout (arrows bottom
   left, buttons bottom right in groups under their layer's name, in
   capitals) is provisional, the lead's taste; whether a press session
   should declare a `label` of its own (as a body has a label and a tool
   a name) to name its group, or the group take its extension's name
   (which `local.running` would then have to carry).
12. **A lock body under touch looks from its eye** (decided unattended
   (2026-11-16, lane/n9), for the lead). A finger never locks the pointer
   (Decisions 9) and never hovers (it only presses and drags, and the
   router hovers only a pointer with no button down), so a first-person
   body under touch had no look at all: no use prompt, no F, nothing to
   take a station by. The look is now the eye ray's wherever the body
   would lock and nothing wants the pointer, by mouse or finger:
   `looksFromEye(pointer)` ⇔ locked ∨ (body.lock ∧ ¬wanted ∧ touch)
   (`stage/pointer.js`, checked over all 32 pointer states), read by the
   view's look and by the use prompt, which then sits in the middle of the
   view as under lock and doesn't follow a finger dragging to look. So a
   verb is a tap on the prompt's button, at what the eye looks at (sailing
   takes the helm that way, `sailing/probes/touch-run.mjs`). A mouse that
   isn't locked (released, refused) still looks where it hovers. A
   press's hit is unchanged (a finger's press is still where it lands, and
   the router still sets the hover to it), and a menu is of that, not of
   the look: `api.path({ pointer: true })` and each reader's `pointed()`
   read the pointer's hit (the hover the press set), which the look is in
   every other pointer state, so only here do they differ. Before that, a
   finger's long press in walk opened the menu of whatever the eye looked
   at (menu.test.js "a menu is of what was pressed, in every pointer
   state", four rows). The rejected alternative: the look gives way to
   the press's hover while a finger is down on the world, which would pin
   the use prompt to what a drag to look started on.
   Open for the lead: whether a lock body under touch should draw the
   stage's own crosshair (sailing draws its own; walk draws none).
13. **A prompt button with a key is that key; a finger's tap is its look**
   (decided unattended (2026-11-16, lane/n9), for the lead). Before, a
   held verb's button was disabled ("a held verb is the keyboard's"), so
   nobody on touch could wind sailing's windlass, its only way to raise
   the anchor. Now a press on a verb's button presses the key that does
   it (§5): keydown on the press, keyup on the lift, the cancel or a lost
   capture, through `src/hold-key.js` as the pad does, default-prevented
   so focus stays and the key map's held verb stays held. The key is
   asked as the press comes (`keyFor`, against the resolver's state then),
   not taken from what the prompt drew, so a stale button presses nothing
   wrong. The same for a mouse, not only a finger: a mouse held on a held
   verb's button holds it, which a mouse user could not do before, and a
   plain verb runs on the press, as its key does, not on the release (the
   click that follows a press that was the key is that press's). Rejected:
   keeping the click path for a mouse, which would be two rules for one
   button and leave held verbs to the keyboard there too. A pointercancel
   lets the key up, as a lift does: a key has no cancel; when the window
   went first the key map cancels (its keyup with the page away), and a
   target gone cancels by its sweep before the lift. (The plan said a
   pointercancel cancels the session; that would need a cancel channel
   beside the keyboard's, for the case the window rule already covers.)
   The buttons take no browser gesture (`touch-action: none`, no callout,
   no context menu), so a held finger isn't taken for a scroll.
   While a verb is held the prompt keeps the target's verbs in their
   order (the held one as pressed, in its place; one that no longer
   applies from here after the rest), not the held first as before:
   moving the held button first took it out of the document, losing its
   capture, and slid the next button under the finger, so a finger's lift
   clicked that one and the held verb never ended (found in Chrome,
   `probes/touch-run.mjs`; jsdom keeps no capture to lose).
   And so a finger can reach the prompt at all where the look is the
   pointer's (Look, Edit): a finger hovers nowhere and leaves as it lifts,
   which cleared the look, so the prompt went with every tap. The router
   now keeps the hover a finger's tap set when it lifts, until the next
   press on the world; a finger that dragged (an orbit, a carry, a look)
   or was cancelled keeps none, and a finger moving elsewhere (the pad)
   is never the mouse leaving a kept look (the deferred "kept-look
   jitter"). The prompt sits where the finger pressed (a press is where
   the pointer is; a finger has no moves before it). Open for the lead:
   whether the tapped look should also go after a while, or on a tap on
   the prompt's own margin.
