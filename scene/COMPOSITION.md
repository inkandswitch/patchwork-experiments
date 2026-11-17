# Scenes made of scenes: a design note

A note to decide from, not a contract. [STAGE.md](STAGE.md) says what the
stage does today, [DESIGN.md](DESIGN.md) gives the overview and
[SCOPE.md](SCOPE.md) says whose a press is. This note asks what happens
when a scene holds **another scene document**: a card game on a ship's saloon table, a fit-out on a hull,
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

**Now (2026-11-14).** Every step of the build order below is done: 1–15
built, 16 decided rather than built (nothing needs named frames yet; a
start placed on a link was the smaller rule), and 9 closed by bringing
STAGE.md, DESIGN.md and SCOPE.md to the code as it is. The stage composes
docs: a link is live (acting at one placement per view), a mirror (the same
live doc placed again, drawn and never acted on), pinned (a doc fixed at a
version, with everything reached through it) or closed (drawn as its hint).
A viewer enters a linked doc to select and edit in it, the host live around
them, and leaves by Escape or the trail. A selection becomes a doc of its
own, linked in its place (Extract), and a link is copied back (Bundle). One
packages prompt covers every open doc; a hidden link hides its doc; who's
here and held verbs' pins work across docs; packages load at the heads
their folder settles on; an arrival whose body refuses when offered is
asked again until the wait ends; leaving Edit puts the selection down. The
published examples are Lost Cities aboard (the boat, with the game linked
locked on her table), the Quiet games room (the same game doc on one of its
tables), Fitting out (a fit-out pinned at a version, a hatch linked live
twice) and Games night (a mashup: the room and the Liar's dice table linked
unchanged into a new doc). Each was checked in the real Patchwork on
2026-11-14 (FOLLOWUPS "Final fixer").

Since then (scene-stage, 2026-11-14 afternoon and evening), three more
pieces, each published and checked in the real Patchwork:
- **Presence where it is** (section 3): a part of every doc
  (`traits: ["*"]`: walk's avatars, `scene.others`' selection boxes) draws
  each doc's people wherever that doc is drawn, in its frame, and the clock
  chips are one per doc on the focus path. Checked on Lost Cities aboard by
  two identities over the sync server: inside the game, the chip row still
  shows the boat's clock, named for it; another viewer's selection in the
  game is drawn on the card both from inside the game and from the boat.
- **One sea for a world** ([water/WATER.md](../water/WATER.md)): a world's
  ambients are its outermost doc's, and a new `water` package draws and
  evaluates the world's water. The *Harbour*
  (automerge:2wvYRaAWRU8xCKBmrtF2qf4ErRcR, republished 2026-11-16 with
  clipped open water and 2026-11-17 with the stock sloop on rig@4, N6) links Lost Cities aboard and Fitting out, both at anchor on its
  one sea. It rests on Decision 1's
  amended sentence, which the lead accepted on 2026-11-15.
- **Water bodies** (WATER.md, "Water bodies", built in `lane/water`, merged
  into scene-stage and published on 2026-11-15): water
  is an object whose extent says whether it is weather (open, the
  outermost's) or a thing (a box its doc keeps wherever it is placed); the
  sea and a current are behaviours put on it, and the weather is a scene
  trait. The *Model basin* (automerge:2M7DayjgcnnpFupfj4s5fJ3sh7C2), a
  sloop in a box of water, floats in a dry room beside Ship at anchor
  (*Model basin and Ship at anchor*, automerge:T5cwhWMcGzvPXMyqHD6VmmDqMFX, republished 2026-11-17, N6,
  a doc of two links, laid out so her block clears the basin by 10 m or
  more, WATER.md Decisions 121 and 123, its home fitted to frame both in a
  640 px pane, Decision 122; it linked Ship at sea until the lead chose
  Ship at anchor on 2026-11-16, Decision 123); every sea example was republished in the new shape. One stage correction
  (arriving doesn't wait for objects with nothing to load, WATER.md
  Decision 73) and one removal (the trait-level `needs`, which this left
  with no consumer, Decision 77).
- **Clipped open water** (WATER.md, "Clipped open water", Decisions 90 to
  121, built in `lane/clip`, merged 2026-11-16 (5ae3b34c) and published
  with the Model room): the lead's
  answer to "should an inner world keep its own water?" (2026-11-15). The
  path rule was rejected; open water may carry a `clip`, the box of its
  own sea a doc keeps where the world it is placed in offers no open
  water. Ship at sea dropped into a dry room floats on a block of her sea;
  in the Harbour her block is silent and she floats on the harbour's. The
  box is the guest's (the lead's Q1), liveness is global (Q2), and the
  stage is unchanged: the path rule a fixer committed unaware of the
  lead's choice is reverted (Decision 90). The *Model room*
  (automerge:TCPsebdYmzQnK8JCsGQFHMZH6VS, its home fitted, republished 2026-11-17, N6; WATER.md
  Decision 122) lays boats out as 1:25
  dioramas on its floor, among them *Ship at anchor*
  (automerge:4QoRjMjsP8PHqh6mAHsJFQcrKv9T, now published on her own,
  Decision 120).
- **A machine in a scene** (machine/HOST.md, phase 2b): the published Doom
  and SNES machine docs stand in a scene as cabinets, linked, with a
  screen, sound, a seat per port and Doom's world beside them, and no stage
  change. The *Arcade* (automerge:3T4KdCM2LxkxGj9rwy4bWjZdfXMF,
  republished with one Doom world on 2026-11-16: Decisions, N7, 7) holds
  both, each cabinet whole in the home view with its own label beside it.
- **Mashups of published docs** (N7; Decisions, N7): docs linked
  unchanged into a new doc, with no stage code. *Games night* came first
  (the room and the Liar's dice table). *Arcade in the games room*
  (automerge:2FEoL22wHa6XL9y54Dwg164wyXSG, republished by N6's
  integration; Decisions, N7, 16) links the Quiet games room and
  the Arcade: people arrive Watching at Lost Cities two links deep, the
  cabinets' seats sit in the Arcade stage's roster beside the games' in
  theirs, and on a running world P on a cabinet in the link sits you at
  its port and your keys drive the engine while the room's game seats
  stay free (the published Arcade's world is paused, so there the
  picture holds still: Decisions, N7, 8 and 9). *Games night and the
  Arcade* (automerge:2Vxh319RwLpNkbc2NegkFaBPLTfc, republished likewise)
  puts the same Arcade,
  at the same pose, beside Games night: a mashup of a mashup, its games
  three links deep (Decisions, N7, 11). E1M1 on the Cadboro Bay shore
  was gated and not published (Decisions, N7, 1 and 2).

Still open:
- out of focus isn't tinted;
- a single click on a moving thing can still miss it: aboard-run's step-13
  click selecting the card inside G missed on about one run in ten
  (lane/xarrow); the double-click fix covers only the second press. A miss
  inside G now only fails to select (it used to come aboard: Fixed since);
  editclick-run's clicks with 150 ms of her sea between aim and press
  landed on the boat 3 to 8 times in 12. Aiming only at a card the view's
  own pick lands on doesn't cure it: in the real Patchwork on 2026-11-16
  (presence-check.nopause runs 3 and 4, aims checked so) first presses
  still landed on her Card table 80 ms after the aim;
- entering a link moves the canvas: entered in Edit (a double-click on G's
  card aboard Lost Cities), the canvas moves down about 31 px as the
  entered path's chrome appears, so a click straight after lands that far
  off. The bar of tools holds still (TOOLS Decisions 10, B3), the other
  strips don't (lane/n8, editclick-run step 5);
- a place handed across docs to a body: a body offered by one stage,
  entered with a place that names another doc's object, reads the id in
  its own doc, so a start through a link into a general body doesn't
  arrive and Walk from here on a linked spawn starts at the camera (found
  by N7's gate, 2026-11-16; Decisions, N7, 1; Questions for the lead);
- the real Patchwork ran package versions days apart in one page, and a
  viewer with an older terrain provider rebuilt Cadboro Bay's published
  render without its buildings and trees (whole again since 20:54 UTC
  2026-11-16; Decisions, N7, 6; Questions for the lead);
- machine's "Lay out its world" never refuses a second world for a
  cabinet, and the published Arcade had come to hold two (republished;
  machine/HOST.md, phase 2b, Not done yet; Decisions, N7, 7; Questions for
  the lead);
- in a mashup, a linked world's pause says so nowhere: the clock chips are
  the focus path's (I12) and machine shows no note while the world is
  paused, so Play on a cabinet in a link whose world is paused sits you at
  a machine that never moves (found by N7, 2026-11-16: the published
  Arcade's world is paused; Decisions, N7, 9; Questions for the lead);
- two docs' seat bodies, one stacked on the other, look the same to the
  lower doc's seats: every stage's seat body is `"seat"` and seats'
  `seated()` reads the top body's id alone, so the lower doc's `sitting()`
  still reports its seat and its `getUp` (its Stand up, or its stage
  stopping) leaves the upper doc's body (seats/README.md, Still open,
  pinned by `seats/src/stacked-bodies.test.js`; Decisions, N7, 14).

Fixed since (each item names its Decisions section below):
- the use prompt stayed put while the pointer was on it (since
  lane/arcade), so when the camera moved and the pointer didn't (a ride,
  Frame, a body change) it could be left over a halo handle or anything
  else, and a press there went to the prompt's button (found by
  lane/xarrow, 2026-11-16). It now holds still only under the eye the
  pointer went onto it under: any move of the eye puts it back under the
  pointer, so a press reaches a button only if the eye hasn't moved since
  the pointer reached it (TOOLS.md §3, "A shown key works"; Decisions, the
  use prompt and the eye, below; lane/n11). editor-run's new step leaves
  the prompt's button over Block 1's X arrow, presses `.`, and the press
  at the pointer is the halo's drag. Not yet checked in the real
  Patchwork.
- a doc's packages list grew as parts were added and wasn't pruned when
  they went (Fitting out's boat, as the tools made her, still listed her
  companionway's joints and traversal). Reconcile now goes both ways: a
  listed package this viewer has, that nothing in the doc calls for and
  isn't the scene package, is taken off once the registry has gone quiet,
  while every need of the doc is answered here (STAGE.md, "Packages";
  Decisions, packages pruned, below; lane/n11). publish-fitout's page now lists exactly the
  boat's own (scene, sailing, water: its new check, 15/15 dry run), and
  packages-run takes off a listed package nothing calls for and, later,
  one whose trait goes (21/21). Not yet checked in the real Patchwork.
- the first click of a double-click could open the inspector under the
  second: with the inspector shut, a first press that selected anything
  (the link, or the Card table it missed onto) narrowed the canvas, and
  the second press and the dblclick landed on the inspector or on
  whatever the narrower canvas put under the pointer (editclick-run's
  first try, every run: a 700 px view narrowed to 480 px between the
  presses; the real Patchwork's presence-check.nopause run 3, B's first
  try, the second press on the inspector's behaviour picker). A selection
  now opens a shut inspector a beat later, DOUBLE_MS (the router's
  double-click gate) on the stage's time, counted from the latest
  selection change or press in the view
  (TOOLS.md, Decisions 6, "The inspector waits a beat"; lane/n11). In
  editclick-run (seeds 1, 2 and 3; seed 2 before too) every press and
  dblclick now reaches the canvas at the width the first press found
  (700 px), where before the second press found it 480 px; its step 5, a
  slow double-click (second press 480 ms after the first, dblclick 170 ms
  after that), keeps the width to the dblclick and enters (with the beat
  counted from the selection alone, as first built, the tab opened under
  it: the dblclick at 480 px, and no Enter). Seeds 2 and 3's first
  tries enter; seed 1's first press still misses the card for the Card
  table, which is the single-click item under "Still open", not this one.
  Not yet checked in the real Patchwork (enter-check, presence-check.nopause
  on scratch copies, once the integrator has synced the scene package).
- keyboard bodies (walk, aboard, a station) had no touch input: on a
  phone nobody could walk, sail or take a station, and under a touch
  laptop's granted pointer lock a drag stopped looking. A finger now never
  locks the pointer, and the stage's own pad (`scene.touch`) presses the
  keys the gesture, the held tool and the body declare, derived from their
  labels, with no per-body touch code; a use-prompt button with a key is
  that key, so held verbs (the windlass) work by finger (TOOLS Decisions
  11 to 15, lane/n9, merge f66a7d0a). Checked in the real Patchwork on
  2026-11-16 (touch-check under Chrome's touch emulation, on scratch
  copies of the Quiet games room and Lost Cities aboard).
- in Edit on a boat that is the world, sailing's HUD drew its own "Come
  aboard" button over the canvas's top edge, so the first press of a
  double-click on a card there came aboard, left Edit and moved the canvas,
  and nothing was entered (triage (f)). The HUD now holds no button: Come
  aboard is a world command on the bar of tools in every body, and the bar
  keeps its height whether or not a world command applies (TOOLS
  Decisions 10, lane/n8, merge 7aba1de4). Checked in the real Patchwork on
  2026-11-16 (worldbar-check, 18/18 on scratch copies of Ship at anchor and
  Lost Cities aboard): the double-click 16 px below the canvas's top edge
  enters the game, and the canvas sits at the same place in Look, Edit and
  aboard; against the packages published before, the same check fails 11
  of 17, the first press coming aboard.
- in Edit inside an entered link, a click that landed on the host went
  down the chain to the host's click verbs: inside Lost Cities aboard, a
  single click at a card that the pitching boat moved away landed on her
  Card table, and sailing's click came aboard, so the viewer left Edit for
  the Aboard body, first person at the helm with the pointer locked, the
  card table behind the coachroof, and every later click went down the
  centre ray (presence-check.nopause in the real Patchwork, 2026-11-16: B's
  three clicks selected nothing). In Edit a click on something is now
  Edit's wherever it lands (Decisions, Edit's click is Edit's, below;
  lane/bodyswitch).
- the first click of a double-click on a link selected it, and if the
  inspector was shut that opened it and narrowed the canvas under the
  second click, which could then miss a small link; and a double-click on
  a moving thing missed it (Decisions, double-click; triage N11: on Lost Cities aboard, in Edit
  with her world running, the boat pitched between the clicks and the
  second ray hit the Card table). The second click of a double-click now
  resolves to its first press's hit, while the canvas is still under the
  second click. Checked in the real Patchwork on 2026-11-16, on a scratch
  copy of Lost Cities aboard with her world running, never paused
  (enter-check, 13/13 on the last of three runs): the cards moved 7 to
  15 px between presses 250 ms apart, and every double-click the router
  met as one, with its first press on the game, entered it; on one run the
  second press's own ray hit the Card table and the double-click still
  entered G. (A try the page met more than 500 ms apart was refused then;
  the next item fixes that.)
- the double-click gate measured time as the page met the presses
  (`time.now()`), not as the person made them: when the page was busy
  after the first press (in headless Chrome the first selection of an Edit
  visit, opening the inspector, held it about 1 s), the second press
  arrived over 500 ms later and the router refused a double-click Chrome
  itself fired (enter-check, 2026-11-16, a stalled try, retried). The gate
  now times the events' own `timeStamp`s (Decisions, double-click stamps,
  1, below; lane/dblstamp), and the dblclick as the release that made it,
  since Chrome stamps a dblclick when it dispatches it (Decisions,
  double-click stamps, 3; after the lane/bodyswitch merge). Checked in the
  real Patchwork only with probe-made input whose stamps are planned as an
  OS would stamp a person's clicks (Decisions, double-click stamps, 4);
  never with real OS input. With such input, before the release timing,
  enter-check's first try (presses 250 ms apart by their stamps, handled
  1102 ms apart) didn't enter (12/13); after it, its first try (250 ms by
  the stamps, handled 1011 ms apart) entered (13/13), and
  presence-check.nopause entered on each peer's first try (12/12).

