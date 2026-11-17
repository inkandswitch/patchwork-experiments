# How the scene got here

An append-only log, newest at the bottom, one entry per decision or
milestone; a later entry may reverse an earlier one, and says so. Entries
keep the labels the code cites (`TOOLS.md, Decisions 6`, `COMPOSITION.md,
Decisions, step 16`): grep the label here. The full design notes these were
condensed from, TOOLS.md ("Tools in hand") and COMPOSITION.md ("Scenes made
of scenes"), with their options, build records and test counts, are in git
at d80a2bfa, the commit before their deletion. "The lead" is the project
lead; "unattended" means an agent decided while the lead was away, standing
until the lead confirms or reverses it.

### 2026-10-07 — The scene moves in
`scene/` moves into patchwork-experiments from patchwork-base.

### 2026-10-16 — Contract v3: render docs; fixed versions
Built content lives in a `scene-render` doc recording how it was built
(dependency heads, provider version, clamped params), so it rebuilds only
when stale. 10-19: an object can be fixed at a version of its source (`at`).

### 2026-11-02 — The hand, seats, hidden objects, secure decks
Carrying, snap points, locked objects, seats, hidden objects; pluggable
secrets resolvers and secure decks for tabletop.

### 2026-11-05 — The stage/extension split
STAGE.md becomes the contract between the core (the stage) and everything
that adds to it (extensions), with a pure core: the local atom, activation
by traits, scopes, the input chain. DESIGN.md (why) and SCOPE.md (whose a
press is) are written. Activities replace kits; claims live in the doc,
settled by Automerge, lapsing with their holder's presence; motion stays in
presence. No back-compat: only the current doc shape is read. Sailing's sim
arrives on it (the use prompt, smoothed pose playback, the parts bin).

### 2026-11-06 — Rides, cross-scene drag; 11-10 packages
The camera rides a moving parent; objects drag and paste between scenes.
11-10: a doc lists its packages and a viewer is offered the ones it lacks.

### 2026-11-11 — Audience and keepers
Who may know what an object is (the audience) is the stage's question;
keepers are ordinary extensions.

### 2026-11-11 — COMPOSITION note: scenes made of scenes
A scene doc is a world; a link places one world inside another. Chosen:
nested stages, one stage per open doc, each seeing only its own doc; the
stages share one view (canvas, camera, pointer, bodies). The stage composes
docs only through space.

### 2026-11-11 — COMPOSITION Decisions (2026-11-11) 1–5
The lead answered the note's five questions.
1. A host never reads into what it contains: the only couplings across a
   link are space and published frames. (Amended 2026-11-14, accepted
   2026-11-15: also the outermost doc's ambients and world time, as data.)
2. One activity per view, edit stops at the focus. Superseded the next day
   by TOOLS: no activities; the focus scopes selection, not input.
3. A piece set down outside its doc stays in its doc; moving between docs
   goes through a container placed in both.
4. The private layer is a doc the view links (accepted; not built).
5. Seats leave `scene/` for a `seats/` package, with the roster and `lay`.

### 2026-11-12 — TOOLS note: tools in hand
Edit and play stop being modes. Three drafts (tools in hand, places and
vantages, capabilities) were judged; a hybrid was recommended: bodies, a
held tool, the doc's clock, the Escape ladder, `api.dock`, the end of
`requires`; "can" (the thing's) is not "may" (the person's). Rejected:
grants, act classes, belt digits, Tab between vantages, `with`. A tool is
held only if it takes input outside its own widgets.

### 2026-11-12 — One build order of sixteen steps
COMPOSITION's and TOOLS's work merged into one order, each step shipping
alone (TOOLS's are steps 2, 3, 6, 7, 8, 9).

### 2026-11-12 — TOOLS Decisions 1: Nobody present, no time passes
The lead. No process fast-forwards over a gap; a process may offer that as
its own option later.

### 2026-11-12 — TOOLS Decisions 2: Undo is the stage's own edits only
The lead. Undo covers the stage's editing writes (handles, inspector,
transfer, add, remove), per person and per focus doc, as inverse changes;
package verbs, clock acts and process saves are never on it, so undo can't
un-roll a die. Compare-and-set: an entry applies only where its fields
still hold what it wrote. Kept contents don't come back. 2026-11-13, the
lead: a change that reveals or decides something is taken back only with
its parties' agreement (players, not observers); the stage refuses it with
a reason until a take-back protocol is designed.

### 2026-11-12 — TOOLS Decisions 3: Selecting in a game is by the menu
The lead. Select is the menu's and the outline's in a game; no modifier
key, one may be added if play-testing asks.

### 2026-11-12 — TOOLS Decisions 4: Outside an entered link stays live
The lead. Others still play there, and verbs aren't edits. (Narrowed for
Edit's click alone on 2026-11-16: COMPOSITION Decisions, Edit's click is
Edit's.)

### 2026-11-12 — TOOLS Decisions 5: Any writer may pause, and move anything
The lead. No finer capability; game integrity is not secured beyond the
secret-keeping work. Pauses and moves are attributed by name.

### 2026-11-12 — Build steps 1–6
1 input precedence is nearness (SCOPE §2). 2 `api.dock`: Camber, dice and
bag share one drawer. 3 selection and carrying: the halo replaces the gizmo,
Select in every menu, carrying is the `scene.carry` trait, `local.tool`
and the G/R/H keys go, Frame moves to `.`. 4 `content` replaces
`passthrough`, routed at sync. 5 seats become their own package. 6 bodies
and the held tool: one body stack and one tool slot, declared keys, `from`
and `reach` on every surface, the pointer rule, a seven-rung Escape ladder;
`walk/` is a new package replacing arena's walker.

### 2026-11-13 — Build step 7: the clock
One `"clock"` claim per doc; one view computes processes on a fixed grid of
world time and checkpoints every 30 s; the rest follow; holds are ordered (a
person before a yielding process). Sailing's ships and joints' doors become
processes.

### 2026-11-13 — Build step 8: activities and `requires` go
What runs is the doc's traits alone (`activeSet(metas, doc)`); `always` and
`general: false` go; edit/play twins merge (sailing, arena, tabletop). Chrome
follows attention: the sidebar goes, the inspector and outline become
drawer tabs. `view.start = { body, place, home }` is read once on arrival.
Undo of the stage's own edits is built (TOOLS Decisions 2). Every frame,
timer and stamp now comes from one time source (real, or a probe's manual).

### 2026-11-13 — TOOLS Decisions 6: Editing is a body
The lead, reversing the hybrid's "editing is the selection's halo, with no
switch": in a game, selecting a piece gave it handles and the inspector,
and "a game shouldn't do that unless we've opted into some kind of editing
view". Orbit splits into **Look** (no select on click, no handles) and
**Edit**; you switch by the body chip; published scenes start in Look; the
id `orbit` goes. The editor's chrome is Edit's alone, by one rule: what
writes through the edit stack, the tools that make those writes, and the
aids drawn for them. Nothing stands on Edit (entering any body from it
turns the base to Look; Leave never comes back to it). A new scene starts in
Edit. Later parts of this decision:
- In Edit a plain click selects before any package's click (the lead,
  2026-11-14); a press still goes down the chain first.
- The inspector stays open once a selection opens it (unattended,
  2026-11-14), so the canvas stops changing width at every select.
- Leaving Edit puts the selection down; the toolbar is one row
  (unattended, 2026-11-14).
- The inspector waits a beat (DOUBLE_MS) before opening (unattended,
  2026-11-16), so a double-click's canvas keeps its width.

### 2026-11-13 — Build steps 10–12: views, stages and live links
10 the view splits from the stage: the view holds the canvas, camera,
router, bodies, held tool, selection and hover as paths; one key grammar
names a stage's objects; `scope.js` is the one frame choke point. 11 links,
closed only: the `scene.link` source, `expand`, the cycle rule. 12 links,
open and live: a child stage per live doc, the chain a segment per stage,
claims and presence per doc, the page bus for presences on one handle in a
page. A seat's ride tilts with its table (the lead: "roll with the table;
the boat is how the boat is"). Tabletop's `placeLayout` and seats' `lay`
renaming retire.

### 2026-11-14 — Build step 13 and COMPOSITION Decisions, step 13
Pins and mirrors: a live doc acts at its first placement and is a mirror
elsewhere; a pin is a read-only stage at fixed heads. Unattended: 1 a drawn
stage draws and nothing more; 2 read-only by construction (wrappers whose
writes throw); 3 read-only is silent; 4 a pin has no channel; 5 a mirror
hears its own session; 6 no processes when drawn; 7 stages keyed by
occurrence; 8 `api.link(id)` is `{ role, open, reason? }`; 9–10 a pin is
whole (`fixPoint`) with no package declaring references; 11 a drawn stage
builds no render; 12 Fix and Follow latest apply to links; 13 a pin at
missing heads is its hint; 14 no stations in the fit-out; 15 publishing a
pin re-creates history. Review: 16 drawn stages collect from themselves;
17 a pin holds only what its docs name; 18 packages via the view's repo;
19 a pin keyed by its deps; 20 one drawn facet; 21 no `api.role`; 22 the
stage's repo an allowlist; 23 read-only presence; 24 a keeper takes no part
where it may not write.

### 2026-11-14 — Build step 14 and COMPOSITION Decisions, step 14
Edit in context: the focus is a path of links entered; Enter, Leave, the
trail. Decided unattended: 1 the general parts move with the focus by
stopping and starting; 2 they come after every segment and the input path
ends at the focus, so verbs outside an entered link still work; the
toolbar takes the focus path; 3 Enter goes where the doc acts (not a pin or
closed link); 4 the focus is any path whose every link acts; 5 no stage
sees the focus; 6 selecting from any stage is cut at the focus; 7 Edit's
click outside the focus isn't Edit's (reversed 2026-11-16); 8 a link that
goes while entered leaves the focus; 9 the trail is the view's chrome;
10 drawer tabs reopen where the focus went; 11 a link's outline row is
entered, not expanded; 12 Enter is everyone's, in every body; 13 the camera
stays put on Enter and Leave; 14 the clock chip and packages card show the
focus doc's (both widened since).

### 2026-11-14 — COMPOSITION Decisions, step 14 review
1 a general part the view moves away keeps H2's busy half (a walk isn't
dropped on Enter); re-pointing a running part and a second kind of general
part were rejected. 2 the focus is an occurrence, not a path. 3 nothing
that moves with the focus is a stage's to read (`api.view.leave` went).
4 Look and Edit ride the latest base ride of any acting stage, whatever the
focus. 5 a focus move counts as placing the camera only for general parts.

### 2026-11-14 — Build step 15 and COMPOSITION Decisions, step 15
Extract (a selection becomes a doc of its own, linked in its place) and
Bundle (a link copied back), one copy rule in two directions. Decided
unattended: 1 they are `scene.transfer`'s commands; 2 S is the selection's
subtree; 3 K (root traits to move) is a command's `options`, checkboxes,
none ticked; 4 render docs are copied both ways; 5 the host's change is
worked out when written and refused if what T was made from changed;
6 extract doesn't call `beforeRemove`; 7 dimensions go with both their
ends; 8 the link is filed in S's shared group; 9 a start on S moves to T;
10 T takes the host's look; 11 the link goes where S's first member was;
12 a reference to p becomes null; 13 bundling a pin copies its value;
14 bundle is refused whole for a clashing trait; 15 bundle's options are
read from the linked doc; 16 the aboard probe passes change options.

### 2026-11-14 — COMPOSITION Decisions, step 15 review
1 arriving through a link arrives in that doc's stage or nowhere. 2 extract
compares a footprint of everything it read. 3 I9's fixture has two
clusters. 4 one copy rule as pure pieces (`copyRefs`), placement per
operation. 5 a pin's whole value comes with a bundle. 6 bundle's options
follow a live link. 7 one fresh object record. 8 a box can be asked for in
an object's frame.

### 2026-11-14 — Build step 16 and COMPOSITION Decisions, step 16
Named frames and traversal decided, not built. 1 nothing needs named frames
yet (Doom exits land at a doc's start; stations are the ship's own). 2 a
start placed on a link arrives through it, as the linked doc starts people,
in its stage only, and on down. 3 when named frames come, the name is not
the URL's fragment (`#` already means heads).

### 2026-11-14 — COMPOSITION Decisions, links loose ends
Closing what steps 10–15 left, unattended. 1 one packages prompt for every
open doc; 2 a start placed on a link, for the boat too; 3 a hidden link
hides its doc; 4 who's here is the view's (body and held tool announced on
every channel); 5 a held verb pins a path; 6 the frame audit:
`camera.object` gone, geometry read through `contentMatrix`, world layers in
an anchor; 7 Fix waits for docs on their way; 8 finite harnesses for I4,
I5, I8; 9 getting up returns to Watching.

### 2026-11-14 — COMPOSITION Decisions, links loose ends review
1 `api.path` is a general part's only. 2 "Not now" is the view's. 3 who's
here tested on the manual clock. 4 the I4 harness enumerates its table.
5 I5 crosses pages over an in-memory network. 6 the boat's packages are
checked, not asserted. 7 a stage's boxes are its own doc's say.

### 2026-11-14 — COMPOSITION Decisions, integration
1 a package is loaded at the heads its folder settles on (quiet for
`FOLDER_QUIET_MS`), not those it was found at: old builds ran against the
new stage in the real Patchwork.

### 2026-11-14 — COMPOSITION Decisions, step 9
Step 9 done: STAGE.md, DESIGN.md and SCOPE.md describe the code as it is,
history cut from them. 1 SCOPE.md kept as a reference; 2 no doc deleted
(TOOLS and COMPOSITION kept as design notes whose history is their job;
reversed 2026-11-17); 3 the local table split into the stage's and the
viewer's; 4 sailing's "in Play" blurbs went; 5 no republish.

### 2026-11-14 — COMPOSITION Decisions, final fixer
1 an arrival whose body refuses is asked again until `ARRIVE_WAIT_MS`.
2 a press is where the look is (the router hovers the press's hit first;
amended 2026-11-16 for touch, TOOLS Decisions 14). 3 see TOOLS Decisions 6
and 7. 4 the mashup is Games night (the games room and Liar's dice linked
unchanged); a harbour of two boats waited for a water package. 5 Fitting out
lists each doc's packages exactly (pruning since built).

### 2026-11-14 — TOOLS Decisions 7: No tie rule for verbs beyond running order
Unattended. Where two holders tie (carry and a table on one tile), running
order breaks it for presses and verbs alike; ranking "a game's own verbs"
first was rejected as a priority list by another name.

### 2026-11-14 — Milestone: the sixteen steps are done
Steps 1–15 built, 16 decided. The stage composes docs: links live, mirrored,
pinned or closed; Enter and Leave; Extract and Bundle. Published and
checked in the real Patchwork: Lost Cities aboard, the Quiet games room,
Fitting out, Games night.

### 2026-11-14 — TOOLS Decisions 8: Presence is drawn where it is
Unattended. Other people are drawn in every stage that hears their doc's
channel, not only on the focus path; the clock chips stay the focus path's
(one per doc with a process); who's here stays the focus doc's list.

### 2026-11-14 — COMPOSITION Decisions, presence where it is
Unattended. 1 a part of every doc (`traits: ["*"]`) draws a doc's people,
not a general part with a second entry point. 2 every stage that hears the
channel. 3 a mirror draws the people again. 4 such a part may write, as any
part may. 5 the chips are fed by the view (`view.clocks`). 6 the chip's
plumbing has one consumer and is exempt from the two-consumer rule (the
stage talking to itself). 7 who's here unchanged.

### 2026-11-14 — COMPOSITION Decisions, final fixer after the next phase
Unattended. 1 the water work was merged and published before the lead's yes
to Decision 1's amended sentence (accepted 2026-11-15). 2 a mirror trails a
moving part by the playback delay (~75 ms), kept as a known gap; the lead
accepted it 2026-11-15 ("it's fine").

### 2026-11-14 — One sea for a world; water bodies; clipped water
A world's ambients (sky, weather, open water) are its outermost doc's; a
`water` package draws the world's water (water/WATER.md); the Harbour puts
two linked boats on one sea. 11-15: water is an object, open (the
outermost's) or a box its doc keeps. 11-16, the lead: open water may carry
a `clip`, its own sea where the host has none; the stage unchanged.

### 2026-11-16 — A machine in a scene
Doom and SNES machine docs stand in a scene as linked cabinets (the Arcade),
with no stage change; the use prompt keeps the look while the pointer is on
it (machine HOST Decision 48).

### 2026-11-16 — COMPOSITION Decisions, double-click
Unattended (lane/dblclick), fixing a double-click that missed a pitching
boat's card. 1 a press's hit and widget are resolved as it is pressed and
kept. 2 the widget comes with the hit. 3 the gates measure between the
clicks (500 ms; 6 px mouse, 16 px touch). 4 pointer lock on any of the
three refuses the reuse. 5 a first hit whose stage closed is cast again.

### 2026-11-16 — COMPOSITION Decisions, double-click stamps
Unattended (lane/dblstamp). 1 the gates read the events' own `timeStamp`,
not the page's handling time (a busy page refused real doubles). 2 with no
stamp on any of the three, all are timed on the stage's clock. 3 the
dblclick is timed as the release that made it (Chrome stamps a dblclick at
dispatch). 4 the cost: tests driving the manual clock must set
`timeStamp`; real OS input never checked.

### 2026-11-16 — COMPOSITION Decisions, Edit's click is Edit's
Unattended (lane/bodyswitch); 1 and 2 confirmed by the lead the same day,
"fine for now". In Edit inside an entered link, a missed click went down
the chain to the boat's click and came aboard, leaving Edit. 1 in Edit a
click on something is Edit's wherever it lands (reverses Decisions, step
14, 7; narrows TOOLS Decisions 4). 2 presses, keys, menus and verbs still
reach outside the focus; not chosen: clearing the selection, or leaving the
focus. 3 the property is the click's alone.

### 2026-11-16 — TOOLS Decisions 9: The drawer's width is the viewer's
Unattended (lane/n13). A grip on the drawer sets the width of the kind of
pane shown, two kinds (the stage's chrome, a docked editor), stored as view
prefs; a pane declares no width.

### 2026-11-16 — TOOLS Decisions 10: The bar of tools holds the world's commands
Unattended (lane/n8). A command with `show: ["world"]` is on the bar of
tools in every body, at its right end; the editor's commands stay Edit's,
at the left. The bar keeps its height whether or not a world command
applies (B1–B4). Sailing's Come aboard, arena's Play and the cups' Lift all
moved there, and HUD copies of them went (they sat over the canvas edge and
ate double-clicks: triage (f)).

### 2026-11-16 — TOOLS Decisions 11: Touch is part of the pointer's state
Unattended (lane/n9). A finger never locks the pointer; a mouse after touch
finds the lock released, so its first click on the world only relocks; a
pen counts as a mouse.

### 2026-11-16 — TOOLS Decisions 12: Touch controls are derived from declared keys
Unattended (lane/n9). `touchControls` is pure: codes group by the label a
person sees ("labelled alike is the same action"), arrow codes make a pad,
the rest are buttons, each shown under its reserver.

### 2026-11-16 — TOOLS Decisions 13: The touch pad presses keys as a keyboard does
Unattended (lane/n9). The pad dispatches the DOM key events a keyboard
would, so they go the one key order; no new api. Modifiers are momentary.
The pad lies under every other overlay.

### 2026-11-16 — TOOLS Decisions 14: A lock body under touch looks from its eye
Unattended (lane/n9). The look is the eye ray wherever the body would lock
and nothing wants the pointer, by mouse or finger; a press's hit and the
menu stay the pointer's.

### 2026-11-16 — TOOLS Decisions 15: A prompt button with a key is that key
Unattended (lane/n9). Pressing a verb's button presses its key (keydown on
press, keyup on lift), for mouse and finger, so held verbs (the windlass)
work by touch; a finger's tap keeps its look until the next press.

### 2026-11-16 — TOOLS Decisions 16: The object tree and the inspector are one pane
The lead asked for it; the shape decided unattended (lane/sidebar).
`scene.outline` goes; the tree is mounted at the top of the inspector tab
(at most ~40% of its height); both are drawn only while docked.

### 2026-11-16 — TOOLS Decisions 17: An object's documents are inspector sections
The lead ("the 'open source' is unnecessary"); the shape unattended. A
section is a document `{ url, toolId }` shown inline in its own tool, with
Open; packages add them through a `documents` contribution. "Open source",
"Open file" and the link's Open go.

### 2026-11-16 — TOOLS Decisions 18: Documents in the drawer are the view's
The lead (sections "draggable out into its own panel"); the shape
unattended. `api.view.dock({ url, toolId, title })`; one pane per doc and
tool; a pane lasts until its ×; the tab strip docks any Patchwork document
dropped on it.

### 2026-11-16 — COMPOSITION Decisions, packages pruned
Unattended (lane/n11). The packages list reconciles both ways, as a
function of the doc and the viewer's registry. 1 a package goes only when
every need is answered here and it answers none; 2 not before the registry
is quiet; 3 parts and templates list nothing of their own; 4 a viewer who
can't answer the whole doc takes nothing off; 5 two packages registering
one source both answer it; 6 render docs' providers counted; 7 extensions
of every doc answer no need; 8 a concurrent prune and add ends listed;
9 publishers state exactly what each doc calls for; 10 only the Santorini
table was republished; the rest wait for W8.

### 2026-11-16 — COMPOSITION Decisions, connector frames
Unattended (lane/n11). The scene keeps a connector's whole frame, not only
its yaw; tabletop's second copy (`tabletop.slots`) goes. 1 one source per
connector; 2 the frame on a node is its up and facing carried by the node
(mirrors and skew handled; Euler decomposition exact at gimbal lock); 3 a
yaw-only connector's yaw; 4 "straight up" within 1e-6; 5 the hand's
candidates carry the frame; 6 no LOOK_VERSION bump; 7 tabletop trusts the
stage's frame.

### 2026-11-16 — COMPOSITION Decisions, landing
Unattended (lane/n11). A carry lands a piece in a connector's frame and
`landing()` can lay it flat. 1 the landed pose is a pure function of how
it's held, the snap and the answer; 2 a snap's turn no longer sticks;
3 order: flat, faceUp, snap; 4 up, down or on edge by the most upright
axis; 5 faceUp turns over only a face pointing down; 6 `flat` is the
broadest face down; 7 F turns over what you see; 8 a turn over shows only
when what shows turns; 9 paste and the parts bin take the snap's turn;
10 tabletop answers flat for a domino taken out of a hand; 11 the answer
shape is `{ faceUp?, flat? }`; 12 a yaw-only connector leaves tilt free.

### 2026-11-16 — COMPOSITION Decisions, N7
Unattended (lane/n7): mashups of published docs, no stage code.
1 finding: a place handed across docs to a body is read in the wrong doc
(arrival through a link into a general body; Walk from here on a linked
spawn); options left to the lead. 2 E1M1 at Cadboro Bay is not published.
3 its place would be Gyro Park (the level floats a median 4.8 m). 4 a
linked place brings its things, not its weather. 5 its name and icon.
6 finding: the real Patchwork ran package versions days apart in one page,
and an old terrain provider rebuilt Cadboro Bay's render without buildings
(whole again by 20:54 UTC). 7 the Arcade republished with one Doom world.
8 mashup *Arcade in the games room* published. 9 finding: a linked world's
pause says so nowhere. 10 6 narrowed (no render docs in the room or Games
night). 11 *Games night and the Arcade*, a mashup of a mashup, published.
12 scores of record. 13 a game table in Fitting out's saloon can't be a
mashup (attachment across docs). 14 dice cups at the Lost Cities table
compose by reading, but seats has a stacked-bodies bug (pinned by a test).
15 the findings by owner. 16–17 (2026-11-17) the re-run on the integrated
tree, by the integrator.

### 2026-11-17 — COMPOSITION Decisions, N7, 6: the lead's answer
Fresh render docs for Cadboro Bay and Ucluelet are fine; no back-compat,
the old URLs drop out of the folder. Weather's W8 republished both.

### 2026-11-17 — COMPOSITION Decisions, how a carry ends
Unattended (lane/n11). 1 `ended` is a promise of `{ how, on }`: put, back,
yielded or refused, settled exactly once. 2 `landed(id, on)` is an event,
not a claim. 3 a peer's hold gives the carry way at the stage's `update`.
4 no new query for one's own hold. 5 a drop into a bag is still two
changes.

### 2026-11-17 — COMPOSITION Decisions, templates take parameters
Unattended (lane/n11). A `scene:template` may declare `params`
(ParamSpecs), drawn as a form on the start screen. 1 the kinds every other
form uses; 2 the stage coerces, not the form; 3 none declared gets `{}`;
4 what's chosen is the view's until it runs; 5 tabletop's three Draw
Dominoes templates become one (`players` 2–4); 6 nothing republished.

### 2026-11-17 — COMPOSITION Decisions, telling is the stage's
Unattended (lane/n11). `api.tell(type, data)`: each peer tells it once
`says` answers (within `TELL_MS`); dice, cup, tabletop, bag and seats moved
onto it. 1 `who` is `{ viewer, name, mine }`;
2 the stage names the speaker (contact, else "Someone"); 3 `says` waits for
the name; 4 one's own goes through the same rule; 5 a die keeps its own
evidence clock; 6 tabletop's and bag's `says` answer at once; 7 a view that
can't write tells nothing; 8 packages' fakes copy `telling.js` whole;
9 a waiting message is forgotten by its own timer; 10 data is an object,
checked by the stage.

### 2026-11-17 — COMPOSITION Decisions, the use prompt and the eye
Unattended (lane/n11). The prompt holds still while the pointer is on it,
until the viewer moves the eye. 1 the viewer moving the eye lets go, the
eye moving on its own (a ride) doesn't; 2 a body entered or left lets go;
3 a selection change doesn't; 4 holding keeps the prompt where it is;
5 let go means back under the pointer; 6 the view doesn't keep a Frame as
the viewer's camera.

### 2026-11-17 — TOOLS Decisions 19: Past three verbs, the prompt opens to all of them
Unattended (lane/n11). The prompt shows three verbs and "⋯ N more", which
opens it to every verb that applies, each the same button (its key, held as
long as the finger).

### 2026-11-17 — TOOLS Decisions 20: Multi-select is not built
Unattended (lane/n11). The selection stays one target and a handful stays a
group. Options A1, A2, A3, B, C, D were laid out against H3, H4 and H10; B
(a transient group) leaks into the doc and C (fanning `run` out) makes one
act N. Recommended if wanted at all: a set at the focus kept to its tops,
nothing run on part of it (A2 or A3).

### 2026-11-17 — Walk stands on supports (N10)
walk's body stands on supports (a navmesh per support, the ground and each
`walk.support` object); the ray walker goes. Sailing's own walker, navmesh
and aboard body are deleted: her hull is a support and a station is a body
over walk.

