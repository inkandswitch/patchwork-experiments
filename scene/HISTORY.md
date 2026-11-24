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

### 2026-11-17 — The board-game packages merge into tabletop

PLANS.md step 3b, the lead's call. `tabletop` absorbs `dice`, `bag`,
`tts-import`, `card-table` and `keep` (under `src/dice`, `src/bag`,
`src/tts`, `src/keep`), so step 4 migrates one games package, not six;
`seats` stays separate (machine uses it). Every plugin keeps its id, trait
and datatype. Gone with the package boundaries: the registry conventions
only these used between themselves (`keeper: <kind>` lookups for `contain`,
`container: "bag"` and `fill`, `tables: "tabletop-game"` and `setUp`: setup
code imports the keepers, the bag and the table writer now), the warnings
for a keeper or bag maker not installed, and the copied `rule.js`, GLB kit,
test fakes, empty scene, package-URL helpers, contract copies and probe
stubs. Kept: the `keeper` metadata and contribution (the editor's undo
reads the one, a table's Shuffle the other, per object at run time), and
everything seats, machine and sailing read. STAGE.md, "Keepers", still says
a keeper's module exports `contain` for setup code; nothing outside tabletop
calls it now.

### 2026-11-17 — Kernel step 4a: services and channel; claims, clock and telling leave the kernel

PLANS.md step 4a. The kernel knew claims (their grace, lapse, re-assert and
pagehide), the world clock (its claim, processes, frames, the chip's
`local.clock` and the view's `view.clocks`) and telling (its wire and the
flush's ask). Now an instance may declare `provides: { [name]: (caller) →
facet }`, and `api.use(name)` gives the first running provider's facet made
for `{ id, signal }` (a view plugin's: the focus stage's, then the view
plugins'; a stage reader's and an ambient's `use` too). The host creates
extensions in running order, so a provider is up before what asks.
`api.presence`, `send`, `session` and `viewer` became `api.channel` (`peers`,
`get`, `set`, `watch`, `send`, `rate`, `shownAt`; `session` null in a pin);
`api.page` offers hide, show and visibility; `api.clock.now/after/frame`
became `api.now/after/frame`; `api.settled()` says `{ ready, missing }`.
Claims, world time and telling are `scene.claims`, `scene.clock` and
`scene.telling` in `src/native/`, on the public api only, registered first;
the clock chip became `scene.clock-chip` and reads each focus-path stage's
`use("clock")`. Loops run without WebGL too (`loop(fn, { first })`). The
packages moved by renames (each service got once per create); the keepers
and lots look again on `settled()`, not `local.running`/`packages`; walk
still reads `local.status` (content is step 7). Behaviour: a stopping
extension's processes are saved one by one as its signal aborts, before the
clock's own last checkpoint; a failed extension no longer keeps a doc from
computing; view plugins are created in order too; told notices are
`scene.telling`'s. STAGE.md's Claims, Time, World time and Telling became
"Native services", and Keepers kept only what crosses packages.

### 2026-11-17 — Kernel step 4b: notices, the drawer and prefs leave the kernel

PLANS.md step 4b. The view held notices (`view.notices`, `api.notify`), the
drawer (`stage/dock.js`, `api.dock`, `api.view.dock`, `view.drawer`) and prefs
(`view.prefs`, `api.pref`, `setPref`, their storage). Now they are native view
plugins in `src/native/`, each a service: `scene.notices` (`"notices"`:
`notify(text, kind?, { from? })`, owning the list it draws; `from` is another
running extension of the caller's stage, which telling passes, so told
notices are the teller's again), `scene.drawer` (`"drawer"`: `dock`,
`dockDocument`, `state()`; the model, DOM, CSS, tab-strip drop and the 1110
width cases moved with it) and `scene.prefs` (`"prefs"`: `get`, `set`,
`watch`). An acting stage's extensions reach the view plugins' services
through `use` (a drawn stage's reach none); a view plugin's `use` asks the
view plugins first. Three general hooks replace the special ones: a view
plugin's `api.view.set(value)` (its own value at `view[id]`, so every update
hears a pref or the drawer change), `api.wantPointer()` (an open drawer keeps
the pointer free) and `api.url`. Behaviour: an edge part made while the drawer
is open no longer goes inside it; with no notices or drawer plugin, a notify or
dock does nothing. Review: no stage creates an extension before the view's
providers have started or failed (host.js `first`), so a create's
`use("drawer")` holds whatever order things load in (24 cases); a pref's doc
suggestion is the asking extension's doc's again (a view plugin's: the focus
doc's).

### 2026-11-17 — Kernel step 5: display; poses and the audience leave the kernel

PLANS.md step 5. The stage's doc → viewport loop had separate branches for
lenses (`instance.looks()`), the veil, remote pose holds and their playback,
and the audience. Now one kernel primitive, `api.display(id, { transform?,
content?, hidden?, name? })` → release, layered in running order (later per
field; again from the same extension replaces its own; released as it stops);
a transform is the viewport's pose, so `worldOf`, boxes and picking follow it.
Pose holds became `scene.poses` (`native/poses.js`; `holds.js` now holds the
order, the hold table and the wire, which rides the channel's sends;
`smooth.js`): `hold`, `release`, `heldBy`, `rate`, `shownAt` (the clock
`uses` it). The audience and the veil became `scene.audience`
(`native/audience.js`, `veil.js`): `audience`, `shown`, `veil(id)` → release,
the veil a `display` content (GLB bytes, not a three.js node: it goes through
the GLB path, so box and picking go by it). Keepers and the dice cup show
items and veils through `display` (tabletop `showLooks`). `settled()` gains
`failed`. Group hiding stays: it is the doc's (a group's `visible`, the same
for everyone), one argument to the viewport's display, not a branch.
Behaviour: a pose moving (a peer's sample, a local drag) no longer wakes
every extension's update, only its appearing and going do; an extension
holding a pose no longer lingers for it; sends from a session that said bye
are ignored; the pose rate is the poses service's `rate(hz)`, not the
presence rate (sailing asks both). Also from the 4b review: a view or doc
provider not started within the packages' load timeout counts as failed, so
no stage waits on it for ever; the right edge with only the empty drawer
takes no room.

### 2026-11-17 — Kernel step 6: links leave the kernel

PLANS.md step 6. The view expanded links, kept their roles, fixed them,
named the trail and announced linked docs. Now the kernel keeps a tree of
stages and one way to grow it: `api.open(handle, { under: [stagePath, id],
acting, heads?, deps? })` → close, on the view-plugin api (`heads`: a pin,
read-only through readonly.js; `close.reached`: what its repo found). A
stage under an object is its content (a `content: "scene"` source is drawn
as its hint without one); closing one closes what is under it and takes the
focus out; one that acts is announced. `api.opening()` holds arriving while
stages are still on their way. Links became `scene.links` (`native/links.js`,
pure `native/link-graph.js`, I3's tests with it): expansion, roles, pins with
`deps`, the budget (64), `fixPoint`, relinking on every doc it reached; the
service `"links"` (`role(id)`, `fixPoint(id)`, the caller's stage's: a
service caller from a stage now carries its `path`); Enter (`scene.focus`
folded in) and the trail. `api.link` is gone; walk asks `loadState(id).content
=== "scene"`. **The focus stays the kernel's**: a path the view holds,
scoping the selection (H10), where view plugins sit, changed by
`selectionStep`, Escape's last rung; moving it out would move H10, the
ladder and `focus()` with it for no fewer lines. Entering is generic (the
acting stage under an object); only the command, the trail and its names
moved. **Ambients stay**: `collect(name, { world: true })` would still need
the frozen-JSON copy (I13: only data crosses docs), `mine`, the frame and
the outermost's `use` in every reader (sailing, water, weather, arena), so
more lines, not fewer. Behaviour: the Enter command is `scene.links`'s (the
inspector's button, the menu: `data-ext`); arriving through a place that holds
no open stage waits while anything is opening, then is decided by the route,
not the link shape; a view provider registered before `scene.links` that
starts slowly delays links. Also from the step 5 review: a label item may
sit `on: id` at `offset` in that object's drawn frame, placed each frame;
seat tags, cup tags and bag counts use it instead of re-anchoring by hand
(`scene.bounds` still redraws its boxes in `afterRender`, so it keeps it).

### 2026-11-17 — Kernel step 8: the page

PLANS.md step 8; section 1 is complete (step 7 stays deferred, now in
section 2). STAGE.md (676 lines) became the kernel's contract alone, 200 lines:
words, the stage tree and `open`, the three places for state, activation
(providers start in parallel, each waiting only on what it `uses`), the view
plugin and extension api tables, the input chain, bodies and hands, packages,
arriving, and the invariants the kernel guarantees. Everything else went to a
page of its own: NATIVE.md (the nine native services, H6–H8, I3), EDITOR.md
(the editor's view plugins, commands, the key map and use prompt, undo, drops,
templates, parts, copying, extract and bundle, describing traits, the
interface; H3, H9, H13, I9) and CONVENTIONS.md (shared maps, no migrations,
seats, keepers, world ambients, carry and landing; H11). Of 491 citations
`STAGE.md, "<section>"` across the repo, 203 were rewritten to the page that
now holds the section (a script, dry-run first; HISTORY.md left as written);
16 naming sections gone since, and two dozen unquoted ones (`STAGE.md, H3`,
`STAGE.md's clouds`), were pointed by hand.
`src/native/boundary.test.js` is the lint rule: modules in `src/native/` and
`src/parts/` import from `src/stage/` only an allowlist of pure helpers
(`bodies.js`, `paths.js`, `ladder.js`, `pointer.js`); `contentMatrix` moved
from `stage/scope.js` to `src/transform.js` and `isTyping` from
`stage/router.js` to `src/keymap.js` (two copies of it in the parts went). It
also holds the pages to their sizes (200, 400, 300, 200) and every invariant
label they list to a test naming it (H8's are tabletop's and joints'). Docs
found behind the code and fixed: `hud(scene, local, view)` (not `hud()`); a
hold ranks a still one ahead of a landed one; a `scene:view` may declare
`provides` and `uses`; the kernel reads ten instance members, not the draft's
four.

### 2026-11-17 — "Fitting out" retired

The lead found it uninteresting; its hatch was linked twice, which mirrors' removal left as a placeholder.

### 2026-11-17 — Republished after the kernel

Synced scene (at the clock fix), tabletop, seats, walk, sailing, water, weather, terrain, machine, arena, joints, doom and traversal; each published tree matches the checkout.
The Scene examples folder links 21 republished examples (each checked in real Patchwork by probes/real-check.mjs; swapped by probes/folder-swap.mjs in one change), the Harbour's second boat is Ship at anchor, and Fitting out is gone.

### 2026-11-18 — Tabletop: assets and pieces on demand

The lead's call, after "Set up a table" on Terraforming Mars (1368 kinds)
still drew every piece up front: 1368 GLB docs, 819 of them card faces
nobody had seen, after an import that fetched and stored every asset.
Now the game description (tabletop-game v2, `contract/v2`) names each
asset by its original URL and caches it in `assets: { [url]: { file } }`;
the importer stores only what came with the mod ("Fetch every asset now"
is the offline option), and a TTS tile or token is as wide as its picture
says (`aspect: "image"`), measured when drawn. `pieces.js` `pieceDrawer`
draws a kind the first time something needs it: setting up draws what the
table lays out (`kindsLaid`), and a card's face, named in its container by
game and kind, is drawn when a keeper first shows it (`table/faces.js`,
`keep/rule.js`), with every face of its sheet, made and recorded in kind
order: `drawn` says which sheets were seen, never which card. Writes follow
ctx.file's rule (theirs if it got there first; each shows what it made);
a read-only viewer draws for themselves; a refused fetch leaves a
placeholder with its URL (`drawn[kind].missing`), retried after ten
minutes. setup-bench, TM at full size: import 2.8 s / 340 docs / 339 fetches
→ 0.6 s / 1 / 0; setup 15.2 s / 1454 docs / 29 changes / 1330 crops → 8–11 s
/ 742 / 8 / 310; a card's first showing 8 ms (46 ms to keep its sheet's 15
faces), later ones its doc. The privacy probe (plain part) passes in
headless Chrome with faces drawn on demand. Review the same day: a sheet
said too much — Terraforming Mars's decks span up to three sheets under one
back, so recording one sheet told everyone which third of the deck a
player's card was in. A face is now drawn with its group (`groupsOf`: the
cards it may share a container with, and those cut from the same sheets,
closed over both); its sheets are fetched in URL order and the group is
recorded whole or not at all; the game has its `assets` map from the start
(two viewers making it at once lost one's entries), and editing the game
writes it entry by entry. Then images are decoded four at a time (look.js's
drawer holds at most six decoded, counted out and back, so its eviction
never closes one a draw is still using, as its FIFO could): drawing what
TM's table lays out in headless Chrome (probes/decode-bench.mjs, 305 real
TTS-cache PNGs) went from 6.3–8.2 s to 2.8–4.3 s.

