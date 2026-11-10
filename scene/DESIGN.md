# scene: where it's going

A direction, not a description: [README.md](README.md) says what the scene
does today. This note covers what it should become and the use cases that
have to fit before we believe the model is general.

## The model: a stage, and contributions

The scene core is a **stage**. It holds:

- the doc, its sync and its upgrades;
- rendering;
- picking: what's under the pointer, and pointer events that carry that hit;
- a camera rig that can be driven and limited;
- a world-space layer and a screen-space layer to draw into;
- drag helpers that can be called on: carry with connector snapping, drag
  along an axis, the transform gizmo, handles;
- presence;
- the lens (how an object looks to this viewer).

The stage has no UI of its own: no toolbar, sidebar, modes, keys or
selection.

Everything else is a **contribution**, and anything may contribute.
Contributions come from three scopes:

| Scope | Active when | For example |
|---|---|---|
| **Object** | The object is in the scene: by its kind, source or tags | A deck draws and shuffles; a die rolls; a hull has a trim handle; a target can be shot |
| **Scene** | The doc carries the trait | Seats, zones, the face-up rule; a snap grid; units; an arena's rules |
| **General** | It needs nothing in the doc: it serves whatever the viewer is doing | The editor's toolbar and outline; the key map; notices |

A contribution can provide:

- **Verbs:** commands that act on a *target*, not on "the selection".
- **Gestures:** claims on pointer and key input.
- **Widgets:** things drawn in the stage's layers.
- **Surfaces:** things that present other contributions' verbs. A toolbar, a
  radial menu, an inspector and a key map are all surfaces.
- **Lenses and constraints:** how something looks; snapping; camera limits.

What isn't contributed doesn't exist. A card table has no outline because
nothing there contributes one. It isn't hidden.

Docs name plugins by id and never carry code, so a contribution's code always
comes from installed packages.

### Activities: what a viewer is doing

An **activity** is what someone is doing in a scene: editing it, playing
it, later reviewing it or sailing it. It is one value per view, and each
viewer has their own: one person can lay out the next room of a level while
another plays the first. Every contribution says which activities it takes
part in (none said means all of them), and a scene offers an activity when
something with a reason to be there takes part in it. Editing is always on
offer; a scene with an arena's traits also offers play.

Activities choose among **shared parts** without bundling them:

- selection;
- the transform gizmo and numeric transforms;
- the outline and the inspector;
- snapping;
- measure and dimensions;
- standard views.

Those parts are common infrastructure. Each is written once as a
contribution, takes part in editing, and anything can pull it into another
activity by requiring it: a card table in play brings the hand and the key
map, and nothing else of the editor.

The doc says where people **start** (`view.activity`), and a template that
makes a level says "play", so whoever opens it, its maker included, is in
the game. Each viewer switches from there.

**Why not kits.** This used to be kits: named lists of contributions,
mixed into a scene together, suggested by the doc and turned on and off by
each viewer. Kits answered "which tools do I have", and that turned out to
be the wrong question. Joining a level dropped you into a level editor,
because the doc suggested the editing kit and the game was just another
thing switched on beside it; getting into the game meant knowing which kits
to turn off. A kit was also a second, parallel way to make something run
(beside traits), with its own ordering, nesting and per-viewer persistence,
and every kit had to list the shared parts by name. An activity replaces all
of that with one question, "what are you doing here", one value per view
and one flag per contribution. What runs follows from the doc and that
value; nothing is listed, nesting has no meaning, and nothing is kept.

### Arbitration

Once anything can contribute, the stage's real job is deciding who handles
what.

Input bubbles, and each step may claim it or pass:

1. a tool someone explicitly armed (measure, say);
2. the object under the pointer;
3. what that object is attached to, then its group;
4. the scene's traits;
5. general contributions;
6. otherwise drag orbits the camera.

The other kinds of contribution combine as follows:

- Keys follow the same chain, starting from the hovered or targeted object.
- Camera limits intersect.
- Lenses stack.
- A surface collects every verb that applies to its target.

### Where today's code stands

All of the above is built, and [STAGE.md](STAGE.md) is its contract. The
stage is `src/stage/`; activation has all three scopes; input goes down one
claiming chain; widgets sit in the stage's layers; commands take a target;
and the toolbar, outline, inspector, gizmo, hand, measure and dimensions are
shared parts (`src/parts/`) that together, while editing, make the editor.

## Use cases that prove it's general

The model is only general if each of these can be built **purely from
contributions**. Each must work without the stage knowing what it's for, and
without any of them being the default the others are measured against.

1. **Building (CAD, boats).** Editing, over the shared parts:
   - select then edit;
   - gizmo and handles;
   - snapping to grid, vertices and connectors;
   - numeric transforms with units;
   - view cube, standard views, ortho, section plane;
   - measure and dimensions;
   - outline, inspector, status bar.

   Parametric sources contribute handles. A boat package adds its own
   editing tools to the same parts.
2. **Playing at a table (tabletop).**
   - Drag always carries; right-click actions at the pointer; hovering a
     card shows it full size.
   - Seats you click to sit at, players around the table, your hand as a fan
     in screen space.
   - A seat camera that can't go under the table.
   - Hidden cards through the deck's lens.
   - No editing UI at all while playing; switching to editing lays the
     table out.
3. **First-person (a little FPS with a HUD).**
   - Exclusive input while playing (pointer lock, mouse-look, WASD): an armed
     tool at the top of the chain.
   - A per-frame hook.
   - Raycasts for shooting and for walking into walls and up onto things.
   - A camera fully driven by the contribution.
   - A HUD in the screen layer (crosshair, health, ammo, score).
   - Targets as objects that contribute "can be shot".

   The level is ordinary scene objects, so it can be laid out while
   editing (the shared parts plus spawns and targets) and then played. This
   is the case that exercises the
   per-frame and exclusive-input primitives the other two don't need.

4. **Sailing (a ship you crew together, the *Sea of Thieves* way).** The
   boat built in the editor goes on the water, and its crew walk its deck
   and work it with their hands:
   - walk the deck of a moving, rocking ship, riding in its frame;
   - walk up to a station (helm, sails, anchor, a cannon) and use it with a
     prompt ("F to raise the anchor"), some verbs held as long as the key is
     down; one player per station, and everyone sees who is where;
   - carry things in your hands (a bucket, a plank, a lantern) that others
     see you holding;
   - one peer simulates the ship (wind, heel, buoyancy) and the rest follow
     its pose, with a handoff when that peer leaves;
   - cannonballs and spray simulated locally from sends; damage and water in
     the doc;
   - sky, sea and sun through atmosphere and an ocean extension.

   This is the case that forces two decisions the others dodge: who owns
   time, and what a person is (presence that rides in a frame and can hold
   things). It also needs claims, a use prompt over commands, scopes that
   move, and precedence by nearness. [SCOPE.md](SCOPE.md), sections 5, 6 and
   9, lays out each with a recommendation. Each is a general capability, so
   the arena and the table can use them first.

### Later: hybrids

The real test, and deliberately not a goal yet. Kinds of scene should mix,
because they're only sets of contributions:

- a boat placed in the game world;
- walking around on board a boat model;
- playing cards on a table in its saloon.

That needs:

- contributions to compose by object and region, not per scene;
- arbitration that holds up when two kinds want the same input (carrying a
  card while in first-person, say);
- seats, zones and arenas that can sit inside an attachment, so they move
  with the boat.

Design the pieces above so nothing rules this out, even before we build it.
