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
  you may write, the inspector follows the selection and the toolbar's
  editor commands, grid, axes and bounds show. Look is the same camera without any of it.
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
inspector is a drawer tab a selection opens (a beat later) and that stays open (on the
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
Decisions 14). A finger's hit is what it pressed, and a tap's stays the
look when it lifts, until the next press on the world (a drag's doesn't;
Decisions 15). The prompt and the halo are
one surface over it, and keys go to it (§5): what is shown is what keys do.

**A press** runs COMPOSITION §5's chain: the held tool, the widget owner
(handles), the holders nearest first along the hit's path, then the body's
default: Edit's selects (its drag orbits); Look, walk, seat and station
have none (Look's drag orbits too). So in CAD a click selects a crate, and
at a card table it draws. A holder's `cursor(ev)` may name its click
("Draw"), shown at the pointer.

**Select** is also the first entry of every target's menu (right-click,
long-press, the context-menu key; under lock, at the crosshair): the
deliberate select in a game, in every body. The inspector's tree is the
keyboard's, in Edit. Alt keeps its one meaning: place freely during a carry.

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
| the inspector, the object tree and the fields in one tab (opening on the selection; Starts in), and the Dimensions and Parts tabs | menus, the use prompt and the key map (less Edit's commands) |
| the bar of tools' editor commands (Snap, Frame all, Inspector, Measure, Dimensions, Grid, Axes, Bounds, units, Parts, Undo, Redo) | the body chip, who's here, Leave, the Esc hint; the bar of tools' world commands (a game's Play, Lift all cups, Come aboard) |
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
A package's command meant for the toolbar (`show: ["toolbar"]`, or no
`show`) is the editor's and shows there only in Edit. One meant for games
says `show: ["world"]`: the bar of tools holds it in every body, at its
right end (§6, Decisions 10).

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
editor's chrome among them) move into the focus stage, so the halo and the
inspector (its tree too) act on the entered doc's objects in its frame;
one holding something (a walk's body, a held Measure) finishes it where it
was, so Enter and Leave never change the body or drop the tool (the tool
goes down only when its stage leaves the focus path);
they are offered input after every segment wherever the hit is, so the
menu, keys and prompt still reach outside. In Edit, a click outside the
focus is still Edit's: it selects nothing and goes no further, so no
package's click verb acts for it (COMPOSITION.md, Decisions, Edit's click
is Edit's, reversing step 14's "isn't Edit's"). The
tree's link rows say what each link is here and enter; drawer tabs
open as the focus moved open again inside. Select's menu entry is the
focus stage's alone, so it's offered only on what can be selected.

**Multi-select: not built; options for the lead** (Decisions 20). *Today:*
the selection is one path at the focus (`src/selection.js`, H10),
attention is one target, and every command is `state(target)` /
`run(target)`. A handful is a group: Group (inspector and menu, on one
object, no key) puts it in a new group, the tree files more rows in, and
packages already treat a group as one thing: dice's Roll tosses every die
filed in it, bag's Put in a bag puts all of it, the halo moves it, Remove
takes it after a confirm. The ops under the commands already take sets
(`ops.removeObjects(snapshot, ids)`, `subtreeOf` under Copy, Extract's
plans: COMPOSITION Decisions, step 15, 2: "when one does, nothing below
the command changes"). Only the selection and the command layer hold one.

- **(A) The selection is a list at the focus; a command opts in with
  `several: true`.** Shift-click in Edit (and Shift- or ⌘-click on a tree
  row) adds or removes. A plain click, Select, Esc, Enter and Leave act on
  the whole list as they act on the one today. A `several: true` command
  always gets a non-empty array (one member when one is selected, or the
  look), so it has one shape; every other command gets one target, as
  today. Remove, Group (`ops.newGroup` taking `around` as a list), Copy
  and Extract become `several: true`. `api.view.get().selected` stays the
  one target, and the list is a new `selection` beside it, derived from
  the same value. A menu opened on a member is the selection's; on
  anything else it is that thing's, as today. Two ways to treat the
  commands that don't opt in while several are selected:
  - **(A1) attention is the last one picked.** The prompt, keys, halo and
    inspector act on it; the rest are only outlined. This is how most
    editors behave, but it puts a trap in "what is shown is what keys
    do": with three dice outlined, R rolls one.
  - **(A2) nothing acts on part of the selection.** Attention is the
    list. A command applies to it only if it is `several: true` or the
    list has one member. With several selected, the prompt shows only
    `several` verbs (usually none), keys reach only those, the inspector
    lists the members over the `several` commands, and the halo is not
    drawn (Group first, then the halo moves the group). No primary is
    needed: the selection is a set, and the order it was picked in only
    orders the inspector's list.
- **(B) A transient selection group:** the stage wraps the handful in a
  group that packages see as a group, so every group-aware verb works
  unchanged. Rejected: a stage-made object would sit in the snapshot that
  packages, presence and undo read. That leaks the editor into the doc,
  and it is a second kind of group to tell from the real one.
- **(C) The stage fans `run` out per member.** Rejected: "throw a handful
  together" is one act, not N. Roll run three times is three throws and
  three tells; Remove run three times is three undo steps and three
  confirms.
- **(D) No multi-select.** Group makes a handful and packages act on
  groups. The cost is a Group and a filing per handful, and a group left
  in the doc that nobody wanted (Ungroup takes it out). Nothing changes.

*Checked against the invariants:*

| | H3 a shown key works | H4 Escape | H10 selection at the focus | Packages see |
|---|---|---|---|---|
| A1 | holds (one target per command), but a key acts on one of several outlined | the selection rung clears the whole list | every member at the focus: `selectionStep` gains `toggle { path }`, model-checked as today over ≤3 of press, toggle, Select, Enter, Leave, Esc | one target, unless `several` |
| A2 | holds by one function, `targetFor(command, attention)` (the list if `several`, its one member if it has one, else not applicable), asked by the hint and the dispatch alike; a finite table over command {plain, several} × selection {none, one, two} × attention {selection, look} | as A1 | as A1 | as A1; water's outline and seats' picker read `selected`, null while several are selected |
| B | holds | as today | breaks: the group is written, and isn't what the viewer picked | a group nobody made |
| C | breaks "one act": one key shown, N runs | as today | as A | N calls |
| D | as today | as today | as today | as today |

*Recommendation: A2, minimal*, if the lead wants multi-select at all:
Shift-click in Edit and in the tree; Remove, Group, Copy and Extract take
the list; only `several: true` commands see more than one target, and
nothing runs on part of the selection. The selection outline draws every
member, and presence shares the list (`src/peers.js`). It is not small:
`selection.js` and its H10 model, `view.js` (the value and presence), the
key resolver and `commandState`, the halo, the outline, the inspector's
header, the menu, transfer, `ops.newGroup`, and STAGE.md's command and
view rows. It also touches Decisions 3 (no modifier key), so it is not
built here. D stands meanwhile.

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
relocks (Decisions 11). So the lock is only ever taken by a press on the
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
not D). The prompt shows three verbs and, past three, a "⋯ N more" that
opens it to all of them (Decisions 19); the menu shows all that show on
"menu"; verbs are buttons, for
touch and for a mouse: the prompt keeps the look (`data-keeps-look`, the
router's) and stays put while the pointer is on it, so moving onto a button
to click it doesn't take the look, and the prompt, away (machine/HOST.md,
Decision 48), but only until the viewer moves the eye: an orbit or a Frame
ending, a body entered or left, a pointer lock taken or lost puts it back
under the pointer, so a press reaches a button only if the viewer hasn't moved
the eye since the pointer reached it; a ride carrying the eye doesn't
(COMPOSITION.md, Decisions, the use prompt and the eye). Held-key sessions (`use.js:20-33`) move into the one key map, the
only `input.key` implementer (STAGE.md:659-662 becomes true).

