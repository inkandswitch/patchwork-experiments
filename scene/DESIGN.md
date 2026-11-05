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
| **Viewer** | Someone turns it on; it belongs to them, not to the doc | An editing kit; a camera style |

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

### Kits: bundles over shared parts

A **kit** is a named set of contributions that gets mixed into a scene
together. It isn't one built-in editor. There are many kits, one per task,
for example:

- general modelling;
- hull fairing for a boat;
- laying out a game table: seats, zones, snap points;
- building an FPS level: spawns, targets, cover.

Several kits can be on at once.

A kit adds no new mechanism. It only chooses and arranges **shared parts**:

- selection;
- the transform gizmo and numeric transforms;
- the outline and the inspector;
- snapping;
- measure and dimensions;
- standard views.

Those parts are common infrastructure. Each is written once as a contribution
and any kit can pull it in, as can a game: the table could take selection for
its setup step. Kits differ in which parts they include, what they add, and
which surfaces present them.

Like any contribution, a kit is a plugin, so another package can ship one.
Which kits a scene suggests can be named in the doc; which ones are actually
on belongs to each viewer.

### Arbitration

Once anything can contribute, the stage's real job is deciding who handles
what.

Input bubbles, and each step may claim it or pass:

1. a tool someone explicitly armed (measure, say);
2. the object under the pointer;
3. what that object is attached to, then its group;
4. the scene's traits;
5. viewer contributions;
6. otherwise drag orbits the camera.

The other kinds of contribution combine as follows:

- Keys follow the same chain, starting from the hovered or targeted object.
- Camera limits intersect.
- Lenses stack.
- A surface collects every verb that applies to its target.

### Where today's code stands

`scene:extension` already covers scene-scope activation, commands, lenses,
drop and landing rules. Objects already contribute connectors and handles
through their GLB or source. Still missing:

- object-scope and viewer-scope activation;
- gestures and the claiming chain (move, rotate and hand become
  contributions);
- widgets in the stage's layers;
- surfaces as contributions (these replace `panels` and `hud`);
- commands that take a target;
- the stage itself, carved out of `src/tool.js`;
- today's toolbar, outline, inspector, gizmo, measure and dimensions split
  into shared parts, with a general modelling kit that bundles them the way
  the scene looks now.

## Use cases that prove it's general

The model is only general if each of these can be built **purely from
contributions**. Each must work without the stage knowing what it's for, and
without any of them being the default the others are measured against.

1. **Building (CAD, boats).** Editing kits over the shared parts:
   - select then edit;
   - gizmo and handles;
   - snapping to grid, vertices and connectors;
   - numeric transforms with units;
   - view cube, standard views, ortho, section plane;
   - measure and dimensions;
   - outline, inspector, status bar.

   Parametric sources contribute handles. A boat-specific kit adds its own
   tools to the same parts.
2. **Playing at a table (tabletop).**
   - Drag always carries; right-click actions at the pointer; hovering a
     card shows it full size.
   - Seats you click to sit at, players around the table, your hand as a fan
     in screen space.
   - A seat camera that can't go under the table.
   - Hidden cards through the deck's lens.
   - No editing UI at all unless a viewer turns on a kit, such as the
     table-layout kit.
3. **First-person (a little FPS with a HUD).**
   - Exclusive input while playing (pointer lock, mouse-look, WASD): an armed
     tool at the top of the chain.
   - A per-frame hook.
   - Raycasts for shooting and for walking into walls and up onto things.
   - A camera fully driven by the contribution.
   - A HUD in the screen layer (crosshair, health, ammo, score).
   - Targets as objects that contribute "can be shot".

   The level is ordinary scene objects, so it can be laid out with a
   level kit (the shared parts plus spawns and targets) and then played. This is the case that exercises the
   per-frame and exclusive-input primitives the other two don't need.

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
