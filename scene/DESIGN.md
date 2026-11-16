# scene: the idea

An overview for someone new to the scene. [STAGE.md](STAGE.md) is the
exact contract between the core and everything else; [SCOPE.md](SCOPE.md)
says whose a press is; [README.md](README.md) says what the scene tool does
for a person using it. The design notes, [TOOLS.md](TOOLS.md) (bodies, the
held tool, world time) and [COMPOSITION.md](COMPOSITION.md) (scenes inside
scenes), hold the reasons, the decisions and the record of how each piece
was built.

## The model: a stage, and contributions

A scene is an Automerge document of objects (each showing some content: a
GLB, a built model, a map, another scene), their transforms and
attachments, and **traits**: small records on an object or on the scene
that say what it is or does (`tabletop.card`, `sailing.ship`,
`joints.slide`, `scene.carry`).

The core is in two parts. A **stage** is a doc's, one per open doc:

- the doc: deriving a snapshot from it, loading and building each object's
  content, and the packages the doc lists;
- the extensions its traits call for, and the api each gets;
- presence, claims (who is at the helm, in the doc), pose holds (a thing
  shown somewhere while it moves, streamed to peers) and their one order,
  all on the doc's own channel;
- the doc's **clock**: world time, computed by one view, and the processes
  stepped on it;
- the audience (who may see what an object is), the veil, lenses and its
  ambients (the values a world has once: its atmosphere, its water). The
  outermost doc's ambients are the view's, read by every stage as plain
  data.

The **view** is the viewer's, one per mounted tool, shared by every stage
it opens:

- rendering, the camera and its rides, and picking: what's under the
  pointer, rays, and input events that carry that hit;
- the input router: one chain every event goes down, the **body stack**
  (where you are and how you move) and one **held tool** slot;
- the selection and hover, the **focus** (which linked doc you are editing
  in), prefs, notices, the drawer extensions dock panes in, and one
  presence session.

Neither has UI of its own: no toolbar, sidebar, modes or verbs. The only
opinion either has about input is the Edit body's: a click nobody else took
selects.

Everything else is a **contribution**, from an **extension** that any
package may register. An extension runs in a stage for one of two reasons,
which also give it a scope:

| Scope | Runs when | For example |
|---|---|---|
| **Object** | Some object in the doc carries one of its traits | A card shuffles and draws; a die rolls; a door slides; anything with `scene.carry` can be picked up |
| **Scene** | The scene itself carries one of its traits | Seats; a sea; an arena level |
| **General** | It declares no traits: it serves whatever is there | The key map, the menu, notices, the walk body, the editor's outline |

A contribution can provide:

- **Verbs:** commands that act on a *target* (an object, or the scene),
  each saying whether it applies there and, if it must, that it needs to be
  within reach.
- **Input:** presses, clicks and keys offered down the chain.
- **Bodies** and **tools** (below).
- **Widgets:** things drawn in the stage's layers.
- **Surfaces:** things that present other contributions' verbs. The menu,
  the use prompt ("[F] Open"), the inspector and the key map are surfaces.
- **Lenses, policies and processes:** how something looks to this viewer;
  who may see what it is; what moves in world time.

What isn't contributed doesn't exist. A card table has no outline because
nothing there contributes one. It isn't hidden.

Docs carry no code. They name traits and providers, and list the packages
those come from; a viewer who lacks one is offered it, and it loads only on
a click. Nothing in the stage knows a domain: it has no idea what a card,
a ship or a door is.

## Views, stages and links

**A scene document is a world; a link places one world inside another.** A
link is an ordinary object whose content is a scene doc. To its host the
linked doc is content, like a GLB: a box, surfaces a ray can hit, a frame
that rides whatever the link is attached to. To itself it is a whole world
with its own stage. The view opens that stage where the link is, in the
link's frame, so a game on a ship's table never knows it is on a ship, and
the ship never reads into the game. An extension sees one doc: inside a
linked game `null` is the game's root and `api.url` the game's.

