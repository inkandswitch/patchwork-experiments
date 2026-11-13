# scene: the idea

An overview for someone new to the scene. [STAGE.md](STAGE.md) is the
exact contract between the core and everything else; [README.md](README.md)
says what the scene tool does for a person using it. The design notes say
where it is going: [TOOLS.md](TOOLS.md) (tools in hand, bodies, world time),
[COMPOSITION.md](COMPOSITION.md) (scenes inside scenes) and
[SCOPE.md](SCOPE.md) (whose a click is).

## The model: a stage, and contributions

A scene is an Automerge document of objects (each showing some content: a
GLB, a built model, a map), their transforms and attachments, and
**traits**: small records on an object or on the scene that say what it is
or does (`tabletop.card`, `sailing.ship`, `joints.slide`, `scene.carry`).

The core is a **stage**. It holds:

- the doc: deriving a snapshot from it, loading and building each object's
  content, and the packages the doc lists;
- rendering, the atmosphere (sky, fog, sun), and the camera and its rides;
- picking: what's under the pointer, rays, and input events that carry
  that hit;
- the input router: one chain every event goes down, the **body stack**
  (where you are and how you move) and one **held tool** slot;
- presence, claims (who is at the helm, in the doc), pose holds (a thing
  shown somewhere while it moves, streamed to peers) and their one order;
- the doc's **clock**: world time, computed by one view, and the processes
  stepped on it;
- the audience (who may see what an object is) and the veil, lenses, and
  the drawer extensions dock panes in.

It has no UI of its own: no toolbar, sidebar, modes or verbs. Its only
opinion about input is the orbit body's: a click nobody else took selects.

Everything else is a **contribution**, from an **extension** that any
package may register. An extension runs in a scene for one of two reasons,
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
  the use prompt ("[F] Open"), an inspector and the key map are surfaces.
- **Lenses, policies and processes:** how something looks to this viewer;
  who may see what it is; what moves in world time.

What isn't contributed doesn't exist. A card table has no outline because
nothing there contributes one. It isn't hidden.

Docs carry no code. They name traits and providers, and list the packages
those come from; a viewer who lacks one is offered it, and it loads only on
a click. Nothing in the stage knows a domain: it has no idea what a card,
a ship or a door is.

### Bodies, tools and the clock

Three ideas replace modes, so that playing and editing are not states a
viewer switches between ([TOOLS.md](TOOLS.md)).

**A body** is where a viewer is and how they move and look. The stage owns
**orbit**, always at the bottom of a per-view stack; packages contribute
the rest: **walk** (first person on whatever the rays hit, riding what it
stands on), a **seat** at a table, and sailing's **aboard** (her deck) and
**station** (the helm, a winch). Entering a body pushes it, leaving pops it:
sitting down from walking pushes a seat, standing up walks on. The top body
says which keys it reserves, whether it wants pointer lock, where the eye
is and how far it reaches, and every verb is measured from there ("too far"
is computed once, by the stage, for every surface).