**A prompt button with a key is that key** (Decisions 15). A press on a
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
pointer's click runs a verb only on the button that had its press, and
only when that press wasn't the key: a browser clicks whatever is under
the lift once the button pressed has gone, so a verb that puts another
button in its place would otherwise run that one too. Only a primary
press is a key or a click (a right or middle press does nothing). A
button stays the one element in the document while the prompt changes
round it (its key going down marks it held), as a pad control does, so
its capture takes the lift to it even if it moves on the screen.

**Touch controls are the declared keys** (`touch-keys.js`, pure;
Decisions 12). With no keyboard, the keys the gesture, the held tool and
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
`src/parts/touch.js`; Decisions 13). While the input is touch (the view's
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
No editor: the bar of tools' editor commands (Measure, Dimensions…) are
Edit's. (Since Decisions 10 the bar of tools also holds the world's
commands, a game's Play or Come aboard, at its right end in every body:
not this sketch's world bar, which is not built.)*

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
  the focus path. *Built* as the toolbar (`scene.toolbar`), in two
  clusters (Decisions 10): the editor's commands (`show` names "toolbar",
  or says nothing) at the left, only in Edit (Decisions 6), and the world's
  (`show` names "world": only an explicit mention counts) at the right, in
  every body, so a game's Play, a table's Lift all cups and a boat's Come
  aboard sit at the same place looking, walking, seated or editing. It
  shows while some extension on the focus path has a command that is the
  bar's in this body, applying just now or not, and every cluster and
  control is one control tall: the canvas under it doesn't move as a
  command comes and goes. In a narrow view the editor's cluster scrolls
  sideways and the world's stays in view. A plain scene, looking, has no
  bar. Since COMPOSITION step 14 it is the focus path's: each stage's
  scene commands from the focus out, worked out and run in that stage,
  whatever the pointer is over.
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
- **One drawer** with tabs: the inspector, and an object's own editor
  (Camber, a dice table, a bag), docked by its verb with `api.dock` and
  closed by its × or its caller; the pane with the keys shows a focus ring.
  A grip on its left edge sets its width, the viewer's for the kind of pane
  shown (Decisions 9).
- **The inspector is one pane**: the object tree on top and the
  selection's fields below, one tab, one selection (Decisions 16). A row
  click selects and the fields follow in the same flush; a click in the
  view, the menu's Select or Escape marks and reveals the row, and a
  selection made while the pane was shut is revealed as it opens. Both
  halves are drawn only while it's docked. The tree takes at most about
  40% of the pane's height, its rows scrolling below its bar; the fields
  scroll under it. It opens by the inspector's rule (a selection in Edit, or the
  toolbar's Inspector), so the tree comes with it; there is no Objects tab
  or toggle.
- **An object's documents are sections of the inspector** (Decisions 17):
  every document that goes with the selection (or, with nothing selected,
  the scene) is one kind of thing, a section: its label, a fold, **Open**
  and the document itself inline, in its own tool. The inspector's own are
  the object's **Source** (the doc it shows, in that doc's own tool, open
  beside its Build), or that doc as its **File** (a GLB shown as it is) or
  its **Linked scene**, each a section of its own and starting folded, its
  **Build** (the render doc in the build controls)
  and **About** (its `infoUrl`, else its nearest group's); any package adds
  its own by declaring `documents` (STAGE.md "A document"), with no
  inspector code. Open asks Patchwork to show the document as the main view
  (`patchwork:open-document`, its url and tool); nothing else in the
  inspector or the build controls opens a document, so "Open source",
  "Open file" and the link's Open are gone. Whether a section is open is
  the viewer's (a pref per section, `inspector.open.<ext>/<id>`, so
  unfolding one File leaves every Source and Linked scene as it was), and
  nothing is written to the doc. A section stays mounted while it's shown,
  whatever comes and goes beside it.
- **Documents in the drawer** (Decisions 18): a section comes out of the
  inspector into a drawer pane of its own, by its **Dock** or by dragging
  its head onto the drawer's tab strip. The strip takes any Patchwork
  document dropped on it (from Patchwork's sidebar, an outline row, a
  section's head) and docks each, highlighting while one is over it;
  nothing dropped there reaches the scene. A docked document is the
  view's (`api.view.dock`), not Edit's nor any extension's: it stays across
  selections, bodies, focus moves and the inspector restarting, until its
  × (or the scene closes). There is one pane per document and tool, so
  docking one again shows its tab. While it's docked, its section in the
  inspector shows "In the drawer · Show" instead of a second live view of
  it. So a document has three places, all the same value `{ url, toolId }`:
  inline, a drawer pane, and the main view (Open).
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
  *Built since* (N13, lane/n13, merged cc3a6d78): a grip on the drawer's left edge. The
  drawer has two widths, the stage's chrome's (`embed: false`) and a
  docked editor's, each the viewer's own: dragging the grip (or its arrow
  keys, Home, End) sets the shown kind's, double-clicking gives that kind
  its default back, and the widths are view prefs (`drawer.chrome`,
  `drawer.editor`). A docked editor's default is Camber's old
  `clamp(360px, 46cqw, 760px)`, so Camber has its room back without
  docking with a width of its own. The width is a function of the kind
  shown, its pref and the stage's size only (`src/stage/dock.js`,
  tested over every sequence of up to three of ten acts); a window resize
  clamps what shows (the drawer takes at most all but 160px of the stage,
  70% on a narrow stage, so the stage keeps at least 160px, or 30%, for the
  scene and any left edge) and never rewrites a pref; the grip's presses
  and keys reach no part of the scene, and a key held at the stage is let
  go there even if focus comes to the grip (`drawer-grip-stage.test.js`);
  a drag ends on its release, a cancel, lost capture, a move with the
  button up, or its pane's kind no longer being shown, and only its
  release stores.
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
  a tie is left to it. (Decisions 7 settled the order; Decisions 19 put
  the fourth on the prompt, behind its "⋯ 1 more".)
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
  are `scene.body`, bottom right; the world bar of §6 is not built (games'
  world commands are on the bar of tools instead: Decisions 10). Tabletop's
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
  editor's (each kind's width the viewer's own, set with the drawer's grip:
  Decisions 9); `local.drawer` says what's docked, so the toolbar's toggles hear
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
  and bounds, the toolbar's editor cluster (`onBar`), add, transfer, undo's keys and
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
  grid, axes, bounds and the toolbar (with no world command running) show exactly in Edit (handles and
  knobs only where writable, the inspector only on an object; 30 cases,
  `parts/edit-body.test.js`); a click on an object or on nothing in each
  body from each selection (30, `parts/select.test.js`); every sequence of
  ≤5 enters and leaves from Look and from Edit on the model (18,662) and ≤4
  on the stage itself (3,110), the bottom always Look or Edit, nothing
  standing on Edit, Leave never landing in it, and the fall-back after
  Leave from every body (`stage/bodies.test.js`).