Known and accepted as is:
- a mirror trails its acting placement while a part moves (about 4 cm on
  Fitting out's hatch; equal at rest): it plays the acting stage's held pose
  back as any peer does (Decisions, final fixer after the next phase, 2).
  The lead accepted it on 2026-11-15 ("it's fine").

Confirmed by the lead on 2026-11-16, and moved to the decisions they
belong to: in Edit a click on the host inside an entered link is Edit's
and does nothing ("fine for now"; Decisions, Edit's click is Edit's, 1, reversing
Decisions, step 14, 7, and narrowing TOOLS Decisions 4 for Edit's click
alone; TOOLS Decisions 6 says so); the options not chosen there, a click
outside the focus clearing the selection or leaving the focus out to
where it landed ("fine for now"; Decisions, Edit's click is Edit's, 2);
and the dry-room mashup links Ship at anchor, not Ship at sea ("clearly
better"; WATER.md Decision 123).

Waiting on the lead (decided unattended on 2026-11-16; each stands until
the lead confirms or reverses it):
- **The asymmetry this leaves** (found by the merge's critic): in Edit a
  click on nothing (or on a stale hit) with something selected clears the
  selection, while a click on something outside the focus keeps it. The
  reason given for keeping it ("a missed card should not drop what is
  selected") fits a near miss onto empty sea just as well. Both should
  probably keep, or both clear; unchanged until the lead says which.
- **No stamp on any of the three events puts the double-click on the
  stage's clock** (Decisions, double-click stamps, 2; lane/dblstamp). Only
  an event whose `timeStamp` is 0 takes that path, and no engine in use
  makes one (Chrome and happy-dom stamp every event), so in practice it
  serves tests; and a test that drives the stage's manual clock no longer
  drives the gate unless it sets `timeStamp` (Decisions, double-click
  stamps, 4). Not chosen: refusing a double-click with a missing stamp.
- **The bar of tools for games** (TOOLS Decisions 10; lane/n8): the empty
  row outside Edit, where the world cluster sits and what the surface is
  called, a new `show` surface or `edit: true` alone, a game's world
  commands without entering it, one stage-drawn key legend, and whether a
  game keeps a big Play call to action. The questions are there.
- **Touch controls for keyboard bodies** (TOOLS Decisions 11 to 15;
  sailing DESIGN.md "A station's keys say what they do"; lane/n9, merge
  f66a7d0a): when the pad shows (from the first touch, always on a coarse
  pointer, or a chip toggle) and whether a pen is touch; a digital d-pad
  or an analog stick, and whether WASD makes a pad; label-as-identity or
  an explicit grouping field (machine's doom pad shows one "Weapon"); the
  pad's layout and group names (a press session's `label`); whether the
  500 ms touch hold opens the menu while a body looks by drag; a stage
  crosshair under touch; whether a tapped look should expire; the station
  labels' words (B above all); whether sailing's HUD hint keeps key names
  on touch; whether arena's gun fires on a tap (today it fires only
  locked). The questions are there.
- **The pad and sailing's HUD share the bottom left** (lane/n9): the pad
  lies under every other overlay (TOOLS Decisions 13, so a menu opened
  over it takes the finger), and sailing's panel paints over its arrows
  (they still work, the panel letting the pointer through); move the pad,
  or have the HUD keep clear. Layout is the lead's taste.

Questions for the lead (not decided; each names what stands meanwhile):
- **A place handed across docs to a body** (Decisions, N7, 1): when a body
  offered by one stage is entered with a place that names an object of
  another stage's doc, should that stage resolve the place to a pose in
  the world (frames cross, references don't, as §9 has it), should the
  enter be refused, or should arriving through a link move the focus
  there? Arrival through a link into a general body and Walk from here on
  a linked spawn are the two cases today. Stands meanwhile: the enter
  silently starts the walker at the camera, and E1M1 on the Cadboro Bay
  shore isn't published (Decisions, N7, 2).
- **Package versions in one page, and a render an old provider can
  overwrite** (Decisions, N7, 6): Cadboro Bay's terrain render drew
  without its buildings and trees from 18:35 to 20:54 UTC on 2026-11-16,
  until a build that reads every layer made it whole again. Is a viewer
  whose provider is older than a render's allowed to rebuild it? Stands
  meanwhile: Cadboro Bay as it is now (whole; the weather merge may
  change its doc: Decisions, N7, 16), and
  no real-Patchwork checks from N7 of published docs with older renders
  until the lead says (checks of docs N7 made itself, and of docs with
  no render docs, go ahead, guarded, naming the versions they ran on:
  Decisions, N7, 6, 7 and 10).
- **A second world for a cabinet** (Decisions, N7, 7): should machine's
  "Lay out its world" be disabled on a cabinet that has one, or replace
  it? Stands meanwhile: the Arcade republished with one world; the
  command unchanged.
- **The Arcade's paused world, and who says so in a link** (Decisions, N7,
  9): the published Arcade's world has been paused since 20:20:57 UTC on
  2026-11-16, by your registered contact (how, isn't recorded). Resume
  it, or leave it? And inside a link, which should say a world is
  paused: the stage (a clock chip for every linked doc with a process,
  not only the focus path's), or machine (its note, which today stays silent because "the
  world's pause says so already")? Stands meanwhile: the Arcade paused, the
  two mashups linking it as it is; the checks play on a scratch clone
  whose world starts running.
- **Games night and the Arcade's folder slot** (Decisions, N7, 11): it
  adds depth, not a new kind of composition, and neither N7 mashup has a
  scaled link. Keep it in the folder, drop it, or swap it for E1M1 as a
  1:50 diorama in the Model room? Stands meanwhile: in the folder.
- **A place as a mashup's ground** (Decisions, N7, 3 and 4): a linked world
  brings its things, not its weather (STAGE.md, "Ambients"), so Cadboro
  Bay linked under E1M1 loses its sky and its wind (since the weather
  merge its sky is the weather's; to re-read after N7's merge:
  Decisions, N7, 16). Should a doc be able
  to say "my world's ambients are link N's" (a stage capability), or is
  the answer that the place's own doc holds the level (not a mashup)? And
  E1M1 floats over the Gyro Park lawn by a median 4.8 m (p90 9.3, max
  17 m), its spawn floor 4.9 m up: acceptable as a diorama on the shore,
  or should it have a stand? Stands meanwhile: E1M1 at Cadboro Bay is not
  published (Decisions, N7, 2), for 1's reason, not these.
- **Dice cups at the Lost Cities table** (Decisions, N7, 14): by reading,
  two games' seats in two linked docs can both be one person's, and the
  card table's and the cups' keepers each count their own doc's players,
  so no seat across docs looks needed. Try it (a doc of cups and seats to
  link onto the table, and seats' fix for two stacked seat bodies first),
  or is "a game that wants both is one doc" the answer? Stands meanwhile:
  not built.

*What follows is the record as written before build step 1; line
references are to the code then. Where it still holds, the step that left
it says so.*

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
Leave start them in the stage entered and stop them in the one left by
H2's busy half (`host.setGeneral`): one holding nothing at once, one
holding a body, the tool, a session or a pose when it lets go, offering
nothing meanwhile. What each doc runs is untouched (H1). Carrying shows the other case: it is a trait part
(`scene.carry` on the things that can be carried), so each stage whose doc
has carryable things runs its own, and a card aboard is carried by the
game's stage, in the game's doc.

The general parts that present others' contributions (STAGE.md's surfaces:
the key map, menu, notices, the packages card) run in every view, showing
nothing when nothing offers them anything. The view offers the union of
what its acting stages offer: commands, tools and bodies. The outermost doc
gives the defaults: its ambients and `view.start`, the body and place a
viewer starts in. An ambient is a named value a world has once, however
many things it holds: its atmosphere, its water. Each stage offers some
(`instance.ambient()`, stacked per name), the stage copies each offer into
frozen plain JSON, and every stage in the view reads the outermost's with
`api.ambient(name)` and its own code. A linked world brings its things, not
its weather: a boat alone has her sea; linked into a harbour, she floats on
the harbour's; in a dry room she has none of the world's; water she holds as
a thing (a basin, a tank, a box with bounds), she keeps, and open water she
gave a clip becomes that box in a world with none
([water/WATER.md](../water/WATER.md), "Water bodies" and "Clipped open
water"). Inner docs' spawns serve arrivals (section 9).

**Presence where it is.** What a doc's people are doing (someone walking,
someone's selection) is that doc's, so it is drawn where the doc is, in
its frame, whatever the focus. That needs no new kind of part: an
extension whose traits are `["*"]` is called for by every doc (as
`drops: ["*"]` takes any datatype), so it runs in every stage as that
doc's own part, held by its scene, and never moves or restarts when the
focus does. walk's people (`walk.people`) and everyone else's selection
boxes (`scene.others`) are its two consumers, and they share nothing but
the rule. The general parts keep what is the viewer's: the walk body
(`walk`), this view's selection and its box (`scene.select`). A part of
every doc reads the doc's channel like any part: a pin has none, so it
draws nobody; a mirror hears its doc's (a read-only stage listens and says
nothing), so it draws the people again, as it already draws their carried cards
again. Neither part draws this view (a mirror hears this view's own
session). A part with nothing of the doc's to draw (the menu, the
inspector, the toolbar) stays general, so twenty linked games still don't
make twenty menus. *Built 2026-11-14 (presence lane), and reworked after
review the same day from a general part's second entry point to this:*
`activation.js` (`"*"`), `chain.js` (held by the scene), walk split into
`walk` and `walk.people`, `scene.select` split into itself and
`scene.others`.

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
view computes them. A world's ambients and its world time do too (Decision
1), as plain data its outermost doc offers; each stage reads them
with its own code (the water package evaluates the outermost's water in
each stage's frame and time).

**The camera is the body's** (TOOLS.md §4). The current body's ride
applies; the stage's Look and Edit (the orbit camera) ride the latest base
ride of any acting stage, wherever the focus is (it scopes selection, not
the camera). A seat
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
- **Bundle(L, K)**: copy the linked doc's records in, ids kept unless they
  collide, top-level transforms = link · local, K's traits onto the host
  root (refused per key the host has: "This scene already has Seats"),
  assets merged; remove the link. The linked doc is never written. A pin is
  copied as its value: what in it follows a doc the pin holds (a link, a
  built object) is copied fixed at the pin's heads for that doc, and render
  docs are read as the pin holds them.

Since neither carries runtime state, linearity holds under any
interleaving, concurrent extracts included. *As built* (Decisions, step 15
review, 4): the copy rule is one set of pure pieces in `src/transfer.js`
that paste, extract and bundle all call: `subtreeOf` (what S is),
`cleanObject`/`cleanTraits` (runtime state left behind), `copyRefs` (ids
mapped first, then every described reference follows its object, is kept
or is cleared, an entry kept where the doc it lands in has it, a dropped
field left behind), `renderSeed` and `assetsFor`. What differs is only
placement, which is each operation's own: paste lands a copy at a point
through `addObject` (`planCopy`), extract keeps every transform, bundle
composes with the link. K is extract's and bundle's argument; paste takes
none, so nothing adds a root trait for you.

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
  `patchwork:open-document` event an inspector section's Open already sends) and puts the
  eye at the named frame, as standing up puts the walker at the eye. The
  arriving doc reads its own frame, so nothing crosses.

A name the doc doesn't publish resolves to its root.

*Not built (Decisions, step 16).* Arriving through a link is the smaller
rule that the one consumer needed: a start whose place is one of the doc's
links arrives as the linked doc starts people.

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
card table, a Sea (a water object with `sailing.sea` on it), and a link to game doc G on the table top,
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
| I4 | **Placement independence.** A stage's snapshot, running set, `audience`, `looks` and `shown` are functions of its doc and the registry: never of its host, the focus, the viewer's body or held tool, or whether it acts or mirrors. The reads that do depend on placement are space (frames, rays, hits) and `api.ambient`: its `value` is the world's, the same wherever the caller sits, and its `mine` (the caller is the world), `frame` and `clock` say where the caller sits. An extension that branches on them (water draws only where `mine`; a boat rides the camera and shows her HUD only where `mine`) acts differently by placement, on purpose and only through these (WATER.md W7) | A synthetic G shaped like Lost Cities' (seats with a roster and a seat body; a table whose audience reads the roster; a lens) × seats {none, p1, p1+p2} × card state {dealt, played to the table} × body {look, edit, walk, seat} × held tool {none, measure} × clock {running, paused}: G alone, in X at 0° and mirrored at 20° heel, in X' at 20° heel, in Y two links deep (mirrored there too), focus inside and outside the link (outside only alone): snapshot, running set, audience, shown, looks and the clock identical, and beside each comparison the ambient read: the world's value (G's alone, the outermost host's linked), `mine` exactly alone, the stage's own frame, the outermost's clock (`src/stage/placement.test.js`: 1056 comparisons; mutation: a stage's own offer serving itself when it isn't the world fails all 3; mirrors and pins also `links-drawn.test.js`; the real Lost Cities in `links-run`) |
| I5 | **Channels.** An object's claims, holds and sends travel on its doc's channel | Three views of G (alone and in X in one page, on one repo and its page bus; in Y in a second page, on a repo of its own joined by an in-memory network, so its messages cross by the handle's broadcast) × every claim/release/leave order: `claimedBy` agrees once delivered; a carry in one shows in the others and in a mirror (`src/stage/channels.test.js`: every ≤2 claims/releases by three views, 390 checks in five stages; every holder × leaver; a hold from each view) |
| I6 | **A read-only stage writes nothing**, through its api or its repo | Read-only handles whose `change` and `broadcast` throw; the Lost Cities probe against G pinned, unwritable and mirrored: no throw |
| I7 | **Frames.** For a similarity frame of S, points map by it, directions and normals by its rotation, distances by its scale; boxes are S's own | Property test over depth ≤3 × held and moving link poses × every spatial call and event field (`scope.test.js`, with the audit's: geometry in an object's own frame, the camera's up; `viewport.test.js`: a layer two links deep, every pose, moved; a box in its own stage whatever the host shows of the link) |
| I8 | **Chain and camera.** Inner segments before outer, out to the outermost whatever the focus; each (stage, extension) once; no segment, tool or body from a mirror; no held tool from a stage off the focus path; the applied ride is the current body's, and Look's and Edit's is the latest base ride of any acting stage, whatever the focus | `chainOrder` over depth ≤3 × hit × holder placement × focus × held tool; every body stack ≤3 × rides in each stage role; a sibling link's stage riding × every focus (`src/stage/chain-links.test.js`: every hit × focus × widget, every stack ≤3 × focus; the held tool across focus moves and the sibling's ride in `focus.test.js`) |
| I9 | **Extract and bundle.** Each is one host change and writes no other existing doc; `bundle(extract(S, K), K)` equals the original on every non-runtime field (render doc identity aside) when S has no edge outside; each edge outside is cleared where it lives and said | Every set of roots of a fixed 7-object, two-cluster scene with traits, refs of both kinds, a group, dimensions, a start on an object and a seats map × K ⊆ the root's three traits: 1016 cases, 116 exact over four classes (p the root or not, the link grouped or not, S one block of the order or spread), each exact one again with the host holding T's ids; every concurrent edit to what T was made from refuses the extract (`src/extract.test.js`) |
| I10 | **Selection, hover and keys.** Each stage sees its own element of a path or null; keys visit attention's path (the selection's, else the look's), innermost first, and every hint is computed by the same resolver | Every pair of paths of depth ≤3 × target × body × held tool |
| I11 | **Linearity.** Runtime state has at most one writable holder among reachable docs | Every sequence and every interleaving of ≤3 of link, pin, copy, extract, bundle on 3 docs with one bound object and one claim, merged on Automerge: 2696 (`src/linearity.test.js`) |
| I12 | **Presence where it is.** Every stage that acts or mirrors draws its doc's people, in its frame, by one instance of a part of every doc that no focus move or body restarts; a pin draws nobody; nobody draws this view; the body stays the focus's general part's (or where it lingers); the clock chips are the focus path's docs with a process, outermost first, each acting on its own doc and naming it as the trail does | Activation over every subset of six extensions (one of every doc among them) × four docs (`stage-pure.test.js`, 256); every focus over a tree with acting stages at depth 0–3, a sibling off the focus path, a mirror (with its links) and a pin × where the body is held (nowhere, each acting stage) × before and after letting it go, one other person present in each doc from a view of their own: who is drawn in which stage and in which stage's layer, which instance draws them, where the body part runs, the clocks and the chips' names (55 states, `src/stage/presence-where.test.js`); every chip pausing its own doc only; chip names after each link on the path is renamed; `scene.others` × focus × own selection over an acting link, a mirror and a pin (`select.test.js`); walk's two parts × every set of four kinds of peer (`walk/src/extension.test.js`); the real packages in `sailing/probes/links-run.mjs` 7b |
| I13 | **One world's ambients** (WATER.md W2, W4). Every stage's `api.ambient(name)` is the outermost stage's stacked value or null, the same frozen object to every caller, `mine` exactly at the outermost; an offer is copied into frozen plain JSON, and one that isn't (a function, a cycle, a handle, a Map, a non-finite number) is refused | Every link shape (alone, linked, mirrored, pinned, two deep) × the outermost offering {nothing, one extension, the other, both in running order} × every linked doc offering both × focus {outside, inside} × body {look, edit, walk}: values, identity, `mine` and the viewport's sky (`src/stage/ambients-stage.test.js`, 20 cases; mutation: each stage reading its own offer fails 16); every offer kind and every pair of running-order offers {nothing, null, A, B} (`src/stage/ambients.test.js`) |

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
   (the inspector's status line and its Source section read it). `"scene"` is
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
   *Done* after step 15 (Decisions, step 9): the three describe the code as
   it is, with no history in them. STAGE.md gained Closed link, Focus and
   Extract/Bundle in Words, the local state split into the stage's
   (`api.local`) and the viewer's (`api.view`), an api table for the view,
   links and surfaces, the input chain's segments across links, the ride's
   `tilt`, the seats convention as built (no `around`, no renaming `lay`)
   and the modules it lacked; DESIGN.md is the overview of views, stages,
   links, the focus, extract and bundle, bodies, the held tool and the
   clock, and the published examples; SCOPE.md went from a design note to
   the scope model as built (§2 still nearness, which code cites). The
   scene README gained Enter, Leave, Extract and Bundle; the package docs
   that still spoke of edit mode, Play or activities were fixed. The
   examples were republished by the integration after step 15.
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
    an audit (done: step 13, and the links loose ends). *Built:* the view expands the outermost doc's links whenever a
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
    Enter/Leave (14); the packages card showed the focus doc's asks only; a
    hidden link hid only its hint (its doc's stage still drew); "who's
    here" showed people at a linked placement as "look" to a viewer of the
    game alone (the body chip published on the focus doc's channel). All
    three closed in the links loose ends (Decisions, links loose ends).
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
    audited here. *Closed* in the links loose ends: `camera.object` went
    from the api, `axes.js` and `sea-view.js` read `camera.get()` (in the
    stage's frame, with `up`), `dimensions.js` reads through `scope.js`
    `contentMatrix`, and Camber's dressing (a layer group placed at
    `api.worldOf`) was right through the choke point and wrong only because
    the viewport overwrote the layer's matrix, which a layer anchor fixed
    (Decisions, links loose ends, 6). Not done here: Enter on a pin offering Follow latest
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
    closed link aren't entered); leaving is the view's (Escape, the trail);
    the view reaches any focus whose every link acts by leaves and enters
    (`focusSteps`). A link that goes, is pinned, stops acting there or is
    pointed at another doc leaves the focus out to the deepest stage still
    acting. The general parts are offered by the focus stage and no other
    (`host.setGeneral`); one holding something when the focus moves
    finishes it where it was (a walk goes on; a held Measure stays held
    while its stage is on the focus path). They are offered after every
    segment wherever the hit is, and the input path always ends at the focus,
    so outside an entered link verbs, carries, keys and the menu still work;
    Edit's click outside the focus was left to the chain (Decision 7 below;
    reversed since: Decisions, Edit's click is Edit's). The
    resolver and the menu take a segment per stage on the input path
    always, each stage's commands in its own context and run there (the
    "outermost is the caller's" assumption went; a held verb pins attention
    to its target's path: Decisions, links loose ends, 5); the toolbar holds the scene commands of
    the stages on the focus path (TOOLS.md §6), not the pointer's, so it
    doesn't change under the pointer (`api.path({ focus: true })`). A stage never sees the focus. `scene.focus`
    offers Enter on a link (menu, inspector; everyone's, every body) and
    takes a double-click on one; the outline's link rows say what the link
    is here (linked, shown again, fixed, closed) and enter (→, or a
    double-click); the inspector's Link row says the same, with
    what the host sets of it (the linked doc is its folded Linked scene
    section, whose Open shows it on its own). The trail, the view's own chrome
    along the top while the focus is inside a link, names the outermost doc
    and each link entered (each crumb a way out) and has Leave; Escape's
    last rung leaves. Drawer tabs open as the focus moved open again inside.
    *Proves* (`stage/focus.test.js`): H10 across docs over every reachable
    focus and selection × every press (Edit's click), Select (each stage's
    api), Enter, Leave and Escape, in a view of a host with a live link L to
    B (B linking C live), a mirror R of B, a pin P of B and a closed link:
    11 states × 37 events, each transition what the pure model says, the
    focus and every link on its way a stage that acts, each stage seeing
    its own element and never the focus (nothing it can read of the view
    changes on a focus move but its element of the selection, and it has
    no Leave and no `reopened`), the general parts in the focus stage
    alone, nothing written; a raw `select` fails it at the first
    transition. Every way a link can go while entered (removed, pinned, a
    link ahead of it, pointed at a doc open here or not yet found) × the
    focus at B or C; every body (Look, Edit, a general part's walk, a trait
    part's seat) × Enter, Enter deeper, Leave, Leave two: the body stays,
    the walk holding it isn't started again, nothing is offered twice; the
    held tool × six moves: held while its stage is on the focus path, else
    put down; a sibling link's ride applies whatever the focus (I8). In
    `stage/host.test.js`, the view's move over every sequence of ≤4 of in,
    out, busy, idle and a recheck (781): a general part stops only out and
    idle, offers only in, is kept if it comes back before stopping. Another view of the same scene
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
    draws entered; Escape leaves). Decisions, step 14, and its review
    fixes. Not done here: the
    clock chip shows the focus doc's only (TOOLS.md §6 wants a chip per doc
    on the focus path); walk's avatars of others (drawn by a general part
    from its stage's presence) are the focus doc's while you aren't walking
    yourself (Decisions, step 14 review, 1); "who's here" and the packages
    card, which had the same root, were made the view's in the links loose
    ends; out of focus isn't tinted; in Edit the first click of a
    double-click selects the link and opens the inspector, which narrows the
    canvas under the second click (the probe aims again; a person on a small
    part of a link may miss). *Fixed 2026-11-16* (Decisions, double-click):
    the second click resolves to the first press's hit.
15. **Extract and bundle** (I9, I11). *Built:* `src/extract.js`, as §8
    says: Extract on an object or group (S: it, what's attached under it
    and what's filed in it; its top objects share one parent p, else it's
    refused) writes T whole with ids kept, runtime state left behind and
    render docs copied with their builds, then the host in one change
    (`extractHost`): S goes, a link to T at p with no transform of its own,
    its hint S's box in p's frame, in the group S's outer members share,
    where S's first member was in the order; references into S cleared and
    said; a dimension with both ends on S goes to T, one with one end keeps
    it frozen; a start placed on S moves to T and the host starts through the
    link (step 16). Bundle on a link (`bundlePlan`) copies the doc it shows
    (a pin's value: what in it follows a doc, a link or a built object,
    fixed at the pin's deps, its render docs read as the pin holds them) in the link's
    place, ids kept unless taken, top objects at link · local under the
    link's parent and in its group, what hung on the link left where it is,
    and never writes that doc. K is the commands' `options` (STAGE.md "A
    command": the inspector's checkboxes, none ticked; the menu takes none).
    Both are `scene.transfer`'s, edit-only, one undo step, the host written
    once, computed from the host as it is when it's written (compare-and-set
    on everything T was made from: its footprint). *Proves*
    (`src/extract.test.js`, I9): every set of roots of a seven-object scene
    in two clusters (a table with a lamp and a card on it; a shelf with a
    crate and a wheel on it, filed in a group; a built object, both kinds of
    reference, a runtime trait field, a claim, a `copy: "drop"` field, two
    dimensions, a start on the crate, an order mixing the clusters) × every
    K over three root traits, 1016 cases, each run through the doer on a
    fake repo: refused exactly when the tops don't share a parent (584);
    otherwise the host written once and nothing else that existed, the new
    docs T and one render doc per built object, T and the host intra-doc
    (I2), T and what comes back holding no runtime state; each edge outside
    S (said independently of the code) cleared exactly where it now lives,
    with paste's notice, the link ungrouped where S's outer members differ,
    a dimension across frozen at its point, and no notice where nothing
    crossed (316); bundled back, the host written once more and T never;
    and where S has no edge outside (116: the whole scene 64, the table's
    or the shelf's cluster at the root spread through the order 32, the
    cargo group on the shelf as one block 16, the crate and wheel without
    their group, the link filed in it, 4) the host is the original on every
    field but runtime state and render doc identity, its order exact where
    S was one block, else S one block where its first member was; each of
    those 116 again with the host holding every id T has, every one coming
    back new and every reference following it. Extract's compare-and-set:
    eleven kinds of edit landing while T is made (a child attached under S,
    something filed in a group of S, a member edited, S's order, p, a
    dimension added with both or one end on S, one edited, the start moved
    onto or off S, a trait of K edited) each refuse it with nothing written,
    and four that touch nothing T was made from don't. Bundling a pin seeds
    the render doc as the pin holds it and fixes the built object at the
    pin's heads for its source (Decisions, step 15 review). I11
    (`src/linearity.test.js`): A, B and C on real Automerge, B holding a
    keeper-bound object with a claimed one under it; link A→B, pin A→B, link
    C→B, copy into A or C, extract, bundle in A or C; every sequence of up to
    three and every interleaving (a ‖ b, a ‖ b ‖ c, a ; (b ‖ c), (a ‖ b) ;
    c, a ‖ (b ; c)) over every ordered choice, 2696: at most one doc holds
    runtime state, and it is B. Dropping `cleanObject` from either direction
    fails a harness. Through the stage (`src/parts/transfer.test.js`): the
    view opens T where the link is, Undo puts the host back exactly, Bundle
    leaves the linked doc's bytes alone, the inspector's checkboxes run
    Extract with what's ticked. In Chrome: `sailing/probes/extract-run.mjs`
    (25/25): Lost Cities aboard, the card table and the game's link on it
    extracted into T, the game acting inside T (its stage's path the boat's
    link, then T's) with its cards drawn where they were (0 m), Undo and Redo,
    then Bundle: the boat back field for field, T unwritten, the game at its
    first path, its cards where they were. Decisions, step 15.
16. **Named frames and traversal**, when doom's exits or stations need them.
    *Decided, not built* (Decisions, step 16): neither needs them yet. The
    one workaround was arrival among linked docs, and it went with a start
    placed on a link (`startArrival`, `src/stage/view.js`), which names no
    place across a doc: the body is that doc's stage's or none
    (`src/stage/links-live.test.js`: a sibling game offering the same body,
    whether the named doc has none or is still starting, never takes it).

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
- **Run another doc's code for you.** Space crosses, and the world's
  ambients and world time cross as data (Decision 1); no doc's code runs
  for another.
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
   *Amended 2026-11-14, accepted by the lead on 2026-11-15 ("that's fine";
   [water/WATER.md](../water/WATER.md), Decisions 1, 39 and 43):* "...space,
   published frames, and the outermost doc's ambients and world time, as
   data." Nothing from a contained doc reaches its host, so the first
   sentence holds as written. Water a doc keeps as a thing (bounded water)
   crosses no link at all (WATER Decision 47).
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

## Decisions, final fixer after the next phase (2026-11-14, made unattended)

1. **The water work was merged and published before the lead's yes to
   Decision 1's amended sentence.** Recorded after the fact, here and as
   WATER Decisions 39. Reason: "kick those off" asked for the shared water
   package among the three next pieces, and a piece is checked only once
   it runs in the real Patchwork, which means publishing. The presence
   work, which needed no yes, came in on the same lane. Cost of a no now:
   revert f2ac0784's water, sailing and terrain parts and the ambients
   read path (2d738ae6, 94cfd4d0, with the atmosphere and arena moved onto
   it), republish Ship at sea, Lost Cities aboard, Fitting out and Cadboro
   Bay without the water trait, and take the Harbour out of the folder.
   This is the first of the lead's open questions. *Closed: the lead
   accepted the sentence on 2026-11-15 (Decision 1; WATER Decision 43).*
2. **A mirror trails a moving part by the playback delay, and that is kept
   as a known gap.** fitout-check's step 4 failed once at integration (the
   mirrored hatch 13 to 24 cm behind the acting one mid-slide). Run three
   times more on scene-stage it passed every time, the mirror behind by 3.6
   to 3.7 cm in every mid-slide sample and equal at rest. The hatch moves at
   0.5 m/s, and a mirror plays the acting stage's held pose back late by
   smooth.js's playout delay, 1.5 send intervals of 50 ms: 75 ms, 3.75 cm.
   Neither smooth.js (since 2026-11-05) nor the page bus in presence.js
   (since the morning of 2026-11-14, before the night's 11/11 pass) changed
   today, so the lag isn't new; the failed run's 270 to 500 ms is that
   delay plus a stalled headless page, which a check with 5 cm of tolerance
   catches when the page stalls. A mirror in the same view as its acting
   stage could draw the held pose without the delay (it needs no smoothing:
   no network between them), but that is a change to presence for the one
   case of a doc placed twice in one view, and it waits for a second
   consumer or the lead's word. fitout-check now also waits for the
   packages to run before step 1 (a run failed step 1 when the load prompt
   came after the stages were up). *Accepted by the lead on 2026-11-15
   ("it's fine"): the lag stays, and the same-view shortcut is not built.*

## Decisions, presence where it is (2026-11-14, made unattended)

1. **A part of every doc (`traits: ["*"]`), not a general part with a
   second entry point.** The first build gave a general part's module an
   optional `elsewhere(api)`, a "half" the host ran in every acting stage
   but the focus. Review found it a new lifecycle concept: a second set of
   records, a rule keeping half and whole apart that had to interlock with
   lingering, a stop and start on every focus move, and a module written
   in two halves by whether it is at the focus, which is close to what "no
   stage sees the focus" guards against. It also handed the half the drawn
   facet in a stage that acts, which blocks almost nothing there, so "a
   half only draws" was a convention. The fix is an activation rule that
   already had a precedent (`drops: ["*"]`): one line in `docReason` and
   one in `holdersFor`. What draws a doc's people is then an ordinary part
   of that doc, with an ordinary part's honest capabilities, which never
   depends on the focus, so there is nothing to keep apart and nothing to
   linger. The other options weighed: running every general part in every
   acting stage (it would draw the grid, axes and halo at every link,
   since no part can tell it isn't at the focus), and letting the focus
   part reach into the other stages (three new capabilities, and a
   lingering walk drawing its stage twice).
2. **Every stage that hears the doc's channel, not the focus path.** See
   TOOLS.md Decisions 8: the focus scopes the editor, never what the world
   shows.
3. **A mirror draws the people again.** The first build said a mirror draws
   nobody because it has no channel; that was wrong (only a pin has none: a
   mirror listens, and already plays back peers' carried cards). With a
   part of every doc a mirror draws its doc's people and selection boxes as
   it draws everything else of its doc. Keeping them out of mirrors would
   need the stage to tell a part it is a mirror, a special case for no
   reason anyone has given.
4. **A part of every doc may write, as any part of a doc may.** In an
   acting stage it gets the full api a trait part gets; neither consumer
   writes or speaks. Nothing claims it is drawn-only, so there is no
   restriction to keep true.
5. **The chips are fed by the view, acted on through readers.** The view
   gathers the focus path's clock statuses into `view.clocks` (general
   parts only), as it gathers every open doc's packages into
   `view.packages`, so the chip hears a change in any doc on the path; a
   reader's `clock` pauses and resumes its doc. Each entry carries the
   trail's name for its doc, and the view gathers them again whenever it
   draws the trail again (`showTrail`), so a renamed link renames its chip
   at once and the two never disagree. A chip shows its name only while the
   focus is inside a link.
6. **The chip's plumbing has one consumer, and is exempt.** `view.clocks`,
   a reader's `clock` and its `writable()` serve only `scene.clock`. The
   rule that a stage addition needs two consumers is there to keep a
   package's needs out of the stage; the world clock and its chip are both
   the stage's own (TOOLS.md §6 puts the world bar in the stage), so this
   is the stage talking to itself across docs, as `view.packages` is for
   the packages prompt. If a package ever reads them, that is the second
   consumer, and they stay as they are.
7. **Who's here is unchanged** (the focus doc's list): it already lists
   everyone with that doc open anywhere. One list per doc on the focus
   path, like the chips, is left for when it's asked for.

## Decisions, final fixer (2026-11-14, made unattended)

1. **An arrival whose body refuses is asked again** until `ARRIVE_WAIT_MS`
   after the offer (view.js `tryArrive`). A seat refusing at the moment it
   is offered (not yet laid) used to leave the viewer in Look for good.
   Consequence found by the stations probe: the maker of a table, after its
   template, is seated watching as its `view.start` says (TOOLS §2), which
   the old code skipped by accident.
2. **A press is where the look is** (router `onPointerDown` hands its hit to
   `onHover` before dispatching). Since step 14 the menu takes its sections
   from the look's path, and the look moved only on the next frame after a
   pointer move, so a right-click within a frame of moving, a touch long
   press (no hover at all) and every probe's right-click got the previous
   hover's menu or the scene's. Rejected: passing the press's hit to the
   menu through `api.path({ hit })`, which would give the path a second
   notion of where the pointer is; one look, updated by the press, keeps
   the use prompt, the keys and the menu on the same thing. Amended
   (2026-11-16, lane/n9, decided unattended, for the lead): a lock body
   under touch looks from its eye while a finger presses where it lands
   (TOOLS.md Decisions 14), so the menu reads the pointer's hit
   (`api.path({ pointer: true })`, a reader's `pointed()`): still not a
   second notion, the same hover the press sets, which the look is in
   every other pointer state.
3. **Leaving Edit puts the selection down; the toolbar is one row with no
   scrollbar; no tie rule for verbs beyond running order**: TOOLS.md
   Decisions 6 and 7.
4. **The mashup is Games night**: the Quiet games room and the Liar's dice
   table, both published, linked into a new doc by a generic publisher
   (`scene/probes/publish-links.mjs`: named links at positions, a start
   through one, one linked doc's display prefs). No code was written for
   it. Rejected for tonight: a harbour of two linked boats, because each
   boat's doc draws its own sea at the same height and the stage has no
   notion of a water surface (SCOPE §9 lists water height as not built);
   making one in `scene` would be sailing leaking into the stage. Recorded
   as NEXT PHASE (a water surface as its own package that boats find by
   trait). Also rejected: dice cups on the Lost Cities table, since since
   step 12 a game is its own doc and the Quiet games room already shows
   several games' docs in one room; Games night adds what it didn't: whole
   published scenes (one made before links existed) linked unchanged, and
   arrival two links deep.
5. **Fitting out lists each doc's own packages exactly** (S scene and
   sailing; F scene, joints, traversal; W scene and joints), checked in the
   page as "what the doc calls for equals what it states". A doc's packages
   list grows as parts are added and isn't pruned when they go (S, as the
   tools made it, still lists the companionway's joints and traversal):
   recorded as a stage gap, not fixed tonight (a prune would have to know
   which package each remaining object needs, the registry's question, and
   a doc edited while a package is missing must not lose it). Since fixed
   on both counts (Decisions, packages pruned).

## Decisions, step 9 (2026-11-14, made unattended)

1. **SCOPE.md is kept, as a reference.** It is the one place that answers
   "whose a press is" end to end (trait placement, nearness, the frame,
   across links), which STAGE.md spreads over three sections. Rewritten as
   the model as built, numbered so §2 is still nearness (chain.js and two
   tests cite it); what it once weighed is in git and in the build order.
   Section 11 above said it would shrink to nearness; it also keeps the
   frames and keys that follow from nearness.
2. **No doc deleted.** None of the six is stale or duplicated as a whole:
   DESIGN.md is the overview, STAGE.md the contract, SCOPE.md one question,
   README.md the tool for a person, and TOOLS.md and COMPOSITION.md the
   design notes whose history is their job (the build order's *Built*
   notes and the Decisions). History was cut from the first four instead.
3. **The local table split in two.** It listed the viewer's keys (body,
   held, selection…) under `api.local`, which since the view split is the
   stage's; the code has `api.view.get()` for those. STAGE.md now has one
   table each, with who changes what.
4. **Sailing's "in Play" blurbs went** (`sailing/src/index.js`, the sea's
   and the float's `describes`): there is no Play to be in. A string, but
   it ships, so sailing is rebuilt and synced with scene.
5. **No republish.** Nothing here changes a doc's shape.

## Decisions, integration (2026-11-14, made unattended)

Found while verifying the merged steps 13–15 in the real Patchwork.

1. **A package is loaded at the heads its folder settles on.** A doc found
   fresh is still catching up: in the real Patchwork, sailing's folder was
   found at an older version and reached its current heads 160 ms
   later. Loaded at the found heads (as the stage did since packages were
   first loaded), an old build ran against tonight's scene (`camera.object`
   is gone), every frame threw, and a game linked aboard never seated its
   arriving viewer (19 of 21 cold loads of the room arrived; the two that
   didn't went unlogged; each of the three failed boat arrivals traced with its
   page log had loaded an old sailing).
   The module watcher reloads a package when its folder changes; a scene
   loads once per page and its running extensions keep their module, so
   reloading would not fix them. Instead the load waits until the folder has
   gone `FOLDER_QUIET_MS` (500 ms) without a change, at most
   `PACKAGE_FIND_MS`, then pins those heads (packages.js `quiet`; STAGE.md
   "Packages"). Rejected: no pin at all (the entry and its chunks could then
   come from two versions). Cost: half a second on every package a viewer
   loads.

## Decisions, links loose ends (2026-11-14, made unattended)

The open items the links work (steps 10–15) left, closed on lane/compose.
Each is general: none knows a game, a boat or a seat.

1. **One packages prompt for every open doc.** Each stage still keeps its
   doc's list and loads for it; the *prompt* is the view's: `view.packages`
   is `unionPackages` over every open stage, acting or drawn (a pin's
   content needs its providers as much as a live doc's), outermost first,
   each URL once, asked about if any stage asks, else failed, else loading.
   Only general parts see it (`projectView`), as only they see the focus: a
   stage that read another doc's packages would depend on its placement
   (I4). `api.packages` is a general part's view-wide (Load and Not now go
   to every stage that asked) and any other extension's its own doc's, the
   same split as `api.collect`; and `api.path` (the other stages' readers,
   which carry the same information) is a general part's only (review fix
   1). "Not now" is the view's, for the view's life (review fix 2). *Why not a doc rule* (a host listing its
   links' packages): that was the stopgap; it made the host's list depend
   on what it links, and a linked doc's packages are already its own list.
   The publishers no longer list their games' packages for them (the boat:
   scene, sailing, tabletop, joints, traversal; the room: scene, tabletop,
   walk; publish-office checks the room lists no seats or keeper).
2. **A start placed on a link, for the boat too.** `publish-aboard.mjs` now
   writes `view.start = { place: <the game's link>, home }`, as the room
   does, instead of `{ body: "seat" }`: with one linked game path order was
   unambiguous, but naming the link says what is meant (arrive as the game
   starts people) and needs no rule about which stage offers "seat". The
   room's link-id renaming was retired at step 15.
3. **A hidden link hides its doc.** A link's content is its doc, so the
   roots of the stage it opens hang in the link's *body*, not its group
   (`viewport.setParent`: a parent of another stage, which only a link can
   be, takes the child in its body). Hiding the link then hides its doc by
   the rule that already hides any object's content, for drawing, picking
   and boxes; an attachment of the host's own stays shown, as before. The
   stage's world layers hang in an anchor that is drawn only while the
   link's content is (`contentShown`), and its labels likewise. *What
   doesn't change:* the stage still runs (claims, presence, its clock), and
   still loads its content: what it does is a function of its doc (I4), and
   hiding is the host's display choice, not a reason to close an
   occurrence. Its boxes (`api.box`, `groupBox`, `sceneBox`) are its own
   doc's say too: shown-in-its-stage stops at the stage's root (review fix
   7). Picking and rays stay the view's: they look at what is drawn, every
   stage's (`pick` and `raycast` already hit the host's geometry, "not
   mine" as id null), so a hidden link's doc isn't hit, as nothing hidden is. Removing a link moves its doc's roots out first (they
   outlive it until the stage closes, as attachments do).
4. **Who's here is the view's.** The viewer's body and held tool are the
   view's (its atom), so the view says them on every channel it acts on
   (`presence.announce`: top-level `body` and `held` in the presence
   message, beside `viewer`), not a part on the focus doc's. A viewer of G
   alone sees a sailor seated at G aboard as "Player 1", and entering a
   game no longer turns you into "look" for the host's viewers. A drawn
   stage's channel only listens, as before. The body chip reads `body`/
   `held` from presence and publishes nothing. *Why top-level fields and
   not a reserved extension key:* `viewer` is already the view's and sits
   there; a reserved key would be a name every extension must avoid.
5. **A held verb pins a path.** The pin is the target's full path (its
   stage's path, then its id), the same thing a selection is, so each stage
   on it sees its own element (`keyAttention` → `{ pinned }`;
   `api.path({ at })` gives the stages on it). Its target holds in its own
   doc wherever the look goes; a change to another doc is no reason to let
   go; it lets go when the target goes from its own doc, its link goes, or
   its extension stops there (checked whenever the key map's part updates
   and every frame while held, against the target's own stage:
   `reader.runs(ext)`, `reader.scene()`). *Why a path, not a stage number:*
   stage numbers are the view's bookkeeping and change when an occurrence
   closes and reopens; a path is what the selection already is.
6. **The frame audit.** No extension reads three.js's world matrices or
   holds the camera: `api.camera.object` is gone. `camera.get()` gives `up`
   (the picture's, rolled as the camera is) beside position and target, and
   the choke point turns it as a direction; the axes triad draws from it (so
   it shows the focus doc's axes: what's being edited), and the sea is
   drawn around the camera's position in its own stage's frame. Geometry
   inside an object is read through `scope.js` `contentMatrix(root, node)`
   (the dimension tool's surface gaps), invariant under every frame above
   the root; sailing's `hullTriangles` keeps its own copy of the same rule
   (packages don't import each other) and its own test of it. Camber's
   dressing (a group in its layer placed at `api.worldOf`) was already
   through the choke point and was wrong two links deep only because the
   viewport overwrote the layer group's matrix to follow the link; a world
   layer now hangs in an anchor the viewport owns, so the extension's
   matrix is its own. Camber's repo needed no change.
7. **Fix waits for what's on its way.** A link's fix point is null (Fix not
   offered yet) while a doc its docs name is still being found by a stage
   under it: a pin made then would leave that doc out of `deps` and show it
   live. `stageRepo` notes a find on its way as `null` in `reached`.
8. **Finite harnesses for I4, I5 and I8** (`placement.test.js`,
   `channels.test.js`, `chain-links.test.js`), the cases the invariants
   table names, each a fixed enumeration. I8's held tool across focus moves
   and the sibling link's ride were already enumerated in `focus.test.js`
   and weren't repeated.
9. **"Watching" aboard.** Getting up from the seat you arrived in comes
   back to Watching wherever seats are (the seat body without a seat), the
   boat and the room alike: lane/loose made that call and fix (seats,
   f1ecf3cb), general already, so nothing was done here.

Not done, and why:
- *Leaving Edit drops the selection* (decided on lane/loose, to do after
  step 14's merge): it changes TOOLS.md Decisions 6 and the probes lane/loose
  owns; left for the merge, where both lanes' tests can be run together.
- *The clock chip per doc on the focus path*, *walk's avatars of others
  from every channel*, *tinting out of focus*: new capabilities (TOOLS.md
  §6), not defects.
- *A closed link's hint can't be hovered or picked*: true of every object
  drawn only as its hint (loading, or no provider here), not of links;
  picking looks at content. Left as the general rule it is.

## Decisions, links loose ends review (2026-11-14, made unattended)

The review of the links loose ends found two design gaps and four places
the harnesses claimed more than they enumerated. Each fixed, with a test
that fails without it.

1. **`api.path` is a general part's only.** Decision 1's reason (a stage
   reading other docs would depend on its placement) held for
   `view.packages` but not for `api.path`, whose readers hand out other
   stages' scenes, packages, running sets and `run`. Now any other
   extension's `api.path` is undefined, as it never had a use for one: only
   the key map, the menu, the resolver and the toolbar call it, all
   general. *Why undefined rather than its own reader:* a stage extension
   already has its own scene, collect, context and look on its api; a
   one-element path would be a second spelling of those. Checked for an
   outermost stage's extension (`packages.test.js`) and for every G stage's,
   linked, mirrored and two links deep (`placement.test.js`).
2. **"Not now" is the view's.** The declined set moved from each stage's
   packages module to the view (`view.declinedPackages`, shared by every
   stage it opens), so a doc opened after the click (a link added, a
   relink, a mirror that comes to act, a pin unpinned) isn't asked about
   those URLs either, and a URL nobody declined still is. A stage
   extension's own `api.packages.dismiss` declines view-wide too: one
   viewer, one answer. `packages.test.js` "Not now holds for a doc opened
   after it".
3. **Who's here, on the manual clock.** `whos-here.test.js` runs both views
   on one `manualTime` and checks the host's chip every frame for a
   heartbeat and a send interval after Enter. The old 50 ms wall wait
   passed with the regression (the coalesced send arrives at frame 14);
   the new one fails on it (checked by making the view announce only on
   the focus stage).
4. **The I4 harness enumerates what the table says.** `seen()` now includes
   the doc's clock and the stage's `api.clock.running()`; a card-state
   factor (p2's card dealt, or played to the table) is added; the alone
   view, with no link to enter, is checked outside only (it was counted
   twice). 352 comparisons per seating, 1056 in all; G is a synthetic
   two-extension game shaped like Lost Cities', and the table says so.
5. **I5 crosses pages.** The third view (G in Y) is now on a second repo,
   joined to the first by an in-memory network (`fake-repo.js` `connect`:
   changes and ephemeral broadcasts cross, nothing echoes back), so what a
   view in one page and a view in another must agree on goes by the
   handle's broadcast, as in real Patchwork, beside the page bus within
   each page. Turning the network's broadcasts off fails the claims and
   holds cases. (The leave cases pass either way within the claim's grace,
   as designed: a claim is in the doc, presence only says it lapsed.)
6. **The boat's packages are checked, not asserted.** `aboard-probe.html`
   registers each package's plugins from its URL (`?urls=`, as
   office-probe does; sailing's plugin stub now keeps `importUrl` like
   tabletop's), and `publish-aboard.mjs` checks that what the boat calls
   for and lists is within its stated packages and names nothing of seats'
   or the keeper's, and that the game's is within the game's.
7. **A stage's boxes are its own doc's say.** See Decision 3, links loose
   ends: `isShown(entry, { inStage })` stops at the stage's root, and the
   scope's boxes ask for it; drawing, picking and rays keep the view's
   rule. `viewport.test.js` "a hidden link hides its doc" checks the in-stage
   box for each case, and that the linked doc hiding its own object does
   take its box away.

## Decisions, step 15 review (2026-11-14, made unattended)

The review of steps 15 and 16 found the build narrower than its proof in
four places and three small rough edges. Each is fixed; what was decided:

1. **Arriving through a link arrives in that doc's stage or nowhere.**
   `bodyDefs(caller, only)` reads only the linked doc's stage when the start
   came through a link, and `enterBody` enters only there. While that stage
   is starting or its packages may still come, arriving waits for it (with
   no deadline: the same wait as any arrival before its body is on offer,
   so a viewer slow on the package prompt still arrives); once it has
   settled without the body, nobody arrives. Why: the place is that doc's
   id, so entering a sibling's body with it is a reference across docs (I2)
   and makes arrival depend on which stage started first (I4). The
   reviewer's "give up after ARRIVE_WAIT_MS" was not taken: no other arrival
   gives up while its body may still come.
2. **Extract compares a footprint, not the records.** `footprint(doc,
   roots, K)` is everything an extract reads: S worked out again (so a child
   attached or a member filed meanwhile changes it), S's order, p, S's
   records, K's traits, every dimension with an end on S, and the start.
   The plan keeps it; `extractHost` recomputes it from the host as it is
   and writes nothing unless it's equal. Why: one value, so nothing T was
   made from can change unseen; the alternative, a check per hazard, is a
   list someone extends wrongly. Edits that touch none of it (an object
   outside S, a reference into S added from outside, which is cleared and
   said as any other) don't refuse it.
3. **I9's fixture has two clusters.** A table with a lamp and a card, and a
   shelf with a crate and a wheel filed in a group, in an order mixing them:
   so exact round trips exist with p not the root, with the link filed in a
   shared group, with S spread through the order and as one block, and
   every exact one is run again with the host holding T's ids. Each edge
   kind is checked at its field: the reference cleared where it now lives
   and paste's notice given, the link ungrouped, the dimension frozen.
   Mutating bundle's id map, the link's group, the order rule or the start's
   id mapping each fails the harness.
4. **One copy rule, as pieces; placement per operation.** `fixRefs` is gone:
   `copyRefs` (in `transfer.js`) is the rule for a copied object's
   references, and paste, extract and bundle all call it, after mapping
   every id first. Paste could only do that once `addObject` took an `id`
   (made with `newId` beforehand), which it now does; so no copy writes a
   reference twice. What stays in a doc when something leaves goes through
   the same rewriter (`refEdits`). Root traits are cleaned by the same
   `cleanTraits` as an object's. `planCopy` is not bundle's: it is paste's
   placement (landing at a point, a duplicate beside, through `addObject`),
   while extract keeps every transform and bundle composes with the link
   and writes one change. Why: §8's "planCopy gains `{ traits }`" would have
   put two placements paste never uses into paste's planner, and one copy
   rule is about what a copy is, which is now one code path.
5. **A pin's whole value comes with a bundle.** Anything in the pinned doc
   that follows a doc the pin holds (a link, or a built object whose source
   the pin holds) gets `at: { heads: deps[url], deps }`, the rule links
   already had, now not a special case; a file object gets none (its file
   never changes, and `at` means nothing there, as addObject has it). Each
   render doc is read through `pinnedRepo(repo, deps)`, the repo a pinned
   stage reads, so its copy is seeded with the pinned params and build.
6. **Bundle's options follow a live link.** The cache in transfer's local
   state stays (a command's state is synchronous), but for a live link it
   subscribes to the found handle and rewrites its entry when the root
   traits change, unsubscribing when transfer stops; a pin is read once.
7. **One fresh object record.** `ops.newObjectRecord` is the shape
   `addObject` and extract's link both write.
8. **A box can be asked for in an object's frame.** `api.box(id, { in })`
   boxes the object's own geometry within that object's displayed frame
   (the viewport's `within`, as a stage's frame already was), and extract
   asks for each object of S in p's frame; without a viewport, each hint
   box is carried there from its own frame. No box is boxed again.

## Decisions, step 16 (2026-11-14, made unattended)

Named frames and traversal (§9) were to be built "when doom's exits or
stations need them". Read against doom, traversal, sailing and the
published examples, nothing needs them, so step 16 is this decision.

1. **Named frames aren't built.** Precisely why:
   - **Doom's exits** lead to a map's start: E1M1's exit switch carries
     `traversal.exit.to` (the boat), and going there opens the boat as it
     starts people. A Doom exit always goes to the next map's player start,
     which is that map's `view.start`, so no exit lands anywhere a doc's own
     start doesn't.
   - **Stations** are objects of the ship's own doc, entered with their
     local id as the place. A station in a linked fit-out would be inert
     (step 13, decision 14), and worked example 2's station snapped to a
     fit-out's published winch has no consumer built: no fit-out publishes
     a frame, and carry doesn't snap across a link.
   - **The one workaround was about arrival, not names.** The Quiet games
     room renamed its links `link-1-lost-cities`… so that arriving, which
     takes the first acting stage offering the start body, would pick Lost
     Cities. That needed a way to say *which linked doc* you arrive in, not
     a place inside it by name.
2. **A start placed on a link arrives through it.** `view.start.place`
   naming one of the doc's links hands arrival to that doc: its own
   `view.start` (body and place), in its stage and only there, and on down
   where that place is a link in turn (`startArrival`, pure). The host's
   `body` isn't read then, and no other stage's body is entered: the place
   is that doc's id (step 15 review, 1). Through a pin, a mirror or a closed link nobody arrives (Look,
   nothing entered). Why: nothing crosses, the host names an object of its
   own and the linked doc its own place, so the game arrives people the same
   way alone and in the room (I4); and it composes, a room in a building
   arrives through two links. The games room's publisher now writes
   `{ place: <its Lost Cities link>, home }` and keeps the ids addObject
   made. Extract uses the same rule to keep a start that was on what it
   extracts (decisions, step 15, 9). Rejected: a body-and-stage pair in
   `view.start` (`{ body, in: link }`), which says the same with a second
   field and leaves the linked doc's own start unused.
3. **When named frames come, the name is not the URL's fragment.**
   traversal passes `to` as written, and `automerge:<id>#<heads>` already
   means a version, so `url#name` would collide with it. A consumer that
   needs a named landing gets its own field beside `to`. What would call for
   them: an exit to a place other than a doc's start (a teleporter pair
   across docs, a portal landing at a door), or a station snapped to a linked
   fit-out's fitting. Then: `frames: { name: localId }` on the root, the
   view's `go(url, name)`, carry snapping to a link's frames.

## Decisions, step 15 (2026-11-14, made unattended)

Made while building extract and bundle, with the project lead away.

1. **They are `scene.transfer`'s commands**, beside Copy and Paste. Why:
   §8 calls them one copy rule used in two directions, and transfer is
   where the copy rule's verbs live; a part of their own would be a second
   home for it.
2. **S is the selection's subtree.** The selection is one value, so the
   command extracts one target (an object, or a group with what's filed in
   it); the plans take any set of roots, and the harness runs every set.
   Why: no multiple selection exists to take a set from; when one does,
   nothing below the command changes.
3. **K is a command's `options`**, a set of values the inspector offers as
   checkboxes, none ticked, the button running with what's ticked; other
   surfaces run with none. Why: §8 asks for checkboxes, none ticked, nothing
   inferred, and the contract had a one-of (`choices`) but no set. Cost: an
   addition to the command contract whose two consumers are siblings. The
   ticks are the inspector's, per selection, never stored.
4. **Render docs are copied both ways**, seeded with their builds. Why: one
   copy rule (paste does so), and one render doc shown by two docs' stages
   would be built by both (step 13, decision 11). So I9 compares render
   docs by what they hold, not by url.
5. **The host's change is worked out when it's written**, from the host as
   it is then, after T and the render copies are made; extract writes
   nothing if anything T was made from changed meanwhile (its footprint:
   step 15 review, 2; T is left unlinked: an orphan, nothing lost), and
   bundle is planned again. Why: an edit to S
   while T was being written would otherwise be missing from T and deleted
   from the host.
6. **Extract doesn't call `beforeRemove`.** References into S are cleared
   by their descriptions, as paste clears them, and the doc's own maps are
   handled by extract itself. Why: nothing leaves the world, it moves; the
   one implementer (dimensions) would freeze measurements that move with S.
7. **Dimensions go with both their ends.** One with both ends on S goes to
   T (its points refreshed in T's frame); one with one end on S stays,
   that end frozen where it is, as removing the object does; bundle brings
   T's dimensions back, ids kept unless taken. Why: §2, a relation lives in
   the doc that holds both its ends.
8. **The link is filed in the group S's outer members share** (else none),
   and bundle files T's ungrouped objects in the link's group. Why: so a
   group S sat in comes back with it.
9. **A start placed on S moves to T**, the host starting people through the
   link (step 16, 2), and bundle puts T's start back, its place following
   its id, the host's home kept. Why: arriving keeps working across an
   extract, and it round-trips.
10. **T is a scene made new from the host's look**: the first root's name as
    its title (and the link's), the host's display prefs, its own start
    unless one moved (decision 9) the datatype's (Edit), its packages what
    reconcile would list for it here, the host's `"@patchwork"`. Why: T is
    a new doc someone will open to build; its look shouldn't change.
11. **Order.** The link goes where S's first member was; bundle puts T's
    order in the link's place. So the order round-trips exactly when S is
    one block of it, and otherwise S comes back as one block, every other
    relative order kept. Why: a link is one row; the alternative, spreading
    T's objects back to where they were, needs the host to remember T.
12. **A reference to p becomes null in T, and stays null coming back.**
    Why: §8 for the first; for the second, null in T is its root, which the
    host can't tell from a reference that was always null. A reference to p
    is an edge outside S.
13. **Bundling a pin copies its value**: what in it follows a doc the pin
    holds (a link, a built object) is copied fixed at the heads the pin held
    that doc at, and its render docs are read as the pin holds them (step 15
    review, 5). Why: a copy of a value is that
    value, not today's.
14. **Bundle is refused whole** for a ticked trait the host has ("This scene
    already has Seats") or the linked doc lacks. Why: an edit happens or it
    doesn't; §8's "refused per key" is which key the refusal names.
15. **Bundle's options are read from the linked doc**, found by url (and
    heads) and kept in transfer's own local state
    (`scene.transfer.linked`), so the surfaces ask again when they come; a
    live link's are followed as its doc changes (step 15 review, 6). Why: a command's state is synchronous, and the only way to
    the linked doc's root traits is to find it, which an extension may do by
    URL itself. Cost: the first time a link is selected its checkboxes come
    a moment later. A host still never reads into a link to decide anything.
16. **The aboard probe page passes a change's options through** to its
    handle. Why: without the patches the edit recorder never recorded
    anything there, so undo couldn't be probed on it.

## Decisions, step 14 (2026-11-14, made unattended)

Made while building Edit in context, with the project lead away.

1. **The general parts move with the focus by stopping and starting.** Every
   stage's host can run them; the view has the focus stage's alone do so
   (`host.setGeneral`). *Revised in review (below, 1):* in the stage left
   they stop by H2's busy half, not at once. Why: §3's "the view runs it
   once, at the focus" with the one mechanism that exists (start, stop);
   pointing a running part's api at another stage would be a second.
   Cost: the chrome is made again on Enter and Leave; what that loses is
   listed in the review decisions.
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
   and a held verb pins attention in the stage it was held in (to its
   target's path since: Decisions, links loose ends, 5). The toolbar
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
   step 13's 21 removed `api.role`. *Tightened in review (below, 3):* nor
   anything that moves with it.
6. **Selecting from any stage is cut at the focus.** `api.view.select` in a
   game's stage with the focus on the boat selects the link (it used to
   store the game's path). Why: H10 by construction, whoever asks.
7. *Reversed on 2026-11-16 (Decisions, Edit's click is Edit's): the click
   is Edit's and does nothing. The reversal confirmed by the lead
   2026-11-16, "fine for now".* **Edit's click outside the focus isn't Edit's**: it goes down the chain.
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
10. **Drawer tabs reopen where the focus went**: the view keeps the tabs'
    titles as the focus moved, and a general part asks
    `api.view.reopened(title)` as it starts (review, 3). Why: entering from
    the outline would otherwise close the outline it was entered from.
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
    a game aboard, the boat's follow should still carry the camera. *Revised
    in review (below, 4 and 5):* I8 and §4 now say "any acting stage", and
    only a general part counts a focus move as placing the camera.
14. **The clock chip and the packages card show the focus doc's**, being
    general parts. Deferred: TOOLS.md §6's chip per doc on the focus path,
    and every open doc's packages in one prompt (FOLLOWUPS). *The packages
    prompt is every open doc's since* (Decisions, links loose ends, 1).

## Decisions, step 14 review (2026-11-14, made unattended)

The review found that moving the general parts by stop-and-start threw away
what they held, and that the focus still showed through side doors.

1. **A general part the view moves away keeps H2's busy half.** In the
   stage left, one holding nothing stops at once; one holding a body, the
   held tool, an open session or a pose hold lingers there until it lets
   go, offering nothing (no commands, bodies, widgets or place in the
   chain: `host.offering()`), while the stage entered starts its own. Back
   in that stage before it stops, it is kept. A held tool still goes down
   when its stage leaves the focus path (§5), and that's done before the
   parts move, so its part then stops at once. Why: Enter is everyone's in
   every body (decision 12), and stopping walk, the general part whose body
   it is, dropped a walker to Look; a held Measure went down even on Enter
   deeper, where its stage stays on the focus path. H2 already says a busy
   part isn't torn down under someone; the view's move is one more cause of
   a stop, so it takes the same rule, but not the 2 s grace, which is for a
   peer's edit undone (a focus move isn't one, and the old chrome would
   show twice for 2 s). Rejected: (a) re-pointing a running part at the new
   focus stage (the review's option 3). A part's state is in its stage's
   terms: walk's pose is in its stage's frame, a held tool and a body are
   owned by a (stage, extension) key, `api.local` is the stage's, and its
   subscriptions are on its stage's doc and channel. Re-pointing would move
   all of these at once under the part, which can't be told without seeing
   the focus (decision 5). (b) Splitting general parts into view-wide ones
   (walk) and focus-following chrome (the review's option 2). That needs a
   second kind of general part, declared by a flag. No principle tells the
   kinds apart: a walk is a body, which any part may offer. The busy rule
   covers walk while it matters, when you're walking. *What a restart still
   loses*, for a part holding nothing: the DOM state of its chrome beyond
   which drawer tabs were open (scroll, a tab's own expansion); its
   `<ext>.*` keys in `api.local`, which are its stage's; and anything it
   draws from its stage's presence. So once you stop walking while
   entered, walk runs in the entered stage and draws that doc's walkers,
   not the host's (the same root as the who's-here chip's deferral). A
   busy part's docked tab stays with it until it stops. No shipped part
   both owns a tab and holds something.
2. **The focus is an occurrence, not a path.** When a stage on the focus
   path closes in a relink, the focus leaves to the level above it before
   anything reopens. So a link pointed at another doc counts as the link
   going (decision 8), whether or not the new doc is already open in this
   view. Why: before this, the focus stayed at the same path, in a
   different doc, with a selection naming an id of the old one.
3. **Nothing that moves with the focus is a stage's to read.** `reopen`
   left the view's value; the view keeps the titles, and only a general
   part's api has `view.reopened(title)`, answered once per title per move.
   `api.view.leave()` went: leaving is the view's (Escape, the trail), and
   no extension used it, while its false at the outermost told a stage
   whether the viewer had entered anything. Escape's last rung ("leave")
   shows to a stage's parts as no rung, and to the general parts as it is
   (the body chip says what Esc does). H10's harness now asserts that
   nothing a stage's part reads of the view changes on a focus move except
   its element of the selection. That check found the Escape rung, which
   the review had missed. Why: decision 5 means what it says; general parts
   are the view's own, and their api says so.
4. **I8 and §4 say what the code does: the latest base ride of any acting
   stage, whatever the focus.** Why: the focus scopes selection, not input
   (TOOLS.md §3), and the camera is the body's. Filtering rides by the
   focus path would stop a linked boat's follow while the viewer is at the
   room, and make where the camera goes depend on where you entered.
   Proved with a sibling link riding × every focus.
5. **A focus move counts as placing the camera only for the general
   parts.** A stage's part's `api.camera.touched()` is "moved by the viewer
   or restored as the view opened"; a general part's also counts "carried
   across a focus move" (`view.cameraCarried`), so `scene.autoframe`,
   started again in the stage entered, leaves the camera be. Why: the
   general parts are the view's own and are restarted by the move, so for
   them the camera really did come along. A stage's part must not learn of
   the move (decision 3): sailing's quarter view waits for a camera nobody
   placed. Tried and dropped: counting any extension's `camera.set` or
   `frame` as placing it. That removes the flag, but autoframe's
   provisional framing then counts, and sailing's quarter view never comes.

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

## Decisions, double-click (2026-11-16, made unattended in `lane/dblclick`)

The fix for triage N11 (WATER Decision 112), after its review.

1. **A press's hit and widget are resolved as it is pressed**, and kept
   with it (not the lazy event). Why: the first version stored the event
   and relied on the view's hover happening to read its hit at every
   press; any host whose hover didn't would have picked at dblclick time,
   with the camera and scene of then, and the miss came back silently. The
   cost is one pick and one widget pick per press, which the view's hover
   already pays for the hit. The router's laziness rule ("nothing is
   picked unless someone reads it") now has that one exception, and its
   test says so.
2. **The widget comes with the hit.** A dblclick's hit and widget are both
   the first press's, so the chain (`widgetWins` compares their distances)
   is decided at one moment, and a widget the first click brought up under
   the pointer (a selection's handles) doesn't take the double-click from
   the thing double-clicked. `x`, `y`, `ndc` and `ray` stay the dblclick's
   own; STAGE.md says so, and that `hit.point` is then off `ev.ray` and
   localised with a moving stage's frame of now (no consumer reads it).
3. **The gates measure between the clicks.** The second press within
   `DOUBLE_MS` (500 ms) of the first, the dblclick within `DOUBLE_MS` of the
   second, as an OS times a double, not from the first press. A touch press
   has 16 px (`DOUBLE_PX_TOUCH`), a mouse 6. The browser's own click count
   (`detail`) was not used: on `pointerdown` it isn't the click count in
   every browser, and the browser has already decided the dblclick is a
   double; the gates only check the router's last two presses are its two
   clicks. Outside them, or for a slower double, it casts a new ray as
   before, never another press's hit.
4. **Pointer lock on any of the three refuses the reuse.** Each press
   records whether it was locked: a locked press's hit is the centre ray's,
   never under the pointer, so a lock released between the clicks must not
   hand it to an unlocked dblclick.
5. **A first hit whose stage closed is cast again; one whose object went is
   kept.** The router asks the host (`live`); the view answers whether the
   key's stage is still open (an `n` is never reused, so a stage that
   closed and opened again between the clicks gives a dead key, and the
   same link is found by a new ray). A hit on an object the first click
   removed is kept, not cast again: the review expected it to come to
   nothing, and it does for a frame target, but from outside a link the
   card's element is the link, still there, so the double-click enters it
   (focus.test.js). A new ray there could land on whatever is behind it.
   A null first hit (empty sea) stays null: nothing was double-clicked.

## Decisions, double-click stamps (2026-11-16, made unattended in `lane/dblstamp`)

The gate's page time (the Still open item, now under Fixed since).

1. **The time gates read the events' own `timeStamp`.** Each press keeps
   its `pointerdown`'s stamp, and the dblclick brings its own; the two
   gaps (second press after the first, dblclick after the second) are
   taken between those. Why: a stamp is when the input happened, on one
   clock for every event of the page, so what the gate measures is what
   the browser measured when it decided the dblclick was a double. The
   stage's clock (`time.now()`) is when the router got round to the
   event: a page busy after the first click (the inspector opening, about
   1 s in headless Chrome) pushed a 200 ms double past 500 ms and the
   router refused it, and a page catching up on queued events would pass
   clicks made 600 ms apart. Both directions are in router.test.js, each
   time gate on and one past its bound with the page's clock saying the
   opposite; focus.test.js has the stage's clock a second on between the
   presses and the double-click still entering the link. The bounds (500
   ms, 6 px, 16 px for a touch), the lock gate and `live` are unchanged.
2. **No stamp on any of the three puts all three on the stage's clock.**
   A stamp is `timeStamp` when it is a finite number above 0 (`stampOf`);
   an event without one (a synthetic event, an old engine's 0) can't be
   placed on the stamps' clock, and the stage's `time.now()` is the epoch
   (or a manual source's), so comparing one against the other would be
   meaningless. Then every press and the dblclick are timed as handled, as
   before this change: never one clock against the other. Each press
   records both, so the choice is made at the dblclick, with all three in
   hand. Not chosen: refusing outright when a stamp is missing (a host
   test or tool dispatching plain events would lose double-clicks it has
   today), or the browser's `detail` click count (Decision 3 above).
3. **The dblclick is timed as its release** (2026-11-16, after the
   lane/bodyswitch merge's review; not in lane/dblstamp). Chrome stamps a
   `dblclick` when it dispatches it, not when the release that made it was
   made: in the real Patchwork (presence-check.nopause run 3, every press
   and release stamped as made), B's dblclicks were stamped 1518 and 835 ms
   after their second presses, while the pointerups that made them carried
   their inputs' stamps, 50 ms after. So a dblclick's own stamp is page
   time again, and Decision 1 cured only the first gap. The router now
   keeps the release after the last press and times the dblclick by it;
   the browser fires the dblclick from that release, in the same task, so
   its time is the dblclick's. A dblclick with no release heard after the
   last press (one dispatched alone) keeps its own stamp. The second gate
   now reads: the second click released within 500 ms of its press.
   router.test.js has the dblclick stamped a second after its release
   still resolving to the first press's hit (it failed before), held
   second clicks on and past the bound, unstamped releases, and no release
   heard.
4. **What it costs.** The gates read a clock the stage's injectable `time`
   source doesn't govern: happy-dom and Chrome stamp every event, so a test
   that drives the stage's manual clock no longer drives the gate unless it
   sets `timeStamp` (router.test.js does). Decision 2's fallback is reached
   only by an event whose `timeStamp` is 0, which no engine in use makes:
   in practice it serves tests (Waiting on the lead, above). A probe that
   drives Chrome over CDP must pass `timestamp` on each
   `Input.dispatchMouseEvent`: unstamped, Chrome stamps each event as it
   dispatches it, and an awaited dispatch waits out a busy page, so the
   stall lands in the stamp (presence-check run 1, B's third try: presses
   1023 ms apart by their stamps, 90 ms apart as sent). enter-check and
   presence-check.nopause plan their stamps from the first press since
   2026-11-16. Real OS input has not been checked by any run.

## Decisions, Edit's click is Edit's (2026-11-16, made unattended in `lane/bodyswitch`; 1 and 2 confirmed by the lead 2026-11-16)

Found by presence-check.nopause: in the real Patchwork, B entered Lost
Cities aboard's game G in Edit (a double-click), her world running, and
B's next single clicks selected nothing. B was in the Aboard body at the
helm. The click had gone `editInput.click` (`src/stage/view.js`) → "outside
the focus, not Edit's" → down the chain → the Card table's holder, the
boat's sailing part, whose click (`sailing/src/crew.js`, `input.click`)
comes aboard. Reproduced in `focus.test.js` and on local builds by
`sailing/probes/editclick-run.mjs` (Card table, another part of her, and
near-misses at cards on her moving table: all boarded before, none after).

1. **In Edit a click on something is Edit's wherever it lands.** At the
   focus it selects, as before; outside the focus it selects nothing
   (`selectionStep`'s "outside, nothing", unchanged) and goes no further.
   Only a click on nothing (or on what its doc no longer has) with nothing
   selected is still left to the chain. This reverses Decisions, step 14, 7
   ("isn't Edit's"), and narrows TOOLS Decisions 4 ("outside an entered
   link stays live") for Edit's click alone; both were the lead's to
   confirm, unattended, and the lead confirmed this on 2026-11-16 ("fine
   for now"). Why: TOOLS
   Decisions 6 (the lead's) is that in Edit a plain click selects before
   any package's click verb, "a click on the ship selects her rather than
   coming aboard", and that nothing stands on Edit; step 14's exception
   handed exactly that click to the ship again whenever the focus was
   inside something aboard her, and a verb that changes the body throws the
   editor out of Edit with no act of theirs but a missed click. The stage
   is the owner: a package can't tell (no stage sees the focus, and none
   asks whether the viewer is editing: STAGE.md, Bodies), so sailing's
   click is right as it is.
2. **What stays live outside the focus.** Presses (a carry, a drag), keys,
   the menu, the prompt and every verb on them still reach outside an
   entered link from Edit (TOOLS Decisions 4, "verbs aren't edits"); Look
   and every other body hand the click down the chain as before. Not
   chosen (unattended; confirmed by the lead 2026-11-16, "fine for now"):
   a click outside the focus
   clearing the selection (the selection model is unchanged, and a missed
   card should not drop what is selected), or leaving the focus out to
   where the click landed (a near miss would throw the editor out of the
   game). Tested over every base body (Look, Edit) × every focus (the
   scene, one link in, two) × a selection or none × every hit (each
   stage's objects, a mirror's, a pin's, a closed link; stale hits: an id
   each stage no longer has, a stage no longer there, a malformed key; and
   nothing): 264 cases, the click reaching the chain exactly in Look or on
   nothing (or a stale hit) with nothing selected, the selection as the
   model says, the body and focus unchanged; and a click verb that enters a
   body, as the boat's does, reached from Look and never from Edit at every
   focus.
3. **What the property is, and isn't.** It is about the click: in Edit no
   package's click verb is offered a click, after the held tool and a
   widget's owner (which take it first in every body, as before). It is not
   "nothing a missed pointer does leaves Edit": presses and the
   double-click still go down the chain in Edit, at the focus as much as
   outside it, because a press is a carry or a drag and the double-click
   is Enter and Frame (`scene.focus`, `scene.frame`), and a widget's owner
   still takes what it owns. No package in the tree changes the body on a
   press, a double-click or a widget (sailing, seats, walk and arena enter
   bodies only from a click, a command or a key), so nothing reaches the
   symptom by those today; a package that did would be wrong by TOOLS
   Decisions 6 (nothing stands on Edit), not something the stage would
   cut, since a carry out there is meant to work.

## Decisions, packages pruned (2026-11-16): decided unattended (2026-11-16, lane/n11), for the lead

The doc's packages list reconciles both ways (STAGE.md, "Packages";
`reconcileList`, `packagesToList`, `packagesToPrune`, `unansweredNeeds` and
`changeList` in `src/packages.js`). Both halves are a function of the doc and
the viewer's registry; the view remembers nothing.

1. **What may be taken off.** A listed package goes only when every need of
   the doc's is answered here, this viewer has the package registered, none
   of its registered plugins answers a need (the registry's question,
   `answeringPlugins`, with the providers render docs asked for), it isn't
   the scene package, and, while a render doc built here hasn't said which
   provider it names, it registers no source. So a package missing here
   (never installed, loading, failed, declined) is never dropped, nor one
   that answers a need: a doc edited while a package is missing keeps it.
   Tested over every case of (registered × answers × scene package × every
   need answered × render docs heard), for each kind of need (a source, a
   render doc's provider, a scene trait, an object trait): pruned iff (yes,
   no, no, yes, yes or not a source), 128 cases; and the fixed point over
   two packages in every state (listed not/once/twice × registered × a
   source or an extension × called for) with the scene package, render docs
   heard and a need nothing answers: 4608 cases, where one pass reaches
   `answering ∪ (listed ∩ (unregistered ∪ {scene} ∪ kept))` and the next
   writes nothing.
2. **Not before the registry has gone quiet.** Additions are made at once,
   as before; removals wait for `PACKAGE_SETTLE_MS`, as the prompt does.
   The unanswered-needs gate already holds a removal while a package the doc
   needs is still registering; the wait also keeps the list still while a
   viewer's own packages arrive.
3. **Parts and templates list nothing of their own.** The list used to keep
   the package of a part or template run in the view (the step 13 rule,
   written when the list only grew). That made the list a function of who
   had visited: the next viewer took it off and the one that ran it put it
   back. A part or template counts by what it makes, objects and traits,
   which are needs like any other; one whose result calls for nothing of its
   package leaves it unlisted. (The plan for this step had it as a fourth
   condition; the review dropped it.)
4. **A viewer who can't answer the whole doc takes nothing off.** Two
   viewers can hold different versions of one package URL. When the older
   lacks the plugin the doc calls for, that need goes unanswered there, and
   the older version's viewer prunes nothing (the listed package may be what
   answers it elsewhere). This replaces the first build's per-view memory
   (`relisted`: a view didn't take off again what someone else put back),
   which made the list depend on the view's history, didn't survive a
   reload, and left a stale package listed. Over the published examples (the
   folder, and every doc a live link reaches, against every package's built
   metadata) only Geometry showcase has a need nothing here answers
   (camber-hull-surface), so the gate costs nothing there today.
5. **Two packages registering one source id** both answer it, whichever the
   registry hands out, so viewers registering them in different orders
   agree (tested: both listed, one write).
6. **The render docs' providers.** A render doc may name a provider other
   than its object's field. Until every render doc built here has said
   (hidden or veiled objects never load theirs), no package registering a
   source is taken off. Tested in the stage: P listed for a hidden object's
   render doc stays while it is hidden, and is never off the list on the way
   to being called for once it shows; R, a source nothing calls for, goes
   then.
7. **Extensions of every doc** (`traits: ["*"]`, walk's people) answer no
   need: they run wherever they are installed, so a doc doesn't list them
   for having them. A package that wants a doc to bring it declares a trait
   the doc carries (walk's spawn point does). Late-bound references (an
   `infoToolId`, a tool by id) aren't needs either, and a package listed
   only for one is taken off.
8. **Concurrent prune and add.** One peer taking P off while another adds
   an object needing P ends with P listed for both, in every order of their
   passes around the merge (real Automerge merges, 4 orders).
9. **Publishers state exactly what each doc calls for.** `withPackages`
   (every `*/probes/scene-packages.mjs`, all copies the same) now sets the
   list to the stated packages, where it used to append them to what the
   page listed, and `packageProblems` checks equality, each once. The stated
   lists that said more are cut: publish-office's room (scene, walk) and its
   Santorini (scene, seats), publish-aboard's boat (no tabletop), and
   publish-table's Santorini (seats and a deck decide: no deck, no tabletop
   or card-table). publish-office, publish-aboard, publish-table and
   publish-fitout check on the page that the stage's answering packages are
   exactly those stated.
10. **Published examples.** Six lists shrink on a writable visit (worked out
    in node from each doc in the folder and every doc its live links reach,
    against every package's built plugin metadata): Santorini table, both
    copies (tabletop and card-table: its pieces carry only `scene.carry` and
    `seats`); Lost Cities aboard (tabletop: her game is a link that lists
    its own); Quiet games room (tabletop: its tables are links); Fitting
    out's boat (joints, traversal) and its hatch W (traversal, sailing:
    published with the old appending `withPackages`). By the no-back-compat
    rule they are republished from the fixed publishers and swapped in the
    folder by the integrator, before any check visits them writable.

Questions for the lead:
- The one disagreement left takes turns: P's versions differ on a trait
  another package answers on both viewers. Each is right by its own
  registry, so while both are open on different versions one takes P off
  and the other lists it again, until their versions meet (a test plays
  it: 20 writes in 10 rounds, none once the versions agree). Acceptable,
  or should something (a version on the entry, a hold on removals while
  another viewer is here) settle it?

## Decisions, connector frames (2026-11-16): decided unattended (2026-11-16, lane/n11), for the lead

The scene keeps a connector's whole frame (README "connectors", STAGE.md
`content(id)`; `sanitizeConnectors` and `placeConnector` in
`src/carry-rules.js`, used by `findSnapPoints` and `snapCandidates`). It
used to keep only the yaw, so Tabletop wrote its rack places' frames a
second time under the GLB's `extras["tabletop.slots"]`; that copy is gone.

1. **One source per connector.** A clean connector is `{ position, rotation,
   yaw, tags }`. With a `rotation`, `yaw` is derived from it
   (`yawOfEuler`), never taken from beside it, so the two can't disagree.
   Without one, the connector gives only a yaw (the older `snapPoints`), or
   nothing.
2. **The frame on a node is the connector's up and facing carried by the
   node** (`carryFrame`): the node's matrix with each column made unit (its
   scale's sizes left out, a mirror's sign kept) carries the connector's Y
   and Z as directions; Y is kept, Z is squared to it, and X = Y × Z. On an
   ordinary node (any scale, even uneven: a CAD export's stretch) that is
   exactly the node's rotation · the connector's. On a mirrored node (a
   negative scale; glTF allows it, and mirrored CAD parts use it) where the
   connector faces is mirrored but its frame stays a right-handed rotation,
   never inside out or upside down. Under a parent stretched unevenly (which
   skews a turned child's columns) it stays a rotation, its up as drawn.
   The result goes back to Euler XYZ by `decomposeMatrix`, which is now
   exact as a matrix everywhere, gimbal lock included: it used to give up
   part of the turn within about 4.5e-4 rad of y = ±π/2 (three's rule),
   which is exactly where a rack's standing places are on a rack turned a
   hair (a rack yawed 1e-4 lost its yaw). It now takes z from the first two
   columns turned back by x (Day's method), so whatever x comes out near the
   lock, the frame is kept; exactly on edge z is 0, as three's. It is one
   function, `eulerOfRotation`, that the presence smoothing's
   `eulerFromQuat` (`src/stage/smooth.js`) now uses too, so a peer's tile
   standing in a rack turned a hair is drawn turned while it glides.
   Tabletop's copy (`src/table/frame.js` `decompose`, used for every slot
   pose) has the same fix. The angles may be another triple for the same frame (the
   rack's [π/2, π/2, 0] comes back as itself).
3. **A yaw-only connector on a node** gets the yaw at which the node turns
   its facing (+Z turned by its yaw). On an upright node that is its yaw
   plus the node's, as before. On a node whose +Z is vertical the old rule
   added a yaw taken from a vector with no plan length, which is noise; the
   new one is defined and is null only when the facing itself goes vertical.
   A connector facing +Z on a node tilted about X faces straight down: null
   (the old sum gave 0). The table pins it (forms with yaw 0 and π/4).
4. **"Straight up" is within 1e-6** (`VERTICAL`), not 1e-9: a GLB stores
   32-bit floats, so a connector pointing up on a turned node comes out a
   few 1e-8 off vertical and would otherwise get a yaw from float noise.
   The table has a frame 5e-7 off straight up (no yaw) and one 2e-6 off (a
   yaw), and a GLB case whose float32 node leaves 6e-8 of noise.
5. **The hand's candidates carry the frame** (`snapCandidates` gives
   `rotation` in the carry's frame beside `world` and `yaw`), and the carry
   now lands a piece in it ("Decisions, landing" below). The candidate's yaw is the
   placed frame's: the same as before for every upright object, and
   correct, where the old sum wasn't, for a tilted one.
6. **No LOOK_VERSION bump in Tabletop.** A table GLB already drawn still
   carries `tabletop.slots` beside its connectors, and its connectors
   already carry the rotation (`connectorsOf` wrote it), so it reads the
   same; the leftover key is ignored. A golden test reads every built-in
   game's places both ways and finds them equal.
7. **Tabletop trusts the stage's frame** and keeps no Euler maths of its own
   for places: `slots.js` lost its `yawOfEuler` and `yawOfMatrix`, a place
   is `{ position, rotation, tags }` (a yaw-only connector as [0, yaw, 0]),
   and `worldSlots` gives `{ world, radius, local: { position, rotation } }`,
   no world yaw (nothing read it, and summing yaws is the rule the scene
   dropped). Its tests read GLB extras through a stand-in for the stage
   (`test/stand-ins.js` `stageExtras`) that writes each frame back through
   decompose as the stage does, so they see the triples real docs get; the
   golden compares frames as matrices. The seam with the real stage is the
   probes' (dominoes.mjs, table.mjs).
   So Tabletop now needs a scene that keeps the frame: syncing one without
   the other leaves rack places yaw-only (a drawn tile would lie flat).

## Decisions, landing (2026-11-16): decided unattended (2026-11-16, lane/n11), for the lead

A carry lands a piece in a connector's frame, and `landing()` can lay it
flat (STAGE.md "Landing"; `landedPose`, `layFlat` in
`src/parts/carry-math.js`; `sideOf`, `faceOf`, `intoFrame`, `intoSnap` in
`src/carry-rules.js`). This retires the stage gap "`landing()` can only say
faceUp", Tabletop's README "Not yet" item 1 and the U-then-carry dance: a
domino carried out of its rack goes down flat in one move, and one carried
into a rack's place stands there.

1. **The landed pose is a pure function** of how the piece is held (as
   picked up, with every Q/E and F since: `own`), the snap (frame, yaw or
   none) and the merged answer. The carry keeps `own` and derives what it
   shows from it on every move. With no snap and no answer that is `own`
   exactly, so every carry today that meets no snap and no rule is
   unchanged. The 48-case table (start {flat up, flat down, standing facing
   +Z, standing facing −X} × answer {none, faceUp, flat, both} × snap {none,
   yaw-only, framed standing}) is worked out by hand and run twice, on
   `landedPose` and through `createCarry`; the old carry fails 26 of the
   carry rows, every one with a frame or an answer that changes the pose.
   Beside it: 36 leaning and tilted frames, a yaw that the table can tell
   from the start's own (start 0.3, connector 1.0), a mirrored piece, a
   piece whose length is straight up, and where `landing` is asked.
2. **A snap's turn no longer sticks** (a behaviour change; a question for
   the lead). The old carry turned its own pose to a connector's yaw and
   kept it after the pointer left (the face-up turn it already undid). Now
   leaving a snap gives back the pose as held, as the face-up rule always
   did, so what lands never depends on which snaps the pointer crossed on
   the way. The cost: Q/E over a snap turns what is held out of sight (the
   connector's turn wins while over it), and the turns show once it
   leaves; a card carried across a tray slot and on to the felt keeps its
   held heading, not the slot's.
3. **Order: flat, then faceUp, then the snap.** Flat before faceUp is
   pinned by a piece thinnest across and held face down: laid on its side,
   its face is no longer down, so faceUp leaves it (faceUp first would
   turn it over, a flip that shows). Flat before a frame matters only for
   a frame that lies face down, where a standing piece then goes in face
   up. A yaw sets the heading of the piece's length as 1 and 2 left it; a
   piece whose length is within `VERTICAL` (1e-6) of straight up faces no
   way and is left as it is (before, noise gave it a heading).
4. **Up, down or on edge is one test, by the most upright axis**
   (`sideOf`): an axis lies up or down when it is the most upright of the
   three (a tie goes to it), else on an edge or an end. It decides a
   piece's face (`faceOf`), a frame's (does it stand the piece?) and which
   way `flat` lays an axis down, and it is Tabletop's Stand on edge test
   (45°). It compares axes, never one against a tolerance: the first
   build's "level within 1e-6" (`LEVEL`) made a rack leaning 1e-5 a tray,
   so a face-down tile went in facing away from its player. That constant
   is gone. Into a frame that lays a piece flat, it goes face up or face
   down as it is (or as faceUp asks): the frame, or the frame turned over
   about its own length. A frame that stands it says alone which way it
   faces. A flat frame with a face-down card is exactly today's yaw turn.
5. **faceUp turns over only a face that points down** (a behaviour
   change; a question for the lead). The old rule turned over anything not
   face up, so a standing piece asked faceUp spun about its length to face
   the other way. Now a piece on an edge is left alone (flat lays it; a
   frame stands it).
6. **`flat` means the broadest face down**: the thinnest body axis (box ×
   the piece's scale) upright by the smallest turn about a level axis; of
   axes equally thin, the most upright already, then Y, X, Z, so it is the
   identity on a piece lying flat. The axis keeps up or down (`sideOf`);
   on an edge or an end it goes up, as Lay flat does. Its length keeps its
   heading wherever it was level.
7. **F turns over what you see.** `own` becomes the shown pose (after flat
   and faceUp) turned over, so F over a tile laid flat by the rule leaves
   it face down, and F over a card a hand turned face up leaves it face
   down (the old carry did the same by turning `state.W`). After F, faceUp
   is no longer heeded (unchanged) but `flat` still is: `landing` is asked
   on every move now, not only while faceUp could matter, which also gives
   the bag its answer after a flip.
8. **A turn over is shown when what shows turns over.** The carry keeps
   which way up the shown pose is (F's turns and the faceUp turn, odd or
   even) and the last way it showed; in a frame that stands the piece it
   doesn't show. So F in a rack's place shows nothing, and the piece turns
   in the air as it leaves; F twice there shows nothing at all.
9. **Paste and the parts bin take the snap's turn** (step 3 only: flat and
   faceUp are the carry's). A part goes into a connector's frame as the
   frame gives it. A copy with one top-level object is turned by the same
   `intoSnap` as the carry (`moveBy`), so there is one rule, not a copy of
   it; several take only the yaw, since a frame for a handful has no
   meaning. Where a copy goes on a connector is decided by what it is,
   not by how the connector is written (the first build rested a copy only
   going into a frame, so a frame and a yaw for the same flat place pasted
   differently): a carried piece (`scene.carry`) copied alone with a load
   hint rests on any connector it snaps to as the carry rests it
   (`restOnConnector`: footprint middle over the connector, underside at
   its height; the carry's rays find the surface, the copy uses the
   connector's height), and anything else keeps the parts bin's rule, its
   origin at the connector, which a part's connector (a mast step) is made
   for. Paste's
   drop on an object row (`on`) and at the pointer (`at`) answer through
   the same `partLanding`, so a frame facing straight up gives no yaw in
   both (`on` used to fall back to the parent's heading).
10. **Tabletop answers `flat: true` for a domino taken out of a hand**
   (`canStand`, and where the doc still has it, since a carry writes only
   where it ends, lies in a hand: a rack's), plus faceUp in your own hand
   as before. Taken out of a hand it is being played: it goes down flat,
   face up, as playing it does (or face down with F). Anything else goes
   down as carried, so a tile standing on the felt in front of its player
   (no rack: theirs alone, visibility.js `facing`) stays standing and
   hidden when moved; the first build answered flat wherever a domino was
   carried, which laid such a tile face up for everyone on any nudge. A
   rack's place stands a tile by its frame, so `landing` needs no
   knowledge of slots. Options for the lead: (a) this; (b) flat for every
   domino, a standing one tipping onto its face (face down; playing is F);
   (c) flat everywhere, face up, accepting the reveal.
11. **The answer shape is `{ faceUp?, flat? }`**, flat meaning "on the
   broadest face". Standing comes from a connector's frame, not from
   `landing`. A general `up` axis in the piece's body frame is the
   alternative: a question for the lead.
12. **A yaw-only connector is a frame with its tilt left free** (stated,
   not changed; a question for the lead). Into a whole frame a piece takes
   the frame's tilt (a tilted piece put on a flat tray place lies flat); a
   connector with only a yaw (`{ position, yaw }`, or the older
   `extras.snapPoints`) turns it about the vertical and keeps its tilt. So
   one place written two ways lands a tilted piece two ways. Under the
   no-back-compat rule the older forms could go (every connector a whole
   frame, a yaw written as [0, yaw, 0]); they are kept here because that
   changes the GLB contract (README "connectors") for every package that
   writes one, which is the lead's call.


## Decisions, how a carry ends (2026-11-17): decided unattended (2026-11-17, lane/n11), for the lead

A carry session says how it ended, and the carry tells what it put down
and on what (STAGE.md "How a carry ends"; `src/parts/carry.js`). This
retires bag README's "What the stage lacks" rows "this was put down on me"
and "is my own carry still holding this?".

1. **`ended` is a promise of `{ how, on }`**, one of four outcomes: put,
   back, yielded, refused. Every session settles it exactly once, whatever
   ends it (end, cancel, a newer carry, the part stopping, a peer's hold,
   a refused hold, the object gone). A promise rather than a callback in
   `opts`, so whoever holds the session can ask, and a session already over
   answers on the next microtask. The outcome names the cause, not the code
   path that ended it: a refused hold with a peer's ahead (`heldBy`) is
   "yielded", wherever it was refused (fixed in review). "put" means
   written: a stage read-only at the put ends it "back".
2. **`landed(id, on)` is an event, not a claim**: after the put's write,
   once per running extension, on the carrier's client only. Nothing is
   ordered and nothing can refuse it; who may refuse a drop is drop claims,
   N15's, the lead's. A rule that throws is warned of and the rest hear.
3. **A peer's hold gives the carry way at the stage's `update`**, the flush
   that shows the hold, not the pointer's next move, so `ended` says
   "yielded" while the pointer is still. The bag stopped watching for that
   hold itself. The object removed ends it "back" at the same `update`.
   **Question for the lead:** the carry learns of the loss twice (it polls
   `heldBy` at each `update`, and its next `pose.hold` is refused), though
   the stage knows the moment it drops a hold (holds.js `lost`, used only
   for bookkeeping). Should holds tell their holder (a refusal that says its
   cause, or a `lost` the holder hears)? That would retire the poll and the
   `update` hook; it changes the scene contract, so it waits for you.
4. **No new query for one's own hold.** `pose.hold`'s boolean says whether
   it stands, `ended` how it ended; `heldBy` stays "the peer ahead of this
   view".
5. **A drop into a bag is still two changes** (the put, then the bag's
   removal), so undo takes two steps. One change would need the put to be
   offered to rules before its write, which is a drop claim: a question
   for the lead, tied to N15.

## Decisions, templates take parameters (2026-11-17): decided unattended (2026-11-17, lane/n11), for the lead

A `scene:template` may declare `params` (ParamSpecs), drawn as a form under
its button on the start screen; `api.template(id, params)` runs
`create(ctx, params)` (STAGE.md "Templates"). Tabletop's three Draw Dominoes
templates are one, `tabletop.dominoes`, with `players` 2, 3 or 4. This
retires the stage gap "templates take no parameters (one template per
count)".

1. **The params are ParamSpecs, the kinds every other form here uses**
   (`src/param-form.js`; an `enum` for a choice of counts). No new kind,
   and the start screen draws the form from metadata alone, so nothing is
   loaded to offer a template, as before.
2. **The stage coerces, not the form.** `api.template` hands create
   exactly its declared params: coerced to each spec, the default where a
   value is missing or can't be, every other key dropped (`paramsBySpec`,
   which is `effectiveParams` without the pass-through of unknown keys). A
   render's params keep unknown keys because a doc outlives its provider's
   metadata; a template runs once, so there's nothing to keep. Any caller
   (the start screen, another tool, an agent) gets the same guarantee, and
   a template trusts its params as `build()` trusts its own.
3. **A template that declares none gets `{}`** and is offered as the same
   bare button, so it runs as before. One shape for every template, rather
   than calling create with one argument or two.
4. **What's chosen is the view's until it runs**, and survives the list
   being drawn again when another package registers a template (the start
   screen keeps each template's values by id). It isn't written anywhere:
   the template writes what it made of it.
5. **Tabletop's games stay one per count, as data** (`draw-dominoes-2/3/4`,
   GAME-FORMAT's shape); only the template is one. Its `game` maps
   `players` to the game's id. The parts bin keeps its three Draw Dominoes
   parts: a part takes no params. **Question for the lead:** should
   `scene:part` take `params` the same way (the bin drawing a form, or the
   part asking after it lands)? Not built: the bin is a drag, and where its
   form would go is your call.
6. No published example records which template made it (a template writes
   a table, not its own id), so none needs republishing; the Draw Dominoes
   (2 players) table in the examples folder is unchanged.

## Decisions, telling is the stage's (2026-11-17): decided unattended (2026-11-17, lane/n11), for the lead

An extension declares `messages: { [type]: { valid(data), says(data, who,
scene) } }` and calls `api.tell(type, data)`; the stage says it here as
"You", sends it, and on each peer drops it unless valid, asks `says` at once
and after every update until it answers text or `TELL_MS` (3000 ms, stage
time) has passed, tells it once and forgets it (STAGE.md "Telling",
`stage/telling.js`). Dice (turned), the cup (peeked, lifted), tabletop
(shuffled, drew, washed, showed), bag (drew, put, emptied, poured, looked)
and seats (sat) tell this way; arena's shot is drawn, not said, and stays
`receive`'s. Retired: dice's MESSAGES, heard, waiting and TRUST_MS, the
cup's waiting, settleWaiting and TRUST_MS, tabletop's and bag's announce,
told and shape checks, bag's contact lookup and NAME_MS, seats' told. This
retires the stage gap "api.send is unverifiable: the bookkeeping is copied
between packages".

1. **`who` is `{ viewer, name, mine }`, not a name alone** (the plan had a
   name). The cup's evidence for "peeked" is that the speaker holds the cup
   down, which needs who they are, not what they're called; `mine` (this
   view told it) because another tab of the same viewer is a peer, so
   `viewer` can't say it ("Ana lifted their own cup", not "your own").
2. **The stage names the speaker: their contact's name, else "Someone";
   a package that knows better may say better.** Seats already contributes
   that better name: the roster's `who(viewer)` (contact, else the seat
   they sit in, else "Someone"; seats/README.md). The cup's HUD and
   tabletop's notices used it before this step, so the cup and tabletop
   still call a peer by `roster.who(who.viewer)` where a roster runs, and
   by `who.name` where none does; one viewer is then "North" in the cup's
   HUD and in its notices alike. Dice, bag and seats' own "sat" use
   `who.name`. (Review, 2026-11-17: the first cut dropped the roster and
   made a contactless "North" "Someone".) **Question for the lead:** two
   lookups of one contact name remain, the stage's and `roster.who`'s.
   Should the stage's be the one name, `roster.who` deferring to it for
   the contact and adding only the seat; or should the stage ask whoever
   contributes a name (`roster.who` itself) before "Someone", so no package
   picks; or is a package choosing its own name, as now, right?
3. **`says` waits for the name**: not asked about a speaker whose contact
   is still being looked up until it comes or `NAME_MS` (1000 ms) passes, so
   the first word from someone is told by name (the bag waited the same
   way; dice and tabletop said "Someone" until the name came).
4. **One's own goes through the same rule**, asked at once and on this
   stage's updates, so a local `says` that needs the doc to have caught up
   (dice) waits for it as a peer's does. Every tell is said here too.
   Changes: tabletop's "Shuffling 44 cards…" and "Washing 6 dominoes…" are
   now "You shuffled “Deck” (44)" and "You washed “Deck” (6)"; the cup's
   own peek and lift are said to their maker ("You peeked under your cup.",
   "You lifted Alice's cup."), where before they were told only to the
   others. **Question for the lead:** is a notice for your own peek noise?
   `says` could answer null for one's own, but then null would mean "not
   worth saying" as well as "not borne out", and the rule is simpler with
   one meaning.
5. **A die's evidence keeps its own clock** (`MOVED_MS`, 3000 ms: how
   recently the doc must have moved the die), since the move may arrive
   before the word, which the stage's window (from the word's arrival)
   doesn't cover.
6. **Tabletop's and bag's `says` answer at once** (the bag: once every bag
   named is in this scene), as planned, so they are told unchecked. For
   tabletop's `shuffled` and the bag's contents that is all there is: the
   change is in another document (a keeper's deck, a bag's) the scene
   doesn't carry. But tabletop's `drew`, `washed` and `showed` do write the
   scene (a card into a hand, a pile's cards moved, cards turned), and are
   told on arrival anyway, before or without that change: their data is
   counts only, never which card (who drew what is hidden), so nothing in
   it names what in the doc to wait for. (Review, 2026-11-17: the first
   wording said none of tabletop's wrote the scene.) **Question for the
   lead:** hold them to the doc too, by sending the ids moved (an id says
   no face, but does say which card went to whose hand) or by evidence
   like the die's (a card of that noun moved lately into the speaker's
   hand), or leave them vouched for?
7. **A view that can't write the doc tells nothing** (`tell` is a no-op
   where `writable()` is false), as `send` reaches no one from a read-only
   stage.
8. **Packages' fake stages copy `telling.js` whole** (`test/telling.js` in
   dice, tabletop, bag and seats), so their tests run the stage's own rule;
   packages stand alone, so it is a copy, not an import. Each copy's first
   line names the scene commit it was taken from, so drift shows in a
   `git diff` of scene's since then.
9. **A waiting message is forgotten by its own timer** at `TELL_MS`, not
   when something next asks it, so a quiet doc holds nothing past its time
   and a chatty peer can't grow what waits (review, 2026-11-17: the first
   cut kept it until the next update). The window is half-open, `[arrival,
   arrival + TELL_MS)`, the same for the timer and for asking.
10. **Data is an object, checked by the stage** before `valid`: every
   package's `valid` began with the same guard, so it is said once.

## Decisions, the use prompt and the eye (2026-11-17): decided unattended (2026-11-17, lane/n11), for the lead

The use prompt (`src/parts/use.js`) follows the pointer over the world and
holds still while the pointer is on it, so a button can be reached. It now
holds still only under the eye the pointer went onto it under. Invariant:
a press reaches a prompt button only if the eye hasn't moved since the
pointer reached that button. Pinned by use.test.js, "the eye moves: back
under the pointer" (pointer off the prompt or on it × nothing, an orbit's
end, a ride's frame, a Frame's frames, Edit entered, Look entered, a
selection change = 14 cases; against the old use.js the 5 eye moves leave
it held, 7 fail).

1. **The eye is the body and the camera**, compared as a value: the top
   body's id and `api.camera.get()` (the stage's frame, so a stage moving
   under the eye counts as the eye moving: what is under the pointer moved
   either way). The plan named `api.camera.watch`, but that fires only when
   the fov changes, so it can't see an orbit, a ride or a Frame. No stage
   API was added: every move of the eye is drawn, so the prompt asks on
   every frame drawn (`api.afterRender`), and only while it is held (the
   hook goes with the hold); the view's update and an orbit's end ask too,
   through `place`.
2. **A body entered or left lets go** even if the camera stays (Edit from
   Look): it is another eye, and Edit brings its halo, which is what a
   press at the pointer should reach.
3. **A selection change doesn't let go**: the eye hasn't moved, so what is
   under the pointer is what it was, the prompt's button included.
4. **The pointer is tracked over the prompt only.** Over another part's
   overlay (the touch pad, the body chip) it is still ignored, as before:
   nobody looks there. The pointer leaving the view lets go too.
5. **Let go means back under the pointer, 36 px below it** (use.css), so
   the pointer is no longer on the prompt; a still pointer stays off it
   until it moves onto it again, which holds it anew.

## Decisions, N7 (decided unattended (2026-11-16, lane/n7), for the lead)

N7 is mashups: published docs linked unchanged into a new doc, with no
stage code. The first candidate was E1M1 on the Cadboro Bay shore, gated on
an unlisted scratch doc, *E1M1 at Cadboro Bay (scratch)*
(automerge:25Zpxs48qfj7ZaNAaapmwWFvLZCv): Cadboro Bay's link at the origin,
E1M1's on the Gyro Park lawn, the start on E1M1's link. It was checked in
the real Patchwork by the lane's `shore-check` (kept with its publish
scripts, outside git; each run's results are kept). The figures below are
its run of 18:37 UTC, 2026-11-16 (8/11: rows 3 and 10 fail by design, they are
the finding; row 6 failed to a stale package, 6 below).

1. **Finding: a place handed across docs to a body.** *A question for the
   lead, not a decision.* A body's `enter(place)` takes an object id and
   reads it in the body's own doc (TOOLS.md, "A place is not a type";
   seats' `enter`, sailing's station, `walk/src/body.js` `enter`). TOOLS.md
   says `enter` runs in the stage that called `api.body.enter(id, place)`,
   but `view.enterBody` finds the body wherever it is offered, and a
   general body (walk: its plugin has no traits, `walk/src/index.js`) is
   offered only by the focus stage (§3; `src/stage/host.js` `offering`).
   So when stage S hands a place to a body offered by stage T ≠ S, T reads
   S's id in its own doc. Two consumers hit it today:
   - **Arrival through a link.** E1M1 starts people with `{ body: "walk",
     place: <its spawn> }`. A start on a link hands arrival to the linked
     doc, in its stage and only there (Decisions, step 16, 2; step 15
     review, 1: `tryArrive`, `const only = at.through`), and walk isn't
     offered there, so nobody arrives. shore-check 9 reads the cause rather
     than narrating it: the mashup starts on link 2 with no body, E1M1's
     start is walk at its spawn, walk runs in the focus stage and not in
     E1M1's, E1M1's host has settled, arrival gave up and the body is
     Look (it passes). Row 11 is the control: E1M1 alone arrives walking at
     its spawn (its feet 0.05 m over it, 77 s after the page opened). So a doc that starts people in a general body
     starts them differently alone and linked, against the reason
     Decisions, step 16, 2 gives.
   - **Walk from here on a linked spawn.** walk.spawn runs in E1M1's stage
     (a trait part) and its verb calls `api.body.enter("walk", <spawn>)`.
     The view finds the focus's walk, which looks the spawn up in the
     mashup's scene, doesn't find it, and starts at the camera's eye (or
     over the middle of the whole scene's box), with no notice, since the
     enter succeeded (shore-check 10: the walker started 40.2 m from the spawn, under the camera, no notice). Were the ids to collide (a
     bundle's extracted copy holds its source's ids), it would start at an
     unrelated object. walk's `spawns()` reads the focus doc only too, so
     its "else any spawn" never sees a linked level's.

   The options, for the lead, as one rule for both consumers:
   - (a) **The calling stage resolves the place to a pose in the world**
     (frames cross, references don't: §9 has the view answer a link's
     connectors in the host's frame). Then a start through a link also
     offers the focus's general bodies. The price: the body contract
     changes for every body. A seat or a station needs its id (the place
     *is* the seat), so `enter` would take the id for its own doc and a
     world pose for another's, and the view would have to know which is
     which. That is a TOOLS change touching seats, sailing and walk, not
     a line in `tryArrive`.
   - (b) **Arriving through a link moves the focus there** (an Enter), so
     the general parts run in that stage and the place is local. It covers
     arrival only; Walk from here on a linked spawn still crosses.
   - (c) **Refuse**: an enter whose place isn't of the body's own doc
     fails, so the verb says "Couldn't walk from there" instead of
     starting somewhere else, and a linked doc that starts people walking
     isn't started so. The gap stays, but visibly.

   Not taken: the publisher writing `{ body: "walk", home: <the spawn's
   eye> }` on the mashup itself. walk would start at the eye, which a
   returning viewer's saved camera replaces; that hides the gap. (The
   check's own Walk, entered directly with `view.enterBody("walk")` so rows
   5–7 can read the rest, starts on E1M1's floor only because the camera
   is at the home, which is the spawn's eye carried through the link: the
   home's coincidence, not the spawn.)

   Everything else composed with no change (shore-check 2, 4, 5, 7 and 8): walk,
   a general body in the outermost stage, walks a linked doc's floors (W
   held 1.5 s moved 2.24 m, and the ray down hits E1M1's level in its
   stage); E1M1's 11 doors offer Open from E1M1's own joints, Cadboro's
   hatch from Cadboro's; no error notices. E1M1's exit offered Exit from
   its own traversal in the two earlier runs (row 6).
2. **E1M1 at Cadboro Bay is not published.** The gate's rule was "NO-GO if
   arrival needs a stage change", and it does (1). The scratch doc stays
   unlisted, out of the folder. N7's second mashup falls back to the
   Arcade nested in Games night. The place's proof, the check and the
   publish command are kept with the lane's publish scripts, for when (1)
   is answered.
3. **The place is Gyro Park**, the flat lawn at the head of Cadboro Bay
   (centre −145, −680, yaw 0): land, nothing standing, nothing swinging
   over it, the level's drawn floors clearing the drawn ground. A Doom
   level isn't flat, so it floats over the lawn by a median 4.8 m per 5 m
   cell (p90 9.3, max 17 m), its spawn floor 4.9 m up. Whether that is
   acceptable, or the level wants a stand, is the lead's call.
4. **A linked place brings its things, not its weather** (STAGE.md
   Ambients; shore-check 4 asserts the rule, it is not a bug). Row 4 first
   requires that Cadboro's stage runs `sailing.weather` and offers
   `atmosphere` and `wind`, so the rule can't hold vacuously: in an earlier
   run its stage ran no weather at all, and the row passed with nothing to
   refuse (6 below says why). With the weather running, the world has
   neither: the default sky and still air. Alone, Cadboro has sailing's
   bright maritime day and a 4 m/s wind from 235° (its `terrain.sky` is
   `{}`, which offers nothing, so its sky is the weather's); linked, the
   place loses its sky as well as its wind. Its Sea is drawn as a clipped
   block (one `water-patch`, no open ocean, water running in Cadboro's
   stage alone). Whether a doc should be able to say "my world's ambients
   are link N's" is the lead's question.
5. **Name and icon, if (1) lets it publish:** *E1M1 at Cadboro Bay*,
   Castle.
6. **Finding, not the stage's: the real Patchwork ran package versions
   days apart in one page, and an old provider rewrote a published
   render.** A *question for the lead*, and outside N7's reach (no
   Patchwork core changes). shore-check keeps each run's results, and
   they disagree in ways no doc change explains:
   - one run's Cadboro stage ran no `sailing.weather` (a doc trait, so it
     should always run);
   - row 6 failed in the last two runs, and the last shows why: E1M1's
     traversal offered commands `use` and `exit`, not `go`, the
     traversal from before 2026-11-12;
   - one run loaded scene at old heads (`automerge:2zt6…#ZKap91…`, the
     stage without `view.ambient`, older than 2026-11-14), so water's
     current part failed to start (`e.ambient is not a function`) and no
     view could be read (that run scored 4/11);
   - and during the 18:37 run, Cadboro Bay's terrain render
     (automerge:38pgCBi4…) was rebuilt by a viewer at 18:35:16 UTC with a
     terrain provider from before 2026-11-15 (its build reads no `look`
     file): the new GLB has no Buildings, Trees, Forest canopy or Moored
     boats, and the published Cadboro Bay drew without them (whole again
     since 20:54 UTC; see below). The
     lane's Chrome held the lock then, so it was very likely that run's
     page. The previous GLB is still on the server (the render doc's
     history); the lane didn't write it back.

   So a real-Patchwork check reads whatever versions the shell resolved
   that load, and any viewer whose provider is older than a render's can
   overwrite it. The lane ran no more real-Patchwork checks once this was
   seen.

   Narrowed by 7 below: a check may open docs the lane itself made (fresh
   render docs, nothing older to overwrite) when it reads, node-side,
   before and after, the heads of every published doc it reaches but must
   not write. A scratch clone counts as the lane's own only when its
   render docs are its own too: `repo.clone` keeps every object's
   `renderUrl`, so a clone shares its source's render docs, and a
   viewer's builds write the render doc (`scene/src/build.js`; a GLB is a
   new doc each build). Checks that open published docs with renders
   built before (Cadboro Bay) still wait for the lead. The Quiet games
   room and Games night have no render docs at all, so checks may open
   them, guarded the same way (10).

   Read again node-side at 04:21 UTC on 2026-11-17 (step 7): Cadboro
   Bay's render has been whole since 20:54:34 UTC on 2026-11-16. A build
   that reads every layer (params buildings, forest, boats true; the
   fingerprint `d3b9f2e636cc0` and three deps of the build before the
   damage) wrote a new GLB (automerge:48dzaSpx…), and `shore-place.mjs
   --check`'s clubhouse control, which had failed while the render was
   damaged, passes again (Buildings ×118 and Trees ×34 drawn there;
   18/18). Who rebuilt it isn't recorded. So the write-back half of the
   question is moot; whether an older provider may rebuild a newer
   render still stands, and shore-check still waits, since opening
   Cadboro Bay is what risked it.
7. **The Arcade republished with one Doom world.** The published Arcade
   (automerge:gfLLzkhgvPaDTaWUPR4QVh7duNr) had come to hold two objects
   carrying `machine.world` for the Doom cabinet, `world` and `okg5pjo09`,
   at one pose with their own render docs, so every view drew Doom's map
   twice. Its publisher writes one (`machine/probes/publish-arcade.mjs`);
   the second came from "Lay out its world" pressed on the published doc,
   which never refuses a second world (`machine/src/scene/worlds.js`
   `worldCommand`; machine/HOST.md, phase 2b, Not done yet). With no
   back-compat, the Arcade is republished by the unchanged publisher, at
   automerge:3T4KdCM2LxkxGj9rwy4bWjZdfXMF, and the folder's *Arcade* link
   swapped by name; the old doc stays, unlisted. The invariant, read
   node-side from a repo that never saw the doc, before any visit and
   again after every check: for each cabinet id, the number of objects
   whose `machine.world.machine` names it is 1 for `doom` and 0 for
   `snes`, and no world names an object that isn't a cabinet (the old doc
   reads 2 and 0; it also requires every object whose render is Doom's
   map to carry the trait, and every world's `source` to be its
   cabinet's machine doc). Checked in the real Patchwork by
   `arcade-check` (kept with the lane's publish scripts), which also
   sees the defect in the page: the scene draws exactly one node named
   `machine.world:*`, and it is `machine.world:world`. The new Arcade
   scores 30/30 with play on its own scratch clone, then 14/14 with
   `--no-play` as a later visit; the old doc, `--no-play`, scores 13/14,
   failing that row (it draws `machine.world:world` and
   `machine.world:okg5pjo09`). The scratch clone now clones each
   object's render doc and drops the shell's `@patchwork.mainDraftUrl`, a
   row checks it shares no doc a viewer writes with the published one,
   and a row reads, before part 2 and after, the heads of the published
   docs it still reaches (the Arcade, its sessions, the machine docs and
   their content, the WAD): unchanged. The earlier runs' clones shared
   the published renders: the world's render was first built by the
   first run's scratch page, not by a visit to the published doc (a
   fresh render doc, the old docs' GLB hash, so the same provider
   version). The first two runs scored 16/27: in a fresh profile the
   shell's first page came up with the stage but none of the doc's
   packages and no prompt to load them for 7 minutes, while the next
   navigation, to the scratch clone, prompted, loaded and played. The
   check now reloads once after 150 s with nothing loaded and nothing to
   click, and its summary says so ("after a reload", naming the page);
   no scored run since needed it. The machine docs, their content, the
   WAD, both Arcades, their render docs and sessions kept their heads
   through the last three runs.
   *For the lead:* should "Lay out its world" be disabled on a cabinet
   that has its world ("It has its world"), or replace it? Either is a
   small change in machine, outside N7.
8. **Mashup B: *Arcade in the games room*** (automerge:3gvFRkHB8YbCm9B2bRmoVKPbNXyB,
   icon Gamepad2; the name and icon decided here): the Quiet games room
   at the origin and the Arcade of 7, both published, linked unchanged
   (`publish-links`), people starting as the room starts them. Gated
   first on an unlisted scratch doc (automerge:2Vs2KeZL5vY6yYBgBdteYMhNDTxP)
   by the lane's `arcade-room-check` (kept with its publish scripts,
   outside git), and GO: nothing in scene, walk or machine changed.
   - **What composed without change** (the published doc; the check's
     rows in brackets): every doc it opens acts in it, one stage each:
     the mashup, the room, its three games, the Arcade (1). People
     arrive Watching at Lost Cities, two links deep (2). Both cabinets'
     screens sit on their bezels, and each cabinet has its session (3).
     One seat mechanism serves two packages: a tabletop game declares
     seats on its doc, machine lays a cabinet's ports as seats on its
     object (seats' `lay`, seats/README.md), and each stage has its own
     roster, so each game shows a picker with its own seats, the Arcade
     one more, and the cabinets' eight seats are free in the Arcade
     stage's roster (4). Walk is on offer (5); no error notices (7). The
     machine docs are reached one link and a reference down: the mashup
     links the Arcade, whose cabinet objects name their machine docs.
   - **Play, on a running world only.** The published Arcade's world is
     paused (9), so on the published mashup P on a cabinet sits you at a
     picture that never moves. Play was shown on a scratch Arcade (its
     renders cloned, its runtime fields dropped, its world started)
     linked with the published room at the same poses: from Look, P
     aimed at the Doom screen sits you at the Doom P1 seat in the
     Arcade's stage with the keys panel up (8); held forward reaches the
     engine and the picture moves (9); Lost Cities' seats stay free (10),
     since the cabinet's seat is in the Arcade stage's roster, not the
     game's, and a view sits in one seat at a time (`roster.sitting()`);
     Watching stands you up, the port goes back and the picture holds
     (11). So a running emulator on world time works inside a link when
     its world runs.
   - **The place** (`arcade-room-place`, kept with the check; its table
     and mutants in 12): the Arcade at (3.4, 0.035, 1.65), turned 180°,
     its screens facing the tables. The rule ("room to play"): every box
     of the Arcade (each cabinet, Doom's world, and a players' strip from
     each cabinet's front out to its seats' cameras) stands on the room's
     floor and is 0.3 m clear in plan of every triangle the room draws in
     the slab a player uses (floor + 5 mm to floor + 2.1 m), of each
     linked game's hint box, and of a column on the walk spawn; the walls
     being drawn, the clearance is also what keeps it inside them. Of the
     poses on a 5 cm grid at the four right angles that keep it, the one
     with the most room (0.908 m, to a Lost Cities chair). Triangles, not
     hint boxes: the room's Lamps and its Bamboo and moss are one mesh
     each, spread round the room, and their boxes cover nearly all its
     free floor. Two clauses never decide a real pose in this room, so
     synthetic controls test them: every game sits on a table that
     reaches further (a game set on the floor under a players' strip
     fails the pose by its box), and nothing between 0.6 m and the
     slab's top stands where the Arcade could go (a thing at head height
     over a strip fails it, the same thing just over 2.1 m doesn't). The
     page agrees: row 6 reads every triangle the room draws, as drawn,
     and finds the same 0.908 m.
   - **The hover:** the room's tatami are islands 3.5 cm proud of wooden
     aisles, and a link is one rigid pose, so the Arcade stands at the
     tatami's top and what is over an aisle hovers 3.5 cm (Doom's world
     54% of it, each players' strip 40%, the cabinets about 1%).
     Reported, as 3 reports E1M1's, not decided.
9. **Finding: a linked world's pause says so nowhere.** *A question for
   the lead.* The gate's first play failed row 9: seated at the Doom
   cabinet, the session's clock stood still and no tick ran. The
   published Arcade's world is paused (`clock: { running: false, t:
   32.751 }`): its history has it running from its publish, then at
   20:20:54 UTC, 2026-11-16, one actor writing `{ running: true, t:
   29.96 }` and, three seconds later, the pause, its `by` your
   registered contact. How it was paused isn't recorded (a clock chip,
   or code calling `clock.pause()`). It wasn't a lane check: a check's
   Chrome runs in a fresh profile, which has no contact
   (`terrain/probes/cdp.mjs`), and no N7 Chrome ran between 20:08 and
   21:12 UTC. A scratch clone kept that clock. A paused world runs no
   machine (machine/HOST.md, phase 2b), and machine shows no note then,
   because "the world's pause says so already"
   (`machine/src/scene/shown.js` `stoppedNote`). In a mashup it doesn't:
   the clock chips are the focus path's docs (I12), and the Arcade is a
   link off it, so Play sits you at a cabinet whose picture never moves
   and nothing says why, until you enter the link and its chip appears.
   Not changed here (no package code in N7). The checks' scratch clones
   start their world running (`clock: { running: true, t: 0 }`, as
   published), in `arcade-room-check` and in step 3's `arcade-check`
   alike; with that, play passed. The published Arcade stays paused: the
   pause is yours.
10. **6, narrowed for the room and Games night; its versions half
   recorded, not answered.** Read node-side, no object of the room, its
   three games, Games night or the Liar's dice table has a `renderUrl`
   (their GLBs are files, drawn from their source; their games are
   links), so no provider's build writes into them and 6's overwrite
   can't happen there; 6 now says so. The other half of 6, a page
   running package versions days apart, stands: a page runs whatever the
   shell resolves. `arcade-room-check` now names them: each module the
   page loaded from an automerge URL, with its heads, by package, and
   whether that is the package's current heads (read node-side after
   the run); it scores only that the page names them, one heads per
   package, the stage's among them. Its write guard is every published
   doc a visitor could write: the docs it opens below the mashup and
   every render and session they name (the Arcade's three renders and
   two sessions too), their heads read before and after.
11. **N7's second mashup: *Games night and the Arcade***
   (automerge:48Szu3pnC7mVUupS2mSZUt7ZRJQt, icon Trophy; the name and
   icon decided here). With A not published (2), this is the fallback 2
   named: Games night at the origin, the Arcade at B's pose, a mashup of
   a mashup, its games three links deep. The rule holds there unchanged
   (the host walked through its links, 59 GLBs; least 0.908 m, the same
   chair), and the check passes the same rows: four game seat pickers
   and the Arcade's, arrival Watching at Lost Cities three links deep,
   play on a scratch Arcade as in 8. What it adds over B is depth only:
   Games night already links a doc with links, and depth three is the
   same mechanism as depth two. Neither mashup has a scaled link (the
   plan's other fallback, E1M1 as a 1:50 diorama in the Model room,
   would). Whether it keeps its folder slot is a question for the lead.
12. **Scores of record** (the real Patchwork, 2026-11-17, 02:50–03:22
   UTC): `arcade-room-check` on *Arcade in the games room* 20/20 with
   play (its first page reloaded once: the shell's fresh-profile start
   with no packages and no prompt, 7), on *Games night and the Arcade*
   20/20 with play. Both named their package versions: every one the
   current heads but once, Games night's published page running scene at
   a heads other than its current one (`2zt6…#nBUHTf…`), while the room's
   run minutes before and its own scratch page minutes after ran the
   current (`#nHZXa1…`): 6's versions half, seen again within one
   check.
   `arcade-room-place --check` at the published pose: 15/15 on the room
   (each of nine mutants fails its own rows) and 4/4 on Games night (its
   controls are the room's). The runs before these, and the gate's, are
   in the lane's report.
13. **Not built, by design: a game table in Fitting out's saloon, as a
   mashup.** Fitting out (automerge:234hYUvZMozmQ3bo3c6BRcTJmVXB) has no
   saloon of her own; the candidate is a table anywhere aboard her, linked
   in a new doc. It can't ride her:
   - A mashup places each link in its own frame: `publish-links` writes
     every link on the doc's root (`parent: null`). Writing a parent
     instead changes nothing, because a parent is doc-local: `rawParent`
     (`src/hierarchy.js`) keeps one only if it names an object (not a
     group) in the same doc, and her Sloop (`oga3461ux`) is in her doc,
     not the mashup's.
   - She moves in her own doc. Her Sloop carries `sailing.ship`, lies to
     her own Windlass and Anchor, and pitches and swings on her own Sea in
     her world time. What rides her is what her doc parents to her: her two
     W hatches and F's companionway are links parented to the Sloop. Lost
     Cities aboard is the shape that works: its game's link sits on the
     Card table, and the Card table on the Sloop
     (`omkjnt9w5 → onocu6k6f → oz3e3gr5o`), all in one doc.
   - §9 leaves only a landing: a carry may snap to a linked doc's named
     frame, but it stays where it landed ("no reference crosses docs"); §9
     says so of an edit to the linked doc ("It doesn't follow the winch if
     the fit-out changes"). Motion is the same case: the landed pose is
     written in the host's frame, so a table snapped to her cockpit also
     stays put while she pitches and swings out from under it.

   So the candidate needs an attachment across docs, which §9 rules out.
   By design, the answer is the boat's own doc holding the link (Lost
   Cities aboard), which isn't a mashup. Nothing to ask.
14. **Dice cups at the Lost Cities table: not the capability the plan
   expected; not built; a question for the lead.** The plan held that a
   view sits in one seat at a time (`roster.sitting()`), so a person could
   be player 1 of G or of a dice doc linked onto the same table, never
   both, and that this forces a seat spanning linked docs. Reading the
   code says otherwise for the keepers:
   - Players and claims are per doc. Each doc's seats part holds its own
     lasting seat's claim (`held`; seats' `sit` and `reconcile`, in
     `seats/src/seats.js`), and "a viewer has at most one lasting seat in
     a doc" (seats/README.md) is per doc. Sitting in a second doc's seat
     neither writes nor lets go of the first's, so one person can be
     player 1 of both at once.
   - Each keeper counts its own doc's players, from a roster that is pure
     in that doc: card-table's hand keeper through `playing()` →
     `roster.viewers(scene)` (`card-table/src/keeper.js`), dice's cups
     through `seated()` → `roster.viewers(s)`
     (`dice/src/cup-extension.js`). Neither reads `sitting()`.
   - What is one per view is the body on top: you look from one doc's
     seat at a time. At one table, the two seats' cameras can be the same.

   So, by reading, the keepers compose with no new seats capability. Two
   things stand in the way, neither of them stage code:
   - No published doc holds dice cups alone. Liar's dice
     (automerge:BEkpNoJVsGN4FXHUkC9yjJ9C1kT) is a round table of its own
     (`dice/probes/publish-liars.mjs`), so this mashup needs a new doc of
     cups and seats, which is more than publishing.
   - A latent seats bug, met by the first person to sit in both. Every
     stage's seat body has the id `"seat"`, and seats' `seated()` compares
     the top body's id alone (`seats/src/seats.js`, `const seated`), not
     its `ext`; the stage projects `ext` as its own extension's id only for
     its own body (`src/stage/view.js` `projectView`). Seats' own UI can't
     put one seat body straight over another: with another doc's seat on
     top, the lower doc's picker hides (`pickerOwner` checks `ext`) and F
     offers only Stand up (`seats/src/model.js` `seatVerb`). Two ways do
     reach it: a body in between (sit at G, walk off from the seat, then F
     at the dice doc's seat: look, seat(G), walk, seat(dice)), and another
     package's `roster.sit` (machine's Play asks its own stage's
     `sitting()`, `machine/src/scene/hands.js` `clicks`, which is null
     there, and pushes the Arcade's seat over a game's). Then G's
     `sitting()` still reports G's seat, against seats' roster contract
     ("the seat body on top"), and G's `getUp` leaves the body on top, the
     dice doc's, wherever G calls it: its F Stand up, `dispose` when G's
     stage stops, the lost-race and perch paths. Pinned in
     `seats/src/stacked-bodies.test.js` (decided unattended, a test only,
     no seats code): G's picker hides under the other body, and `sitting()`
     being null there is an expected failure (`it.fails`). With `seated()`
     also checking `ext` (one line, as `pickerOwner` does) the expected
     failure flips and the other 86 seats tests pass; with `pickerOwner`
     not checking `ext` the picker test fails. The fix leaves a decision
     for seats: `getUp`'s `downToSeat` would then pop the dice doc's body
     to get down to G's. In the review a scratch run of the second way
     showed G's `dispose` calling the dice body's `leave` and leaving
     look, seat(G). Recorded in seats/README.md, Still open.

   *For the lead:* try it (a doc of cups and seats to link onto the table,
   and seats' fix for two stacked seat bodies first), or is "a game that
   wants both is one doc" the answer?
15. **N7's findings, by owner** (the evidence is in the entries named):
   - **scene:** a place handed across docs to a body (1); a linked
     place's ambients are lost by rule (4; STAGE.md, "Ambients"); a
     linked world's pause shown nowhere (9; scene's clock chips or
     machine's note, the lead's call).
   - **machine:** "Lay out its world" never refuses a second world
     (7; `machine/src/scene/worlds.js` `worldCommand`; machine/HOST.md,
     phase 2b, Not done yet).
   - **seats:** two stacked seat bodies told apart by id alone (14;
     pinned by `seats/src/stacked-bodies.test.js`).
   - **terrain:** `terrain/src/terrain-sample.js`'s header says the canopy
     layer holds "the trees' (and roofs') height", but the build leaves
     built ground out of it ("no forest where something is built",
     `terrain/src/build.js`; `forest.js` `effectiveCanopy`), so it never
     shows a roof. E1M1's place reads the drawn GLB instead (3). A line of
     terrain's docs, not edited here.
   - **the Patchwork shell** (not ours; no core changes): package versions
     days apart in one page, and an old provider rebuilding a published
     render (6, 10, 12); a fresh profile's first page with no packages and
     no prompt (7), and once, shore-check's first run, the scene package's
     `package.json` failing with HTTP 557 for 10 minutes.
   - **reported, not decided:** E1M1's float over Gyro Park (3), and the
     Arcade's 3.5 cm over the games room's aisles (8).
16. **Step 7, the re-run on the integrated tree, is the integrator's**
   (2026-11-17, 11:08 UTC). It runs when the integrator asks, after N7's
   merge and a sync, on whatever scene-stage then holds. lane/n7 isn't
   merged (at 11:30 UTC, 9 commits ahead of scene-stage 1eb3c344, 96
   behind), and the lead's probe policy of 2026-11-17 gives the one
   real-Patchwork sweep after a merge to the integrator, so the lane ran
   none. N7 changes no package code (its one code file is seats' test),
   so its merge needs no build; the integrator's sync after it still
   takes in seats and machine, whose README, test and HOST.md pushwork
   mirrors. The packages changed twice after N6's run: the sidebar's
   sync (20390028) and the weather merge (1eb3c344), whose W6 (45d53bf9)
   turns terrain's sky into the weather's: terrain's place gives no sky,
   and Cadboro Bay's template writes a weather trait. Under no back-compat
   that may change Cadboro Bay's published doc, so three items here may be
   affected: Cadboro Bay standing as it is (6), the deferred `shore-check`,
   and the ambients question (4: a linked place's sky). Part of the re-run is already done: N6's integrator
   republished both of N7's mashups with the same links and places
   (*Arcade in the games room* automerge:2FEoL22w…, *Games night and the
   Arcade* automerge:2Vxh319R…; 8 and 11 name the URLs they replace) and
   scored `arcade-room-check` 19/20 ×2 (row C, the shell's "scene package
   unavailable" log) and `mashup-check` 5/5 on Games night
   (automerge:Zty1huc3…). Owed, one at a time under the Chrome lock:
   - `arcade-check` on the Arcade (automerge:3T4KdCM2…, swapped into the
     folder by `swaps-n7.tsv`; the folder note still names gfLLzkhg…):
     30/30 with play, then 14/14 with `--no-play` (7);
   - `arcade-room-check` on both mashups, 20/20 each, and `mashup-check`
     on Games night, 5/5, again, since the packages changed after N6's
     run; a shell resolver timeout or row C's
     log is noted, not counted, as for `ucluelet-check`;
   - `shore-check`: not run. It opens Cadboro Bay, and the older-provider
     half of 6 still waits for the lead; E1M1 at Cadboro Bay isn't
     published (2).
   Merging N7 meets one conflict, in this file's list of what is still
   open (N7's five items against lane/n8's "entering a link moves the
   canvas"): keep both.
17. **Step 7, run by the integrator** (2026-11-17, 11:30–11:59 UTC; decided
   unattended (2026-11-17, lane/n7 integration), for the lead). N7 merged
   into scene-stage as 11eea508, the conflict resolved as 16 says; seats,
   machine and scene built (each dist the same as the published one: only
   docs and seats' test differ) and synced, scene's sync also taking in the
   weather merge's docs (DESIGN, SCOPE, STAGE) and `probes/xdnd-run.mjs`.
   Suites: seats 87/87 (the stacked-bodies expected failure holding),
   machine 551 (56 skipped), scene 2048/2048. The real Patchwork, one at a
   time under the Chrome lock (shots `recovered/publish/shots/n7int/`):
   - `arcade-check` on the Arcade (automerge:3T4KdCM2…): 29/30 with play,
     13/14 with `--no-play`. The one red row in both is "each stopped
     cabinet's note says how to play it", which reads no notes on the
     published Arcade: its seats are laid now (four a cabinet, read in the
     same run), and once they are, a seat's tag is a cabinet's label in
     place of its note, as the same check's framing row already says ("its
     note, or once its seats are laid a seat's tag") and the folder note
     has said since N8. The scratch clone, whose seats aren't laid yet,
     shows both notes. So the row is the check's, not the Arcade's: the
     lane's 30/30 and 14/14 (7) read an Arcade whose seats weren't laid
     yet. Not a regression; the check is to read labels as its framing
     row does.
   - `arcade-room-check`: *Arcade in the games room* 19/20 after a reload,
     the red row C (the shell's resolver: scene's package doc `2zt6…`
     "unavailable"), noted, not counted, as N6's integrator saw; *Games
     night and the Arcade* 20/20.
   - `mashup-check` on Games night: 5/5.
   - `shore-check`: not run, as 16 says.
   No doc shape changed, so nothing is republished and no folder link
   moves. Cadboro Bay standing as it is (6), `shore-check` and the
   ambients question (4) now wait on the weather's W8 republish as well as
   on the lead: W8 may run now that N7 is in (WEATHER Decision 54 waits on
   N11 too).