### 2026-11-17 — The weather package
A `weather` package holds the world's weather as data (the sun from time
and place, Open-Meteo fetch); sailing's wind and terrain's sky come from it.

### 2026-11-17 — A small-scene kernel, investigated
A design investigation of a kernel whose contract fits a page or two, with
everything else as plugins (PLANS.md). The lead decided four of its
questions: hands are a stack; the presence transport stays kernel as
`channel`; native plugins stay in `scene/` under a lint rule; content
loading stays where it is for now. All of it is deferred.

### 2026-11-17 — The docs simplified
The scene's docs (about 165k tokens) were cut down: STAGE.md is the
present-tense contract, README.md the package, DESIGN.md the overview, all
with history removed; this file holds the history and PLANS.md what is
deferred. TOOLS.md, COMPOSITION.md and SCOPE.md were removed (reversing
COMPOSITION Decisions, step 9, 2); they are in git at d80a2bfa. KERNEL.md,
never committed, was folded into PLANS.md and removed.

### 2026-11-17 — Dead api and hooks removed
Nothing implemented or called them, so they went: the `decided` instance
hook, the `documents` contribution (the inspector keeps its own sections),
`doc.materialRules`, `api.camera.limit`, `api.Counter`, `api.rebuild`,
`api.presence.shownAt` (the clock still uses it inside), and sailing's `receive`.