**The held tool** is one slot per view: empty, or one tool that takes every
press first (measure, arena's gun, a piece just drawn from a bag). A tool is
held only if it takes input outside its own widgets; Escape puts it down.
Playing is the empty hand. Editing is selecting a thing, which shows its
**halo** (move, rotate and scale handles where the doc may be written), or
holding an editing tool. Carrying needs no tool: whatever has the
`scene.carry` trait can be picked up by anyone.

**The clock** is the doc's world time. One view computes it, holding the
doc's `"clock"` claim, and steps every **process** extensions register (the
ships' physics, a door closing itself); the others follow its time, and
take over if it goes. Anyone who may write can pause it, by name. Nobody
present, no time passes. Things that are acts (a die's tumble, a carry) run
on the wall clock and finish during a pause.

**Activities remain until build step 8.** Each view still has one, `"edit"`
or `"play"`, and an extension may say which it takes part in: the editor's
chrome runs only in edit, the use prompt and sailing's physics only in play.
Step 8 removes them; until then a sailing sim stops for someone editing
(STAGE.md, "Activities").

### Arbitration

Once anything can contribute, the stage's real job is deciding who handles
what. A press goes down one chain, and each step may claim it or pass:

1. the held tool;
2. the owner of the widget under the pointer (a halo handle);
3. the **holders, nearest first**: the extension whose trait is on the hit
   object, then on what it's attached to, then its groups, and last the
   scene's (a card on a table aboard a boat goes to the table's extension,
   then the boat's, then the scene's);
4. general extensions;
5. the top body (in orbit, Select);
6. otherwise a drag orbits the camera.

Keys have no position, so what reserves them comes first: the open gesture
(a carry's Q/E/F), the held tool, the body, then the key map over
**attention** (the selection, else what you look at). A key a surface shows
is computed by the same resolver that dispatches it, so a shown key works.
Escape pops exactly one layer: the pointer lock, a field, a popover, the
gesture, the tool, the selection; never the body or the clock.

The other kinds of contribution combine without order mattering where
they can: camera limits intersect, lenses stack, audiences are unions and
intersections, and a surface collects every verb that applies to its target.

## How the examples compose

The model is only general if each of these is built **purely from
contributions**, without the stage knowing what it's for, and without any
of them being the default the others are measured against.

**Tabletop games.** A game is a JSON document (tabletop's format: pieces,
looks, where everything starts); *Set up a table* lays it out as objects
with traits. The tabletop package gives cards and hands their verbs
(Shuffle, Draw, Wash) and a policy saying who may see a card's face; a
**keeper** (the keep or card-table package) holds what each card really is,
away from the scene doc, and shows each viewer only what the audience
allows. The **seats** package is the seats, the roster, a claim per seat
and the seat body. Pieces carry the `scene.carry` trait, so the scene's
carry moves them, snapping to the board's connectors. Dice and bags are
packages of their own on the same table. None of them knows the others by
name: they meet through conventions (`roster`, `seatPlaces`, `keeper`).

**The sailboat.** A sea is a scene trait; a sloop is a hull with
`sailing.ship` and her fittings attached under her, each with a trait
(helm, sail, winches, windlass, ladder). Her physics is a process on the
doc's clock: one view steps it and streams her pose, the rest draw her
where it says, at the moment its sea is drawn. Her crew walk her deck in
sailing's aboard body and take a station with F, pushing the station body.
Her companionway is two other packages' traits: a hatch that slides
(`joints.slide`) and an exit (`traversal.exit`). A card game laid on a
table in her cockpit is carried, seated and screened by the same packages
as on land, riding her frame: face up is the table's up, however she heels.

**Doom's E1M1.** Dropping a WAD lays out its first map: the doom package's
provider builds a GLB of the static map, one per door and one per exit
switch, all from the one WAD document. The doors get `joints.slide`, the
exit switch `traversal.exit`, the player 1 start arena's spawn part
(`walk.spawn`), and the scene `arena.level` for its sky. You walk it in
the walk body with arena's gun as the held tool; joints' process closes the
doors on world time. Nothing outside the doom package is Doom-shaped, and
the doom package imports none of the others.

**Building (CAD, boats).** Selection, the halo, numeric transforms with
units, snapping to connectors, measure and dimensions, the outline and the
inspector are shared parts, each written once as a contribution. A
parametric source contributes its own handles; a hull designer docks its
editor in the drawer.

## Where today's code stands

Build steps 1–7 of [COMPOSITION.md](COMPOSITION.md)'s order are built:
nearness in the chain, the drawer, selection and carrying by trait, content
kinds, seats as a package, bodies and the held tool, and the clock.
[STAGE.md](STAGE.md) is the contract for all of it. The stage is
`src/stage/`; the shared parts are `src/parts/`; the other packages
(tabletop, seats, dice, bag, keep, card-table, sailing, joints, traversal,
walk, arena, doom) are top-level folders of this repo, each standalone.

Next are step 8 (activities and `requires` go) and then scenes inside
scenes: one stage per open document, sharing one view, so a card game on a
ship's table is its own doc, linked onto the table
([COMPOSITION.md](COMPOSITION.md)).