### 2026-11-18 — Tabletop: the game library and its launcher

PLANS.md §3, the lead's tabletop plan, built while the lead slept (nothing
published or synced). A `game-library` doc (tabletop's `src/library/`) is
folder-shaped, `{ title, docs }`, made holding two plain folders linked as
folders, Games and Sessions; Patchwork picks a doc's tool by datatype id
alone, so a datatype of its own, not a marked folder, is what makes the
launcher its default, and "Open as folder" shows it in the folder tool.
The launcher: **New game** renders a description, as a variant, into a
fresh scene through the game page's own path (`table/session.js`, now one
function both call), linked as the game and the time; **Continue**;
**Fork** copies a session by the scene's copy rule (a copy of transfer.js's
in tabletop, `copy-rule.js`: runtime state, keeper bindings and dropped
fields left behind, every `entries` trait set back to its `init`, which
empties the seats; bag docs copied) with `forkedFrom: { url, heads }`;
**Import** runs the TTS importer at its default into Games; **Add the
built-in games** makes each registered game's description once
(`origin.builtIn`). The format gained `variants` (tabletop-game v2,
GAME-FORMAT.md §3, choice 18): other ways to set a game up, each its own
`players`, `setup`, `seats`, `camera`, never pieces, each checked as the
game it sets up; a card's face group spans every variant's setup. The
three Draw Dominoes files became one game with three variants. The
start screen's per-game templates stay: an empty scene has no description
to start from, and a template's params are fixed per template.
probes/library-run.mjs (headless Chrome, in-memory repo) adds the built-in
games twice, starts Lost Cities, sits, forks, imports the tiny mod and
starts it: 17 checks pass. A fork's cards are bare backs (the copy rule:
what a card is stays with the session it was dealt in); that a fork be a
playable save of hidden state too is the lead's to decide.