- **Sidebar 1 (lane/sidebar, 2026-11-16): one pane for the tree and the
  inspector** (Decisions 16). `scene.outline` and its Objects toggle went;
  `parts/outline.js` is `createOutline(api)`, mounted by `scene.inspector`
  at the top of its one tab, over the fields. *Proves* (finite): six
  sources of a selection (a row click, `api.view.select`, the menu's
  Select, Escape, a group's row, a dimension's ref) × the pane, the row
  marked and what the fields show, read together after the flush (they
  agree in every row); the inspector's open-rule table (216 sequences)
  unchanged, with the tree shown exactly while the pane is; the tree mounted
  with the pane and the same tree after × and a reopen; arrow keys in the
  tree reach no scene key; the package registers no `scene.outline` and
  Edit's toolbar has Inspector and no Objects (`parts/inspector.test.js`,
  "one pane"); a focus move with the pane open reopens it inside, its tree
  on the link's objects (`stage/focus.test.js`). Local probes (built
  tool, headless Chrome): editor-run 81/81 with arena built (new
  `treeAboveTheFields`: the tree on top, at most 40% of the pane;
  `inspectorShowsIt`: one Inspector tab, its tree's row and its fields on
  the same object), parts-run 20/20, xdnd-run (main) 60/60, hand-run 33/33.
  drag-run times out on scene-stage too (not this change). The real
  Patchwork checks (realcheck-editbody, grip-check, enter-check) wait for
  the integrator's build and sync.
  *Review fixes:* the tree is drawn by the tab's update, only while the
  pane is docked, and reveals the selection as the pane opens (drawerTab's
  new `opened()`); the rows scroll below a fixed bar. *Proves*
  (`parts/inspector.test.js`, "one pane"): the six-source table reads the
  row and the fields in every flush from the one the selection lands in
  (an extension running after the inspector) and the doc unchanged; three
  ways a selection comes before the pane opens (Look then Edit, × then the
  toolbar, a later select) × the row drawn and scrolled into view in the
  drawer, never in a detached pane; shut by × or by Look, a doc change
  isn't drawn, and is on opening. Each fails on the code before (and the
  first table with the tree's update a tick late). Local probes after
  merging scene-stage (N8): editor-run 86/86 with arena built (new
  `tallTree*`: 76 rows, the tree 245 of the pane's 613 px, the fields 368;
  the last row revealed below the bar, the first again on the way up, and
  again after × and the toolbar's Inspector), xdnd-run 60/60 (it failed
  `outlineDropCopies` with a sticky bar, which covered the row it dropped
  on), parts-run 20/20, hand-run 33/33.
- **Sidebar 2 (lane/sidebar, 2026-11-16): an object's documents are
  inspector sections** (Decisions 17). One contribution, `documents`
  (STAGE.md "A document"), and one pure rule, `documentsFor`; the
  inspector's own are Source, Build and About; "Open source" (the build
  controls), "Open file" and the link's Open went. *Proves* (finite):
  eight kinds of selection (built, a GLB file, a link, a plain group, a
  group with an infoUrl, an object in one, an object with its own,
  nothing) × the sections, their labels, folds, urls and tools, and five
  contributions (null, a non-automerge url, a throw, a repeat of the
  Source's url and tool, a doc on the scene) × kept or dropped
  (`parts/inspector-model.test.js`); in the stage, the sections shown are
  documentsFor's in its order, each view inside the embed marker; one live
  view per open section, the same elements kept while nothing changes and
  every one unmounted on a new selection; fold {no pref, true, false} ×
  {folded entry, open entry} (6); the fold writes only the pref; Open on
  Source, Build and About dispatches its own url and tool (3); no other
  button in the pane (any selection) or the build controls dispatches an
  open; a lens's sourceUrl is never shown (`parts/inspector.test.js`,
  "documents"; `controls-tool.test.js`). On the code before, all 15 stage
  tests, the controls test and the model file fail; dropping the dedupe,
  the url check or the own-first order each fails two model rows. Full
  scene suite 1629/1629 (113 files). Local probes (built tool):
  editor-run 89/89 (`sectionsSourceThenBuild`, `noOpenSource`, the inline
  Build controls still rebuild at 200 mm in cm); solander-run shows the
  hull's group About as a section ("About BODY", its stand-in view
  rendered). The real-Patchwork check, `recovered/publish/sections-check.mjs
  <showcase url> <shots>` (Source inline in its own tool, Build's
  controls, the fold is the pref, Open sets doc= to the source, the doc
  unchanged), waits for the build to be synced after the merge.