A link is one of four things in a view, decided by a pure function of the
link graph:

- **Live and acting.** A live doc acts at one placement per view, the first
  in path order: there its extensions run, take input, offer bodies and
  verbs, compute its clock and claim on its channel.
- **A mirror.** The same live doc placed again in the same view is drawn
  there and never acts: its extensions draw it as the doc is (a carry shows
  in both places), and a press on it reaches the host as the link.
- **A pin.** A link with `at` is a value: its doc at fixed heads, with the
  heads of every doc reached through it (the docs it links, render docs,
  files, a keeper's container), so the whole of what it shows holds still.
  Drawn, never acted on. *Fix at this version* and *Follow latest* move a
  link between live and pinned.
- **Closed.** A cycle, a doc that can't be opened, or a live link inside a
  pin with no heads for it: drawn as the link's hint.

A pin and a mirror are read-only by construction: their stage is given its
doc and repo through wrappers whose writes throw, and every write path asks
first, so nothing they run can write any doc. The couplings across a link
are space (rays, hits, frames, rides) and the view's input path, and
nothing else. What the view does gather from every open doc is the
viewer's: one packages prompt for all of them, and who's here.

**The focus.** The view's focus is the path of links the viewer has
entered: the outermost doc until **Enter** (a link's menu, the inspector,
the outline, a double-click) moves it into a link whose doc acts there. The
selection is always in the focus doc, and the editor (the halo, the
inspector, the outline, add, paste, undo) edits that doc in its frame. The
focus scopes the selection, never input: outside it verbs, carries, keys and
the menu still work, and the world around keeps running, its people drawn
where they are: what draws a doc's people (walk's avatars, others'
selections) is a part of every doc, so it runs wherever that doc is drawn.
**Leave** goes back out (Escape's last rung, the trail along the top). No
stage sees the focus.

**Arriving.** A doc says where people start (`view.start`). A start placed
on one of its links arrives through it, as the linked doc starts people: the
Quiet games room starts you at its Lost Cities table, seated or watching,
because the game says so.

**Extract and bundle** are the one copy rule in two directions. Extract
turns a selection into a doc of its own, linked where it was, runtime state
left behind; Bundle copies a linked doc into its host in the link's place
and never writes the linked doc. Each is one change to the host and one
undo step.

What composition doesn't do: reason over two docs, reference or group
across them, screen a linked doc's secrets from its host, specialise one
placement of a live doc (copy it to differ), or act on a mirror or play a
pin.

## Bodies, tools and the clock

Three ideas replace modes, so that playing and editing are not states a
viewer switches between.

**A body** is where a viewer is and how they move and look. The stage owns
two, **Look** and **Edit**, both the orbit camera, one of them always at
the bottom of the view's stack; packages contribute the rest: **walk**
(first person on whatever the rays hit, riding what it stands on), a
**seat** at a table (riding the table, rolling with it aboard), and
sailing's **aboard** (her deck) and **station** (the helm, a winch).
Entering a body pushes it, leaving pops it: sitting down from walking
pushes a seat, standing up walks on. The top body says which keys it
reserves, whether it wants pointer lock, where the eye is and how far it
reaches, and every verb is measured from there ("too far" is computed once,
by the stage, for every surface). Look and Edit are chosen on the body
chip; nothing stands on Edit, so entering any other body leaves it, and
leaving one comes back to Look.

**The held tool** is one slot per view: empty, or one tool that takes every
press first (measure, arena's gun, a piece just drawn from a bag). A tool is
held only if it takes input outside its own widgets; Escape puts it down.
Playing is the empty hand. **Editing is a body**: in Edit a click selects,
and a selection shows its **halo** (move, rotate and scale handles where
the doc may be written) and the inspector; the toolbar's editor commands,
the grid, axes and bounds and every editing command are Edit's alone, so
someone at a table or walking a level sees no editor (the toolbar's world
commands, a game's Play or Lift all, show in every body: TOOLS.md
Decisions 10). Carrying needs no tool and no body:
whatever has the `scene.carry` trait can be picked up by anyone, and Select
is in every menu.

**The clock** is each doc's world time. One view computes it, holding the
doc's `"clock"` claim, and steps every **process** extensions register (the
ships' physics, a door closing itself); the others follow its time, and
take over if it goes. Anyone who may write can pause it, by name, on its
chip (one for each doc on the focus path that has a clock). Nobody
present, no time passes. Things that are acts (a die's tumble, a carry) run
on the stage's time and finish during a pause. A linked doc has its own
clock: pausing the boat doesn't pause the game on her table.

**What runs is the doc's**, nothing else: an extension runs where the doc
has one of its traits, and one that declares none runs in the focus stage.
Nothing a viewer holds, where they stand or the clock changes it, so a
sailing sim never stops for someone editing her (a pause does, by name).
The editor's parts run everywhere and show only in Edit, where attention
asks: the inspector is a drawer tab a selection opens, which stays open
(on the scene when nothing is selected) until its ×, the toolbar or
leaving Edit shuts it, and holds the object tree over the fields, the grid and axes are drawn. A doc says
where people **start** (`view.start`: a body, a place, a home camera), read
once on arrival: a table starts people seated (or watching from a seat), a
level walking at a spawn point, a ship or a showcase in Look (no body
named), and a scene made new in Edit, since its maker came to build.
**Undo** takes back the stage's own edits (the halo, the inspector, add,
remove, paste, extract, bundle), this viewer's, never a verb's: undo can't
un-roll a die. An edit that showed or decided something is taken back only
with its parties' agreement (refused, until that protocol is designed):
undo can't un-show a card either.

## Arbitration

Once anything can contribute, the stage's real job is deciding who handles
what. A press goes down one chain, and each step may claim it or pass:

1. the held tool;
2. the owner of the widget under the pointer (a halo handle);
3. the **holders, nearest first**: the extension whose trait is on the hit
   object, then on what it's attached to, then its groups, and last the
   doc's root (a card on a table aboard a boat goes to the table's
   extension, then the boat's, then the scene's). A hit inside a linked doc
   goes through a segment per doc, innermost first: the game's holders,
   then the host's from the link outward;
4. general extensions (the focus doc's);
5. the top body (Edit takes a click ahead of 3 and 4, and selects with it;
   Look has nothing here);
6. otherwise a drag orbits the camera.

Keys have no position, so what reserves them comes first: the open gesture
(a carry's Q/E/F), the held tool, the body, then the key map over
**attention** (the selection, else what you look at), a doc at a time from
the innermost out. A key a surface shows is computed by the same resolver
that dispatches it, so a shown key works. Escape pops exactly one layer:
the pointer lock, a field, a popover, the gesture, the tool, the selection,
the focus; never the body or the clock.

The other kinds of contribution combine without order mattering where
they can: camera limits intersect, lenses stack, audiences are unions and
intersections, and a surface collects every verb that applies to its target.

## How the examples compose

The model is only general if each of these is built **purely from
contributions**, without the stage knowing what it's for, and without any
of them being the default the others are measured against.

**Tabletop games.** A game is a JSON document (tabletop's format: pieces,
looks, where everything starts). A template lays one out in an empty scene;
a game part dropped on a table in another scene makes a game doc of its own
and links it there, locked. The tabletop package gives cards and hands
their verbs (Shuffle, Draw, Wash) and a policy saying who may see a card's
face; a **keeper** (the keep or card-table package) holds what each card
really is, away from the scene doc, and shows each viewer only what the
audience allows. The **seats** package is the seats, the roster, a claim
per seat and the seat body. Pieces carry the `scene.carry` trait, so the
scene's carry moves them, snapping to the board's connectors. Dice and bags
are packages of their own on the same table. None of them knows the others
by name: they meet through conventions (`roster`, `seatPlaces`, `keeper`).

**The sailboat.** A sea is a Water object (the water package's: an object
whose extent says what the water is, open here) with sailing's sea on it
(its waves), and the weather is a scene trait (`sailing.weather`: the
world's wind and sky). Open water is weather, the outermost doc's, so a
boat alone sails on her own sea and a boat linked into a harbour on the
harbour's, one surface drawn; water with bounds (a basin, a tank) is a
thing, which its doc keeps wherever it is placed. A sloop is a hull with
`sailing.ship` and her fittings attached under her, each with a trait
(helm, sail, winches, windlass, ladder). Her physics is a process on the
doc's clock: one view steps it and streams her pose, the rest draw her
where it says, at the moment its sea is drawn. Her crew walk her deck in
sailing's aboard body and take a station with F, pushing the station body.
Her companionway is two other packages' traits: a hatch that slides
(`joints.slide`) and an exit (`traversal.exit`).

**Docs inside docs.** *Lost Cities aboard* is two docs: the boat, and the
game linked onto her cockpit table. The game is carried, seated and
screened by the same packages as on land, riding her frame: face up is the
table's up, however she heels. The *Quiet games room* links its games, its
Lost Cities table the same game doc as the boat's: one person plays in the
room and another aboard, the table heeling only aboard. *Fitting out* is a
sloop whose companionway is a fit-out pinned at a version, and one hatch
linked live twice: the second is a mirror, opening when the first does.
*Games night* is a doc of two links and nothing else: the Quiet games room
and the Liar's dice table, both published before it, linked unchanged; it
starts people through the room's link, which starts them through its Lost
Cities link, so they arrive watching at that game two links down. The
*Harbour* (water/WATER.md) is water, a sea and two boats linked live, Lost
Cities aboard and Fitting out, both at anchor: both float on its water and
lie to its wind, one surface drawn.

**A machine in a scene.** The *Arcade* is two published machine docs, a
Doom and a Super Nintendo, linked into a scene as cabinets, unchanged: each
cabinet draws its machine's screen on its own mesh, plays its sound from
there, and carries a seat per port (the seats package's, on the object),
so sitting at one plays it and getting up stops it. Beside the Doom stands
its world, doom's map of the level, with the game's things drawn in it from
the engine's state. Nothing in the stage knows a machine (machine/HOST.md,
phase 2b).

**Doom's E1M1.** Dropping a WAD lays out its first map: the doom package's
provider builds a GLB of the static map, one per door and one per exit
switch, all from the one WAD document. The static part gets the doom
package's own marker trait (`doom.map`), the doors `joints.slide`, the
exit switch `traversal.exit` (which leads to another doc: going somewhere
is not a link), the player 1 start walk's spawn trait (`walk.spawn`), and
the scene `arena.level` for its sky. You arrive walking at that start, with
arena's gun to pick up as the held tool; joints' process closes the doors
on world time. Nothing outside the doom package is Doom-shaped, and the
doom package imports none of the others.

**Building (CAD, boats).** Selection, the halo, numeric transforms with
units, snapping to connectors, measure and dimensions, the outline and the
inspector are shared parts, each written once as a contribution. A
parametric source contributes its own handles; a hull designer docks its
editor in the drawer. An assembly that has become a world of its own is
extracted into a doc and linked back; Enter it to edit it in place, the rest
of the scene live around you.

## Where the code is

The stage and the view are `src/stage/` (`stage.js`, `view.js`, and the
pure modules STAGE.md lists under "Inside the stage"); the shared parts are
`src/parts/`, one module each. Everything domain-shaped is a top-level
package of this repo, each standalone: tabletop, seats, dice, bag, keep,
card-table, sailing, joints, traversal, walk, arena, doom, machine. What is
not built yet, and why, is in the design notes' build orders and
decisions.