### 2026-11-18 — Tabletop: setup recipes

PLANS.md §3, built while the lead slept (nothing published, synced or
fetched). A game's setup is data: the format's `recipe` (tabletop-game v2,
additive; GAME-FORMAT.md §6, choices 18–22; `contract/v2/recipe.js`, no
imports). **Options** (integer, choice, yes/no) are what New game and Set
up a table ask, and a template's params; a session is named for them.
**Layout** steps run when a table is made, pure (game × values → game):
`remove` by id, tag or seat (with its hands), `place` things at a pose or
named spot (out of a bag too), `seats` (a seat's area moves, its hands and
camera rigidly with it), and `kit`s laid at each seat's area last.
**Start** steps (`shuffle`, `deal` n to each seat's hands, `draw` n face
up onto a thing, `first`) are resolved to the table's objects when it is
laid out (setup.js `startPlan`) into the scene trait `tabletop.start`, and
run by **Start game**, a world verb (`table/start.js`) enabled once every
seat is taken: the keeper shuffles, the moves are one change with
`started`; pressed again, or on two peers, it deals once. A condition is
one comparison on an option. The validator lays out and checks every way
the options can be set (at most 512, and a bounded cost). `variants` (that morning's) are gone:
one mechanism. Draw Dominoes is one setup with a `players` option, seats
placed at spots, its rack a kit, and Start deals 7 (6 with four); Santorini
asks 2 or 3. Lost Cities' deal stays its deck's `deal` (it was never code;
moving it would make five probes press Start). The TTS importer reads a
memory bag's saved layout (the `ml` of its script state: data, never
code) into `place` steps, bags laying out one spot being one choice
(Earthborne's six ranger bags), seats into a `players` option, face-down
decks into a shuffle-at-start option (off unless chosen). Start is an
extension of its own (`tabletop.start`, by that scene trait): declared on
the cards' extension it ran it scene-scoped, before carry, putting Draw and
Wash ahead of Flip on the use prompt (dominoes.mjs caught it). Who goes
first is drawn by lots between the seated players' clients. Tests: every built-in game every way its options set it (every
component once, a hand per seat, nothing on anything but the table, no
hands overlapping, deals to their own seats), Start against the plain
keeper and real joint-keeper clients. probes/setup-run.mjs imports
Earthborne Rangers Demo offline (Chrome refusing every other host), New
game for two with the pre-made rangers and shuffling, sits, Start: 11
checks pass; library-run.mjs and dominoes.mjs (2, 3, 4) pass too.