- **Sidebar 2, review fixes (lane/sidebar, 2026-11-16).** A section stays
  mounted while it's shown (sections coming and going are inserted and
  removed around it; before, every open one was taken out and put back,
  which unmounts a `<patchwork-view>`'s tool). The source is three
  sections, `source`, `file` and `link`, each its own fold pref (one pref
  had covered all three). `documentsFor` drops a second entry with one id
  from one extension (warned); it and `commandsFor` share one walk of
  what's collected, and a command whose state throws is warned of too. A
  section's box has a definite height (min(40vh, 22rem), resizable) its
  view fills. Without a host `<patchwork-view>` a section names its doc:
  the build controls are no longer mounted by hand; the tests and the
  editor probe use a stand-in host (`src/test/patchwork-view.js`) that
  mounts the package's own tools by their registrations. `docKey` lives
  in `dnd.js`; the link's text row is "Link" (the section is "Linked
  scene"). *Proves* (finite, each failing on the code before): sections
  around an open one coming and going {About goes, About comes, another
  extension's comes, goes} → exactly that mount or unmount (4 steps); a
  section's doc changing under one selection shows and opens the new
  one; fold {no pref, true, false} × {File, Source} (6) and one kind's
  pref × the three kinds (3); routing {built, file, scene, none} → the
  one section (4); a repeated id (warned); a throwing command warned;
  Open on File and Linked scene (folded) (2 more rows); the placeholder
  without a host (`inspector-nohost.test.js`); the CSS height; the
  controls' tool id is index.js's. Full scene suite 1645/1645 (114 files;
  one vitest "onTaskUpdate" RPC timeout under load). Local probes (built
  tool): editor-run 90/90 (new `sectionsHaveAHeight`: Source and Build
  boxes 286 px, their views 284), solander-run "About BODY" shown, no
  errors. `sections-check.mjs` now resets and reads the fold through the
  api's prefs (it had written the stage atom, whose empty `prefs` shadowed
  the view's), measures the views' heights, and checks the fold is per
  section; it still waits for the synced build.
- **Sidebar 3 (lane/sidebar, 2026-11-16): documents in the drawer**
  (§6 "Documents in the drawer", Decisions 18). `api.view.dock({ url,
  toolId?, title })` → close docks the host's view of a document
  (`embed.js` `documentView`, the one the sections use) in an editor-kind,
  embedded drawer pane, one per `docKey(url, toolId)`; the panes are the
  view's (`dock.js` `dockDocument`, owned by no extension), so only their
  ×, `close()` or the view's dispose takes them. `view.drawer` gains
  `docs`. The tab strip docks any Patchwork document dropped on it
  (highlighted while one is over it; its drags never reach the stage);
  `dnd.js` carries an item's string `toolId` through. A section's head
  drags as a Patchwork document (the three types) and has **Dock**; while
  its key is docked it shows "In the drawer · Show". *Proves* (finite,
  each failing on the code before: 29 tests): a dock sequence {A, A again,
  A in X, A in Y, × on A, close() twice} → tabs, shown, docs and one
  embedded pane per key (6 rows); a non-document url docks nothing, heads
  dropped; no owner's close reaches a doc pane, dispose takes all; drops
  on the strip {one item with a tool, two items, url list, text url,
  text garbage, an outline row, nothing} → docked keys, nothing past the
  strip (7 rows); lifetime {another selection, Edit → Look, Enter, Leave,
  the inspector stopped, the view disposed} → still docked and never
  remounted, but on dispose (6 rows); ×; a drop in the view never docks,
  one on the strip adds nothing to the doc; Escape inside a doc pane is
  its own; fold while docked {docked, docked then ×, docked under another
  tool} (3 rows) with never two live views of one key; Show; the head's
  payload is exactly the three types (four since the review fixes below). Mutations: inline while docked (2
  fail), the strip's drop bubbling (7), no dispose with the view (1), no
  one-pane-per-key (1), toolId dropped by dnd (2). Full scene suite
  1672/1672 (115 files; one vitest "onTaskUpdate" RPC timeout under
  load). Local probes (built tool): xdnd-run 68/68 (its new
  section-to-strip drag: the head's payload, docked on the strip,
  folded while docked, the strip's drop adds nothing, a selection keeps
  the pane, × closes it and unfolds the section) and editor-run 90/90. `sections-check.mjs`
  gains the drag to the strip (CDP), Dock, a selection and Look keeping
  the pane, × unfolding the section, and a doc from Patchwork's sidebar
  docking; it waits for the synced build. Review fixes (2026-11-17): a
  section's head also carries `application/x-scene-section` (`dnd.js`
  `ownDrag`, refused by the add and the tree as a row's drag is), so let
  go anywhere in the stage but the strip it is nothing, the tree in its
  own pane included; a pane is titled `<object> · <label>` and keeps the
  title it was first docked with; a dock with nothing selected tells the
  pointer router.
- **Sidebar 4 (lane/sidebar, 2026-11-17): the sweep.** scene-stage (N6,
  N8, N9) merged into the lane; its Decisions 11 to 15 keep their numbers
  and the sidebar's become 16 to 18. A repo grep (outside agent/,
  model-viewer/, patchwork-frame-tiling/) finds `scene.outline`, the
  Objects toggle and `open-source`/`open-file`/`open-linked`/`open-about`
  only in the docs saying they went and in tests and probes checking they
  are gone; the dice, bag, tabletop, arena and doom probes already name
  the inspector. DESIGN.md's general parts say inspector, not outline;
  COMPOSITION.md's traversal names a section's Open. *Proves*:
  `src/removed.test.js`, a static check over src/'s non-test sources for
  the eight removed things (the extension, the toggle, the tab title, the
  four buttons, the hand-made About, controls and Open file), each row
  failing on the sources before step 1 (8 of 8). `pnpm build` passes.
  Full scene suite 2047/2047 (119 files) on the merged tree. Local probes
  (built tool): editor-run 90/90, xdnd-run 69/69, parts-run 20/20, and
  dice's dice.mjs 60/60 (the inspector's tab and Edit die's panel side by
  side). Not run: the real-Patchwork checks (realcheck-editbody,
  grip-check, enter-check, sections-check, dice.mjs under publish/), which
  need the integrator's build and pushwork sync of scene. No doc shape
  changed: nothing republished, the folder untouched. Review fixes
  (2026-11-17): a docked doc's box was outside the style guard, so the
  scene's `.label`, `.button` and the like restyled the docked tool; both
  boxes are now `documentBox` (Decision 17). *Proves*: dock.test.js's
  7-row sequence checks each docked view is unstyled by the scene (fails
  without the fix); xdnd-run's `dockedDocLooksAsInline` compares a probe
  `.label button`'s computed look docked and inline (without the fix,
  docked is `position: absolute`, 69/70; with it 70/70). removed.test.js
  gains the removed classes (a dead `.controls-embed` rule in styles.css
  went). Full suite 2048/2048; editor-run 90/90. The real-Patchwork checks
  are still owed (integrator's build and sync).
- **Sidebar, integrated (2026-11-17, merge 50a6b379 into scene-stage).**
  A clean merge (scene-stage's N6 docs since the lane's own merge touch
  no file of the lane's). Scene suite 2048/2048 (119 files; one vitest
  `onTaskUpdate` RPC timeout under load, no failure); arena 56, doom 86,
  tabletop 569 (their probes only changed). Built and pushwork-synced
  (clean on the first sync). Local probes on the built tool: editor-run
  90/90, xdnd-run 70/70, dice.mjs 60/60 (55/60 on a first run under load:
  the d20 dropped on the table landed on the ground; 60/60 on the rerun,
  nothing in the merge touches a part's drop). Real Patchwork (shots
  recovered/publish/shots/sidebar/): sections-check 22/22 on the Geometry
  showcase, after two fixes to the check itself, never run before (the
  section head is now scrolled into view before it's pressed, as
  xdnd-probe's `sectionHead` does: the sections sit below the fields; and
  the drag from Patchwork's sidebar picks a titled item, not the sidebar's
  untitled new-doc button, which is draggable but carries only
  `application/x-patchwork-new-doc`); realcheck-editbody 8/8; grip-check
  8/8; enter-check 13/13 on the third run (scratch clones 2xwN3KcU…,
  B2dDw4BB…, 4Ur934X2…; the first two 12/13, see FOLLOWUPS "Sidebar
  integrated"). No doc shape changed: nothing republished, the folder
  untouched. The lead's questions in Decisions 16 to 18 stand.

## What it costs

- Every piece carries a trait; a plain CAD scene moves things by handle
  until someone ticks Carryable. Selecting in a game takes the menu, and
  editing takes the Edit body (Decisions 6).
- Touch controls are digital keys, a d-pad and buttons: no stick, no
  analog walk (Decisions 12, 13). They cover what keys do, not what a
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
     thirteen events, three of eight and four of four
     (`parts/inspector.test.js`; the beat, part of one, a press and Enter
     joined them with the next bullet).
   - **The inspector waits a beat** (decided unattended (2026-11-16,
     lane/n11), for the lead). A selection made while the tab is shut
     opens it a beat later, DOUBLE_MS (500 ms, `stage/router.js`) on the
     stage's time (`api.clock.after`), and only if the rule above still
     wants it then. A newer selection starts the beat again, and so does
     a press anywhere in the view while it runs; a press with no beat
     running starts none. The beat is the router's double-click gate
     (`firstOfDouble`: the second press within DOUBLE_MS of the first, the
     dblclick within DOUBLE_MS of the second), and each gate begins at
     something that holds the tab: the first click's selection (Edit
     selects on its release) holds it to the second press, and the second
     press holds it to the dblclick. Without the press, a slow double
     (press 0, release 120, press 480, release 650) had the tab open at
     620, under its dblclick, which `onDblClick` takes only on the canvas;
     and a double-click whose first click re-selected what was selected
     (changing nothing) met a beat begun by an earlier selection
     (editclick-run seed 1, a second try 1070 ms after the first one's
     dblclick selected the link). An open tab shows
     each new selection at once, and the toolbar's Inspector opens it at
     once. Before, the first click of a double-click opened the tab and
     narrowed the canvas, so the second press and the dblclick landed on
     the inspector, or on whatever the narrower canvas now put under the
     pointer, and the double-click never entered (COMPOSITION.md, "Fixed
     since"). The invariant: with the tab shut, the canvas keeps its width
     for DOUBLE_MS after the latest selection change and after every press
     in the view, so for the whole of any double-click the router takes.
     The model the test holds the
     tab to: open ⇔ Edit ∧ (asked ∨ (¬dismissed ∧ (was open ∨ (an object
     selected ∧ a beat since it or a press)))); Enter carries the tab as
     it was.
     It applies to every selection change, the outline's and the menu's
     Select too, since the inspector can't tell a click from a Select: a
     question for the lead whether only Edit's click selections should
     wait.
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
   (arena's Play, the cups' Lift all) was only in the menu (and on a key,
   where it had one) outside Edit, until there was a bar of tools for games (Decisions 10).
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
   what a press wouldn't reach first. What the cap costs: a fourth verb
   is on its key, in the menu when it shows on "menu" (Stand on edge
   does), and one press away on the prompt, its "⋯ 1 more" (Decisions 19;
   decided unattended, 2026-11-17, lane/n11).
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
9. **The drawer's width is the viewer's, by the kind of pane shown**
   (decided unattended, 2026-11-16, lane/n13, for the lead). The drawer
   has a resize grip, and a pane declares no width (`api.dock` has no
   `width` option). There are two widths, the stage's own chrome's
   (inspector, outline, dimensions, parts: docked with `embed: false`) and
   a docked editor's (Camber's Shape, a die's panel, a bag's); dragging the
   grip sets the width of the kind shown.
   - Not one width per owner extension: the four chrome tabs are four
     extensions, so the drawer would jump width going from Inspector to
     Objects, and every new package would add a width to keep.
   - Not a width a pane declares: Camber's lost room comes back by making
     its old `clamp(360px, 46cqw, 760px)` the editor default, so the stage
     learns nothing of one extension's layout, and the person, not the
     package, decides how much of the screen the scene gives up.
   - The widths are view prefs (`drawer.chrome`, `drawer.editor`), per
     viewer and per scene like the grid, units and snap, so another tab of
     the same scene follows. A stored width outside [220, 1200] px is no
     setting (the default shows), not one to clamp; the CSS clamps what
     shows: the drawer takes at most all but 160px of the stage (70% of a
     stage 640px wide or less), so a narrow window never rewrites a stored
     width. The 160px (or 30%) is the scene's and any left edge's
     together: the CSS can't see the left edge's width, so with one the
     port itself may get less.
   - A click on the grip that doesn't move stores nothing, so a pane's
     default (which follows the stage's width) stays until the person
     actually drags.
   - The grip owns a key from its keydown on the grip until that key's
     keyup, the grip's blur or its drawer going, and owns no other key. A
     key held at the stage when focus comes to the grip (a helm's or a
     walk's ArrowLeft) stays its holder's: its auto-repeats resize nothing
     and its keyup reaches the holder, so no held key is left stuck. A drag
     ends on its release, a cancel, lost capture, a move with the button
     up, or its kind no longer being shown, and only its release stores.
   - Checked in the real Patchwork after the merge (2026-11-16, the
     Geometry showcase in a 640px pane beside comments): the inspector
     docks at 220px with the grip on its edge; a 200px drag gives the
     drawer +200 and the canvas -200 and stores `drawer.chrome` only;
     ArrowLeft +16; a reload keeps the width; a double-click gives the
     default back and forgets the pref (8/8).
   - Still open (a nit): the grip's `aria-valuemin`/`aria-valuemax` are
     the fixed 220/1200 a pref may hold, while the CSS may show less on a
     narrow stage, so `aria-valuenow` (what shows) can fall below the
     minimum; nor is it refreshed on a window resize.
   Questions for the lead: are two kinds right, or should each pane's
   owner have its own width? Should the widths be one per viewer across
   all scenes, as screen layout usually is, rather than per scene? Should
   a pane still be able to declare a preferred width on top of the grip?
10. **The bar of tools holds the world's commands in every body**
    (decided unattended, 2026-11-16, lane/n8, for the lead). Outside Edit,
    a game's Play and the cups' Lift all were reachable only by menu (and
    key, where they had one) or a HUD's private copy of the command,
    because the toolbar was Edit's whole. A command that says `show: ["world"]` (only an explicit
    mention counts, as for the menu's scene commands; for scene commands,
    the null target, as "toolbar" is) is now on the bar of tools in every
    body, in a cluster at its right end; the editor's commands stay at the
    left, in Edit only. One mechanism, the existing toolbar part
    (`scene.toolbar`, the id unchanged): `onBar` and `barEntries` in
    `src/parts/toolbar-commands.js`. What it keeps true:
    - **B1** outside Edit the bar holds exactly the world commands that
      apply, never an editor command;
    - **B2** in Edit it holds the editor's commands, then the world's (a
      command naming both surfaces is a world command);
    - **B3** it shows ⇔ some command on the focus path is the bar's in this
      body (a world command, or in Edit an editor command), whatever that
      command's state; one rule for both clusters;
    - **B4** a shown key works (H3): the bar's world entries, in every
      body, are among the hints the key resolver's table checks.
    - **When it shows (B3).** So the bar's height depends only on which
      extensions run, never on a command's state, and every cluster and
      every control (button, toggle or picker) is one control tall, even an
      empty cluster: the canvas doesn't jump as Play, Lift all or Come
      aboard comes and goes (the 36 px shift that made a double-click near
      the canvas's top edge miss in Edit). The cost is not an edge case:
      outside Edit an empty row is the usual state wherever a world command
      applies only now and then (aboard a boat whose Come aboard applies
      only in the lobby, so walking, at a station or seated; a dice table
      while no cup is down; holding arena's gun). Showing the bar only
      while a world command applies was rejected for that jump. *Question
      for the lead:* is the empty row acceptable? The other way that keeps
      the height and the x: a world command that is declared but doesn't
      apply shows disabled (§6's "Can't shows"), at the cost of a greyed
      Come aboard while aboard; the contract has no way today for a
      command to say "don't apply" apart from "can't now".
    - **Where it sits.** At the right end of the bar of tools, the same x
      in every body and at every width: the editor's cluster scrolls
      sideways in a narrow view and the world's sits outside that scroll.
      This runs against §6's sketch, where the world bar's left is the
      world's and its right is yours, and "world bar" (§6: breadcrumb,
      clock chips, who's here, body chip; not built) and `show: "world"`
      (a cluster on the bar of tools) are now two things with one word.
      *Question for the lead:* should world commands go at the bar's left
      (the world's side) or join the clock chips' slim bar, making the two
      top strips one, and should the surface have another name?
    - **A new surface, or `edit: true` alone?** The alternative not taken:
      the bar shows in every body and `edit: true` keeps the editor's
      commands Edit-only, with no new surface name. Nearly every stage
      command on the bar already says `edit: true` (Snap, Units, Grid,
      Axes, Bounds, Undo, Redo, Objects, Dimensions, Parts, Inspector,
      Measure); only Frame all doesn't, and §3's table lists Frame as
      everyone's. That would be fewer words (no strict special case, no
      precedence between clusters, games keeping `show: ["toolbar"]`), but
      any package command with `show` absent or "toolbar", no `edit: true`,
      that applies to the scene would appear outside Edit (arena's Gun is
      one; the rest would want an audit), and a game would say where its
      button goes by saying it isn't the editor's. The lane chose the
      explicit surface: a package says "this is for players". `show`'s
      vocabulary is an API every package writes against, so this is a
      *question for the lead*.
    - **The focus path's only**, as the toolbar and the clock chips: in a
      mashup a game's world commands show once the game is entered (Games
      night's Lift all inside Liar's dice; the Model room's Come aboard
      inside Ship at anchor). *Question for the lead:* should a game's
      world commands show without entering it?
    - A bar button doesn't take the focus from a mouse press (it stays on
      the tool's root, where keys are heard), so outside Edit an unclaimed
      Space or Enter after a click goes on to the stage and doesn't run the
      button again.
    - Key legends (machine's controls panel, sailing's keys line, arena's
      help line, the Esc hint) are not commands and stay as they are; one
      stage-drawn legend of declared keys is a *question for the lead*.
      N9's touch controls have since merged (Decisions 11 to 15):
      `src/touch-keys.js` derives the controls each layer shows from the
      same declared keys, so such a legend would read that model.
    - **Order within the world cluster.** It is right-aligned and in
      command order, so its last entry's place is anchored and an entry
      coming or going slides everything to its left. B3 holds the bar's
      height, not a button's x, so a package lists a world command that
      comes and goes (Stand targets up, there while a target is down)
      before the one people reach for (Play), which then never moves under
      a pending click. Between packages the order is running order, which
      the stage doesn't promise; nothing has two packages' world commands
      on one path yet. *Decided unattended (2026-11-16, lane/n8), for the
      lead:* a convention, not a mechanism; a stable slot per command (a
      declared, disabled one) is the first question above.
    - **Consumers.** Sailing's Come aboard (`aboard`, `show: ["world"]`):
      the HUD's own button, a private copy of the command that sat over the
      canvas's top edge in Edit (triage (f)), is gone, and the HUD only
      reads (`sailing/src/hud.js`, `probes/editclick-run.mjs` steps 5-6).
      Its lobby hint, "Click her to come aboard", false in Edit, went
      after (lane/n11 step 10): the HUD says nothing before you're aboard
      (sailing DESIGN.md, Decisions (N11) 1).
      Arena's Play and Stand targets up (`show: ["world", "menu"]`): its
      HUD's lobby drew its own "▶ Play" / "▶ Pick up the gun" and "Stand
      them up" buttons, private copies of the two commands, so N8's "Play
      only by menu and key" was stale for arena; they're gone, Play's
      `state` carries the label ("Pick up the gun" while walking, when it
      only hands you the gun), and the HUD only reads: the count, the
      scores, the crosshair, the ammo (`arena/src/play.js` `playState`,
      `probes/arena-run.mjs`: the canvas rect is the same looking, walking,
      holding the gun and as Stand targets up comes, and Play's rect as
      Stand targets up comes and goes to its left). The Gun toggle stays
      Edit's toolbar, the menu and G: outside Edit, Play offers the gun.
      *Question for the lead:* a big Play call to action over the level
      (what the lobby had) is gone with it; should a game keep one, and if
      so as what, given that a HUD button is the triage (f) hazard? The
      cups' Lift all (`lift-all`, `show: ["menu", "world"]`, was
      `["menu", "toolbar"]`) is now a button outside Edit too, where it
      had been the menu's alone: seated watching, walking, Look. Its state
      is unchanged (some cup covers, or is shaken blind with a holder),
      and since it's declared the bar is up at a cups table whether or not
      a cup is down (`dice/src/cup-extension.test.js`: its surfaces, and
      the 21-row state table, knocked-over cups among its cases, and a run that
      lifts exactly the cups the state counts; `dice/probes/liars-dice.mjs`: seated, the
      bars are up with nothing on them, both shake and each bar offers it
      with neither canvas moved, and at the end A's click lifts every cup
      down in both docs and leaves the knocked-over one alone). It's the
      cups' only world command, so the order convention doesn't come up.
      Sailing's button reaches
      further than her HUD did: it's on the bar wherever sailing runs on
      the focus path (an entered boat in a harbour, the Model room's boat),
      where the HUD is hidden because her doc isn't the world. It applies
      there exactly where Enter and a click on her already did, so nothing
      new can happen; the focus-path question above covers it.
    - **Where the bar is now up on arrival.** Outside Edit the bar is up
      wherever a world command is declared on the arrival's focus path,
      so these published examples now arrive with it, their canvas one
      control row (about 38 px) shorter than before: Ship at anchor, Ship
      at sea, Cadboro Bay and Ucluelet (a sloop at the root: Come aboard);
      Lost Cities aboard (watching the game, the boat on the focus path:
      Come aboard); Arena level (walking: Play, "Pick up the gun"); Liar's
      dice (seated: Lift all cups declared, the bar empty while every cup
      is up). The cameras' fov is vertical, so a shorter canvas crops
      nothing above or below; it narrows the view's aspect. A plain scene
      (no world command) arrives with no bar at all, as before.
    - **Known: entering a link moves the canvas.** Entered in Edit (a
      double-click on G's card aboard Lost Cities), the canvas moves down
      about 31 px as the entered path's chrome appears. That's after the
      entering press, so it isn't triage (f), but a click straight after
      lands that far off; B3 holds the bar of tools still, not the other
      strips. Left for a later item (a constant-height strip for the
      path's chrome).
    *Proves* (finite, exhaustive, `src/parts/toolbar.test.js`): every
    `show` (absent, [], toolbar, world, both, menu, the string "world") ×
    Look, Edit and a walk × `edit: true` or not lands in exactly the
    cluster B1 and B2 say (42 rows); Look and Edit × an editor command
    (none, there, applying) × a world command (likewise), the bar shows
    exactly when B3 says and holds exactly what applies (18 rows); on the
    stage, Look, Edit, a walk and Look again × playing or not, the world's
    button is there exactly while it applies, the editor's only in Edit,
    and the bar never hides; a mouse press on a button is kept from moving
    the focus; entered in a link, looking, the game's and the host's world
    commands are both on it, each run in its own doc (`stage/focus.test.js`).
    The key resolver's H3 table enumerates the bar's world entries in
    every body, Edit's among them, and keeps a keyed command on no surface
    (`keymap.test.js`, B4). In a browser (`probes/toolbar-run.mjs`), wide
    and narrow: a button and a picker are one control tall, as is an empty
    cluster; Play clicked goes and neither the bar nor the canvas moves; in
    Edit the world's controls are where they were in Look, still in view
    and clickable while the editor's cluster overflows. Two checks for the
    real Patchwork (recovered/publish/). worldbar-check, on scratch copies
    of Ship at anchor and Lost Cities aboard in a 639 px pane beside
    comments, checks that Look's bar holds exactly Come aboard and the HUD
    no button; that Edit adds the editor's commands with Come aboard where
    it was; that the bar's Come aboard, clicked from Edit, comes aboard;
    that the canvas's top and height are the same in Look, Edit and
    aboard; and that in Edit on Lost Cities aboard a double-click on a
    card 16 px below the canvas's top edge enters the game, the first
    press read two frames on. realcheck-editbody's rows say what the bar
    is outside Edit, on arrival and after a press: none on a plain scene
    (the Geometry showcase, Santorini), and on the examples above exactly
    their world commands, with no editor command. Before this change,
    against the published packages (2026-11-16), worldbar-check fails 11
    of its 17 checks then (an 18th, no error in the page's log, came
    later), triage (f) among them: the first press lands on the
    HUD's Come aboard, comes aboard, leaves Edit and lifts the canvas
    38.5 px (Look's canvas sat at 101 px and Edit's at 140, the bar being
    Edit's alone), and nothing is entered. After the merge (7aba1de4) and
    the sync of scene, sailing, arena and dice, it passes 18 of 18 (its 17
    and the page log's), the canvas at 140 px in Look, Edit and aboard; the
    first run showed Come aboard's tooltip as "… (Enter) (Enter)" (the
    command's title named its key and the bar adds the key's hint), fixed
    in sailing (c0f79738) and pinned in the check. realcheck-editbody passes
    on its eight rows (8/8), Play on the Arena level and the bar up and
    empty at Liar's dice among them.
11. **Touch is part of the pointer's state; a mouse after touch finds the
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
12. **Touch controls are derived from declared keys, grouped by what they
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
13. **The touch pad presses keys as a keyboard does** (decided unattended
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
   Decisions 11). Open for the lead: always on a coarse pointer, or a
   toggle in the chip's menu; whether a finger held still on the world
   while a body looks by drag should still open the menu after 500 ms
   (the router's touch hold), as it does now; the layout (arrows bottom
   left, buttons bottom right in groups under their layer's name, in
   capitals) is provisional, the lead's taste; whether a press session
   should declare a `label` of its own (as a body has a label and a tool
   a name) to name its group, or the group take its extension's name
   (which `local.running` would then have to carry).
   The pad lies under every other part's overlay (its own at z-index 1,
   theirs at 2; decided unattended (2026-11-16, lane/n9 integration), for
   the lead): before, it came above whichever overlays had installed
   before it, so the chip's menu opened under the pad's buttons and a tap
   on Edit or on the current body pressed Jump or Run (found at
   integration; `probes/touch-run.mjs` 2b fails on the lane's dist). A
   menu or prompt drawn over the pad now takes the finger where it is
   drawn. The cost: anything another part draws over the pad hides it
   (sailing's HUD panel at bottom left, which lets the pointer through, so
   the arrows still work unseen; COMPOSITION "Waiting on the lead").
14. **A lock body under touch looks from its eye** (decided unattended
   (2026-11-16, lane/n9), for the lead). A finger never locks the pointer
   (Decisions 11) and never hovers (it only presses and drags, and the
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
15. **A prompt button with a key is that key; a finger's tap is its look**
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
   `probes/touch-run.mjs`; jsdom keeps no capture to lose). The same
   browser rule, the lift's click going to whatever replaced the button
   pressed, holds for a plain verb that runs on the press and puts
   another button in its slot (the next target's verb, an Open for a
   Close), so a pointer's click runs a verb only on the button that had
   its press, and only when that press wasn't its key: the view's every
   press clears it first, and a second finger on a held button is the
   key's too (step 5 review). A right or middle press is neither a key
   nor a click (`holdKey` takes only a primary press), as on any button.
   A held button keeps its place in the document, not always on the
   screen: a verb before it that comes to apply pushes it along, and its
   capture still takes the lift to it.
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
   the prompt's own margin. It is shared, too: `hovered` is presence
   (select.js), so other viewers see a touch viewer's tapped outline
   until that viewer presses again, where before every lift cleared it;
   and it outlives a body change (Look, walk, Look again brings the old
   tapped prompt back).
   Proves, for Decisions 11 to 15 together: merged into scene-stage
   (f66a7d0a; the lane's Decisions 9 to 13 renumbered after the drawer
   grip's 9 and the world bar's 10) and checked in the real Patchwork on
   2026-11-16 under Chrome's touch emulation (recovered/publish/
   touch-check.mjs, 14/14 on scratch copies of the Quiet games room and
   Lost Cities aboard): the room arrives with `pointer.touch`; a tap on the
   chip, then Walk, walks with the lock never asked for; the pad shows
   Forward, Left, Back, Right in its places and Run, Jump; Forward held
   moves the eye, and with a second finger dragging on the world it both
   moves and turns. Aboard, the bar's Come aboard by a tap; the pad is
   aboard's; at the wheel the prompt sits in the middle and a tap on Take
   the helm stands there; Steer to starboard held turns the wheel 0.48 and
   Steer to port back; Leave leaves; at the windlass a finger on Raise
   anchor brings the rode from 25 to 18.4 m and it stops when the finger
   lifts. The published room, boat and game were never written. Locally on
   the merged tree: scene `probes/touch-run.mjs` 19/19 (2b new: the chip's
   menu over the pad's buttons), sailing's 11/11, and the mouse probes
   toolbar-run 28/28 and aboard-run --quick 54/54.
16. **The object tree and the inspector are one pane** (the lead,
    2026-11-16: "the sidebar's objects / inspector should be integrated
    together"; the shape of it decided unattended, 2026-11-16,
    lane/sidebar, for the lead). The rule is §6's ("The inspector is one
    pane"); what was decided, and why:
    - **One extension, the tree a module.** `scene.outline` and its
      `objects` toggle went; the tree is `createOutline(api, { shown })`
      (`parts/outline.js`), which `scene.inspector` mounts at the top of
      its one tab. Two tabs over one selection could disagree for a flush
      and opened by two rules; one tab can't, and needs no second toggle.
    - **Both halves are drawn by one rule:** the tab's update, only while
      it's docked. A shut pane is drawn into by nothing (the tree used to
      redraw a detached list on every flush, every frame of a sailing sim),
      and what to reveal is noted on every flush and revealed as the pane
      opens, whichever way it opens (a selection in Look then Edit, the
      toolbar after ×, a later open), since a scroller put back comes back
      at the top.
    - **The name stays Inspector** (the tab, its `data-panel`, the toolbar
      button), so every probe hook and the open rule are unchanged.
    - **A fixed split:** the tree takes at most about 40% of the pane's
      height; its bar (filter, New group) stays put and only its rows
      scroll, so a row scrolled into view is never under the bar (a sticky
      bar over a scrolling tree hid the row a drop aimed at); the fields
      fill the rest. With a ref selected (a dimension: no fields here) the
      tree has the whole pane.
    - **The tree arrives with a selection**, by the inspector's open rule,
      where Objects opened only when asked.
    Questions for the lead: is "Inspector" the right name for the pane
    (or "Objects", or "Scene")? Should the split be draggable (a view
    pref, like the drawer's grip) or the tree foldable, rather than a fixed
    40%? Should the tree arrive with a selection (as now), or stay folded
    until asked?
17. **An object's documents are inspector sections, one kind of thing**
    (the lead, 2026-11-16: "the 'open source' is unnecessary! it should be
    a kind of inspector and render inline"; the shape of it decided
    unattended, 2026-11-16, lane/sidebar, for the lead). The rule is §6's
    ("An object's documents are sections of the inspector"); what was
    decided, and why:
    - **A section is a document, `{ url, toolId }`, nothing else**: a
      `<patchwork-view>` of it inline, and Open for the main view (the
      drawer, next, is a third place for the same value). About, the build
      controls, "Open file", the link's Open and the controls' "Open
      source" were five shapes of one idea; now there is one. A section
      that was a mount function couldn't be opened as the main view, so a
      die's or a bag's panel, which needs this scene's context (it rolls as
      this viewer), stays a command docking its own element.
    - **A contribution, `documents`, beside `commands`**: read with
      `api.collect`, worked out by one pure rule (`inspector-model.js`
      `documentsFor`: the inspector's own first, then running order; a null,
      a non-automerge url, a throw (warned), a second entry with one id
      from one extension (warned) or a repeated url and tool is dropped,
      the first kept). Commands and documents share that walk of what's
      collected, so a command whose state throws is warned of too. Unlike
      a command, a document may go with the scene.
    - **The Source is the doc's own `sourceUrl`**, in the source doc
      type's default tool, never a lens's: a veiled card's face is never
      offered. It is three sections, one per kind of content (`source`,
      `file`, `link`), so each keeps its own fold: a file and a link start
      folded (what they show is already in the scene, and a linked scene
      inline is a whole second stage); a built object's source starts
      open, beside its Build. A source routed nowhere (its provider isn't
      here) is a folded Source.
    - **Folding is the viewer's**, a pref per section (extension and id),
      not per object, and no fold is written to the doc. (A question, below.)
    - **The build controls open nothing.** (A question, below.)
    - **A section's box has a definite height** (min(40vh, 22rem), and the
      viewer can drag it taller or shorter), which its view fills: a tool
      that fills its host (an editor, a scene) needs one, and the build
      controls, which size to their content, leave room below.
    - **No tool of this package is mounted in a section by hand**: without
      a host `<patchwork-view>`, a section names its doc. The tests and the
      editor probe use a stand-in `<patchwork-view>` (`src/test/
      patchwork-view.js`) that mounts the package's own tools by their
      registrations, as Patchwork does, so they check the one path.
    - **A section stays mounted while it's shown**: sections coming and
      going beside it are inserted and removed around it. The inspector's
      whole field list is rebuilt when the selected object becomes another
      kind of thing (its render doc, routing or link-ness changes), and
      its sections are remounted then.
    - A document's box, inline or docked, is `embed.js` `documentBox`:
      it carries both the `data-stage-embed` marker (its keys are its own)
      and the stage-wide CSS guard's class, `.about-embed` (every
      stage-scoped rule, in some thirty stylesheets in eight packages,
      stops at it), so a document looks the same inline and docked. The
      two aren't one marker: a docked extension panel (a die's, a bag's)
      is `data-stage-embed` for its keys but keeps the scene's styles.
      Renaming the class waits for the parallel lanes to land.
    Questions for the lead: which tool shows a Source (now its type's
    default; should a provider name one, a `sourceTool` in its
    `scene:source` metadata)? For an object fixed at a version, the Source
    shows the latest (the doc you'd edit) while the Version row says Fixed
    at…: should it show the source at those heads, read-only? Should a
    die's or a bag's panel become a section (its tool working as a plain
    doc tool), or stay a docked panel? Should a fold be per section for
    every object (as now: folding Source folds every object's Source), or
    per object? The build controls lost "Open source", so opened on their
    own they have no way back to the source: accept that (the inspector is
    where you meet them, their Source beside them), or should they show
    their source too? Is a fixed section height (the viewer dragging it)
    right, or should a tool that sizes to its content (the build controls)
    take only its own height? And should a tool named explicitly as the
    type's default count as the same section as one shown in the default
    (the scene can't know a type's default tool, so today they are two)?
18. **Documents in the drawer are the view's** (the lead, 2026-11-16: "it
    should be a kind of inspector and render inline but be draggable out
    into its own panel / openable as the main view"; the shape of it
    decided unattended, 2026-11-16, lane/sidebar, for the lead). The rule
    is §6's ("Documents in the drawer"); what was decided, and why:
    - **The drawer docks a document as well as an element**: `api.view.dock({
      url, toolId?, title })` → close, the same `{ url, toolId }` a section
      is, shown by the one `documentView` (`src/embed.js`) the sections use,
      in a pane of the editor kind (embedded: its keys its own; the
      editor's width). One pane per `docKey(url, toolId)`, so a second dock
      shows the first: there's never two panes of one doc and tool.
    - **The pane is the view's, not Edit's or the inspector's**: you
      dragged it out on purpose, so a new selection, leaving Edit, Enter or
      Leave, or the inspector stopping keeps it; only its × (or closing the
      scene) takes it away. `api.view.dock` is on every extension's api, in
      any body, since docking a document is something a viewer does, not an
      edit.
    - **One way in, the standard payload**: a section's head drags as a
      Patchwork document (the three types Patchwork's sidebar uses, the
      item carrying its `toolId`), plus the scene's own type
      (`application/x-scene-section`), and the tab strip docks any Patchwork
      document dropped on it. So a doc from Patchwork's sidebar, an outline
      row's own document and a section all dock the same way, and a frame
      that takes Patchwork drops takes a section's head too. `dnd.js` now
      carries an item's string `toolId` through, and one entry is one url,
      version and tool.
    - **The strip's drags are its own**: a drag over it never reaches the
      stage (the scene's add, a row's copy), whatever it carries; one that
      carries a document may drop there. A section's head let go anywhere
      else in the stage (its pane, the tree, the view) is nothing: nothing
      in a scene adds it. That is told by its type, as a tree row's is
      (`dnd.js` `ownDrag`, which the add and the tree both refuse), so it
      holds at dragover and needs no flag (review fix, 2026-11-17: the
      tree, in the same pane, used to add it). Adding a section's doc to
      the scene by dragging is the lead's to opt into (a question, below).
    - **A pane is titled after its object**: `<object> · <label>` ("Hull ·
      Source"; the label alone for the scene's), so two objects' Sources,
      when they are different documents, are two tabs with two titles.
      Docking a doc that's docked shows it under the title it was first
      docked with (a doc dropped as "My notes" stays that). Its limits, as
      built: a pane is one per `docKey(url, toolId)`, not per object, so
      two objects sharing a source (two instances of one built object)
      share one pane, titled after whichever docked it first; two objects
      of one name give two tabs of one title, which `view.drawer.tabs` (by
      title) can't tell apart (`view.drawer.docs`, by key, can); a renamed
      object's pane keeps its old name. Decided unattended (2026-11-17,
      lane/sidebar), for the lead.
    - **The drawer changing tells the pointer router**: any change of
      `view.drawer` (not only a selection) has the router look again, so a
      pane docked by a command in a pointer-locked body frees the pointer,
      and its last × gives it back.
    - **Docked, a section shows where it is**: an open section whose doc
      and tool are in `view.drawer.docs` shows "In the drawer · Show"
      instead of its view (a pure function of the drawer, so there's never
      a second live editor of it in the stage); its fold is still the
      viewer's pref; Show docks it again, which shows its tab. Docked under
      another tool, it's another document: the section stays inline.
    - **A pane follows the latest**: a dropped link at a version docks the
      doc itself (heads dropped), as a section shows the doc you'd edit.
    Questions for the lead: is the drawer the right "own panel", or should
    Dock ask Patchwork for a panel beside the scene (it has no such event
    today: Open is the main view)? Should a section's head dropped on the
    scene's view add that document to the scene, as any doc dropped there
    does (now it never adds: a missed drag at the strip writes nothing)?
    Should a docked document leave with Edit, as the inspector does? And
    what should a docked doc's pane be called (now `<object> · <label>`;
    the doc's own title would need a load)?
19. **Past three verbs, the prompt opens to all of them** (decided
    unattended, 2026-11-17, lane/n11, for the lead). The prompt shows the
    first three verbs that apply to attention's target, in running order
    (Decisions 7), and past three a last button, "⋯ N more"; a press on it
    opens the prompt to every one, until attention is on another target
    or on none, or the prompt goes (a carry's gesture takes it down).
    *Invariant:* every verb that applies on "use" to the prompt's target
    is on the prompt, shown or counted in its more, in running order; a
    held verb always shows, in its place, or after the rest when it no
    longer applies, and the more counts the rest (`src/parts/use.test.js`:
    0 to 5 verbs × none held, the first, the last, one that no longer
    applies, or the first and the last × closed or opened, 52 cases). The
    prompt between and beside its buttons is the prompt's, not the
    world's, so a mouse going down it from button to button keeps it
    still (`tabletop/probes/dominoes.mjs`, a pixel at a time to the
    fourth); before, a gap's pointer was the world's, and the prompt ran
    off from under it. The plan was for the more to open
    the target's menu at the prompt; it opens the prompt instead, because
    the menu lists what shows on "menu", not on "use" (a verb shown only on
    "use" would not be there), and its rows are clicks, so a held verb
    past three could not be held by a finger, which has no keys (N9's
    touch). Opened, each verb is the same button the first three are: its
    key, held as long as the finger. The more is a click of a press it
    had, as a verb's is, so a lift landing on it after a verb ran on the
    press opens nothing. *Questions for the lead:* raise the cap instead
    (or none: the prompt grows with the target)? Should the opened prompt
    close on an eye move too, not only on another target? *Known gap:*
    the prompt is put under the pointer and not kept inside the view, so
    near the bottom edge its last buttons (opened, more of them) can be
    off it; a tap or a pointer higher up brings them back.
20. **Multi-select is not built; the options are in §3** (decided
    unattended, 2026-11-17, lane/n11, for the lead). The selection stays
    one target, and a handful stays a group (option D). §3 lays out A (a
    list at the focus, with `several: true` commands), B (a transient
    group, rejected because it leaks into the doc), C (the stage fans
    `run` out, rejected because a handful is one act) and D, each checked
    against H3, H4 and H10. It recommends A2: nothing runs on part of the
    selection. The plan's draft was A1, where attention stays on the last
    one picked. A2 is recommended instead because A1 lets a key act on
    one of several outlined things. *Questions for the lead:* multi-select
    at all, or is D (Group, then file) enough? If A, A1 or A2? Shift-click
    is a modifier key, which Decisions 3 ruled out for games: is it
    Edit's alone (Edit's click already is), or should every body's menu
    offer "Also select", since Select is everyone's there? With several
    selected, should the halo move them all (one edit step, the same
    world move for each member in its own parent's frame), or stay off
    until they are grouped?