### 2026-11-17 — Undo consent removed
Undo keeps only its plain rule: this viewer's own step, taken back if nothing
it wrote has been written since. The reveal judgment, `parties` (seats'
answer too) and the refusal "needs the others' agreement" went (PLANS.md).

### 2026-11-17 — Double-click in the world removed
The stage has no `dblclick` event: the router's first-press resolution, its
DOUBLE_MS/DOUBLE_PX gates and stamp handling, and `input.dblclick` went.
Enter stays on the menu, the inspector and the tree's link rows; Frame on `.`
and the toolbar. The inspector no longer waits a beat to open.

### 2026-11-17 — Mirrors removed
A live doc linked more than once in one view acts at its first occurrence;
every other is closed, reason `"repeat"`, drawn as its hint. The `mirror` role,
Enter's go-where-it's-live case and a listener hearing its own session went;
the page bus between views of one doc in a page stays.

### 2026-11-17 — Kernel step 1: hands; Edit is a hand (reverses TOOLS Decisions 6's body)
The lead reopened Decisions 6's "editing is a body" and kept its opting in:
a game never selects or shows the editor's chrome unless the viewer has
picked up the editor. The router's separate "who goes first" mechanisms
became one **stack of hands** per view, offered every event first, top
first: the held tool (a tool replaces only the tool held), popovers, and
the **Edit hand**, which the viewer picks up or puts down (the body chip's
Edit toggle, `api.view.edit`). Its click selects at the focus unless a
widget is under it; presses stay the chain's; it wants the pointer, so
walking while editing looks by drag. `editing(view)` is "the Edit hand is
held"; `edit: true` commands keep their meaning. Gone: Edit as a body,
`setBase`, the body's `ahead` types, "nothing stands on Edit" and Leave
never returning to it; Look is the one stage body, and you can walk or sit
holding the editor (a body never puts it down). Escape: the lock, a field,
the gesture, then the top hand's `escape()`, putting the hand down when it
does nothing; with no hand, the selection, then the focus. The lead's two
calls: `view.start.edit: true` starts people holding the editor (a new
scene, bag's and tabletop's new scenes; `view.start.body` names only real
bodies; the inspector's Starts in has an "editing" box), and with Edit held
Escape clears the selection, then leaves the entered link, then puts Edit
down. Unattended: the Edit hand is the view's own for now, not scene.select's
(a general part moves with the focus, and would take the editor with it);
with no hand held Escape still clears a selection made by the menu's Select,
then leaves; a stage's `view.escape` shows leaving an entered link as what
Escape does at the outermost (the hand put down), so no stage learns the
focus. Old docs saying `body: "edit"` start in Look, not editing (no
back-compat; republished later).

### 2026-11-17 — Kernel step 2: view plugins replace the general scope
An extension with no traits used to be "general": it ran once, in the focus
stage, with an api no other extension had (`api.path`, `view.reopened`,
view-wide packages and clocks, cross-stage `collect`, a `camera.touched`
that included "carried across a focus move"), and the view stopped and
restarted it on every Enter and Leave (`host.setGeneral`, lingering while
busy). That was privilege by identity and a lifecycle special case. Now a
**view plugin** (`scene:view`, `src/stage/view-plugins.js`) runs once per
view for its whole life; only the registry starts or stops one. Its api is
the view's (chrome, prefs, notices, hands and bodies, the viewer's value
whole, `collect`/`run`/`path`/`stages` across acting stages, camera and
picking in the world), and `api.focus()` is the focus stage's **facet**
for it: that stage's api less the view's members. It is **seated** at the
focus stage: its input (the chain's step 4), commands and other
contributions are offered there, after the stage's own, and its `update`
hears that stage's flush. What it acquired through a facet is given back
when the focus leaves, or, while it holds a body, the tool, a session or a
pose, once it lets go (H2's busy half, per acquisition, not per plugin);
back first, the facet is kept. Every general part of scene's became a view
plugin, rebuilding what is the focus doc's per facet (`src/parts/per-focus.js`:
`perFocus`, `focusInput`, `atFocus`); carry and others stay extensions.
Gone: the `general` scope (an extension needs a trait, `"*"` for every
doc), `host.setGeneral` and `offering`, `placeGeneral`, `reopened` (a tab
simply stays open across focus moves), `projectView`'s `general` flag,
`cameraCarried` (scene.autoframe knows the focus moved), `chainFor`'s
`widget`. The Edit hand moved to the editor: `scene.edit` pushes it with
the ordinary `api.hand`, its click offering a widget's owner first
(`api.offerWidget`); the body chip runs its `edit` command, and
`view.start.edit` reaches it as `view.arrived`. The view knows nothing of
editing beyond which hands are held. Tests: the general-part tests became
view-plugin tests (`src/stage/view-plugins.test.js`: every order of ≤4 of
in, out, busy, idle and a recheck, 781 sequences, the plugin started once
and never stopped, a seat offered only at the focus and given back only out
and idle); a test's own extension with no traits is now a part of every doc.
Simplified the same day: no seating, no lingering. The view offers its
plugins' input, commands, `beforeRemove` and `update` at the focus stage,
and `focus()` is that stage's api, given back as the focus leaves; the
extension host runs them.

### 2026-11-17 — Kernel step 3: undo, drops, parts and templates leave the kernel
The kernel carried the editor's business: `stage/own.js` marked the
stage's own part modules so only they got `api.edit`, `edits`, `undo` and
`redo` (a privilege by identity), an `{ edit }` option ran through
`addObject`, `remove`, `drop`, `part` and the drop context, and drops, parts
and templates (`api.drop`, `api.part`, `api.template`, the drop context,
`ctx.file`, `doc.assets`) lived in the stage and its host. Now the kernel's
`change(fn)` returns its patches, and that is all it offers undo;
`remove(ids)` and `addObject(url, opts)` return change functions (every
`beforeRemove` then the removal; the new object with its `id`, its render
doc made beforehand) for the caller to make, so the editor records them in
its own step and a package (bag, machine) writes them with `api.change`.
The editor writes through `src/parts/editor.js`: `editor(focus)` records
each step from those patches onto this viewer's stacks for the focus doc,
kept in the focus stage's `local.edits` (the toolbar reads its labels
there), with the keepers note read from registry metadata; `drop`, `part`,
`template` and `add` make the drop context from the focus, each one step.
`src/undo.js` keeps its pure logic; its recorder takes any `{ url, doc(),
change(fn) → patches }` and a store. The stage api's `view` gained
`arrive()` (the outermost only), which a template's maker needs. Gone:
`own.js`, `isOwn`, the edit api, every `edit` option, `NO_EDIT`,
`judgeEdit`, `makeDropContext`, `applyPart`, `applyTemplate`, `sceneFile`,
`host.drop`, `takesDrop`. Behaviour: a template is now one undo step
("Template"); a drop context's notices are the editor plugin's, not the
module's. Tests: the kernel's template, part, `ctx.file` and drop tests
call the editor's functions on an extension's api; the `own()` test and the
host's drop test went; undo's exhaustive tests are unchanged.