### 2026-11-18 — Tabletop: alternate states and custom dice

PLANS.md §3, built while the lead slept (nothing published, synced or
fetched). The ranking of the lead's 42 local TTS mods found alternate
States in 28 and custom dice in 12; Arcs (75 ships with a Damaged state,
20 custom d6s) is the proof. **The format** (tabletop-game v2, additive;
GAME-FORMAT.md §4–6, choice 23): a piece may have `states`, other looks
each named and drawn as a piece is (its own is called by its name); a
thing's `state` is the look it is laid out in; a recipe's `place` may turn
a thing to a state (`{ state, at? }`). Never a card's or a card's back's,
so a state never shows what's hidden. Codes `state-name`, `state-card`,
`unknown-state`. **At a table** (`src/states.js`, `table/states.js`, the
extension `tabletop.states`): a look is drawn by ref (`<kind>#<n>`), so a
state is drawn the first time anyone is shown it and kept in the game's
`drawn`, as a card's face is; the thing's trait names every look and the
one it was laid out in, and PgDn / PgUp / a number key write `shown`, one
write for everyone, runtime (a fork shows the laid-out look), the last
writer winning when two turn it at once (an Automerge test). The turned
look is shown over the object with the stage's display; a piece in
someone's hand is seen turned by that seat alone. **Dice**: a die face may
carry a picture (`image: { file, rect? }`) drawn over the side read, its
marks where it can't be had; look.js crops it for the die source through
the game's assets. **The importer**: States become the piece's states in
TTS's order (the object is the state its States leaves out), named by
Nickname or "<piece> (state n)"; a card's or deck's States are left out,
counted. A custom d6's faces are cells of its image, in thirds as TTS's
shipped D6.png template lays them out (the top row unused; the review
checked it against the template), each on the side its RotationValue turns up (found
from Unity's rotation, z mirrored) and named by its value. probes/
states-run.mjs on Arcs, offline, with stand-in assets (none of Arcs's is
cached): New game for four, a ship turned to Damaged and back (drawn on
demand, one entry more in `drawn`), a die rolled showing its pictured
face: 16 checks pass. rank-mods.mjs marks a mod down only for States left
out: two grades (if fetched) rise, Arcs and Root Accessories, B to A.

### 2026-11-18 — Tabletop published

Synced tabletop alone (at d30ee986; scene and sailing changed only docs and probes, so not synced): its published tree matches the checkout.
Republished the 12 examples a tabletop table reaches (Lost Cities, its table, Santorini, Draw Dominoes for 2, Liar's dice, Lost Cities aboard with E1M1's exit re-set, the Quiet games room, Games night, both Arcade mashups, the Harbour, the Model room); each checked in real Patchwork and swapped in the Scene examples folder in one change.

### 2026-11-18 — Visible gears: the X-ray tool

PLANS.md §4, slice 2. `scene.xray`, a native view plugin (NATIVE.md,
"X-ray"): a held tool, X (free across every package's keys) or the editor
toolbar's toggle, held in any body; it wants the pointer free and takes no
event, so a game goes on under it and a click both pins the object and
reaches whoever takes it. Its panel is one drawer tab: the object lens
(holders in input order with package, version, verbs as chips, events,
drawing, services; claims, poses, overrides; last writers), the extension
lens (trait tables, the objects × verbs grid, what it holds now, services,
writes), the running list (busy, lingering) and what isn't running, and
eight layers kept in the prefs (`xray.layers`), four of them badging
objects. World outlines through `boxes.js`, badges through `labels()`.
Everything is `buildGears` of the public reads through pure models
(`xray-model.js`); the boundary allowlist gains `writers`
(stage/provenance.js). Tests: the models over gears.test's 2048 worlds
(holders and chips, outlines, running order, nothing lingering when the
running set is the doc's, the grid against the verbs, trait tables), every
subset of the eight layers toggled, the layers' finite cases; the tool on a
stage (X while playing, hover, a click pinned and passed on with its route,
a picked extension's lens and outlines, the pref, last writers from an
Automerge doc, Escape leaving nothing). tabletop/probes/xray.mjs, a Lost
Cities table for two in headless Chrome: X held, a deck card's holders
(scene.carry, tabletop, the keeper) and verbs, tabletop picked (60 cards
outlined, its grid), both seats' claims, a card Ben is carrying held by Ben
in Ana's poses layer, a click's route, Escape; 19 checks pass; a rebuild
with tabletop picked takes about 9 ms there. The probe's repo is no
Automerge one, so it shows no provenance.

### 2026-11-19 — Tools are a stack; each consumes or passes

The lead's design: "Tools should be more like a stack, so you can have
multiple at once, and a tool may consume the current event or take
some/no action and pass it on." Before, picking up a tool (a command's
`tool`, or `api.hold`) replaced the one held, so the X-ray and Measure put
each other down; and the X-ray asked for the pointer (its tool and its
drawer tab both), breaking a walk's lock.

Now the hands are one stack per view (`stage/router.js`): picking up a tool
puts it on top and puts nothing down; picking up one held (the same
command) puts it down; putting a tool down (its toggle, `putDown`, its
extension stopping) takes it from wherever it is; Escape still pops exactly
the top (after the lock, a field, a gesture), through its `escape()`. Each
hand's input consumes an event (true, a session) or passes it on (false,
null), acted on or not: the Edit hand, held tools, the X-ray alike; a
popover now consumes everything (modal: the router gives it its input);
`kind` only says what a hand is. The pointer is wanted while any hand asks;
a key is the gesture's, else the topmost hand's that declares it
(`keymap.js` `keyLayers`/`keyHolder`), else the body's. `view.held` is the
list of held tools (top last) and `view.hands` carries each hand's keys;
presence's `held` is every hand's name (an open menu passed over), top
last, and who's here (the body chip, the X-ray's people layer) shows them
all; the touch pad shows a group per hand; `api.putDown(tool?)` names one.
An extension may hold several tools (`busy` counts them all). The X-ray is
an ordinary tool that always passes, asks nothing of the pointer (its
drawer tab is docked `pointer: false`, a new `dock` option) and, under a
lock, looks where the eye looks. Carrying, the halo and the knobs stand
aside while a held tool that points (`pointer: true`: Measure, a drawn
piece) is held (`bodies.js` `pointing`), not for the X-ray, a gun or a pad.
Putting the editor down puts down every `edit: true` tool, wherever it is.
machine's pad puts its last pad down before holding another (one pad in
hand); bag already sets one drawn piece down before the next.

Invariants: H4 (the stack's top), H5 (wanted ⇔ any hand, a selection or a
`wantPointer()`), H12 (offering order, the cut at the first consumer, push
and toggle, key ownership) restated in STAGE.md; H13 (EDITOR.md) gains
"every `edit: true` tool, wherever it is". Tests: router.test's "H4, H5,
H12", every sequence of up to four of {pick up, put down} × {Measure, a
gun, the X-ray, Edit, a popover} and Escape (16,104 sequences) × a lock
body or not, against a model: the stack, every put-down told once, the
pointer and the lock (the browser's Escape releasing it, the next press
only relocking), Escape's rung, a press and its release, a wheel and four
keys offered top first and cut exactly at the first consumer, orbit
reached iff nothing consumed the press; key resolution over two hands;
touch controls for every pair of tool declarations; the X-ray with Measure
either way up, and under a walk. tabletop/probes/xray.mjs adds the editor
and Measure over the X-ray at the Lost Cities table.

### 2026-11-19 — The X-ray as a scene-wide view

The lead found the X-ray's panel unintelligible, "big lists of things with
no structure", and asked for a view mode that affects every object. Held, it
now ghosts every object and outlines it in the colour of the extensions that
respond to it (one colour per extension that holds objects, a hash of its id into a
twelve-colour palette, used everywhere; the rest neutral grey); what nothing responds to fades.
Glyphs mark live state (lock, hand, gear, eye; links as dashed labelled
boxes). The drawer tab is a legend: extensions by package with the count of
objects each holds, failures first in red, a click isolating one extension.
The hovered object has a card beside it (traits, the responding chain with
verbs as keycaps, live state); a click pins it and opens its details folded
per extension; the last route runs along the bottom as boxes. The lists
(running, layers, extension lens, grid, tables) are gone, with `LAYERS` and
the `xray.layers` pref.

The kernel change: `display` takes three visual fields beside `transform`,
`content`, `hidden`, `name`: `tint` (a colour over the object's own, through
the doc-level `color`), `opacity` (times its own) and `outline` (colours its
box is drawn in, fat lines, alternating dashes for several; the viewport's
`setOutline`, a child of the object's body, never picked). They layer per
field in running order like the others, so the dressing scrubber can use
them. STAGE.md stays at 200 lines. The scene's own claims (a seat's) are listed in the panel, since they sit on
no object. A clock process may say what it drives
(`on`), which `inspect` publishes as `drives` for the gear glyph; nothing
passes `on` yet (machine's and sailing's processes could).

Tests: the model over the 2048 small worlds (looks, isolation, legend, card,
details agree with who holds what), colours for every subset of ten ids,
glyphs and the route's boxes by finite cases; the plugin's own tests
(isolate, card, pin, glyph labels, down leaves nothing displayed); the
display fields' layering. tabletop/probes/xray.mjs takes the screenshots.

### 2026-11-19 — Move is a tool; packages' writes on the scene's undo

From editing a CAD model in a scene (patchwork-cad's `cad-model-scene-edit`):
selecting showed the halo's handles, which got in the way of a tool that edits
a thing its own way. The lead: make Move a proper tool. **Move** (`V`,
toolbar) is the halo's command, a tool on the stack like Measure; its input
passes everything, and the handles (still widgets) and a provider's knobs
(`scene.handles`) show only while it is held. Selecting is only selecting.
Asked which other parts were tool-less modes: the knobs (folded into Move);
carry stays a holder by design (pieces need no tool), the only remaining user
of `pointing`.

The lead also wanted the CAD editor's edits on the scene's undo. `scene.undo`
provides `edits`: `edit(doc, fn, { label })` records a write to a package's
own doc (the recorder already wrote render docs) as one step in the focus
doc's stacks; the doc's `change` returns the patches the step takes back, so
a package leaves out what isn't the person's (the CAD tool's locks). Tests:
haloTarget's finite cases gain Move (ten tool stacks); the knobs follow Move;
the service's step, its undo and redo, and its refusal read-only.

Undo wrote a string back by assignment, which in Automerge makes a new text:
the CAD editor's cursors into the model's code then panicked Automerge on
redo. A string written over text is now the least splice (`updateText`), so
the text stays one object; tested with a cursor across undo and redo. Undo
still compares whole fields: anyone's later edit anywhere in the text leaves
the step undone, and said.

### 2026-11-19 — Open, and the inspector's parts (PLANS §5 slices 1 and 2)

The lead found patchwork-cad's "Edit model" undiscoverable, and the
inspector a stack of conflicting jobs. **Open** (the lead's word, over
Enter) is one verb: a command with `open: true` (`src/parts/open.js`); a
link's Enter is one, and a package's editor for its content another. The
menu lists it after Select, the outline's → and a row's double-click run it,
its key is Enter, and the Edit hand Opens on two clicks on the same thing
(500 ms, 6 px): in Edit only (the lead), so the kernel still has no
dblclick. Declaring Enter on the Edit hand instead put a lone Open button on
every touch pad: the commands' own key keeps the pad clear and the menu's
hint right.

The inspector is now a header (what it is: the provider's name, Linked
scene or Group; the name; the Open), **In this scene** ("how this scene
places and shows it"), and **Built from**: its source as a row, the Link
and Version rows, the status line, and the build's controls as the
inspector's own fields (a one-line summary from the stage's load state,
Rebuild through scene:rebuild, Pinned, the provider's params as edits on
the render doc, so the scene's undo takes them back). No document is
mounted any more (the lead: "the inline mount of the ex-scene rendered
version" went, which for a CAD model was a whole second editor and kernel);
a document is a row, **Open Editor** (the lead's name) and Dock. The
controls tool stays for a render doc opened on its own. Tests: Open's
finite cases (double-click gates, Enter, Edit only, menu order); the
inspector's parts for each kind of object; rows' Open Editor, Dock and
drag; the build controls' writes and their undo; buildSummary by cases.

### 2026-11-19 — The bar in groups (PLANS §5 slice 3)

The lead: display toggles and history as paired icons, Select beside the
modal tools, edit tools only in Edit. A command may say its `group`
(history, tools, panels, view, settings; anything else is "other"), its
`icon` and an `order`; the bar lays the editor's commands out in that
order of groups, icons drawn from `src/parts/icons.js`, settings (units,
snap) behind a gear in a popover (a popover hand: Escape closes it).
**Select** is the Edit hand's: it puts down every tool picked up through an
`edit: true` command and is checked while none is held; being `edit: true`
itself, it and the other tools show only while editing, so picking one
never enters Edit. Tests: groups in order, icons named by their label, the
popover, Select and Move.

### 2026-11-19 — The selection's verbs are the menu's, with shortcuts (PLANS §5 slice 4)

The lead: Group, Extract and the like go to the context menu with a key.
The inspector has no command buttons now (every package's inspector verb
was on the menu too). A command may declare a `shortcut`, a ⌘ key
(`"Mod+G"`; Ctrl off a Mac): the key map's keys stay plain keys, and
scene.keys runs a ⌘ key a shortcut names on attention's target, as it runs
a plain one; the menu shows it ("⌘G"). Group ⌘G, Ungroup ⇧⌘G, Extract ⌘E,
Bundle ⇧⌘E; Copy ⌘C and Paste ⌘V are the browser's copy and paste events
(`shortcutBy: "clipboard"`: shown, not run). Extract's options (which
behaviours go with it) were only ever the inspector's checkboxes: they are
now checkboxes under the command's menu row. Tests: shortcuts by every
modifier combination on and off a Mac, labels, which command a key runs; ⌘G
and ⇧⌘G on a stage, ⌘C left to the browser; Extract's options from a real
right-click.

### 2026-11-19 — The drawer's rail; Measure in Dimensions (PLANS §5 slice 5)

The lead: panel toggles belong to the drawer, and Measure to the Dimensions
panel. The commands of the "panels" group (Inspector, Dimensions, Parts,
each with an icon) are the drawer's rail now, not the bar's: a column of
icons at the right edge, read through the focus's reader as the bar reads
(no facet acquired: the view-plugins test caught the first try, which
called api.focus()), there whenever a panel is on offer, so a closed drawer
still shows what can open. Measure leaves the bar (its M stays): the
Dimensions panel's head has its button, pressed while it's held, gone where
no Measure is installed. The icons moved to `src/icons.js` (the bar's and
the rail's). Tests: the rail's Inspector pressed with its tab; the panels
off the bar and on the rail; the panel's Measure holding and putting down
the tool.

### 2026-11-19 — Dark mode for native controls and the body bar

The lead: the view picker didn't follow dark mode. Two causes. The stage
never said its `color-scheme`, so native controls (selects and their lists,
checkboxes, number fields) drew in the OS's scheme, not Patchwork's: the
viewport now sets it on the stage's root from the theme's background
(`theme.js colorSchemeOf`, re-read on every theme change), so everything in
the stage inherits it, the CAD and OpenSCAD editors over it too. And the
body bar (the "You · look · Edit" pill and its menu) was the one part
styled from `--studio-surface`/`--studio-ink`, which Patchwork's dark theme
doesn't move: it uses the scene's tokens now. Checked in Chrome with a dark
theme's tokens: the root's scheme turns dark, the pill and selects with it.


### 2026-11-24 — The kernel knows no plugin: layers, commands, view.start

A design review found the kernel importing the editor: `stage/stage.js` ran
commands through `parts/toolbar-commands.js` (which imported back from
`stage/bodies.js`), so `api.run` enforced the editor's `edit: true`;
`bodies.js` defined the Edit hand; `view.js` parsed `view.start.edit`; the
key map lived in the kernel's `keymap.js`; natives imported `parts/`; the
kernel took event names from the build-controls tool and its snap default
from carry. Now:

- **Layers**, one table in `src/native/boundary.test.js`: shared, kernel,
  native, editor, entry; every module in one, imports only down, and the
  layers above the kernel reach it only through the allowlist. The test
  found every violation above, plus `parts/inspector.js` importing the
  controls tool and the packages prompt's text in the kernel's
  `packages.js` (moved to `parts/packages.js`).
- **Commands**: what applies and running are the kernel's
  (`stage/commands.js`: `flatCommands`, `commandState`, `inHand`); the
  surfaces' half stays in `parts/toolbar-commands.js`. `edit: true` became
  `hand: "edit"`: a command names the kind of hand it belongs to and applies
  only while one is held, and a tool picked up through it is held for that
  kind and goes down with the last such hand (H14, the router). Chosen over
  "a hand carries its commands" because the editor's commands come from
  eighteen plugins in four packages (weather, ink-studio, openscad), each
  in its own stage and context, and one hand cannot carry them; the field is
  plain data, so the bar can tell a command is there without asking its
  state. The Edit hand is `parts/editing.js` (`EDIT`, `EDIT_HAND`,
  `editing`), and putting it down no longer scans for its tools: the kernel
  puts them down; Select reads `held[].hand`. H9 (reach) moved to STAGE.md.
- **`view.start`** reaches plugins whole as `view.arrived.start` (frozen);
  the kernel reads `body`, `place`, `home`; the editor reads its `edit`.
- **Keys**: the kernel's key order is `src/key-order.js`; the key map's
  resolver is `parts/keymap.js`.
- The build controls' DOM events and class are `embed.js`'s; the viewport
  gives a GLB's `snapRadius` as written and the carry's `snapCandidates`
  applies the default; `per-focus.js` and `shallow.js` are shared.

### 2026-11-24 — The viewport, composed of small modules

`stage/viewport.js` was 2,564 lines with a dozen ideas in it. It is the
renderer, the frame loop, the object registry and the glue now, over
`atmosphere.js` and `sky.js`, `shadows.js`, `object-content.js`,
`clearance.js`, `camera.js`, `picking.js`, `widget-layers.js` and
`labels.js`. Two things that were not the kernel's left it: placing a
dimension's label off a short line is the dimensions part's (a label item's
`place`), and the default snap radius from a GLB's connectors is the carry's
(tabletop's slots copy it). Comments and constants that named one example
scene are said in general terms. The atmosphere's every field, default and
range are written down in CONVENTIONS.md.

### 2026-11-24 — The kernel's face; one snap radius; hands held for a kind, tightened

A review of the layers commit. The snap radius default is part of the GLB
convention, so it is applied once where the GLB is read
(`gltf-content.js findSnapPoints`, with `defaultSnapRadius` beside
`sanitizeConnectors` in the shared `connectors.js`): `content(id).extras.snapRadius`
is the effective reach, or null under two connectors. The carry's and
tabletop's copies of the default went, and the GLB field `snapPoints` (a
second name for `connectors`) is no longer read. Only `router.hold` takes the
kind a tool is held for (`held[].handKind`), refusing a kind not held and the
kernel's own (`tool`, `popover`), which a command's `hand` may never name; a
command's `tool` gives only `keys` and `pointer`. The layers above the kernel
import from it only `stage/public.js`, a module of re-exports checked to be
used; a root module is filed in the one layer that uses it, or shared; the
sources are native; the boundary test resolves extensionless specs and
refuses a non-literal `import()`. STAGE.md states the build controls' DOM
events, and that only view plugins are told `view.arrived`.

### 2026-11-24 — The kernel's api, smaller and complete

STAGE.md states what plugins relied on unstated (a body's `suspended()` and
`resumed()`, every hand hearing `move`, a tool's `put()`, `escaping()`, a
session's `keyup`, `keys` and `cursor`, the widget, a reader, the repo, the
registry, ops' planners, `camera.set`'s fields, `noPick`, `receiveShadow`).
Gone because nothing used them: `handle`, `local.watch`, the extension api's
`view.watch`, `camera.watch`, `body.reach`, `attention`, `ray`, `cursor`,
`input.leave`, an event's `clientX`, `clientY`, `ndc`, `pointerId`,
`pointerType`, a hit's `back`. One `box(target)` for an object, a group or
the scene (`groupBox`, `sceneBox` went). One fact in one place: the top body
is `view.get().body`, a peer's keys are `channel.peers()`, the tab's
visibility the document's (`body.current`, `channel.get`, `page.visible`
went). A view plugin reaches a stage only through `focus()` (its `viewer`,
`session`, `schedule`, `camera`, `pick`, `project`, `body` went); entering and
arriving are its `view.enter(path)`, `view.arrive()`; a command's context is
its stage's reader's; `trace` (`draws()`, `routes()`, `tap()`) replaces
`owners`, `routes`, `tap`; `overlay(side?)` replaces `edge`; Measure picks in
`move` and `frame(fn)` went. The kernel's theme holds only its own colours;
the grid, axes and dimensions declare and read theirs.

### 2026-11-24 — The contract on two pages

STAGE.md holds the words, views and stages, state, activation, commands, the
input chain, bodies and hands, packages, arriving and the invariants; API.md
holds what a plugin is handed and what the kernel reads of it (the view
plugins' api, the extension `api`, `instance`), in short rows. Each page is
capped at 200 lines; citations of the moved sections point at API.md.

**Content, one boundary (2026-11-24).** Content moved out of `stage.js`
(1,923 lines then) into `src/content/`, a kernel folder: `createContent`
is the stage's one door to it. An object's state became one pure function
(`content/state.js`) that the manager, `api.loadState`, `local.status`, the
inspector and the build controls all read; before, the controls judged
staleness themselves and said "Stale" where the manager said fresh (a build
from changes not synced, a contested one, one held on a loading dependency),
and a reader showed "Building…" for as long as a peer's leftover status
said so. Who builds became a claim-and-heartbeat lock with two parameters,
checked on a finite model (C1–C4), replacing a 20 s grace, a 60 s stuck
reset, a 1 s peer-id stagger and a 2.5 s settle. The manager, the GLB
queue and package loading went onto the stage's time; `build()` got a
`signal`; the test fakes answer `containsHeads` as a DocHandle does.

**Content's api members (2026-11-24).** `content(id)` became one value (what is
drawn, its route, its state, its render, `fix`), replacing `loadState` and the
api's `fixPoint`; `use("links").fixPoint` answers for every object. The
selection loads first by the kernel's own rule, so `focus(ids)` went; the add
dialog matches providers itself (`providersFor` went); the extension api's
`packages` went. No `api.rebuild`: only the build controls rebuild today.

**One claim per render (2026-11-24).** A review found the per-inputs lock
let two builds of one render run at once and an older result replace a newer
(a forced rebuild, a tab that froze), and a claim window with no margin over
two message trips; a model extended to editors, joins, freezes, forced
rebuilds, failures and lost messages found each, and one more (a holder
waking from a freeze kept building beside its successor). The lock is one
claim per render doc held until released, with a write fence (no write over
a build committed meanwhile, nor after another peer's claim, nor past a
lapsed lease without listening again); the windows are derived with margins
(`CLAIM_MS` 4D); failures are retried by their holder alone; a pinned,
contested or unavailable render, or one whose GLB can't be shown, decides
by its state without them; the controls alone build only when asked.

### 2026-11-24 — The editor without its special cases

The editor's chrome is made as the Edit hand is picked up and disposed as it
goes, through `whileHolding(api, kind, make)` (`stage/holding.js`, on the
face), so no part asks `editing(view)` (it went). Every surface takes one walk
over commands, the kernel's `applicable`, which keeps each command's stage: a
menu row for an inner stage's element ran in the focus stage, and the drawer's
rail showed panels naming the Edit hand outside Edit (H14). No command names
the inspector as a surface. Undo, Redo and Copy are shortcuts the key map runs;
Paste stays the browser's event. `scene.drops` hears drops and pastes once and
offers them to the parts' `dropping` and `pasting`. The outline's open rows
are prefs. `making.js` holds what packages' modules make with the drop
context, `editor.js` the recorded writes. Carry is native.
