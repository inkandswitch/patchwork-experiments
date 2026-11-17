# sailing: a ship you crew together

A water body (the water package's `water` object trait) becomes a sea when
it carries the `sailing.sea` trait, a scene has wind and sky when it carries
the weather package's `weather` (weather/WEATHER.md), and an object becomes
a ship when it carries `sailing.ship` (water/WATER.md, "Water bodies"). Everything else is objects
attached under the ship (stations, the mast, the sail) and contributions from
this package and the scene's shared parts. The requirements are use case 4
in [../scene/DESIGN.md](../scene/DESIGN.md) and section 9 of
[../scene/SCOPE.md](../scene/SCOPE.md); this note fixes the conventions the
modules share.

## Conventions

- **Units:** SI. Metres, seconds, kilograms, radians inside code; the doc
  may store degrees where a person edits it (`from` below) and says so.
- **World:** +Y up, gravity 9.81 down. Sea level is y = 0.
- **A ship's body frame:** **bow toward −Z**, **starboard toward +X**, up
  +Y. The waterline is the body's y = 0 at rest, so the keel is at −draft.
  (A person at yaw 0 looks down −Z, so standing at the helm facing forward is
  the ship's yaw.) For the sloop it is her hull object's own frame; a hull
  modelled some other way says where it sits in hers (below, "The ship's
  frame").
- **Wind direction:** `from` is the compass direction the wind blows
  *from*, in degrees, measured from −Z (north) toward +X (east), as sailors
  say it. A wind "from 0" blows toward +Z. Velocities in code are vectors.
- **Densities:** water 1025 kg/m³, air 1.225 kg/m³.
- **The `wind` ambient** is the weather package's: it offers it from the
  outermost doc's `weather` trait, and documents its value
  (weather/WEATHER.md, "What it offers"; scene/STAGE.md, "Conventions",
  points there). Sailing offers no ambient. It reads the wind twice: its
  physics makes it a wind in each stage's frame (`sea-view.js`, by
  `wind.js`: `seed` and `gustiness` make its gusts), and every sea builds
  its waves from it (`sea.js`). Its `from` is the compass convention above.

## Modules (sailing/src)

| Module | Pure? | What it is |
|---|---|---|
| `ocean.js` | yes | The sea's spectrum: a wind-driven directional wave spectrum sampled into Gerstner components (`seaWaves`), plain data. The water package evaluates them, for the shader and for physics and walking (`heightAt`, `normalAt`, `velocityAt`), so what floats is what you see. Sailing keeps no evaluator: its tests' fakes use a copy of water's (`test/surface.js`), pinned by the golden file |
| `sea.js` | yes but for create() | The sea, its own scene:extension on the object trait `sailing.sea`, a behaviour on a water body: for each object with both the sea and the water package's `water`, it builds the spectrum's components from the world's `wind` ambient in its stage's frame and gives them, with what only it knows of them (seed, stats), away as `water.waves` keyed by body (the water package's convention); on a new wind (by value) it asks for one more flush; it draws nothing and runs no ships, so a harbour's sea holds no sailing machinery (water/WATER.md). The surfaces (the open grid round the camera, a bounded body's patch, the Gerstner shader) are the water package's `material.js` |
| `wind.js` | yes | The true wind at (x, z, t): a base speed and direction from the doc, with gusts and veers from smooth deterministic noise |
| `physics.js` | yes | The ship as a rigid body: buoyancy sampled over the hull against the ocean, keel and rudder as hydrofoils, the sail's lift and drag from the apparent wind (the boom swinging toward where the wind and sheet put it, no faster than 200°/s), hull resistance rising toward hull speed (and much more going astern), an anchor whose pull is bounded by what it holds, and the wind on her hull, mast and rigging, each a windage element of her contract's (§3.13) or of `plainWindage`'s, in its own air (§6.1, windage.js `elementForce`). `step(state, controls, env, dt)` |
| `glb.js`, `ship.js` | yes | A procedural sloop as GLB bytes: hull, deck, mast, boom and sail, wheel, capstan, ladder, companionway and its hatch; the hull's connectors (`STAND`), the sail's size (`extras.sail`) |
| `parts.js` | yes but for files | The parts bin's parts (scene:part): the sloop whole, mast and sail, wheel, windlass and anchor, ladder, mainsheet, jib winches, companionway, buoys, islet; squared to the ship they're put on (`placement`), one GLB doc per kind per scene (`ctx.file`) |
| `layout.js`, `template.js` | no | The "Ship at sea" template: the weather and a Sea (a water object with a sea on it, first in the order: `bringSea`; its `clip` the box of her layout, `seaClip`: her swing circle or start and the landmarks, 10 m to spare, centred and turned with the layout, so in a world with no open water she floats on a block of her own sea: water/WATER.md, "Clipped open water"), the Sloop part with her way on (`sailing.ship.motion`) on a beam reach, landmarks. "Ship at anchor" (`layOutShip(ctx, { anchored: true })`): head to wind, still, sail down and anchor down (`AT_ANCHOR`), off the islet (`ANCHORAGE`), in a moderate breeze (`ANCHORAGE_AIR`, 6.5 m/s). At anchor her jib is rolled away (`furl: 1`); B at the helm unrolls it backed to leave ("Leaving the anchor") |
| `rig-contract.js` | yes | The rig aid's contract (`extras.rig`, patchwork-rig v1) in her body frame: whether this ship takes it (`contractOn`: a contract naming the hull family it describes only on that family), its frame (`rigFrame`), the whole contract converted (`bodyRig`, with her drawn hull when it's the one the rig was designed on), the spec parts it fills (`rigSpecParts`), §3.13's elements in her body frame (`windageInBody`: a contract's, and the plain path's), the hull it was designed on checked (`checkSource`) |
| `stock-rig.js`, `stock-rig-12m.js` | yes | The stock sloop's own contract (`stockContract(rigDrawing())`, on her `rig@4` GLB): the 12 m fixture's hull, its windage element, foils, resistance, sail model and loading (`stock-rig-12m.js`, a runtime copy of those parts), with her rig and its windage computed from where ship.js draws it by the specification's rules (`stockMain`, `stockJib`, `leadAt`, `lumpedSailOf`, `rollUp`, `windageOf`, `rm30Of`). See "Trim feedback" |
| `windage.js` | yes | §3.13's windage elements and §6.1's force on one (`hullElement`, `rigElements`, `planOf`, `contractElement`, `elementForce`, the one force law physics.js flies): naval's `naval/windage.js` rules, copied (its header says what differs) |
| `resistance.js` | yes | A rig contract's resistance table (§6.5) unpacked for the 120 Hz loop: the canoe body's R(V, φ) with its planing blend, the planing weight, and the induced drag's effective draft (`contractResistance`) |
| `body.js` | yes | A ship's body frame: where it sits in her hull's (`frameOf`), her pose through it and back (`toBody`, `toObject`), her body frame as drawn (`bodyOf`), and where a thing aboard sits in her (`placeIn`) |
| `traits.js` | yes | The doc's vocabulary: trait keys, claim kinds, station defaults, the wheel's and the boom's turn on top of how they were put (`wheelTransform`, `rigTransform`), the quarter view, and walking the tree as the stage resolves it (`parentOf` from `scene().parents`, `shipOf`, `partsOf`). Every part reads the doc through this |
| `frames.js` | yes | Matrices (`apply`, `invert`, `multiply`, `matrixOf`, `rotateM`, `unrotateM`, `headingOf`, `onHeading`) and quaternions (`rotateQ`, `mulQ`, `quatFromEuler`, `eulerFromQuat`, `poseOfMatrix`) |
| `play.js` | no | The sailing extension in play: joins the parts below, runs them in one loop in the order a frame needs, and sets the presence rate |
| `sea-view.js` | stage side thin | ctx.sea, an adapter: `oceanAt(p, not)` asks the water package which water a point is in (`api.collect("water")`'s `at(p, { not })`: the world's open water in this stage's frame and time, or a bounded body of this doc, leaving out what `not` carries), its wind the world's `wind` ambient read through the same frame and a latched time (`windFor`: its at(), speed and from all in the stage's frame). It has no clock: its time is the doc's world time, `api.clock.t()`, which each reader asks itself. Alone a boat is her own world and these are exactly her own sea; linked into a harbour, the harbour's |
| `sim.js` | stage side thin | ctx.sim: the ships as a process of the doc's clock (`start`, `step`, `save`, `stop`), physics per ship, the holds, the stations' values (pure helpers exported and tested) |
| `looks.js` | stage side thin | What each view dresses for itself: floats bobbing (pure `floatPose`); on a rig with `extras.sail.cloth`, the sails' cloth, battens, bunt and roll, the mainsheet and jib sheets, the telltales, the masthead vane and the burgee, all from trim.js and cloth.js, written into buffers made once; a rig without cloth lowered, bellied to leeward and flat while it luffs (pure `fullness`) |
| `cloth.js` | yes | A sail's cloth grid as a function of its look (`clothVertices`: belly, flog, σ, reef, furl, flat, flutter), its normals, battens and outline; ship.js draws the GLB's `Sail` and `Jib` with it at `NEUTRAL` |
| `crew.js` | stage side thin | ctx.crew: coming aboard (`api.body.enter("walk", hull)`: walking her deck is walk's) and the `station` body, pushed over walk, its eye walk's walker's at the station's stand spot (walk's `stand` contribution); what the viewer is doing (`viewerOf`: the top body, its declared keys, walk's `avatar`); the orbit following her before anyone is aboard |
| `stations.js` | mostly | The verbs for the use prompt: the helm (with the sheet led aft to it), the sail and sheet (at the rig or the mast), the windlass (pure held-verb sessions, each moving by the world time it's held, in whole steps of the world's grid: `worldSteps`, "Determinism") |
| `hud.js` | model pure | Crosshair, the sailing panel (speed over the ground, heading, a dial with the apparent and true wind, a row per sail on a contract ship (`sailRow`, from trim.js) or one Sail row, anchor), the hint line, and what to do head to wind before she's in irons (`luffing`) and once she is (`inIrons`) (`hudModel`). It only reads: (S1) it never holds a button; the way in is stations.js's `aboard` command (Enter, and `show: ["world"]`, so a *Come aboard* button on the stage's bar of tools in every body: scene TOOLS.md Decision 10); (S2) that command applies exactly before you're aboard (the null target, not playing); (S3) the HUD shows where her doc is the world or while you're aboard. Before you're aboard the HUD is the dial alone and says nothing: what a click on her does is the base's (Look's comes aboard, Edit's selects, a seat's is the game's), which a package may not ask; its sheet's one `pointer-events` is the root's `none`, so no node of it takes a press in any state (`hud.test.js`; Decisions (N11) 1); aboard, the walking hint is the keys the top body declares (`keysHint`: walk's own) |
| `trim.js` | yes | Each sail's trim from the physics' read (`trimOf`): α_sheet, flog, σ, belly, and its state (down, wing, backed, luffing, stalled, drawing), on its family's thresholds (`trimModelOf`); the sheets' slack (`mainsheetSlack`, `jibSheets`, `sheetSlack`) and their curve (`sheetCurve`), the flutter, the telltales, the vane and the burgee |

`probes/sailing-run.mjs` plays all of it in a browser: two views of one
doc, crewing her together (see its header). Its page seeds `Math.random`
(`--seed N`, default 1), and the probe writes the sea's own seed into the
doc before the world first runs (`--sea N`, default the `--seed`), so a
run's sea and wind don't depend on how many ids were drawn before the
template drew its seed (`aboard-run.mjs` pins its sea the same way). Not
every sea exercises the leave step: it is gated on the HUD saying to back
the jib, and on some seas the anchor breaks out with her well off the
wind, so the step reports itself not exercised. Which seas, and why that
is an open defect in her physics rather than a property of the probe, is
under "Leaving the anchor" (the probe records its anchoring timeline,
`measured.anchoring`, which `src/test/breakout.js` replays in node). With
`--trace <file>` it also writes every step of world time the computing
view took, as taken, and `probes/trace-diff.mjs` names the first step two
runs differ at ("Determinism": runs of one seed and sea are identical, step
for step, through the leave step). `probes/camber-run.mjs` takes a
hull drawn in camber (its built plugins, borrowed at dev time) from a bare
sea to sailing: the Ship trait with her frame from her GLB, the parts
dragged from the bin onto her deck, floating, sailing bow first, stood on
and steered. `probes/aboard-run.mjs` sets a game aboard her with the tools
themselves (Ship at anchor, then tabletop's Card table and Lost Cities
parts, every package's built dist loaded as plugins, none imported) and
plays it: seated views riding the table, drawing, carrying and flipping on
it at anchor and under way, clicks and drags that mustn't board or move
her, first person and back to the seat. `probes/publish-aboard.mjs` makes
the same scene and publishes it.

## Shared interfaces

```js
// ocean.js: the spectrum only (sailing evaluates no waves)
const sea = seaWaves({ wind: { speed, from }, seed, scale })  // scale: wave height multiplier, default 1
sea.components  // [{ dir: [dx, dz], k, omega, amp, steep, phase }], ≤ 32: sea.js gives them to the water package
sea.stats       // { hs, peakPeriod, peakWavelength, whitecaps }

// ctx.sea.oceanAt(p, not): the water package's reader of the water p is in (its surface.js evaluates)
ocean.heightAt(x, z, t) → y          // surface height at (x, z) in this stage's frame
ocean.normalAt(x, z, t) → [nx, ny, nz]
ocean.velocityAt(x, y, z, t) → [vx, vy, vz]  // orbital velocity, decaying with depth

// wind.js
const wind = createWind({ speed, from, seed, gustiness })   // gustiness 0..1, default 0.3
wind.at(x, z, t) → [vx, vz]        // true wind velocity, m/s

// physics.js
const ship = createShip(spec)       // spec below; derived from the hull's box when not given
const state = ship.rest({ position, yaw })  // floating level at the waterline, still
ship.step(state, controls, env, dt) → state   // pure: returns a new state
ship.read(state, controls, env)     → diagnostics
ship.wrench(pose, motion, controls, env) → { force, torque, cg, boom, weight, crew? }  // no integration
ship.inertia, ship.cg               // kg·m² body [pitch, yaw, roll]; her CG, body
// state:    { position: [x,y,z], quaternion: [x,y,z,w], velocity: [x,y,z], spin: [x,y,z], t }
// controls: { rudder: -1..1 (+ turns to starboard), sail: 0..1 (how far raised),
//             sheet: 0..1 (0 hauled in tight, 1 let right out), anchor: null | { at: [x,y,z], rode } }
// env:      { water: sea, wind }   (anything with heightAt/normalAt/velocityAt, and at)
// diagnostics: { speed, heading, heel, pitch, leeway, apparentWind: { speed, angle },
//                boom (radians, + to starboard), sailForce, submerged (0..1) }

// spec: { length, beam, draft, freeboard, mass, sail: { area, luff, foot, tack: [x,y,z] },
//         keel: { area, depth }, rudder: { area, at: [x,y,z] } }
```

The physics is integrated at a fixed 120 Hz inside `step` (substeps), so
any `dt` gives the same motion.

What the modules offer beyond that (as built):

```js
sea.stats   // { hs, peakPeriod, peakWavelength, whitecaps }
sea.sampleAt(x, z, t, out?) → [y, nx, ny, nz]   // height and normal from one solve
sea.displaced(x0, z0, t, out?) → [x, y, z, J]   // the forward Gerstner map the shader runs
// normalAt, velocityAt and wind.at take an optional out array last

// (the drawn surface is the water package's material.js, which draws the world's water)

ship.hullSpeed; state.acc  // the substep remainder; position/velocity are the body origin's, spin world ω
state.boom                 // where the boom is (radians, + to starboard); missing: where the wind puts it
state.crew                 // a rig contract's crew only: where they sit, −1..1 of their arm (+ starboard)
// step takes at most MAX_SUBSTEPS (30) a call and drops the rest: the caller skips it (sim.js catchUp)
// controls.anchor.at: where the anchor lies (world); sheet defaults to 0.5
// read(): speed forward through the water (− astern), pitch + bow up, leeway + to starboard,
//         submerged: fraction of the whole hull's volume under water (~0.19 at rest)
// spec extras: cg (body y of the centre of gravity), center ([x, z]); specFromBox(box, overrides)

// sim.js: a ship's spec from what she's made of, in her body frame
specFor(content, overrides, scale, { frame, rig: { matrix, sail, contract }, hullUrl })
specKey(spec)   // what her physics is keyed on (a contract by name, not stringified)
```

The parts' GLBs (ship.js) are drawn in the ship's body frame, each with its
origin where it pivots, and `FIT` gives each part's place on the hull. The
boom-and-sail object ("rig") swings about its own Y, on top of however it
was put (its held rotation is placed · turnY(boom), + to starboard); its
sail is cambered to starboard, so with the boom to port it is mirrored on
each view (looks.js), and flattened while it luffs; the gooseneck is 1.45 m
over the deck, so the boom swings clear over a head in the cockpit. The
wheel turns about its own Z the same way (placed · turnZ). The anchor hangs
from its ring at its origin.

What a GLB may say, in its scene's extras:
- a hull: `ship: { length, beam, draft, freeboard, displacement, forward,
  up, origin }`, all in the GLB's own frame and units (metres): its
  principal dimensions (its box is bigger: cabin, sheer, lifelines), about
  her body's origin; `displacement` in kg, her mass; `forward` and `up`,
  which way its bow and its deck face in the model (camber's: forward
  [1, 0, 0]); `origin`, a point on the design waterline midships (the
  middle of the waterline's length, on the centreline), where her body's
  origin is. The waterline is the plane through `origin` square to `up`. A
  GLB that states `forward` but no `origin` has it guessed: the middle of
  its box, level with the model's y = 0. And `connectors` (as the hand
  reads them, with tags) and `snapRadius`: the sloop's say where her mast,
  wheel, windlass and ladders stand (`STAND`), 1.5 m of reach each, so the
  parts bin and the hand snap each there;
- a rig: `sail: { tack, clew, head, luff, foot, main, jib, plan }`, in its
  own frame. The first are the sail as drawn (the main's points, luff and
  foot; `main` 32 m², `jib` 31 m², the fore-triangle her rolled jib
  fills). `plan: { tack, luff, foot, area }` is what the physics flies:
  main and jib as one foil, whose centre of effort sits lower than the
  main's alone. The sloop's is the `SLOOP` spec's sail, put in the rig's
  frame, so a stock rig at its stand sails her exactly as physics.test.js
  tuned her.

A ship's spec (`specFor`) is, in order: her size from her GLB's dimensions
or her box (in her body frame), else the sloop's; her mass from her
displacement, else the sloop's scaled to her size; her sail from her rig's
`plan`, its tack where the rig is placed (up its chain of parents, through
her frame) and its size at the rig's scale, so moving the mast aft moves
her centre of effort aft and she gripes up more; then the trait's `spec`
overrides over all of it. A rig that states no `plan` (a scene's rig filed
before it had one) leaves her the sloop's sail scaled to her hull, as
before rigs were read.

## The ship's frame

The physics, the crew, the stations, the HUD and the looks all reason in
her body frame (bow −Z). A hull modelled some other way (camber's: bow +X,
the design waterline at Y = 0, metres) says where that frame sits in her
hull object's frame, and `body.js` is the one place that converts:

- `frameOf(trait, content, contract)`: what her rig's contract says
  (`rigFrame`, below) if her sail station carries one, else what her GLB
  says (`glbFrame`: turned to
  `extras.ship.forward` and `up`, her origin its `origin`, else guessed as
  above), with `sailing.ship.frame`'s `position` and `rotation` (in the
  hull's frame), each where the trait gives it, over it: a trait that only
  turns her keeps the GLB's origin. A hull that says nothing is her body.
  The sloop states none.
- sim.js turns the hull object's pose into her body's once, where she's
  tracked (`toBody`: from the doc, from the pose last shown, after an
  editor's move), and back where she's held and saved (`toObject`). Her
  `motion` in the doc is her body's (velocity of her body's origin, world
  spin). physics.js never sees the hull's frame. If her frame changes while
  she sails (her model loads and says which way is forward, or someone sets
  it), her hull stays where it is and her body turns in it.
- `bodyOf(api, id)`: her body frame as drawn (worldOf · frame), rigid: in
  metres whatever her hull object's scale, as `toBody` gives the physics (a
  hull drawn a metre long and scaled to twelve is walked in metres), and
  `bodyBoxOf(api, id)` her box in it, in metres too. The crew stand in it (their presence `position` is in it), the HUD and the
  sail's dressing read it, and the camera's quarter view is off it.
- Her bow fairlead, her anchor's drop point and the keel and rudder are
  the spec's, so in her body frame already. The anchor lying on the bottom
  is held in the frame of whatever it hangs from aboard.

## The rig contract

The rig aid (in `naval/`, a separate package) designs a rig on a hull and
states it as `extras.rig` on the rig GLB it builds: patchwork-rig v1, whose
specification (`naval/contract/v1/specification.md`) is the authority,
§6 most of all (how a consumer composes forces from it). Sailing reads the
JSON; it imports nothing of `naval/`'s. Everything that follows is
gated on a contract being present and taken: a ship without one sails the
plain path (`specFor`: her box, her `extras.ship` and the rig's
`extras.sail`; `createShip` without `spec.rig`). The stock sloop carries
one on her rig's GLB ("Trim feedback" item 1). Two live cases sail the
plain path: a rig file with no `extras.rig`, and the stock rig on any hull
but her own (camber's), where her contract isn't taken.
`stock-rig.test.js` pins the plain spec key for key for both. A contract
is read (`rigContract`) only in v1's current shape: with its frame matrix,
mass, hull and the windage elements the schema requires (§3.13). Any
`extras.rig` stated before v1 had windage (naval 01b9b8cb) is not read and
sails the plain path until it is restated: no back-compat. That is every
doc holding `sailing/rig@3`, and any rig-aid GLB exported before then. Not
read means not read anywhere: the physics, and the contract sails' trim
models the HUD, the looks and the jib station read (`sim.sailModels`), all
go through the same gate (`body.js` `rigContractOf`, `contractOn`).

**What sailing reads of v1: all of it that §7 gives its physics.** §7's
list is the one list; two things differ from it. `windage` is read: §7
still says "not yet" (written before N6), but since N6 (2026-11-16)
sailing's rule of its own is gone, and §3.13's elements, each pushed by its
own air as §6.1 says, are sailing's windage ("Windage" below; a ship
without a contract has the elements stated from her box). And of fit-out's
parts, which §7 says only `loading.crew.stations` of is read, sailing also
reads `hardpoints`, to draw the sheets. The stock sloop's contract is on
`sailing/rig@4` (parts.js `VERSIONS`), the first to state windage.

The copies (`test/rig-contract/`: naval's schema, validator, `compose.js`
and five valid fixtures; `windage.js`: naval's windage rules) are copies,
never links. `windage.test.js` holds each copied file to its sha256 and
`windage.js` to what naval states with its rules (every fixture's
elements and mast sections, and compose's §6.1 windage force over a finite
table of states), so an edit to a copy shows. A change in naval doesn't,
since sailing stands alone: to take a newer contract, re-copy them all and
rewrite that table.

- **Frame.** The contract is x forward, y port, z up, the design
  waterplane at z = 0; the body is (−y, z, −x) of it. `frame.glbToFrame`
  takes the hull's glTF (and the rig GLB's) into the contract's, so her
  body frame in her hull object is inverse(glbToFrame) · (body →
  contract): `rigFrame`. It takes the place of her GLB's guess in
  `frameOf`; the trait's frame still wins. The rig is meant to be at the
  identity on her: placed elsewhere, the contract's places still hold, and
  her spec says so.
- **Spec** (`specFor`'s contract path, ahead of her hull's facts and her
  box): the box her columns are built over is her waterline's length
  (between its ends), her overall beam, from the deepest foil to the sheer;
  her mass is the contract's roll-up, her CG's height its `cgM`, her sail
  its lumped sail (§6.8: what places the wind she reads; her sails are
  flown separately, below, and her windage is the contract's elements), her keel and rudder the contract's areas at their
  MAC quarter chords, the rudder's travel its `maxDeg`. `spec.rig` is the whole contract in her body frame
  (`bodyRig`: points converted, lengths ×k, areas ×k², masses and volumes
  ×k³ at her hull object's scale k; coefficient and force tables by
  reference, so at k ≠ 1 they don't hold, and `spec.rig.warnings` says
  so). The rig's `source.hull` is checked against her hull object's
  `sourceUrl`: a rig designed on another hull, or on a synthetic one,
  warns (sim.js logs each warning once per spec).
- **Mass properties** (`createShip`, when `spec.rig` is there). Her CG is
  the contract's `cgM` in all three axes, not pinned over her CB, so she
  trims to it. Her inertia is m·k² from its `gyradiiM` (body [pitch, yaw,
  roll]), in place of the thinned box and the mast. `ship.inertia` and
  `ship.cg` (body) say what they are.
- **Her own hull** (`buildHull`'s contract path, hull-model.js). Her
  buoyancy columns are cast down through her own hull: 12 stations along
  her, each cut across by a plane, with 6 columns over the waterline's
  breadth and 2 more each side out over the flare to the widest the
  section goes; each runs from the lowest surface it meets to the highest
  (`meshColumns`), its depth below the waterplane scaled so she displaces
  the contract's ∇ on her lines. The hull is her drawn mesh when the sim
  has it loaded and the rig was designed on it (`hullTriangles` reads the
  hull object's model in its GLB's coordinates; `bodyRig`'s `drawnHull`
  takes it through `glbToFrame` and uses it only if it displaces the
  contract's ∇ to 5%, else warns). Otherwise it is the hull the contract
  describes (§3.3), built as the rig aid builds a synthetic hull
  (`contractHullTriangles`, its synthetic-hull.js copied: super-ellipse
  sections fitted to Cm along a sectional-area curve fitted to Cp and LCB,
  straight topsides to a flat sheer): for a rig designed on a synthetic
  hull that is exactly the hull the aid analysed; for one designed on a
  drawn hull a stand-in with its ∇, Cp, Cm, LCB, Tc and BWL and its
  waterplane's transverse inertia (BM), but not its flare. Each keel and
  rudder floats her too, a column with its middle at its volume's centroid
  (the aid floats the canoe body at ∇ − ∇_app and adds them), so she sits
  a few millimetres above her lines. Her righting moment is the contract's
  within 7% from 5° to 30° on the four synthetic hulls; cuvature's
  stand-in is 14–18% short past 5° (her flare), a known gap that her drawn
  mesh closes in the sim. 120 columns against the stock hull's 70: each is
  one of the ocean's height queries a substep.
- **Her resistance** (§6.5; `resistance.js`). The canoe body's is the
  contract's R(V, φ) table (`hullN`: ITTC-57 friction on the heeled wetted
  skin, the DSYHS residuary and its heel term, and Savitsky's planing
  blended in by §6.5.7's weight), read as §6.5 "The table" says: bilinear,
  V² below its first speed, its last heel row past 35°; past its last
  speed, where the contract states nothing, the last segment's trend, held
  where that falls (a keelboat's table stops at Fn 0.75, where the held
  regression already turns down). It acts along the flow at her CB (the
  contract's LCB), ×STERNWAY going astern, less as she leaves the water;
  below 0.5 m/s a little creep damping fades in. It replaces the invented
  m·g·(0.004r⁴ + 0.016r⁸) wave term and the box's friction for a contract
  boat. The keel's and rudder's skin friction is theirs (above), a keel's
  bulb adds its spheroid's (§6.5.4), and the induced drag is the whole side
  force's (§6.5.5): R_i = Y²/(π·T_e²·q), Y the keel's, rudder's and canoe
  body's lift across her, T_e from the contract's coefficients, along the
  flow at her LCB and the side force's height, ahead only. Upright, with no
  leeway, she meets the contract's total (its table read so, plus its
  appendage terms) to 0.1%, 0.2% on the J/24 and the Laser, whose
  transom-hung rudders' tops are dry a few millimetres above her lines; the
  table itself is within 0.5% of §6.5's formulas at every predicted point.
- **Planing** (§6.5.6–7). A hull the contract rates as able to plane (its
  `planing.capability`, from D/L) blends Savitsky's planing resistance in
  between Fn 0.55 and 0.75; that is in the table, so she meets the hump and
  then the cheaper water past it (the Laser's resistance is 2%, 7% and 14%
  below ploughing at Fn 0.6, 0.65 and 0.7), and `read().planing` says how
  far onto the plane she is (0..capability). A keelboat's capability is 0.
  The contract states fixed trim and no sinkage, so there is no dynamic
  lift: she doesn't rise onto the plane, she meets less water there.
- **Side force of her canoe body** (§6.4). Y_h = q·LWL²·|Y'v|·sin λ·cos φ
  is a linear sway damping ½ρ·LWL²·|Y'v|·V shared among her wet columns by
  their lateral area at that moment (so it doesn't grow as the lee
  topsides go under), in place of their SWAY_LINEAR (which stands slow,
  over her lateral area at rest); its sum is Y_h, and a turn's sway along
  her damps the turn. It is moved from the columns' centroid to mid-LWL,
  where §6.4 puts it, with the Munk moment N_h = ½ρ·LWL³·|N'v|·u·v (u, v
  her surge and sway in her heeled plane: q·sin λ·cos λ, §6.4's
  q·sin λ for small λ), which turns her broadside to her flow, going ahead
  (her bow to windward) or astern alike: it is the same with the flow
  reversed. (It was V·v, which changes sign going astern and so
  weathervaned her head to wind in sternway: irons was a stable
  equilibrium. "Leaving the anchor", below.) Y_h is lift, as §6.4–6.6 treat it: it lies
  square to her flow at the LCB (in her body's horizontal), so going ahead
  it leans forward by her leeway, Y_h·cos λ across her and Y_h·sin λ along
  her bow, and does no work; across her keel line only, it would cost her
  Y_h·sin λ of drag (most of each keelboat's surge residual, once windage
  is set aside, before it was turned). The columns' quadratic cross-flow
  (SWAY_CD) is not on top of it in normal sailing: it fades in, and Y_h out,
  as sin²λ at the LCB passes the keel's stall (15°: none under it, all of
  it sliding broadside), so a slow pinch or a tack's slide isn't damped
  twice, and drifting broadside she is held by the cross-flow, with no lift
  left along her keel line. (On top of Y_h it was essentially all of each
  keelboat's sway residual less windage, growing as λ².) The slow floor
  under Y_h (SWAY_LINEAR over her lateral area at rest) is damping and
  stays across her. Their heave damping is along her body's vertical,
  as every ship's (moving ahead pitched, that is her bottom's lift, which
  steadies her in a sea), less her slide across her keel line, which,
  heeled, would be a second side force on top of Y_h. (Damping heave along
  the world's vertical instead lost that lift: on a seeded sea she kept
  83% of her flat-water speed to the stock sloop's 88%; now 97%.)
- **Keel and rudder** (§6.4; `planformFoils` in physics.js,
  `planform*` in physics-foils.js). Each acts at its MAC's quarter chord,
  with lift a·α/(1 + (a·α/CLmax)⁸)^⅛, a from Helmbold with the half-chord
  sweep at the effective aspect ratio AR_geom·(1 + (k − 1)·cos²φ), CLmax =
  a·stall. That is §6.4 exactly up to the stall; past it the lift goes
  over 10° to a flat plate's, never above what it had at the stall, since
  a sim meets a foil sideways and backwards too. Drag is the contract's
  appendage friction 2·C_f(Re_MAC)·(1 + 2t/c + 60(t/c)⁴), and the induced
  drag is the whole side force's (below); a contract without a computed
  resistance gives each foil its own cl²/(π·AR_eff) instead. A contract's
  boat flies only these, at every speed and with or without a computed
  resistance: the stock ship's lumped keel and rudder (`spec.keel`,
  `spec.rudder`, derived from the same appendages) would count them twice. Its area is the wet fraction of its span (the
  quarter-chord line's ends against the surface at the quarter chord),
  acting at the wet part's quarter chord. The rudder meets the flow turned
  by the keel's downwash ε = dε/dα·α_k, dε/dα = a_k/(π·AR_eff,k), α_k taken
  as the keel's CL over its slope (so it fades as the keel stalls or comes
  out), and none going astern. Full helm is the rudder's `maxDeg` (the
  Laser's 30°). Checked against compose.js at every fixture's predicted
  points: the foils' side force and yaw moment agree to 0.2% of her weight
  (and her length).
- **Crew** (§6.6). The contract's crew are in its `cgM`, on the
  centreline; their arm is applied as a moment, their weight off the
  centreline by `state.crew`·arm (−1..1, + starboard), which is m·g·arm·cos φ
  when they're all the way out. They sit to windward of the apparent wind,
  all the way out once she heels 3° to leeward, coming in as she comes
  upright (so she sails upright in light air with them partly in, as §6.6
  says), and cross over at their arm a second (two seconds tack to tack).
  The side is the wind's, not the station's: §3.4's "y > 0 is port,
  windward on starboard tack" has the tack backwards (on starboard tack
  the wind is over the starboard side, y < 0), and sailing only reads the
  arm. `state.crew` is in a contract ship's state only; `wrench` puts them
  at `pose.crew` if given, else where the wind and heel put them.
- **Sails** (§6.2–6.3; `riggedSails` in physics.js, `rigSailCoeffs` in
  physics-foils.js, rig-sails.js). When the contract states its sails and
  sets, each sail is its own foil: its family's CL and CDv against α
  (§6.2's formula, which reproduces the contract's `coeffs` tables to their
  9 digits), its own lift slope (Helmbold on 2·luff²/area), area and CE,
  in the air at its own CE (the true wind less her motion there, across
  and along her: §6.1's heeled sail plane). Its sheeting angle δ is its
  chord's angle to leeward (negative: to windward), α = β_e − δ; the main
  sees the headsails' upwash (α − 4°·CL_jib·(1 − S(β_e; 30°, 90°)), a
  backed headsail giving none), a headsail to leeward is blanketed
  (×(1 − 0.35·S(β_e; 90°, 160°))), one goose-winged ×0.75. The rig's CL is
  the area-weighted sum × `flat` (`controls.flat`, flatMin..1, default 1);
  its induced drag CL²/(π·ARe), ARe = h_e²/A for the area set, is shared
  out as each sail's CL·CL_rig/(π·ARe), so it adds up. Each sail's drive
  and heeling force act at its own CE, square to the mast. At rest in a
  steady wind, at a set's trimmed sheets, the wrench gives that set's
  trimmed CL and CD at every β tried, every set of every fixture.
  - *The main* is the boom (`state.boom`): it goes where its own air puts
    it, within the sheet's travel, the contract's `sheeting` (0–85°: a
    traveller, not the stock 10° stop). `controls.sail` is its hoist:
    lowered by 1 − sail, it is reefed by that fraction of P, the sail above
    a line that far up the luff brought down along it (the rig aid's rule;
    at the contract's reef fractions it gives their area, CE and luff), so
    a reef lowers the CE and the slope changes with the luff, not just the
    area.
  - *The headsails* swing on their sheets (`state.jib`, the jib's chord
    tack to clew, + starboard, at the boom's 200°/s; a cutter's staysail
    follows it within its own range): where their air puts them, no closer
    than the least sheeting angle (the lead's line from the tack, §3.9) and
    no further out than the sheet lets them, `controls.jibSheet` 0..1 over
    `sheeting` min..max (7–30°); with none given, trimmed to the main's
    sheet angle within that. A sail its sheet doesn't hold lies at its
    family's zero-lift angle (alpha0) off its air, flogging (P1, "Trim
    feedback" §3): within 2° of the wind the jib lies 5° off it, inside its
    least angle. `controls.jibHeld` (−1 port, +1 starboard) makes it fast on
    one side (P2). `controls.jibBacked` holds it to
    windward at the sheet's angle, which pushes the bow off; from β_e ≥
    `wing.fromBeta` that is goose-winging, on the wing's 30–90°; within 10°
    of dead ahead it stays on the side it's on. `controls.furl` rolls the
    clew toward the luff along the LP line (area × (1 − furl), the luff
    kept); with none given, the contract's furl, or more as the main comes
    down (1 − sail), so lowering the sail stows both.
  - Each sail swings about its luff (tack to head: the head stays on the
    mast or the stay), and its CE with it: eased right out, the main's
    drive acts to leeward of the centreplane and turns her to windward.
    Since naval's 01b9b8cb, §6.6 swings the set's CE too ("The set's CE,
    swung"), but by a different rule: every sail by the set's trimmed
    sheeting angle at |β_e| (`trimmed.sheetsDeg`), area-weighted, where
    sailing swings each sail by where its own air and sheet put it (the
    agreement harness setting each sheet to the point's). The two rules
    disagree on the Laser's dead run, and by more than before §6.6 swung at
    all: then sailing gave more weather helm than predicted (yaw 1.08
    tolerances at 16 kn, up to 1.6 at 20 kn); now it gives 2.4–4.2° less,
    all seven 180° points fail, worst yaw −2.93 tolerances at 20 kn
    (KNOWN_GAPS laser-ilca7, below). Open: which rule's swung CE at 85° is
    the boat's.
  - In irons, head to wind from rest in 12 kn, with the jib backed to
    starboard and the rudder over to bear her away to port, the sloop falls
    off past 60° in 12.5 s, the J/24 in 6.1 s, the Catalina in 7.5 s,
    cuvature in 12.0 s; with the jib sheeted instead it takes 3.0–4.4 times
    as long (54.9, 20.7, 24.3, 35.8 s). Re-measured 2026-11-10. cuvature's
    was 8.4 s before naval's first guess balanced her: her rig is 1.81 m
    further aft, the jib's CE 1.86 m ahead of her CG where it was 3.68 m,
    so the backed rig turns her with 1391 N·m where it had 3599 N·m. The
    rudder does little with no way on, and once she gathers sternway it
    works backwards. The stock sloop's own cases are in "Leaving the
    anchor".
  - A keel's or rudder's flow from astern: its centre of pressure goes
    with its leading edge, from the quarter chord broadside to the
    three-quarter chord dead astern (ahead, the quarter chord, as §6.4).
  - A contract without sails flies its lumped sail on the stock boom.
  - The sim's input has the jib's controls: `controlsOf` reads the Jib
    piece's value (`v.jib`: sheet, held, furl) as jibSheet, jibHeld and furl.
- **Windage** (§3.13, §6.1; one loop in physics.js over `spec.rig.windage`,
  `bodyRig`'s elements by `windageInBody`: areas ×k², centres ×k, each
  through windage.js `elementForce`, the one force law). Each element is in the air
  at its own centre: the true wind (sampled once, at the mast, as the sail
  reads it) less her motion there, her rotation included. Her heel lifts
  the centre `zPerSinHeelM`·|sin φ| up the mast. In her heeled sail plane
  the air's components square to her centreplane (ux) and along it (uz)
  are §6.1's AWS_e·sin β_e and AWS_e·cos β_e, so §6.1's two resolutions
  are, with q in ½ρ·u² (ρ the contract's `rhoAirKgM3`, which her sails
  use too):
  - a body (the hull), in cross flow: along her ½ρ·Cd_f·A_f·uz|uz|, across
    her ½ρ·Cd_s·(A_s + `sidePerSinHeelM2`·|sin φ|)·ux|ux|;
  - a spar (the mast beside the main, the bare mast, the rigging), drag
    along the air: D = ½ρ·A·(Cd_f·uz² + Cd_s·ux²), along (ux, uz)/|u|.
  That is compose's `windageAt` at every predicted point to rounding
  (windage.test.js: surge, sway, roll and yaw about her CG, to 1e-6 of her
  weight), and physics.test.js holds each kind of element (and a body with
  two Cds in thinner air) to the formulas at β_e 0–180° and −90°, upright
  and heeled 15° either way, at k 1 and ½, and turning in still air. A
  ship with no contract (the plain path) flies the same loop over
  `windageInBody(plainWindage(spec))` (hull-model.js): the same rules on
  what she knows (her box and her lumped sail's mast, each on its own
  fore-and-aft plane), stated as a contract states them, no rigging
  element. There is no other windage rule.
- **Wrench.** `ship.wrench(pose, motion, controls, env)` is the sum of
  forces and moments `step` integrates (gravity, buoyancy, resistance,
  foils, sails, windage, anchor), at a state, about her CG, with the boom
  at its goal rather than where its swing has got to, and the jib at
  `pose.jib` if given, else at its goal. It changes nothing: stepping
  after a wrench is stepping without one.
- **Agreement** (`agreement.slow.test.js`, `test/agreement-harness.js`). The
  naval package's valid fixtures and its reference consumer of §6
  (`compose.js`) are copied into `test/rig-contract/`. At each predicted
  equilibrium (unflagged, or, §6.7, flagged only `planing-range`: the
  Laser's 25 planing points) she is put in the predicted state (starboard tack,
  heading −Z: speed along her track, heel to leeward, leeway, rudder, each
  sail's sheet (a negative jib sheet goose-winged), the reef as the main
  lowered by its fraction, the point's `flat`; afloat at that heel) and must
  balance to 2% of her weight in surge and sway, and 2% of her weight at a
  waterline beam (roll) or length (yaw); and, since those moments are
  wide (2% of weight at her length is 5–16° of rudder), the rudder her yaw
  residual would settle her at must be within 1.5° of the predicted one,
  and the heel within 2°. At the reference point the sails' drive and
  heeling force must be §6.3's to 1% and the upright resistance §6.5's to
  0.5%; at every point the water's forces alone (sails stowed, no wind on
  her) must be compose's Y·cos φ square to her track to 1% of her weight
  and its R along it to 0.5%. Sailed 120 s from the reference point on
  flat water she must have stopped changing (the last 15 s's means within
  0.005 m/s and 0.05° of the 15 s before) and average its speed ±10%, heel
  ±2°, leeway ±1.5°, rudder on the same side. Her crew are all the way out
  at a heeled point; at an upright one roll passes if somewhere between in
  and out they hold her there. Since naval's 01b9b8cb and 7d473f91 the
  fixtures' predictions include §3.13's windage and each sail's CE swung
  to its sheet (§6.6), and sailing's physics reads the same windage (see
  "Windage" above), so at every predicted point her windage is compose's
  to rounding (`windage.test.js`). Measured on 2026-11-16, the sloop and
  the Catalina balance at every point, and every fixture settles within
  every tolerance but the J/24's leeway (7.4° against 9.0°: not windage,
  which agrees; part is settle reading leeway in her heeled body frame); the sloop settles 0.8% slow (3.402 against 3.430 m/s),
  cuvature at 3.276 against 3.268. What still fails is listed in
  `KNOWN_GAPS` point by point with its measured values, each held to them,
  so the list moves when the physics does: cuvature's stand-in hull's
  righting moment (17 points from 14 kn), the J/24's heel by her 25°
  limit (every wrench passes, but where her curve is flat a small roll
  residual reads as 2–4.5° less heel: 20 points), and the Laser dead
  downwind (both swing the main's CE, and sailing's turns her bow up
  2.4–4.2° of helm less than §6.6's: open). The report beside it gives
  each fixture's residual at the reference point and its windage, sailing's
  beside compose's. Each
  mechanism also has its own finite cases: `foils-mass-crew.test.js` (item
  9), `hull-resistance.test.js` (her hull, resistance, planing, side force
  and induced drag, and one seeded sea run as a guard), `sails-jib.test.js`
  (item 11: the coefficients, the sets' trimmed tables through the wrench,
  each sail at its own CE and in its own air, the jib's swing, sheet and
  lead, backing and goose-winging, furling, reefing's CE, and irons).

### Decisions (N11)

1. *Before you're aboard the HUD says nothing* (decided unattended
   (2026-11-17, lane/n11), for the lead). N8 took the HUD's Come aboard
   button out to the bar of tools (scene TOOLS.md Decisions 10) but kept
   the lobby's hint, "Click her to come aboard" while she was near
   (`NEAR` 60 m) and the view wasn't seated. In Edit that was false (Edit's
   click selects her, TOOLS Decisions 6), and a package may not ask
   whether the viewer is editing (scene STAGE.md, "Conventions for
   bodies"), so no condition sailing can see makes it true. The plan had
   "Come aboard (Enter)" in its place; that names a key the HUD can't
   check (a key is shown only where the resolver says it reaches the
   command, scene TOOLS.md H3, and the bar already shows Come aboard's
   key that way). So the lobby hint is empty in every base, and with it
   `NEAR`, `nearEye`, hudModel's `seated` and `near`, the `data-seated`
   attribute and the import of crew.js's `seatedView` are gone: the HUD
   read them only for that line, and the HUD's second line, `keys`, never
   set by anything, went too (one line says what the keys do). Table:
   state {lobby, paused, aboard} × what the crew says (`me.hint`,
   `swimming`, `free`), 24 cases (`hud.test.js`). The sheet's only
   `pointer-events`, comments aside, is the root's `none`, and hud.js sets
   none inline: read from the files, so a test sees only sailing's own
   sheet. Of scene's, stage.css gives each child of the overlay `auto` at
   no specificity (`:where`), which the root's own rule outranks, and none
   names a `.sail-hud` node (checked by reading them, 2026-11-17). Lost: in Look, near her, nothing
   on the view says a click on her boards (the bar's Come aboard and the
   templates' notice still do). *Question for the lead:* should the base
   say what a click does (Look's own "Click to …" under the pointer)? It is
   the only one that knows.

### Decisions (N6)

Each decided unattended (2026-11-16, lane/n6), for the lead:
- *`windage.js` is naval's rules, copied, with three seams.* Its builder
  is split into `hullElement` and `rigElements`, and `rigElements` takes the
  mast's width where naval works it out from the mast's length (`planOf`
  reads its plan off a contract's rig and sails): the stock sloop keeps the
  fixture's hull element and states only her rig's, at her drawn 0.19 m
  section (`rig.mast.sectionM`), not `mastSection(14)` (0.087 m). For
  naval's contracts the result is the same, since each states
  `sectionM = mastSection(lengthM)` (windage.test.js checks it). And
  `elementForce` reads a contract element and takes the air as its two
  components in her heeled sail plane and the heel's sine as given, the
  form physics.js has them in; it is the one force law (physics.js calls
  it, no copy inline), held to compose's `windageAt` element by element.
- *The stock hull's windage element is the fixture's*, as her canoe body
  is, not §3.13's rule on her drawn sheer (her drawn hull isn't the one she
  floats on: "Which hull").
- *RM30 for her rigging* is the kept righting curve's (boat + crew at 30°,
  the curve she sails on: `rm30Of`, which equals each fixture's own
  `loads.rm30Nm`), over her drawn chainplates' half-breadth, as naval's
  loads use the chainplate base; `loads` stays null. **Question for the
  lead:** her rigging element's d (9.1 mm) then comes from an RM30 and a
  chainplate base the contract doesn't state, where in naval's contracts
  it traces to `loads.rm30Nm` and `loads.chainplateBaseM`. The schema
  allows a partial `loads` (those two, the rest null), which would make
  the stock contract self-consistent; fit-out reads `loads`, so that is
  left to you.
- *The contract sails' trim models go through the same gate as the
  physics* (`sim.sailModels` reads `rigContractOf`, not the GLB's
  `extras.rig.sails`): a rig her physics sails plain (a pre-windage
  contract, or the stock rig on a camber hull) gives the HUD, the looks
  and the jib station no contract sails' thresholds, as it gives her
  physics none.
- *`rigContract` requires `windage.elements`* (an array: the schema
  requires it). Any `extras.rig` stated before naval's windage (every doc
  filed with `rig@3`) sails the plain path until it is restated; no shim.
- *The agreement harness reads compose's water side force (`hydroAt`) on
  the contract with its windage elements taken off* (`windageless`): L is
  read off compose's sway equation, whose air heeling force now includes
  the elements', which `breakdown`'s §6.3 reading of the sails alone
  doesn't hold. Without it the water check failed by 2–4% at every
  reference point though no water force had changed.
- *KNOWN_GAPS were re-measured, not re-tuned*, twice: once when the
  predictions moved (naval's windage and swung CE) and sailing's physics
  didn't (the sloop and the Catalina were listed), and again when the
  physics read §3.13's windage (they balance again and list nothing;
  agreement.slow.test.js's header has the numbers).
- *One windage rule: the plain path's elements are §3.13's too.* A ship
  without a contract (a rig file with no `extras.rig`, the stock rig on a
  camber hull) used sailing's own rule (topsides 0.7·L·f and 0.7·B·f at
  Cd 1, the mast 0.15·luff at the lumped sail's mast point). It is deleted;
  `plainWindage` (hull-model.js, beside the box it reads; not in the
  copied windage.js) states the elements, in the contract's frame, from
  her box (LOA her length, beam,
  FBAV her freeboard: the sheer is level) and her lumped mast, from the
  deck to the head of the lumped sail, beside the sail from its tack
  (taken as a main's luff: BAS the tack's height over the deck) and bare
  below, its width `mastSection` of the mast's length above the deck (naval's
  rule takes the mast's length; the plan said the luff, a few mm less for
  the stock sloop). No rigging element: she states no I and no RM30.
  physics.js takes them into her body by `windageInBody`, as `bodyRig`
  takes a contract's, so there is one converter. camber-run (the stock
  rig on a camber hull, the plain path) moved with it, measured on
  2026-11-16: over the ground 0.96 → 0.98 m/s, read speed 1.01 → 1.05
  m/s, heel −2.08° → −1.97°, leeway 12.47° → 11.9°.
- *|sin φ|.* §3.13 states the heeled terms (`sidePerSinHeelM2`,
  `zPerSinHeelM`) for heel to leeward (compose's φ ≥ 0). The sim heels
  either way, so it applies them by |sin φ|: whichever side is down, more
  of her side is in the wind and its centre is higher (heeled to windward,
  that is the moment bringing her back up). physics.js takes |sin φ| in
  one place and hands it to `elementForce` and the centre's lift alike;
  physics.test.js's φ = −15° rows pin it. A question if you'd rather apply
  them only to leeward (those rows are what would change).
- *The wind on the elements is sampled once, at the mast,* as the sails'
  is, and each element's air is that wind less her motion at its centre;
  a wind field that changes across her length isn't resolved per element.
  The elements and the lumped sail use the contract's
  `sailModel.rhoAirKgM3` (1.225 in every fixture), the plain path
  physics.js's RHO_AIR (the same): one air density per ship.
- *The windage elements are fixed per rig,* as §3.13 states them and
  compose flies them: the mast beside the main is the 0.4/0.6 element
  even with the main lowered at anchor, and the plain path always takes
  her lumped sail as set. That agrees with compose by construction, and it
  shapes how she lies at anchor and breaks out ("Leaving the anchor"). A question
  if you'd rather the mast go bare (Cd 0.8) with the main down; §3.13
  states no such rule.
- *The agreement harness measures §6.1's windage from compose alone*
  (`composeWindage`): compose with the elements less without them gives
  Σfx, Σfh·cos φ, Σfh·(z − zY) and the yaw about x = 0; compose with every
  element lowered to the waterplane (the same forces) gives −zY·Σfh, so
  Σfh·z needs no reading of compose's internals; both moments are then
  taken to her CG. Sailing's (`sailingWindage`) is her wrench in the
  point's wind less in air moving with her, sails stowed.
- *`ctx.sea` has no clock.* It had `clock: () => api.clock.t()`, the same
  function under a second name: a seam, not a source of run-to-run
  divergence. Every reader (the crew's swimmer, the HUD's wind, the looks'
  bobbing and flutter) asks `api.clock.t()` itself, with no fallback for a
  missing clock (the HUD's and the crew's `?? 0` are gone: a stage always
  has one). `ctx.sea` is exactly `{ oceanAt, wind, world, tick }`. That
  no reader has a fallback is shown by behaviour, whatever its spelling:
  each reader's table runs it on a stage clock broken three ways (none, no
  `t`, a `t` that throws; test/fakes.js `brokenClocks`), and each time the
  read throws and the sea or wind is asked at no time. A test also reads
  every .js/.mjs/.html file of the package (source, tests, probes, itself
  but for its two pattern lines) for a clock read off the sea (`.clock`,
  `["clock"]`, destructured) and the spelled defaults `api.clock?.`,
  `clock.t?.(`, `clock.t() ??` and `clock.t() ||` (sea-view.test.js, "the
  sea's time is api.clock.t()"): a net for spellings, so a fake can't
  bring the seam back. The probe pages' `clock(w)` reads the sailing
  extension's own `api.clock.t()`. water/WATER.md's "`ctx.sea.clock` is
  `api.clock.t`" (line 351) and its list of ctx.sea's members with `clock`
  (line 106) were stale; the integrator corrected both (2026-11-17, merge
  of lane/n6).
- *Leaving the anchor: diagnosed, not fixed; accepted as it is (the lead,
  2026-11-17: a laid ship breaking out off the wind is OK, no fix in the
  physics or the template).* The physics doesn't give the step's claim
  on every sea, and every fix measured was a choice of the lead's
  ("Leaving the anchor", with its questions), so the physics, stations
  and HUD are as they were. What the step adds: the probe records its
  anchoring timeline (`measured.anchoring`), a node replay of it
  (`src/test/breakout.js`, with `sim.stepped`'s spec, the spec her physics
  steps with), and the verdicts pinned (`src/breakout.slow.test.js`), now
  as the accepted behaviour; sailing-run checks that she breaks out head
  to wind or off it on exactly the seas the replay pins (its `BREAKOUT`),
  and runs the leave step only where she is head to wind. The unused
  candidate fixes are scratch patches outside the tree:
  `/Users/pvh/.claude/projects/-Users-pvh-dev-patchwork-base/5cc6c087-e4f2-4927-93fb-4f98c0b7eab2/recovered/loose/n6-step4-candidate-set-anchor-windlass.patch` (a set anchor and a
  bounded windlass), `n6-step4-heave-hybrid.patch` and
  `n6-step4-heave-world-vertical.patch` (the two heave switches), beside it.
- *Run-to-run divergence: three causes, two of them sailing's, fixed where
  they were* ("Determinism"). (1) A held station moves by the world time
  it's held, `api.clock.t()`, counted in whole steps of the world's grid
  (`worldSteps`: the grid points t crossed since the last frame, each
  STEP_S; scene's STEP_S and gridIndex copied, as a package stands alone),
  for every held verb and the wheel. They integrated the frame's dt, whose
  last bits depend on how far the page's clock had run; t's last bits do
  too, but not which grid points it has crossed. What it means: a held key
  moves nothing while the world is paused (no world time passes), on a
  follower it moves with the follower's t, and at a display faster than
  60 Hz a key moves on the frames where t crosses a grid point, not on
  every frame (the physics reads it once a step anyway). Whether a held
  key should work while the world is paused is the lead's (a question,
  below). (2) `ctx.sea.wind` is the wind ambient's as it is when read,
  made again only when the ambient's value or the frame's numbers changed
  (it was refreshed in the frame's tick, which comes after the frame's
  steps, so a step could read the last value's wind). (3) The probe's: the
  runner waits, in paused frames, until both views read the seeds it wrote
  before it resumes the world, and its keys wait until the page has seen
  them (a key it never sees in 1 s is an error). The scene's flush budget,
  which made (3) a race, is the scene's and is left as it is; whether it
  should be deterministic was a question for the lead (below: answered).
- *Held keys while the world is paused: the world is frozen (the lead,
  2026-11-17: "fine, keep it").* A held
  key now moves only while world time passes, so with the world paused the
  halyard, the sheets, the windlass and the wheel don't move however long
  the key is held (and a key let go commits where it was). Before step 5
  they moved on the page's frames, paused or not. The question was whether a
  paused world is one where the crew can still work the ship (then the verbs
  need a clock of their own, and determinism needs another answer), or a
  frozen one, as built; frozen it stays.
- *Which frame a doc change reaches the extensions in (scene's): left as
  it is (the lead, 2026-11-17), deferred to the queued
  Croquet-without-a-reflector work,* where an input that affects the
  simulation carries the world time it takes effect and the stage applies
  it at that time on every peer, while UI-only changes keep the instant
  path. Until then the probe keeps waiting out the jitter. What was asked:
  a change reaches a stage's extensions at once only while
  fewer than `UI_PASSES` passes have run since its last frame (scene
  `stage.js` `requestFlush`), and how many have run is the wall's, so the
  frame an edit lands in differs from run to run. In play a frame late is
  harmless; for a world that must repeat (the probe, and the queued
  Croquet-without-a-reflector work) it is a source of divergence the probe
  now has to wait out. Should the scene deliver doc changes on a frame
  that doesn't depend on the wall?
- *The trace and `ctx.sim.stepped`.* `stepped(id)` is a read of her
  latest step of world time as taken (`{ spec, key, controls, from,
  state }`: the spec her physics stepped with, the controls, the state it
  went on from, the unrounded state it reached), on the computing view
  only, and null when that step didn't step her (held by a person, or no
  water under her), so its parts are always one step's. It replaces step
  4's `specOf` (one read, not two). The probe
  page records it from a kept process of its own, registered after
  sailing's, so only the computer records and it reads each step just
  taken. Marks carry the last step's t, so a trace is byte-comparable; a
  step that doesn't go on from the last one recorded (a start) also records
  where it started and the water and wind it read there, which is what
  named causes (2) and (3).
- *The runner closes the simulator on a fixed frame* (the handoff check:
  a second's sampling, the close, then the rest of the sampling; no frame
  passes between page calls), where it closed it from a call racing the
  sampling's frames. The handoff's remaining difference (one run in three)
  is recorded under "Determinism", open: it is past the leave step, in the
  stage's two-peer playback.

Decided unattended (2026-11-17, lane/n6), for the lead:
- *Docs that are other packages' are left as they are, and listed.* Once
  sailing reads the contract's windage, three places outside sailing say
  otherwise: naval's `contract/v1/specification.md` §7 ("`windage` (not
  yet: sailing applies its own windage rule today …)"); naval's
  `src/sailing-agreement.test.js`, whose header and pinned figures (209,
  395 and 36 N of windage surge, sailing's old settle speeds) describe the
  rule N6 deleted and pass on their own constants; and water/WATER.md,
  whose list of `ctx.sea`'s members has `clock` (line 106) and which says
  "`ctx.sea.clock` is `api.clock.t`" (line 351). The lane works in sailing
  only, so each is listed in FOLLOWUPS for the integrator. Whether a lane
  may make a one-sentence edit to another package's docs was a question;
  the lead (2026-11-17): yes, a lane may.
  *Integrated (2026-11-17, decided unattended by the integrator of lane/n6,
  for the lead):* the integrator corrected naval's §7 and WATER.md's two
  sentences (docs only, both packages synced); naval's
  `sailing-agreement.test.js` is a test of naval's and stays as it is,
  still open in FOLLOWUPS ("N6 integrated").
- *Every example holding the stock sloop is republished* (the lead's
  standing no-back-compat rule decides it; nothing here is the lead's
  taste). rig@4 is a new rig GLB, and a published doc keeps the GLB it was
  made with, so each carries a contract without windage and sails the plain
  path (one lumped sail, one Sail row) until it is made again: Ship at sea
  and at anchor, Lost Cities aboard and what links it, Fitting out, the
  Harbour, the Model room, the basin mashup, and Cadboro Bay and Ucluelet,
  which hold her as scenery (ucluelet-check asserts "sloop floats").
  Ucluelet's 45 MB GLB costs a long Chrome-lock hold; that is scheduling
  for the integrator, not a question.
- *Integrated 2026-11-17 (merge 4fe5aeab; decided unattended by the
  integrator of lane/n6, for the lead).* Every one above is republished on
  rig@4 and swapped in the folder (Ship at sea, Ship at anchor, Lost Cities
  aboard with a new game G, the Quiet games room, Games night, N7's two
  Arcade mashups, which link the room and Games night, Fitting out, the
  Harbour, the Model room, the basin mashup, Cadboro Bay), **except
  Ucluelet**: three runs of its publisher on the machine's GPU missed only
  the home view's frame budget (24.1, 23.4, 24.5 ms against 22.7), every
  view about 1.45 times its time of 2026-11-16 in proportion (the overview
  26.9 to 42.9 ms), with other lanes' Chrome running. A cost added by
  sailing's step would add a constant, not a proportion, so it reads as the
  GPU shared, not as N6; that is not proved. Without the GPU its timing
  never answers. It still holds her on rig@3, so she sails the plain path
  there until a quiet machine republishes it. The same runs found its
  harbour-mirror check reading the shore itself, since N8's bar starts the
  canvas lower; its pixel strips are now carried to the canvas the page has
  (terrain e2a45395). *Since:* the lead made the frame budget report-only
  (2026-11-17, terrain da0c8f50), and W8 republished Ucluelet on rig@4 with
  the weather (`automerge:PfgcCbKYvs6ppP8UWzaUL1Qvtcd`, home 16.9 ms).

## Trim feedback

*Items 1, 2, 3 (the HUD, and P1 and P2 of the physics) and 5 are built
(see "As built (items 1 and 5)" and "As built (items 2 and 3)" at the end
of this section); item 4's visuals are spec, not yet built. Where the
build changes something above (the stock boats "bit for bit"), it amends
that text and says so there.*

A sailor reads trim off the boat: how the sheet hangs, whether the luff
lifts, which telltales stream, where the masthead arrow points. Today a
view can't tell a flogging sail from a full one. The boom has no sheet to
the deck. The cloth is one camber, scaled. This section makes every one of
those cues a **pure function of the physics' own state**: the fields
`riggedSails` already computes, read out by `read()`. Nothing is animated
on its own clock, so nothing can disagree with the forces. The one time
input is the doc's world time, which every view shares (`api.clock.t()`).
It only sets the phase of a flutter whose amplitude the physics gives.

It covers five things, each below:
1. the stock sloop carrying the contract;
2. the jib's station;
3. what physics exposes;
4. the visuals and the HUD built on that;
5. the probes' Chrome hygiene.

### 1. The stock sloop carries the contract

**What changes.** The stock "Mast and sail" part's rig GLB carries
`extras.rig`, a patchwork-rig v1 contract for her. That covers the default
Sloop, Ship at sea, Ship at anchor, Lost Cities aboard and the Sloop part.
So she flies the separate main and jib, the swinging jib, backing, furling
and reefing (§6.2–6.3), with her crew out to windward (§6.6), her foils
(§6.4) and her resistance (§6.5).

**Generated, not copied.** `stock-rig.js` (new, pure) builds her contract
from her drawing. It does not ship the 12 m fixture verbatim, because the
fixture's rig isn't hers:
- its gooseneck is 0.2 m over the deck; hers is 1.45 m, so the boom clears
  a head in the cockpit ("Walking" depends on that);
- its mast is at x 1.35; hers is at z −1.6, forward of her cabin;
- its forestay is fractional (I 10.73); hers goes to the masthead.

Redrawing her to the fixture would put the boom through the cockpit at
knee height, and would move the mast into the cabin's front. That means
rebaking and re-pinning every walking check. Drawing the contract from
her keeps every visual on the physics' geometry by construction: the cloth
the physics flies is the cloth you see.

The contract is the 12 m fixture (`src/stock-rig-12m.js`, a runtime copy
of the parts of `naval/contract/v1/fixtures/valid/sloop-12m.json` it keeps;
`test/rig-contract/` keeps the test copy) with these parts.

*Kept verbatim* (her principal dimensions are the fixture's: LOA 12, beam
3.8, 8000 kg):
- `hull` (its synthetic canoe body, `sideForce` and `dsyhs`);
- `appendages`;
- `resistance`;
- `sailModel`;
- each sail's `model` (the family constants), `rules` and `warnings` ([]).

*Computed from ship.js by the specification's own rules*, each rule named
so a test can re-derive it:
- `name` "sailing stock sloop".
- `frame`: `glbToFrame` takes her hull GLB (bow −Z, up +Y, her waterline at
  y = 0) to the contract's frame, p = (−z, −x, y), with `glbAxes`
  { bow: "−Z", up: "+Y" }. So `rigFrame(contract)` is the identity on her,
  and `frameOf` gives her the frame she has today.
- `source`: generator "patchwork sailing stock-rig". `hull`: { kind
  "synthetic", label "the 12 m sloop's synthetic hull, her principal
  dimensions", `glbKey` "sailing/hull" }. See "Which hull" below.
- `sails`:
  - *The main.* `tackM` is the gooseneck, the rig object's origin.
    `headM` is straight up the rig's own Y axis, at the drawn head's
    height. So the physics swings the main about exactly the axis the rig
    object turns about. `clewM` is the drawn clew. `polygonM` is the drawn
    cloth's outline: its luff column and its leech column with the roach,
    from `cloth.js` at neutral trim (below). `areaM2` and `ceM` are that
    polygon's area and centroid (§3.6). `luffM` = |head − tack|, `footM`
    = |clew − tack|, `ar` = 2·luff²/area, and `liftSlope` is Helmbold on
    `ar` (`sailSlope`). `reefs` are at the fixture's fractions (0.15,
    0.30), by `rig-sails.js reefed` (the aid's rule).
    `sheeting.boom` is { the gooseneck, the boom's end, 4.95 m }.
  - *The jib.* A 100% blade on her drawn forestay:
    - `tackM` is the forestay's foot at the stemhead.
    - `headM` is 0.35 m down the forestay from its top (the main's head is
      0.35 m under the masthead, as drawn).
    - `clewM` makes LP = J. Its foot point is at s = 0.2827 of the luff:
      the fixture's own clew proportion, (c − t)·l/|l|² (0.28270).
    - `sheeting` is { minDeg 7, maxDeg 30, wing }, from `model`.
    - `sheeting.lead` and `hardpoints.jibLeads` follow §3.9's rule. The
      lead is on the line from the luff's midpoint through the clew,
      carried down to her drawn deck surface (her side deck or cabin top
      there). It sits at 7° from the tack, at furl 0, 0.1, 0.2 and 0.3.
  - Each sail's `coeffs` is tabulated by `rigSailCoeffs` at δ = 0 (§6.2's
    table, its α grid).
- `sets`: full, reef1 and reef2.
  - `areaM2` and `ceM` are area-weighted.
  - `heM` = `spanFactor` × her masthead's height above the waterline
    (§6.3).
  - `are` = heM²/A.
  - `trimmed` is null (§3.6 allows it: the aid's VPP wasn't run).
- `rig`: type "masthead", and I, J, P, E, BAS, ISP, LP from the points
  above.
  - `mast`, `boom`, `standing` and `spreaders` are as drawn (ship.js
    `mastMeshes` already places each wire).
  - `designer` and `actual` follow §3.7.
- `hardpoints`, as drawn:
  - mast step, partners and masthead;
  - stemhead and forestay tack;
  - backstay plate and chainplates;
  - `mainsheet`: `boomM` 0.95·E aft of the gooseneck, and `travellerM` the
    drawn track's ends;
  - `jibLeads`, from the rule above;
  - `halyardExits`.

  `rudderStock` and `crewStations` are the fixture's.
- `loading`: the fixture's, except `cgM`, which is re-rolled-up exactly.
  It is the fixture's CG plus Σ mᵢ·(pᵢ − pᵢ′)/M over the rig items that
  moved (mast, boom, rigging, sails). `gyradiiM` stays the fixture's: an
  estimate either way, and marked so.
- `loads`: null (§3.1 allows it; fit-out reads it, sailing doesn't).
- `windage` (§3.13; `windageOf`, rig@4): `source` naval's, and four
  elements. `hull` is the fixture's own (kept, as her canoe body is:
  FBAV 1.2 × beam 3.8 and × LOA 12, Cd 0.816, at mid-LOA). `mast-sail` and
  `mast-bare` are §3.13's rules on her drawn mast (plumb, stepped on deck,
  14 m, section 0.19 m: BAS 1.45, P 12.2, so 1.8 m of it is bare).
  `rigging` is I (13.9) × 4·d at Cd 1.2, half way up I, d the cap shroud's
  for the kept righting curve's RM30 (`rm30Of`: boat + crew at 30°, 43.5
  kN·m) over her drawn chainplates' half-breadth (1.67 m): 9.1 mm.
  `stock-rig.test.js` re-derives each element by hand from the drawing.
- `predicted`: { status "not-computed", why "generated by sailing from the
  stock drawing; the rig aid's VPP wasn't run on it" }, with empty tables.
  The agreement test reads only the fixtures, so nothing is lost.
- `lumpedSail`: §6.8's rule on the sails above.

`extras.sail` stays on the GLB, `plan` included: on a hull that doesn't
take her contract the plain path reads it (below).

**Which hull.** Her drawn hull displaces 9.38 m³ below y = 0, against the
contract's 7.80 m³. That is outside the 5% `drawnHull` allows, so she
floats on the contract's synthetic canoe body, at the same waterplane
(y = 0) and displacement. Two consequences:
- Her drawn waterline is where she floats at rest. Heeled, the drawn
  topsides and the physics' differ; that is a known gap, and it is written
  down here.
- `checkSource` stays quiet when the contract's `source.hull.glbKey`
  names the family of her hull object's file (`sailing/hull`, any `@n`).
  sim.js passes the hull's file key beside its URL: the doc.assets key
  whose URL is the hull object's.

On any other hull (camber's, in `camber-run.mjs`), a contract with a
`glbKey` that doesn't match is **not taken**. It describes the stock
sloop's hull, not this one. The rig is read as a plain rig, by its
`extras.sail.plan`. A rig-aid rig (no `glbKey`) is taken on any hull,
with the warning.

**A rig without a contract sails the plain path.** A rig GLB with no
`extras.rig` (any rig not built with one), and the stock rig on a hull
that doesn't take her contract, give a spec with no `rig`: `createShip`
without `spec.rig`, one lumped sail from `extras.sail.plan`, no jib. Its
HUD and looks are the plain ones: the trim visuals below need a contract.
`stock-rig.test.js` pins that spec key for key (a contract-less rig file
on the stock hull; the stock rig on camber's, an imported and an unfiled
hull) and runs it on a fake stage; the plain path's physics is
physics.test.js's SLOOP cases.

**Tests and probes that assumed the old stock physics** are updated by
re-measuring, not loosening:
- sim.test.js cases that read `partGLB("rig")`;
- parts.test.js and ship.test.js: part lists, connectors, file keys;
- the probes:
  - `sailing-run.mjs`: raising sail, getting out of irons, steady speed;
  - `aboard-run.mjs`: at anchor, then under way;
  - `publish-*.mjs`.

`ANCHORAGE_AIR`'s claim ("enough to get her out of irons once the anchor
is up") becomes a finite case. From Ship at anchor: anchor up, main up,
jib unfurled and backed as the HUD advises, helm over. She falls off past
60° within a time measured once and pinned. The agreement test is
untouched: it reads the fixtures.

### 2. The jib's station

**Pieces** (parts.js PIECES, data-driven):
- **Jib**, a third piece of "Mast and sail" (kind `jib`), under the mast.
  - Its origin is the contract jib's `tackM`. Its rotation turns its
    local +Y along the luff (tack → head) and its local +Z along the
    chord's perpendicular to the luff in the centreplane, aft.
  - It carries the trait `sailing.jib`: `{ sheet: 0.5, held: null,
    furl: 0 }`, the jib's lasting settings (`held` below).
  - The simulator holds its pose turned about its own Y by `read().jib`
    (`jibTransform`, the boom's `rigTransform` on Y). So it swings exactly
    as the physics' `swungCE` does: + to starboard. Peers play it back
    interpolated, like the boom.
  - It is not baked into her navmesh, and not a blocker: you push past a
    sail.
- **Jib winches**, a new part (kind `winch`, two pieces: the port winch,
  and the starboard winch at its mirror `at`). Tag `sailing.winch`.
  - Each carries `sailing.winch: { sail: "jib", side: "port" |
    "starboard", stand: [x, y, z] }`. `stand` is where you stand to work
    it, in the winch's own frame: across the well, on the far side deck
    1.3 m out (ship.js `WINCH_STAND_X`), as a jib trimmer sits to
    windward. You tail the working (leeward) sheet from the high side.
    From anywhere on the winch's own side the main hides the jib's luff on
    a reach, even at the rail; from the sole the mast stands in front of
    it (the first try, 0.3 m out on the far side of the sole, failed so in
    the browser). From the windward deck the eye's ray to the luff, ¼ and
    ½ up, misses the main's cloth and the mast close-hauled and on a beam
    reach (`stand-spots.test.js`, over her drawing). The old spot, 0.22 m out on its own
    side, hid it even close-hauled.
    Locked in, the eye turns to the jib's luff halfway up (crew.js
    `take(…, { look })`, stations.js `jibLuffAt`: the Jib piece's cloth
    luff through its world matrix).
    Open: that holds for the working winch only. The lazy (windward)
    winch's stand is then the leeward deck, at (±1.30, 1.22, 2.25) under
    the boom's sweep: a body there (head 2.97, eye 2.82) meets the boom
    (2.81 up, 0.07 thick) when it is 15–23° out on that side, a
    close-reaching trim. Taking a
    station doesn't check blockers (walker.js `takeStation`), so you stand
    there with the eye in the boom.
  - On the sloop they sit on the cockpit coamings at the cockpit's forward
    end (`FIT.winch`, z ≈ COCKPIT.z0 + 0.3). That is clear of a card table
    in the well (z 2.47–3.23) and of the mainsheet's stand.
  - Their stand is a hull@3 connector, so the bin snaps them there. On a
    contract hull without one, the part is put 1.2 m aft of the contract's
    `jibLeads` lead on each side, on her deck: the hardpoint says where the
    sheet comes from.
  - The Sloop part's `ABOARD` gains `winches`.
- `partsOf` and `stationsOf` gain `jib` (the first `sailing.jib`) and
  `winches` (a list).
- crew.js seeds a stand spot for each winch from its trait's `stand`, in
  place of `standOff(kind)`. You face the winch. The bake's C1 holds for
  each new link, and the sloop's mesh counts in "As built" are re-measured.

**`held`: which sheet is made fast.** Real sheets are fixed to a side; the
physics' `jibBacked` is relative to the wind. `held` is the side, and the
physics derives the rest:
- `held: null`: the jib tends itself. The working sheet is always the
  leeward one, so when the helmsman tacks, the jib crosses with the wind.
- `held: "port"` or `"starboard"`: the clew is made fast on that side,
  whatever the wind does. While that side is leeward the jib draws on it
  as usual, or luffs if the sheet is eased past its air (a sheet only
  pulls). While it is windward the jib is backed, or goose-winged from
  β_e ≥ `wing.fromBeta`. Within the jib's zero-lift angle of dead ahead
  (|from| < |alpha0|, 5° for the stock jib: `trim.js` `heldEitherSide`)
  its air can't say which side is leeward, and it is backed on whichever
  side it's held. Tack with the jib held and it doesn't cross: it goes
  from drawing to backed (heaving to), or from backed to drawing.

`controlsOf` maps `held` to `controls.jibHeld` (−1 port, +1 starboard),
`sheet` to `jibSheet` and `furl` to `furl`. The physics then does this
(item P2 below):
- With `jibHeld` set, the jib's goal is always on that side.
- If the jib's free angle (where its air puts it) is on that side, and
  its air is further off dead ahead than its zero-lift angle, the goal is
  `held·min(|free′|, lim)`: drawing, or luffing.
- Otherwise it is backed: `held·(min + (max − min)·k)`, or the wing's
  `held·(W.lo + (W.hi − W.lo)·k)` from `wing.fromBeta`. Its coefficients
  and forces are then taken with the held side as the side its air is
  from (its cloth bellies away from it): the same as by the air's sign,
  but for the band at dead ahead, where the read's `sheet` is < 0
  (backed) on either side.
- `controls.jibBacked` stays for the agreement harness and the tests.

| Where | Key | Does |
|---|---|---|
| Looking at a winch, in reach (prompt; three verbs) | F | Take the {port, starboard} jib sheet (lock in) |
| | hold Q | Haul in the jib sheet (from this winch, if it's the working one) |
| | hold E | Ease the jib sheet (likewise) |
| Locked in at a winch | Q / E (held) | Trim `sheet` at `SHEET_RATE`, only from the working winch (the side the clew is on, `sign(read.jib)`). From the lazy winch the hint says "lazy sheet: the jib's to starboard" and Q / E do nothing |
| | B | `held` null → this side. That backs the jib if this side is windward; if it's leeward, it makes the jib fast here, ready to heave to. `held` set → null: let it fly (it goes to leeward) |
| | hold R | Furl or unfurl (`furl` toward 1 if it's under ½, else toward 0) at `FURL_RATE` (¼ s⁻¹: all the way in 4 s, as the halyard) |
| | F | Leave |
| Locked in at the helm | B | `held` null → the windward side by the jib's own air (back the jib to bear away, out of irons); within its zero-lift angle of dead ahead (`heldEitherSide`, where either side backs it), the side opposite the wheel, so her bow goes the way the wheel is over (amidships: windward). Either way the side chosen backs it (`stations.js` `helmBackSide`), so the hint's "bow to …" is the way she goes. Furled, it also unrolls (`furl` → 0 at `FURL_RATE`, under the jib's claim till it's out): the furling line is led aft. The hint names it: "B back jib, bow to port", "B unroll jib backed, bow to port". `held` set → null (let it fly). Steering through the wind tacks the jib when `held` is null; held, it stays |

- **Three verbs.** A winch's prompt has at most three: F take, hold Q,
  hold E. Furl and back are only when you're locked in. The unit case that
  walks every look (station kind × reach × eye × sail up or down) gains
  the winch, and a jib furled or out.
- **Claims.**
  - Each winch has its `"station"` claim: who stands there ("Someone's at
    the port winch").
  - The jib object has a `"station"` claim, held only while a key changes
    one of its fields (Q / E, B, R), from a winch or the helm. So two
    people can't trim one sheet, back it or furl it at once. A key pressed
    while someone else holds it does nothing, and the hint says "someone's
    trimming the jib".
  - The main keeps its own claim. The helm trimming the main and a winch
    trimming the jib don't block each other.
- **Hints, locked in.**
  - At a winch: `Q / E jib sheet 40% · B back jib · hold R furl jib ·
    F leave · jib drawing`. B's label follows the case: "back jib",
    "hold jib here" or "let jib fly".
  - At the helm, the existing line gains `B back jib` or `B let jib fly`.
- **Lasting.** Letting go of a key commits the jib's fields
  (`ctx.sim.commit`), as the sail's are committed now.
- **Templates.**
  - Ship at sea: `{ sheet: 0.5, held: null, furl: 0 }`.
  - Ship at anchor (`AT_ANCHOR`): `furl: 1`. Lowering the main no longer
    stows the jib by the physics' default: the jib's own `furl` is given.
  - The HUD's sail-down nudge gains "jib furled: hold R at a winch".

### 3. What the physics exposes (and the two changes it needs)

Every quantity below is one `riggedSails` already computes, stored per
sail in preallocated arrays (`Float64Array(sailN)`; no allocation in the
substep). `read()` copies them out:

```js
read().sails = [{
  id, main,          // the contract's id; is it the main
  angle,             // θ: its chord now (rad, + to starboard): boomAt, headAngle(S, jibAt)
  goal,              // where the wind and sheet put it: boomGoal, the head's jibGoal
  limit,             // the sheet's angle (rad, ≥ 0): mainLimit, the jib's lim (or the backed/wing angle)
  from,              // its air's angle at its CE (rad, + from starboard): atan2(−ux, uz) of sAir
  beta,              // β_e = |from| (deg)
  sheet,             // δ_s (deg, + to leeward, − to windward): dS
  upwash,            // ε (deg), the main only: kInt·CL_jib·(1 − S(β_e; upwash))
  alpha,             // α = β_e − δ_s − ε (deg): what rigSailCoeffs was given
  cl, cd,            // sCl, sCd: after the blanket or wing factor, before flat
  area,              // sArea (m²): after reef or furl; 0 is down or furled away
  q,                 // ½ρ|sAir|² (Pa) at its CE
}]
read().jib           // as now: the jib's chord (rad)
```

`published()` (sim.js) streams a rounded copy at its 5 Hz: per sail
`{ angle, limit, from, alpha, sheet, area, q }` (rounded to 1e−4). Then a
follower's HUD and looks call the same functions on the same numbers. The
cloth itself isn't streamed; each view computes it from these.

**P1. A free sail lies at zero lift.**
- Today, a sail the wind places (its sheet slack) lies along its air, at
  α = 0. Its contract coefficients there give the main CL 0.36 and the jib
  0.45 (`coeffs` at α = 0). So a sail shown flogging still drives her at
  a quarter of its best lift. A view can't show that consistently, and it
  is wrong.
- After: a free sail lies at its family's zero-lift angle. Its free angle
  is `free′ = free − sign(free)·alpha0` (alpha0 < 0: 4° or 5° further
  out), so its α is alpha0 and CL_a is 0 (the main's upwash makes it
  ≤ 0). Its CDv is `cdp`.
- A pinned sail's α is unchanged, and so are the agreement points: every
  predicted state is pinned.
- What moves:
  - the irons times (re-measured, and the numbers in "The rig contract"
    rewritten);
  - sails-jib.test.js's "inside the least angle the jib lies along the
    wind": it now lies at alpha0 off it.
- Contract boats only. The stock `sailCL` already gives a luffing sail
  nothing.

**P2. `controls.jibHeld`** (−1, +1, or absent), as in §2. Absent, the
physics is exactly as now. Held, its clew is made fast on that side,
whatever the wind does. A sheet only pulls: on the side its air puts it,
the sheet stops it going further out than the sheet's angle and no more,
so it draws there, or, eased past its air, lies where a free one does and
luffs (never backed: no sheet pushes the clew out). On the other side its
air presses it against the sheet, held at the sheet's angle: backed.
Within its zero-lift angle of dead ahead (|from| < |alpha0|) its air
can't say which side is which, and it is backed on whichever side it's
held: the only place the side is a choice, and the only place B at the
helm lets the wheel make it (§2's table).

Nothing else in the physics changes. There is no sheet tension: the sheet
is taut exactly when the sail is pinned (its goal is its limit), when its
air pushes it against the sheet.

### 4. The visuals, each a function of the state

`trim.js` (new, pure, no THREE) holds the mappings; `cloth.js` (new, pure)
holds the cloth. looks.js is the stage side. It builds each mesh and line
once, when it starts dressing a ship, then writes positions into their
typed arrays each frame: no allocation per frame. Mesh positions come from
`trim.js`/`cloth.js` writing into `out` arrays. Its scratch is module-level
typed arrays and reused result objects.

They apply to a ship whose spec has `rig` and whose rig GLB says
`extras.sail.cloth` (the stock rig and jib). That field gives the
cloth's grid, so a view can rewrite its vertices. A rig-aid GLB (no
`cloth`) keeps today's dressing (scaled camber, lowered), with the
indicators below that need no cloth: the masthead arrow, the burgee and
the sheets.

#### The thresholds (from the contract, per sail)

For a sail with family constants `alpha0`, `stall`, `width` (its
`model`) and its sheet's `sheeting.maxDeg`, `trimOf(sail, model, out)`
gives:

| Quantity | Definition | Source |
|---|---|---|
| α_sheet | β_e − limit − ε (deg): the α the sheet asks for, if the sail stood at it | `beta`, `limit`, `upwash` |
| free | α_sheet < alpha0: the sheet is eased past where its air puts it. With P1 (below) that is exactly "not pinned", and exactly "its sheet is slack" | |
| ask | α_sheet when free, else α. In a steady state α = max(α_sheet, alpha0), so `ask` is continuous in the sheet | |
| luffAt, drawAt | alpha0 + ½·stall, alpha0 + ¾·stall (`LUFF`, `DRAW`): the luff's onset and full drawing | `alpha0`, `stall` |
| flog | clamp((luffAt − ask) / (luffAt − alpha0 + stall), 0, 1); 0 backed or winged (pressed by its air, it doesn't flog). The whole cloth's flutter | |
| luff | 1 − S(ask; luffAt, drawAt); 0 backed or winged. How far the luff has lifted: the windward telltale and the luff's bubble | |
| σ | S(\|α − alpha0\|; stall, stall + width): §6.2's separation weight, which the physics itself blends CL and CD with | `alpha`, `stall`, `width` |
| belly | Drawing or luffing: −side·clamp(sin(α − alpha0) / sin\|alpha0\|, −1, 1), side the sign of `from`: measured from zero lift, so flat at alpha0 and to leeward from there, full \|alpha0\| past it. Backed or winged: clamp(sin(φ − θ) / sin\|alpha0\|, −1, 1), φ = −from, θ = `angle` (the side its air pushes it) | `from`, `angle`, `alpha`, `alpha0` |
| atStop | stalled with limit ≥ maxDeg − ¼°: its sheet is all the way out, so only the course can help | `limit`, `maxDeg` |

| State | When (first that holds) |
|---|---|
| `down` | area = 0 |
| `wing` | sheet < 0 (to windward) and β_e ≥ `wing.fromBeta` |
| `backed` | sheet < 0 |
| `luffing` | ask < luffAt: free (flogging, its sheet slack), or held by its sheet below the luff's onset (the luff lifting, its sheet taut) |
| `soft` | ask < drawAt: under-trimmed, the windward telltale lifting |
| `stalled` | σ ≥ ½: separated flow carries at least half of §6.2's blend (\|α − alpha0\| ≥ stall + width/2) |
| `drawing` | otherwise |

The luff's onset used to be alpha0 itself, where CL is 0: a sailor easing
until it luffed and trimming until it stopped ended at no lift, read green.
On the 12 m families CL at luffAt is 0.80 (main) and 0.87 (jib), over half
clMax, and the greatest CL (main α 17.3, jib α 18.9) is in `drawing` with
both telltales streaming (`trim.test.js`, "the cues on the lift curve").

On the 12 m model the boundaries are:
- main (alpha0 −4°, stall 18°, width 22°): luffing below α 5°, soft
  below 9.5°, stalled from α 25°;
- jib (−5°, 20°, 30°): luffing below 5°, soft below 10°, stalled from 30°.

**P1 with the upwash.** A sail its sheet doesn't hold lies where its α
is alpha0, counting the main's upwash ε from the headsails: its free angle
is alpha0 + ε further out than along its air (physics.js `lies`; the
headsails' coefficients are found first, so ε is the same step's). Before,
it lay alpha0 out from the raw air, at α = alpha0 − ε: a "luffing" main
gave CL −0.1 to −0.4 (pulling her to windward and back), and between β − ε
+ \|alpha0\| and β + \|alpha0\| the boom was held at its sheet (taut,
drawn straight) while trimOf called it free. Now free ⇔ slack > 0 ⇔
\|CL\| < 1e-9, checked on the physics' own read at whole degrees.

**The stock jib eases to 60°** (stock-rig.js `JIB_EASED_DEG`, its
`sheeting.maxDeg`; the family's `model.sheet` stays [7, 30]). 30° is the
foot at the rail; eased further the clew rises and the head twists open,
so the chord's mean angle goes on out. At 30° the jib stalled at every
setting on a beam reach (α 51–63 at AWA 81) and could never be seen to
luff while sailing. Now on a beam reach (TWA 90°, 7 m/s) it draws at 0.6
and luffs all the way out (`stock-rig.test.js`). Backed, it's held on the
family's travel (rig-sails.js `backMax`, ≤ 30°): a sail pressed against
its sheet doesn't twist open past the shrouds. The cloth swings rigidly
about its luff (sim.js holds the Jib piece at `jibTransform(read.jib)`; no
twist is drawn yet), so the drawn clew, 2.8 m over the deck, crosses the
rail in plan at 23° and is outboard of it by 0.5 m at 30°, 1.2 m at 40°
and 2.4 m at 60°: an open item, measured, not a claim that it looks right. A stalled jib all the way out reads "eased out · stalled" in
the neutral colour.

#### Geometry

| Visual | Function of | Mapping |
|---|---|---|
| **Mainsheet**: boom → traveller | `controls.sheet` (through `limit`), the boom as drawn (θ_shown: the rig object's held pose, which is `read().boom` played back) | B(θ) = `hardpoints.mainsheet.boomM` swung by θ about the main's luff (`swungCE`'s rotation, on a point). C = the traveller's car, fixed at the track's middle as drawn (the physics has no traveller control). Rope length L = \|B(±limit) − C\| on θ's side; d = \|B(θ_shown) − C\|; slack s = max(0, L − d). Drawn as `sheetCurve` (below) from B to C. d is strictly increasing in \|θ\| on [0, 85°], so s > 0 exactly when \|θ\| < limit (eased past where the sail is), and s = 0 when it's pinned |
| **Jib sheets**: clew → lead → winch | `jibSheet` / backed / wing (through `limit`), `furl`, the jib as drawn (its held pose: `read().jib`) | The clew is `furledClew(sail, furl)` swung by θ. The lead is `hardpoints.jibLeads[side]` interpolated at `furl` (clamped to the track's ends). The **working sheet** is the one on the clew's side (sign θ). L = \|clew(side·limit) − lead\|, s = max(0, L − \|clew(θ) − lead\|). The **lazy sheet** is the other. Its length is the largest distance from its lead to the clew over the jib's whole travel (\|θ\| ≤ max(maxDeg, wing.hi), at that furl), so its s ≥ 0 by construction. Lead → winch is always taut (it's on the drum). The clew end is the cloth's clew vertex as displaced (below), so the sheet never leaves the sail |
| `sheetCurve(out, a, b, s, down, n)` | s, the ends, gravity in her body frame (−Y turned by her drawn quaternion) | A parabola in the vertical plane through a–b, sagging toward `down`: p(u) = a + u(b − a) + 4h·u(1 − u)·down⊥. The sag is h = √(3·d·s/8), the parabola's arc length ≈ d + 8h²/(3d) = d + s, capped at (d + s)/2. 16 points. s = 0 is a straight line |
| **Cloth** (main and jib) | `angle`, belly, flog, σ, `area` (reef or furl), `controls.flat`, the world time t (`api.clock.t()`), `q` | `clothVertices(out, sail, cloth, trim, t)`. Rows run parallel to the foot from the luff to the leech (the stock main's rows already are: `lerp(clew, head, h) + roach`, `lerp(tack, head, h)`). The camber depth is cloth.depth·chord·flat·belly·max(FLAT, 1 − flog), deepest at cloth.draft. The twist is cloth.twist·(1 − ½σ): a stalled sail's leech closes. The luff's bubble pushes the front BUBBLE.width (0.3) of each row back to windward by 0.8·luff of the camber, breathing ±25%. A flutter is added (cosmetic constants below) |
| **Reef** (main) | `controls.sail` (raised r; reef f = 1 − r) | Row h maps to the cloth's h′ = f + (1 − f)·h, moved down by f·(head − tack): §6.3's rule, the same as `rig-sails.reefed`. A bunt along the boom has radius 0.02 + 0.08·√f. At f = 1 the cloth is hidden |
| **Furl** (jib) | `furl` | The cloth's clew column moves to `furledClew(sail, furl)`, each row's leech point along with it (the rows keep their luff point). The roll on the luff has radius 0.02 + 0.06·√furl. At furl = 1 only the roll shows |
| **Flutter** | flog, `q`, s, t | The displacement along the cloth's normal is flog·A·u^1.5·sin(2π(f·t − 1.5u) + 3h), u along the chord. A = min(0.08·foot, ½·s + 0.02) m: the clew can't move further than the slack sheet lets it. f = clamp(√(2q/ρ) / (2·foot), 0.5, 4) Hz. flog = 0 means no displacement at any t |
| **Telltales**: the jib's luff, three pairs at 25/50/75% up, 0.3 m aft of the luff | luff, σ, `from`, t | Each is a 2-segment ribbon from its cloth point. The *windward* one streams aft along the cloth when luff = 0 (α ≥ drawAt), and lifts by luff·80°, spinning with phase t, as the luff lifts (fully at luffAt and below). "Streaming" (`streaming`): lifted ≤ 4°, curled < ¼. The *leeward* one streams aft when σ = 0 and curls forward and down by σ. Which side is windward is sign(from). The physics has one α per sail, with no twist and no gradient, so all three heights show the same state, with different phases. Backed or winged: both sides follow σ (the flow on its back is separated) |
| **Telltales**: the main's leech, one at each batten's end (rows 6, 11, 16, 21) | σ, flog, t | They stream aft off the leech by (1 − σ), and curl around behind it to leeward by σ. When it luffs, they flap with the cloth |
| **Masthead arrow** (apparent wind) | her pose, velocity, spin (`motionOf`), the wind field (`ctx.sea.wind`), t | At the contract's `mastheadM` (body), the air is wind.at(masthead world x, z, t) − (v + ω × r). The arrow turns about the mast to point into it: angle atan2(−u_x, u_z) of the air in her body x–z. Her roll swings it, as it does a real one. Pure; every view computes it from the published motion |
| **True-wind burgee** (optional: `sailing.ship.burgee: true`, default off) | the wind field, her heading | A pennant on the backstay 2.5 m over the deck, streaming down the true wind only (no motion term). A reading aid, not a real instrument; off unless asked |

The neutral trim is belly +1, flog 0, σ 0, reef 0, furl 0 and flat 1.
ship.js draws the GLB's `Sail` and `Jib` nodes as `clothVertices` at
neutral trim, so the file and the dressing are one function. The battens
are ribbons on cloth rows 6, 11, 16 and 21, from the cloth's own vertices.
Each view replaces the node's geometry with its own copy once, when it
starts dressing, since two sloops in a scene share a GLB. It puts the
original back on dispose.

**Cosmetic constants** are named in looks.js and are not thresholds:

| Constant | Value |
|---|---|
| `FLAT` | 0.12 |
| cloth.depth, cloth.draft, cloth.twist | the stock sail's 0.085, 0.4, 0.35 |
| rows and cols | main 26 × 12; jib 20 × 10 |
| flutter | 1.5 waves along the chord, u^1.5 |
| telltale length | 0.25 m on the luff, 0.3 m on the leech |
| roll and bunt radii | as in the table above |
| arrow | 0.5 m |

#### The HUD

The panel's "Sail" row becomes two rows on a contract ship. Each is
`trimOf`'s state and the station's values, so the words match the cloth:

| Row | Text (examples) | From |
|---|---|---|
| Main | `drawing · sheet 40%` · `soft · sheet 50%` · `luffing · sheet 80%` · `stalled · sheet 10%` · `reefed 30% · drawing` · `down` | state; the sail station's `sheet`; 1 − raised when raised < 0.95 (`HOISTED`: a halyard stopping short of the block isn't a reef) |
| Jib | `drawing · sheet 30%` · `backed · port` · `unrolling · backed starboard` · `wing · sheet 50%` · `furled 40% · luffing` · `eased out · stalled · sheet 100%` · `furled` | state; the jib's `sheet` (none without a Jib piece: it's trimmed with the main); `held` as a side when it's backed, and while it unrolls held (what the crew chose, not the clew on its way there); `furl` |

- No angles: a number after "drawing" read as an angle of attack, and
  one just above alpha0 is negative.
- Each row's state word carries `data-trim` (`luffing`, `soft`,
  `drawing`, `stalled`, `eased`, `backed`, `wing`, `down`) for one colour
  per state in hud.css; `eased` (stalled at its stop) is the neutral ink.
- A ship with no contract keeps today's single "Sail" row.
- The model stays pure (`hudModel` gains `sails: read.sails` and the
  jib's value), and the DOM changes only when a string does.
- The advice line, in irons: "In irons: back the jib (B at the helm; dead
  ahead, the wheel picks the way)", in place of "lower the sail"; head to
  wind, not yet in irons: "Head to wind: back the jib (B at the helm; dead
  ahead, the wheel picks the way)" (stopped head to wind her rudder hardly
  bites). Only where B has a jib to back: a Jib piece aboard and a
  headsail in her read; a main-only rig, or a rig-aid GLB's jib with no
  Jib piece, gets the plain advice.

#### Finite cases that pin it (`trim.test.js`, `cloth.test.js`, `stock-rig.test.js`, `stations.test.js`, `hud.test.js`)

1. **States**, on the 12 m main and jib models: α_sheet, α ∈ {−6, −4,
   4.9, 5, 9.4, 9.5, 14, 24.9, 25, 36} for the main and {−7, −5, 4.9, 5,
   9.9, 10, 29.9, 30, 50} for the jib, each giving its state, free, flog,
   luff and σ exactly; CL at luffAt > ½·clMax and the α of greatest CL
   drawing with both telltales streaming; backed head to wind, flog and
   luff 0 and the cloth NEUTRAL's camber. Also:
   - sheet −10 at β_e 30 → `backed`;
   - sheet −40 at β_e 150 → `wing`;
   - area 0 → `down`.
2. **Belly sign**: drawing to port, drawing to starboard, backed and
   winged give −1, +1, inboard and ±1 by the formula; pressed at its sheet
   with α −5, −3, −1, 0, 2 the jib's is 0, −0.4, −0.8, −1, −1 (flat at
   zero lift, never to windward).
3. **Mainsheet**: on the stock geometry, d(θ) is strictly increasing at
   every 0.5° on [0, 85°]. s = 0 when θ_shown = limit, and s > 0 exactly
   when \|θ_shown\| < limit, at limits {0, 20, 45, 85}°.
4. **Jib sheets**: the lazy sheet's s ≥ 0 at every whole degree of θ over
   the travel × furl {0, 0.1, 0.2, 0.3}. The working sheet has s = 0 at
   θ = side·limit.
5. **sheetCurve**: straight at s = 0. Its polyline length is within 1% of
   d + s for s ≤ 0.3·d. h is monotone in s.
6. **Cloth**:
   - the GLB's `Sail` and `Jib` positions equal `clothVertices` at neutral
     trim, bit for bit;
   - the reefed outline's area is the contract's `reefs[].areaM2` at 0.15
     and 0.30, to 0.5%;
   - the furled outline's area is `furled(sail, furl).area` at {0.1, 0.3,
     0.6}, to 0.5%;
   - flog = 0 means zero flutter displacement at t ∈ {0, 0.1, …, 1};
   - the displacement is ≤ A at those t;
   - the cloth's clew vertex is the sheet's end.
7. **Telltales**: the windward one is streaming (lift 0) iff flog = 0. The
   leeward one's curl equals σ.
8. **Masthead arrow**:
   - still, true wind from 0°, heading 0° → points at the bow;
   - 3 m/s heading 090° in 5 m/s from 0° → atan2 of the known vector;
   - rolling at 0.2 rad/s → swings by atan(ω·h/…), the exact value.
9. **Stock contract**:
   - `rigContract` accepts it, and it passes naval's validator
     (copied into `test/rig-contract/`, as compose.js is);
   - `rigFrame` is the identity on her;
   - the main's `tackM` is the rig origin and its luff axis is the rig's
     Y;
   - the jib's tack is the forestay's foot;
   - areas and CEs are the polygons';
   - `liftSlope` is `sailSlope`;
   - `coeffs` equals `rigSailCoeffs` to 1e−9;
   - `heM` is 1.1 × the masthead's height;
   - the leads follow §3.9 at 7°;
   - `lumpedSail` follows §6.8;
   - the CG roll-up is exact;
   - a rig GLB without `extras.rig` gives no `spec.rig`;
   - on a hull keyed otherwise, the stock contract isn't taken.
10. **P1 and P2**:
    - a free sail's α is alpha0 and its CL_a is 0 (the main's ≤ 0);
    - pinned sails' wrench is unchanged at the agreement points (the
      harness runs as it does);
    - with `jibHeld` +1, the jib stays on starboard through a tack (one
      scripted tack, flat water, steady wind), backed after it;
    - with `jibHeld` absent, it crosses.
11. **Station**:
    - each key in the table, at the working and the lazy winch, with held
      null or set, makes its one change;
    - the prompt's look walk has at most three verbs;
    - a second person can't take a held winch;
    - a second trimmer's key does nothing while the jib's claim is held;
    - the helm's B backs the jib to windward and lets it fly.
12. **HUD**: `hudModel` gives each row's exact text for each state above,
    and today's "Sail" row without a contract.
13. **Allocation**: one `dress` of a ship, warmed, then 600 frames: the
    looks' per-frame path allocates nothing. Its buffers are identity-
    stable, and a counting `Float32Array`/`Array` shim in the test sees no
    new arrays.

### 5. Probes: Chrome never outlives its driver

Every probe driver that starts Chrome makes sure Chrome dies with it. Each
package's `probes/` carries its own copy of `chrome-guard.mjs`, since
packages are independent. `guardChrome(chrome, { profile })`:
1. Chrome is spawned `detached`, its own process group, so one signal
   reaches its helpers.
2. A watchdog is spawned detached and unref'd: `/bin/sh -c` that polls
   `kill -0 <node pid>` each second. Once node is gone it sends TERM to
   Chrome's group, KILL after 2 s, and removes the profile. That covers
   `kill -9` of node, where no handler runs.
3. `process.on("exit")` sends KILL to the group synchronously. SIGINT,
   SIGTERM, SIGHUP, `uncaughtException` and `unhandledRejection` call the
   driver's `stop`.

A finite check, `probes/chrome-guard-check.mjs`, stands in `sleep 600`
for Chrome. It asserts the stand-in is gone within 3 s after each of:
normal exit, SIGINT, SIGTERM, an uncaught throw, and SIGKILL of the node
parent.

### As built (items 1 and 5)

**Item 1.** `stock-rig.js` states her contract from `ship.js rigDrawing()`
(every point the mast and rig meshes are drawn from, now shared constants,
so the meshes are byte for byte what they were) and the kept parts of the
fixture (`stock-rig-12m.js`). `partGLB("rig")` carries it as `extras.rig`,
filed under `sailing/rig@2` then (`rig@4` today: parts.js `VERSIONS`). Where the build differs
from the spec above, or says more:
- *The runtime copy is a module, not JSON* (`stock-rig-12m.js`, the kept
  parts only: about 19 KB, not the fixture's 199 KB), because plain node
  (publish-ship.mjs imports the template) and a page served from the repo
  (navprobe.mjs imports ship.js) can't import JSON. `stock-rig.test.js`
  holds every part of it equal to the test copy of the fixture.
- *The clew's proportion is 0.2827*, the fixture's to four places (it is
  0.28270; the spec said 0.2824).
- *Her jib's clew is high*: on her masthead stay, 0.2827 up the luff and
  LP = J = 4.52 aft puts it 2.3 m above the tack (y 4.05 in her frame; the
  fixture's fractional stay puts its clew 1.07 m up). So her leads land
  well aft: at furl 0 on the side deck at z 1.60, 0.95 m out, just outboard
  of the cabin's wall (`deckSurfaceAt`: the cabin's crowned roof within its
  walls' tops, the cockpit's sole in the well, else the deck); at furl 0.3
  at z −0.19, 0.73 out. Item 2's winches go aft of these.
- *Where the rig belongs.* §8 puts a rig GLB in her hull's coordinates;
  hers is drawn about the gooseneck and placed at its stand. So
  `extras.sail.at` (sailing's own extras, not the contract) says where it
  belongs in her hull's frame ({ position, rotation }: `FIT.rig`), and
  `specFor` checks the rig's placement against that, not the identity:
  at its stand nothing is said; moved off it, the contract's places still
  hold and its warning says so.
- *The gate.* `contractOn(extrasRig, hullKey)` takes a contract unless it
  is a synthetic-hull contract that names a `glbKey`, and her hull's file
  key (`body.js hullKeyOf`: the `doc.assets` key whose URL is her hull
  object's `sourceUrl`) is not of that family (`keyFamily`: the key less
  its `@n`). It is scoped to synthetic-hull contracts because a linked
  contract may carry a `glbKey` too: the rig aid (now in `naval/`) links
  the hull itself (`path` `file` or `source`), refuses a scene render and
  always writes `glbKey` null, but v1 keeps a non-null one for contracts
  written before that (§3.2), and such a rig keeps today's rule. A hull with no key in `doc.assets` (an
  imported hull) doesn't take the stock contract. The gate is in one place
  for both readers: `specFor` (the physics) and `rigContractOf` (her
  frame). `checkSource` is quiet when the
  key's family matches; a synthetic contract never tries her drawn mesh, so
  sim.js reads her triangles only for a linked contract.
- *Her lowers.* She draws a forward and an aft lower shroud each side;
  the schema names one per side, so both carry `lower-shroud-port` (or
  starboard). The validator's duplicate-id rule is for sails, appendages
  and chainplates.
- *The rig's masses are the fixture's*: the mast, boom, rigging and sails
  are moved to where she draws them (the mast's middle, the boom's, the
  wires' length-weighted centroid, each sail's CE) without changing their
  masses, so `massKg` stays 8000; `cgM` is their roll-up, exactly. The
  mast's `massKg` is the fixture's item's and `kgPerM` that over her 14 m.
  The fixture's righting table (computed at its CG) is kept, as the spec
  says for the loading; the sim's righting comes from her columns, not
  that table.
- *The drawn hull* displaces 9.38 m³ below her waterline (every hull
  triangle, keel and rudder included, `meshVolumeBelow`) against the
  contract's 7.80 m³: pinned as the known gap in `stock-rig.test.js`.
- *Not yet*: `mast@2` (still the furled-jib roll), `hull@3`, `jib@1`,
  `winch@1` and `extras.sail.cloth` belong to items 2 and 4, and aren't
  built. So until item 2's Jib piece exists, her jib flies in the physics
  (unfurled whenever the main is up, trimmed with the main) while the
  drawing still shows it rolled on the forestay.
- *Streamed*: `published()` carries `jib` (the jib's chord) for a contract
  ship, so a follower reads it as the simulator does.

`stock-rig.test.js` (36 cases) pins item 9's list: the kept parts against
the fixture; `rigContract` and the specification's validator
(`test/rig-contract/validate.js` and `schema.json`, copied) pass it;
`rigFrame` is the identity and `frameOf` gives her the frame she had; the
main's tack is the rig's origin and its luff the rig's Y, its outline the
drawn cloth's, its reefs `reefed`'s; the jib's tack, head and clew by the
rules above (LP = J to 1e−12); each sail's and reef's area and CE its
polygon's, its slope `sailSlope`, its coeffs `rigSailCoeffs` to 1e−9; the
sets, I, J, P, E, BAS, designer and actual; the mainsheet hardpoints; the
lead rule reproducing the fixture's own leads (1e−6) and hers at 7°, on the
line, on her drawn deck; the lumped-sail rule reproducing the fixture's own
and hers; the CG roll-up; the gate (any `sailing/hull@n` takes it without
a warning; camber's, an imported hull, a doc without files, and a rig
file with no contract don't, and their spec is the plain one key for
key); and on a fake stage the template's sloop (files and all) sails the
contract (her jib read) while the same layout with a contract-less rig's
extras doesn't, neither warning.

*Ship at anchor* (`ANCHORAGE_AIR`, 6.5 m/s): head to wind from rest on
flat water, the main up at the template's sheet (0.5), the jib unfurled
and backed to starboard, the helm hard over to bear her away to port, she
falls off past 60° in 12.37 s; with the jib sheeted instead it takes
37.43 s (and she goes to starboard). Both are pinned (they move with P1).
(Superseded: "Leaving the anchor".)

*The probes, re-measured* (2026-11-09, GPU, seeded sea):
- `sailing-run.mjs` passes all 76 checks with two changes, each for a
  reason in the physics, not a looser bound. At anchor the boom is
  sheeted in (sheet 0) for the look at it from the cockpit, then eased
  again: her contract's eased boom, sail down, wanders about the
  centreline with each gust and sheer (where the stock boom lay pinned at
  its sheet), so the look kept missing a moving target; and it aims a
  metre forward of the boom's nearest point, since straight overhead is
  past the camera's pitch. Before lowering the sail, B takes the helm and
  puts her back on the reach: left to herself with the wheel where it was,
  her eased main's CE out to leeward rounds her up, and she had lost her
  way (0.27 m/s) before "she carries her way" could be measured.
- `aboard-run.mjs` (Ship at anchor, Lost Cities, then under way) passes
  all 53 unchanged.
- `camber-run.mjs` passes all 35: the rig's file key is now `rig@2`, and a
  new check reads that on camber's hull the stock contract isn't taken
  (no jib in her read).
- `publish-ship.mjs --dry-run` makes the template's docs in plain node
  (which imports ship.js and so stock-rig.js). `publish-aboard.mjs`
  publishes to the real sync server and wasn't run.

**Item 5.** As specified. `chrome-guard.mjs` and `chrome-guard-check.mjs`
are byte-identical copies in arena, implicit, sailing, scene, tabletop and
tts-import `probes/`. Every driver that starts Chrome spawns it
`detached` and calls `guardChrome(chrome, { profile, stop })` with its own
stop, which now signals the group (`killChrome`): `arena-run.mjs`,
`implicit/shoot.mjs` (which also removes its profile now), sailing's
`cdp.mjs` and `ship-shots.mjs`, water's `ocean-cdp.mjs` (the ocean probe
moved there with the surface, 2026-11-14), scene's `cdp.mjs`,
`solander-run.mjs` (profile removed now too) and `drag-run.mjs`,
tabletop's `cdp.mjs`, and `tts-import/import-run.mjs`; every other driver
starts Chrome through its package's `cdp.mjs`. `naval/probes/cdp.mjs` (then `rig/`) also
launches Chrome and is left alone (it wasn’t this work’s to edit), as is
terrain/.
- The watchdog is `/bin/sh` (detached, unref'd, its argv the node pid,
  Chrome's pid and the profile): it polls `kill -0` each second, and
  leaves early if Chrome's group is already gone, so it never signals a
  reused group id; it removes only an absolute profile path.
- `chrome-guard-check.mjs`'s stand-in Chrome is `sh -c "sleep 600 & exec
  sleep 600"` (a helper in its group, as Chrome's renderers are); its
  driver waits for the check's word on stdin before ending, so the
  stand-in is seen running first. All five ways out pass in every package
  (normal exit and the handlers in about 0.1 s, SIGKILL through the
  watchdog in about 1 s), and the check fails as it should without the
  handlers (all five) or without the watchdog (SIGKILL). With real Chrome:
  `ship-shots.mjs` killed with `kill -9` mid-run left none of its 10
  processes and no profile 4 s later.

### As built (items 2 and 3)

**Tests in two tiers first.** `pnpm test` (vitest.config.ts) runs every
`src/**/*.test.js` but `*.slow.test.js`: 613 cases in about 6 s wall.
`pnpm test:slow` (vitest.slow.config.ts) runs the `*.slow.test.js`: the
polar (`physics.slow.test.js`), 45 s on a seeded sea
(`hull-resistance.slow.test.js`), the agreement sweep over the five
fixtures (`agreement.slow.test.js`), two sloops sailed 30 s each on a
quarter-turned hull (`frame.slow.test.js`), the stage cases that sail her
8–25 simulated seconds (`sim.slow.test.js`), the two-crew aboard case
(`aboard.slow.test.js`) and the walker's enumerated cases
(`walker.cases.slow.test.js`). Their shared
setup moved to `src/test/` (`sim-stage.js`, `sail-runs.js`,
`frame-hulls.js`). README "Working on it" says which to run when.

**Physics (P1, P2, read().sails).** As §3. `lies(free, S)` puts a sail its
sheet doesn't hold at `free − sign(free)·alpha0`; `jibHeld` is as §2
(held wins over `jibBacked`); `read().sails` is built from per-sail
`Float64Array`s the substep fills (no allocation in it). One thing the
spec's "exactly not pinned" doesn't hold for: the main. Its free angle is
alpha0 off its air without the upwash ε (ε is computed after the angles,
from the jib's lift), so the main lies at α = alpha0 − ε (CL_a ≤ 0, as §3
says) and trim.js's α_sheet, which subtracts ε, can read "luffing" while
the main is pinned within ε of its zero-lift angle: backwinded by the jib,
which is what that is. The jib (ε = 0) is exactly "luffing iff not
pinned": `trim.test.js` checks it at every whole degree of wind 5–60° ×
four sheets on the physics' own read.

Irons, re-measured with P1 and P2:
- the fixtures (`sails-jib.test.js`, backed with `jibBacked`): above, in
  "The rig contract".
- the stock sloop at the anchorage (`stock-rig.test.js`): exactly head to
  wind from rest, the held jib's side is a coin toss (its air crosses the
  centreline as she yaws a hair; held on the leeward side it only luffs,
  so neither "held starboard" nor "tends itself" got her out in 60 s from
  dead ahead). The pinned cases start her 1°, 2° and 5° off the wind on her
  starboard bow, the jib held to starboard (windward, what B at the helm
  does) at the station's sheet 0.5, the helm hard to port: past 60° in
  10.03, 9.03 and 8.23 s. Tending itself she takes 56.9 s, 59.9 s and
  more than a minute; the cases pin "not within 40 s". (Superseded:
  "Leaving the anchor".)

**Pieces and files.**
- *Jib* (kind `jib`, `sailing/jib@1`), the third piece of the mast, at the
  contract jib's tack (`jibDrawing`, `jibFit`: Euler X = atan2(u_z, u_y),
  0.317 rad), its GLB two nodes: `Jib`, the cloth (20 × 10, the main's
  camber shape, neutral trim) in the piece's frame, and `Roll`, the luff's
  foil at furl 0 (radius `JIB_FOIL_R` 0.02). The simulator holds it at
  `jibTransform(t, read.jib)` while her physics flies a jib.
- *Jib winches* (part `winches`, kind `winch`, `sailing/winch@1`): the port
  winch at `FIT.winch` (−0.95, 1.234, 2.25: on the side deck outboard of
  the coaming, 0.65 m aft of the furl-0 lead), the starboard one its
  mirror under it. `objectsFor`'s `across` (her body x where the part is
  put; `placement` now returns `body`) makes the first piece the side it's
  put on and mirrors the other. `winchTrait(side)`: stand 0.73 inboard and
  down to the sole (0.514 below the winch's foot). The hull's connector
  for them is `hull@3` (`STAND.winches`, tag `sailing.winch`).
- `mast@2` has no rolled jib on its forestay; `parts.js VERSIONS` was
  `{ hull: 3, rig: 2, mast: 2 }` then ("Parts" has today's), so the
  template files 13 GLBs.
- Not built: the bin's placement "1.2 m aft of the contract's lead" on a
  contract hull without a winch connector (put by hand, they go where
  they're put, mirrored across her).

**Walking.** Each winch carries a `walk.stand` (ship.js `standSpot`),
a seed of walk's bake; the jib is a moving part, so not baked. On her
bake (walk's `deck-12m.test.js` over her fixture) C1–C9 hold with them
and each spot's link stands where it was written. Each spot is on the
side deck across the well from its winch, at (∓1.30, 1.22, 2.25) for the
winch at (±0.95, 1.23, 2.25), its drum's top within 3 m of the eye
(`stand-spots.test.js`, over her drawing); her floors claim (below, "Her
checks") skips the winches' bases. A stand spot has no `facing` now: the
station's look is the station's (stations.js), not the spot's.

**Station** (`stations.js`): as the table in §2, plus quick hold Q / E at
the working winch (the lazy one shows "Lazy sheet: the jib's to port",
disabled). The winch's own claim says who stands there; the jib's claim
is held while Q / E or R is down and for the moment of a B press, so a
second trimmer's key does nothing and the hint says "someone's trimming
the jib". The working winch is the clew's side (`sign(read.jib)`; either,
while the read doesn't say). At the helm B backs to the apparent wind's
side (dead ahead: the clew's side, else starboard). The look walk (every
target × distance × eye × main up/down × jib out/held-and-furled) stays
within three verbs.

**HUD** (`hud.js`, `trim.js`): as §4's table. `hudModel` takes `jib` and
`models` (`ctx.sim.sailModels(ship)`: each contract sail's thresholds,
from the rig GLB this view has loaded, so a follower has them);
`published()` streams `sails` (id, main, angle, limit, from, alpha, sheet,
area, q, rounded to 1e−4). The `dd` of each row carries `data-trim` (the
whole value is coloured, not just the word). The nudge gains "jib furled:
hold R at a winch"; the guide "Winches: jib sheet, furl".

**Looks** (until item 4): `jibLook` (pure) scales the `Jib` node's chord
by 1 − furl (exactly `furledClew`: the piece's Z is square to the luff),
its camber by the trim's belly side × (1 − flog) (never under FLAT), and
the roll to 0.02 + 0.06·√furl; a jib her physics doesn't fly (a stock
mast on camber's hull) is drawn rolled away.

**Measured** (2026-11-09): `pnpm test` 525 passed, `pnpm test:slow` 38
passed, build OK. Browser probes not run (a build step); one look at
`ship-shots.mjs` (quarter, helm) showed the jib on her forestay and the
winches by the cockpit.

### As built (item 4)

**Files.** `cloth.js` (new, pure): `clothVertices(out, cloth, look, t)`,
`clothNormals`, `battenVertices`, `clothPoint`, `outlineArea`,
`furledClewOf`, `reefCut`, `clothOf`, `FLAT`, `NEUTRAL`. `trim.js` gains
`rigGeometry(contract)` (the body-frame points the visuals need, memoised
per contract), `swingCoeffs`/`swingDist`/`maxSwingDist`, `sheetSlack`,
`mainsheetSlack`, `jibSheets`, `furledClewAt`, `leadAt`, `arcLength`,
`sagOf`, `sheetCurve`, `flutterOf`, `telltaleOf`, `ribbon`, `mastheadAir`,
`vaneAngle`, `vaneLines`, `burgeeLines`. looks.js's `jibLook` is gone (the
cloth replaces it); `createLooks` dresses as §4.

**GLBs.** `rig@2`'s `extras.sail.cloth` is the main's cloth (26 × 12, its
rows `sailRow`'s, `foot` 0.14 for the flat foot on the boom, battens on rows
6/11/16/21 from column 6, `reef` the contract's luff: the gooseneck straight
up the rig's Y); `jib@1`'s is the jib's (20 × 10, twist 0.2). The `Sail`
node is the cloth and the battens (now ribbons, `battenVertices`, not
tubes) at `NEUTRAL`; a new `Bunt` node lies along the boom at radius
`BUNT_R` 0.02 (inside the boom until a view swells it). The file keys
stayed `rig@2` and `jib@1` (nothing filed before item 4 needed them kept);
they are `rig@3` and `jib@2` since, their cloth taking no shadows, and the
rig `rig@4` since its contract states its windage (§3.13).

**Where it differs from §4, and why.**
- *The reef* cuts level at f of the contract's own tack → head (the
  gooseneck up the rig's Y), not at f of the drawn luff (which starts 0.1
  above the boom): rows h map to the luff's and the leech's parameters
  where their height is the cut's (`reefCut`, exact on the stored
  polylines). The spec's own row rule misses the contract's reef areas by
  1.5% at 0.15; this is within 0.01%.
- *The twist* is twist·(1 − σ/2)·h·t²·belly·chord/foot: in proportion to
  the row's chord, so the head (a point) stays one. Without it the old
  cloth's head fanned 0.35 m across.
- *Sheet slack* is `sheetSlack`: the total variation of the lead-to-point
  distance between |θ| and the limit (the distance is exactly A + B cos θ +
  C sin θ about the luff). Where it's monotone that is the spec's L − d;
  the mainsheet always is. A jib sheet's distance shrinks until the clew
  passes its lead's own angle (7.2° on the stock jib), so L − d would read
  taut for a jib flogging amidships under a sheet set at 7–14°; with the
  variation, s > 0 exactly when |θ| < limit at every limit.
- *The sag* is solved exactly (bisection on the parabola's arc length,
  ½√(d² + 16h²) + d²/(8h)·asinh(4h/d)): the spec's √(3ds/8) is 4% short at
  s = 0.3d, outside its own 1% case. A sheet sags no lower than 5 cm under
  its lower end (`floor`): the lazy jib sheet's slack is metres long, and
  drawn free it hung through her hull.
- *The flutter* fades to nothing on the main's flat foot (the same
  smoothstep as the camber): the boom holds the foot.
- *Lines are in the world* (one group per ship under `api.world()`, never
  picked, never culled): each end from the drawn object it's on (the boom
  through the rig's world matrix, the clew through the jib's, the drum
  through its winch's) and the hull's points (leads, traveller, masthead,
  backstay) through her hull's world matrix and her frame. Telltales are
  children of the `Sail` and `Jib` nodes, in their frame.
- *The dressing is made again* only when a new snapshot changes a ship's
  parts, their content or the burgee flag (a signature string), not on
  every doc change.

**Finite cases** (`cloth.test.js` 10, `trim.test.js` +16, `looks.test.js`
+5):
- (3) d(θ) strictly increasing at every 0.5° on [0, 85°]; s = 0 at the
  limit and s > 0 iff |θ| < limit at limits 0/20/45/85°, both sides; s =
  L − d to 1e−12.
- (4) lazy s ≥ 0 at every whole degree of the travel × furl 0–0.3; the
  working sheet taut at its limit and slack iff |θ| < limit at limits
  5/7/12/30/60°; leads interpolated and clamped.
- (5) straight at s = 0; length within 1% of d + s for s ≤ 0.3d (30
  steps); h strictly increasing; the floor holds.
- (6) `Sail` and `Jib` positions and the battens equal `clothVertices` at
  `NEUTRAL` bit for bit; the reefed outline is reefs[].areaM2 at 0.15/0.30
  and the furled one `furled().area` at 0.1/0.3/0.6, to 0.5%; flog 0 → the
  same cloth at t = 0, 0.1 … 1; displacement ≤ flog·amp; flogging is FLAT
  of the camber; normals unit, facing −x.
- (7) windward lift 0 iff flog = 0 (lift = flog·80°), leeward curl = σ,
  backed/winged both follow σ; the ribbon's geometry.
- (8) the vane: dead ahead → the bow; 3 m/s heading 090° in 5 m/s from
  000° → atan2(5, −3) in her body; rolling 0.2 rad/s at 14.6 m in 5 m/s →
  −atan(0.2·14.6/5) exactly; the burgee streams and hangs.
- Stage (stub api, real GLB nodes): the drawn cloth is `clothVertices` of
  `trimOf`, the slack and `flutterOf`, exactly; the mainsheet starts where
  `swungCE` puts the boom's sheet point and ends at the traveller; the jib
  sheet starts at the physics' clew; the working sheet is straight, the lazy
  one sags; reef → bunt, furl → roll 0.08, dispose restores each geometry;
  the burgee only on `burgee: true`.
- (13) warmed, 600 frames with the trim, reef and furl changing: no
  `Array`/`Float32Array`/`Float64Array` constructed (a counting Proxy), and
  every buffer identity-stable. Scope: the sail dressing; the floats' bob
  allocates in the ocean's sampleAt, as before.

**Look** (`ship-shots.mjs` now takes `view?query`; `ship-probe.html
?trim=beat|luff|stall|backed|reef|run` dresses her with the real looks.js
on a stub stage): no page errors; the main and jib to leeward, the reefed
main's bunt on the boom, the winged jib to windward with its working sheet
taut, telltales on the jib's luff and the main's leech, ripples on the
flogging cloth. The probe's own sun casts shadow acne on the cloth (its
lighting, not the dressing).

## Leaving the anchor

At anchor, lying back on her rode, she lies head to wind; that's what an
anchor is for. Laid at anchor in a seaway she isn't lying to it yet, and
where she points as it breaks out is chance ("Laid at anchor", below:
measured, not fixed, and accepted as it is by the lead, 2026-11-17). The moment
it breaks out, she is in irons unless the crew does something, and for
days every probe's slowest, flakiest step was getting her off the wind.
The cause was in the physics, not the helmsman.

**Why she stayed there.** A yaw map of the stock sloop (12 kn, flat
water) showed dead head to wind a stable equilibrium as soon as she made
sternway: her canoe body's Munk moment went as V·v, so going astern it
turned her back into the wind instead of broadside (and her keel's lift
stayed at its forward quarter chord, a little more of the same). Luffing
sails give only 10–35 N·m within 5° of the wind against about 3,600 N·m
from a backed jib, and Ship at anchor had the jib rolled away, with
nothing at the helm to unroll it. Now:
- the Munk moment goes as u·v (above, "Side force of her canoe body"):
  the same with the flow reversed;
- a foil's centre of pressure goes with its leading edge going astern;
- a made-fast jib is backed to windward, and within its zero-lift angle
  of dead ahead on whichever side it's held (P2); to leeward its sheet
  only stops it going further out, so eased it luffs, never backs;
- B at the helm backs the jib to windward, and within that band on the
  side the wheel asks for, unrolling it if it's furled (§2's table): the
  side chosen always backs it, so the hint names the way she goes.

**What crews do, and the targets.** Left alone in irons a boat drifts
astern and, drifting, turns broadside. Backing the jib turns her bow
without much sternway. With no jib, the reversed rudder works once she
has sternway. Leaving an anchor under sail, you hoist the main while
anchored and back the jib to choose the tack as the anchor breaks out
(US Sailing, Good Old Boat). Pinned in `stock-rig.test.js`, flat water,
from rest, the jib where the wind and its sheet put it:

| 12 kn unless noted | from 0° / 1° / 2° / 5° off | target |
|---|---|---|
| jib backed (wheel to port) | 7.20 / 7.03 / 6.87 / 6.57 s to 45° (±0.05 s) | under 10 s |
| jib backed, 6 kn | – / 14.70 / 14.50 / 14.03 s | under 18 s |
| B at the helm: 0–10° off either bow, the wheel to port, amidships or to starboard, the jib's sheet 0, ½ and 1 (99 cases) | the side B holds it on is backed from the first read; past 45° the way the hint names in 6.1–9.9 s | within 11 s, the hint's way |
| jib luffing, wheel reversed in sternway | – / 46.60 / 44.63 / 38.67 s (±5%) | under a minute, slower than backing the jib and sooner than left alone |
| left alone | 75.70 s from 2° (±5%) | none sourced: falls off by herself, slower than the rudder |

Without the jib she starts on an unstable equilibrium and creeps off it,
so those times move with the smallest change in where she starts: they're
pinned to a band, not to 0.05 s.

The reversed rudder's time is what her sternway allows, and the diagnosis'
first estimate for it (15–30 s, unsourced) was wrong for this breeze. In
12 kn, luffing, about 180 N of air drag pushes 8 t astern (129 N of it
her windage, §3.13's elements, the rest the luffing sails): she makes
0.08 m/s after 5 s, 0.30 m/s after 30 s and 0.34 m/s after 45 s (from 2°
off; measured 2026-11-16). A rudder of 0.6 m² at 0.30 m/s has 46 Pa to
work with, so nothing turns her until she has that sternway: from 2° off
she passes 5° at 20.2 s, 10° at 29.1 s, 20° at 37.5 s and 45° at 44.6 s,
having drifted back less than her own length. The time goes with the
wind: in 20 kn the same move takes 20.1–23.4 s (5°–1° off). So the target is the ordering and a bound, both
asserted: backed (7 s) before reversed (under 60 s) before left alone.
That is why the HUD's advice is to back the jib.

Also pinned: the canoe body's moment under flow reversal is ½ρ·LWL³·|N'v|·u·v
both ways (V 0.3 and 0.8 m/s, λ 5° and 15°), and going ahead that is §6.4's
q·LWL³·N'v·sin λ times cos λ (the agreement's cuvature gap, checked);
drifting straight downwind at 0.45 m/s, at 1–15° off either side, every rig
(main, main and jib, sails down) turns away from the wind (no stable
irons); at anchor, sails down or main up, she lies within 6° of head to
wind. The made-fast jib's cases (P2) are in `sails-jib.test.js`: to
leeward on a fully eased sheet it luffs, as a free one does; within 5° of
dead ahead it's backed held either side.

**The manoeuvre**, in the game and in the probes: raise the main at
anchor, weigh, take the helm; the HUD says "back the jib (B at the helm;
dead ahead, the wheel picks the way)"; wheel over, B (the jib unrolls
backed, on the side opposite the bow the hint names), and once she's off,
B again to let it fly. The probes run it as one bounded step: she must lie
head to wind when it starts, in the HUD's own sense, which is its advice
to back the jib (it gives it when she is luffing, the apparent wind within
40° and under 0.5 m/s, not going astern faster than 0.15 m/s, or in irons,
within 35° and going astern faster than that; else the step fails, not
exercised), and her heading must swing past 45° the way the hint names
within 30 s of world time, with the jib unrolled, recorded either way, never
retried. The bound is 30 s, not the stock rig's 10 s, for a sea where she
breaks out luffing with a little headway: going ahead, the wheel to port
turns her bow to port first, for some seconds, until the backed jib wins.
On the probe's default sea (`--sea 1`) she breaks out in irons, going
astern, and passes 45° in 5.85 s; on sea 383967344 she breaks out luffing
and takes 21 s (2026-11-17, step 5's final build; 18.9 s on 62756a05). The station's verbs (the wheel, sheets, furler, halyard,
windlass) run in world time, `api.clock.t()`, in whole steps of its grid
(`worldSteps`, "Determinism"), so at a few frames a second the jib still
unrolls in its 4 s of world time.

**Laid at anchor, she isn't lying to it, so in waves where she points
as it breaks out is chance (accepted as it is: the lead, 2026-11-17, "a
laid ship breaking out off the wind is OK as it is; no fix in the physics
or the template").** This section's opening claim holds once her
rode is taut (the flat-water case pinned above starts her 20 m from her
anchor and gives her 90 s). It does not hold for a ship *laid* at anchor,
by an editor's move (as the probes do) or as the template lays out Ship at
anchor. Diagnosed 2026-11-16 (lane/n6) in node, without Chrome:
`src/test/breakout.js` replays sailing-run's own sequence (laid at anchor,
the main eased, hoisted and raised, the windlass held, all through the
stations' own held verbs, on the timeline and from the positions the probe
records, `measured.anchoring`), and asks hud.js's own model for the
advice. Measured against the probe's marks on step 5's final build
(2026-11-17; first on 62756a05, when the world's first step read the
template's sea and wind, "Determinism"), the replay follows the
simulator's read to within 3.5° of apparent wind and 0.06 m/s on six
seas; on sea 5, far off the wind with the windlass pulling her, to 15°
and 0.55 m/s at breakout, the verdict the same (a calibration, not
pinned: it moves with any change to her physics).

| sea | as the anchor comes up: apparent wind, speed; B's HUD | 1.25 s later, as the probe reads B's HUD (Chrome) | chain to spare, laid → windlass | while weighing, the windlass |
|---|---|---|---|---|
| 1 | 3° off, 0.58 m/s astern; back the jib | 11° off, 0.36 astern; in irons: back the jib | 12.9 m | never pulls |
| 2 | 32° off, 0.36 astern; back the jib | 38° off, 0.42 astern; nothing (in irons is within 35°) | 11.5 m | pulls for the last 0.7 s, 0.10 m short |
| 3 | 5° off, 0.45 astern; back the jib | 5° off, 0.60 astern; in irons: back the jib | 12.8 m | never pulls |
| 4 | 15° off, 0.44 astern; back the jib | 22° off, 0.49 astern; in irons: back the jib | 12.7 m | never pulls |
| 5 | 143° off, 0.37 ahead; nothing | 178° off, 0.63 ahead; nothing | 9.9 m | pulls from 31.4 to 35.0 s, up to 1.3 m short |
| 383967344 | 29° off, 0.50 ahead; back the jib | 14° off, 0.06 ahead; head to wind: back the jib | 6.3 m | pulls from 30.6 s to breakout, up to 3.9 m short |
| 696349617 | 31° off, 0.36 ahead; back the jib | 21° off, 0.66 ahead; nothing (luffing is under 0.5) | 11.2 m | pulls from 31.6 to 33.5 s, up to 0.5 m short |

(The reads are Chrome's: sailing-run on step 5's final build, 2026-11-17,
one run per sea; the verdicts at breakout and the windlass's columns are
the replay's.) `src/breakout.slow.test.js` pins every verdict here (never
a magnitude), row by row, as the accepted behaviour, and fails when any row
changes; sailing-run's `BREAKOUT` copies the third column's verdict (head
to wind or not as the probe reads B's HUD) and checks it. The
replay's B and Chrome's now agree on every sea's verdict when the probe
reads the HUD; on 62756a05's calibration they differed on sea 696349617
(0.48 m/s ahead in node, 0.53 in Chrome, either side of luffing's 0.5),
so which publish B shows can still decide a row this close.

What the replay shows:
- **Before the windlass turns, she is never on her rode.** The anchor of a
  ship laid at anchor goes down under her bow (sim.js `dropPoint`; Ship at
  anchor's, layout.js, the same) with 25 m of chain in 10 m of water: 22 m
  of horizontal scope. From being laid (7.6 s) until the windlass turns
  (29.35 s) her rode has 6–13 m to spare at every frame, on every sea, laid
  by an editor's move or as Ship at anchor, main up or sails down (28
  cases, pinned). She is a free boat beside her anchor, sailing or drifting
  as the gusts and waves take her: with the main up she had 0.6–0.9 m/s of
  headway, 59–85° off the wind, when the windlass turned on seas 5,
  383967344 and 696349617.
- **The windlass is a cause too, on four seas of seven.** It shortens the
  rode kinematically (all 25 m in 6 s), and on seas 2, 5, 383967344 and
  696349617 the rode goes taut while it does. On the last three the pull
  swings her bow by tens of degrees, toward the wind on two of them and
  away from it on sea 5, and slows her; on sea 2 it pulls only for the
  last 0.7 s. On seas 1, 3 and 4 it never pulls: the physics holds her
  on at least the drop plus her freeboard plus `SLACK` (sim.js
  `effectiveRode`, about 14.8 m), so the last 15 m wound in change nothing.
  The plan's leading hypothesis, that weighing yanks her forward, is still
  refuted: her headway came from sailing adrift under the main before the
  windlass turned, and the pull slowed her.
- **Two of the three seas that fail in Chrome fail on the HUD's
  instantaneous gate.** At the frame the anchor comes up, B's HUD advises
  backing the jib on six seas of seven, all but sea 5. When the probe reads
  it 1.25 s later, sea 2 is 37–38° off (in irons is within 35°) and sea
  696349617 is going 0.66 m/s ahead (luffing is under 0.5), and backed
  anyway, as the probe does whatever the gate says, she passed 45° in 9 s
  and 8.85 s (step 5's final build). Only on sea 5 is she truly off the wind (159°, stern to
  it). The HUD reads her speed through the water, which swings by the
  waves' orbital velocity (±0.5 m/s), so on seas like these the verdict is
  the instant's.
- **Adrift with no wind and her sails down, on most seas she makes way
  toward the waves.** In 60 s, bow or stern to them (pinned as a table of
  verdicts in the same file; metres made toward the waves from 045°):

  | sea | today, bow / stern to the waves | hybrid switch | world's vertical |
  |---|---|---|---|
  | 1 | +10.6 / +10.9 | −6.4 / −6.1 | −6.0 / −5.9 |
  | 2 | +32.7 / +30.2 | +6.5 / +5.5 | +5.8 / +4.9 |
  | 3 | +8.0 / +9.3 | −12.3 / −10.1 | −10.3 / −8.6 |
  | 4 | −5.3 / −1.3 | −21.1 / −21.7 | −19.8 / −20.1 |
  | 5 | −4.3 / +0.3 | −30.1 / −43.9 | −27.2 / −31.4 |
  | 383967344 | +2.7 / +7.1 | −27.9 / −33.7 | −21.6 / −22.7 |
  | 696349617 | +11.4 / +12.2 | −8.1 / −7.2 | −7.0 / −6.5 |

  A hull in waves is pushed slowly down-wave. Most of this is her
  contract's heave damping, applied along her body's vertical (`HEAVE_LINEAR`,
  "moving ahead pitched, that's her bottom's lift"): two scratch switches
  turn every sea but one down-wave. The hybrid damps her body-vertical
  rate along the world's vertical; the other damps the world's vertical
  rate along it. Neither is the whole story: on sea 2 she still makes 5–6
  m toward the waves, so there is a second source, not found. And it isn't
  a head sea's: stern to the waves she makes way toward them as much. At
  anchor this keeps her creeping up on her chain (with the anchor set ahead
  of her, below, her rode was still slack in 75–84% of the frames).
- **Fixing those isn't enough with the windlass as it is.** A scratch
  candidate (kept out of the tree; the lead's to choose, see the
  questions): the anchor of a ship laid at anchor *set* ahead of her bow at
  the reach of her rode, as a ship at anchor lies; and a windlass with a
  bounded pull in her physics (it hauls the chain at its line speed only
  while the tension is under its rated pull, and pulls no harder; a Lewmar
  V2, 12 V, for 35–43 ft yachts: 650 kg, 21 m/min, from its owner's
  manual), the station turning it until her physics has the chain up and
  down. With the windlass alone at the game's 4.2 m/s (25 m in 6 s) and the
  anchor set, she lay within 17° but came up to the anchor at 0.9–1.6 m/s
  ahead on all seven seas: the HUD said nothing (luffing is under 0.5 m/s).
  With the bounded windlass at 21 m/min, weighing took 40–54 s, and in flat
  water she came over the anchor head to wind (2°) at 0.8 m/s ahead: a
  straight chain shortening at 0.35 m/s draws her bow in faster as it comes
  up and down (dx/dL = L/x), so the HUD still said nothing. With all three
  (set, bounded, and the hybrid heave switch) in waves, she lay within
  32–38° (76° on sea 5). Side by side, on the simulator's read as these
  were measured:

  | the HUD advises backing the jib | at breakout | when the probe reads it |
  |---|---|---|
  | today | 6 of 7 seas | 4 of 7 (as in Chrome) |
  | all three candidate fixes | 2 of 7 | 5 of 7 |

  So the candidate is worse at breakout and better 1.25 s later. Raised or
  not, the main changed little with it applied (measured with the
  candidate only, so not pinned).

The plan's table row "sails down" has no verdict to ask for: the HUD gives
the jib's advice only with the main up (hud.js `luffing`, `inIrons`); with
the sails down only the rode's slack before weighing is pinned.

**Two other probe failures on these seas, on 62756a05** (both the same to
the digit on 62756a05's uninstrumented sailing-run.mjs with the same build,
so not the anchoring instrumentation). On step 5's final build (2026-11-17)
both pass: those runs' first step had read the template's sea and wind
("Determinism", cause 2), so they were another world:
- *Sea 383967344: "with the sails down she carries her way, and slows"*
  fails by a hair (a mean of 1.77 m/s over 24 s against 0.9 × 1.95 =
  1.755; the first sample, 2.50, a wave's surge). On b4318ae0's build,
  before N6, the same sea passes (2.62 m/s when the sails came down, a
  mean of 2.15): §3.13's windage changed the whole run before it, and the
  check's bound is marginal. In node, from 1.95 m/s under bare poles in 7
  m/s of wind, running before it she averages 0.91 of her speed over 24 s
  even in flat water (1.77; 1.76 with sailing's old windage), and 0.73–0.88
  of it on other points of sail. It isn't the heave thrust above (flat water
  fails too). Whether the check's bound should depend on her point of
  sail is a question for the lead.
- *Sea 5: "F climbs the ladder: B is back on deck"* failed (B not on deck
  after the climb). That was the walker's (N10's to replace). Since N10
  step 5 it passes on sea 5 (and sea 1): Climb is walk's, and lands you
  at the ladder's top in one step (the old walker's timed climb, its
  ladder state and its board() are gone). Moving it to walk first failed
  on every sea, for a reason the old verb had already met: swimming by the
  hull, the look lands on her side past the thin ladder, so a Climb
  offered only on the ladder isn't offered. walk's Climb now answers a
  look at the ladder or at the support it hangs on (walk spawn.js
  `ladderFor`). What made the old walker's climb fail on sea 5 alone was
  not established before its code went.

So the claim is not met on every sea, and the remaining choices were the
lead's (questions for the lead, 2026-11-16, lane/n6; answered 2026-11-17:
none taken, she is accepted as she is): whether a laid ship's anchor
is set; the windlass's line speed (real, 40–54 s to weigh, or the game's 6
s) and whether it pulls her at all before the chain is up and down;
whether her heave damping goes along the world's vertical (it was put
along her body's for her speed in a seaway, 97% of flat water against 83%,
above), and what else drives her toward the waves on sea 2; whether her
rode should be a catenary rather than a stiff spring that goes slack (in
waves she snatches on it); and whether "head to wind" at breakout is read
through the water, as the HUD does, or over the ground, or over some
seconds rather than an instant (the second finding above: two of the three
failing seas are within a few degrees or a few cm/s of the gate). So
sailing-run exercises the leave step only on the seas where she breaks out
head to wind, and checks which seas those are; `breakout.slow.test.js`
holds the verdicts, and they fail as soon as any of this is changed, to be
rewritten with this section then. (They went red on scene-stage from the
weather merge to 2026-11-17 for a reason of the harness's own: the replay
read the old `sailing.weather` shape, `wind.from`, off the new `weather`
trait, whose `from` is top-level, and laid her headed NaN. Fixed in
`test/breakout.js`; every row as N6 pinned it.)

## Determinism

Runs of sailing-run with one `--seed` and `--sea`, the world held until
both views have loaded (`?held`), are the same world, measured on sea 1:
every step of world time the computing view takes has the same controls
and reaches the same state, to the bit, through the leave step. Measured
2026-11-16 on sea 1, three traced runs on the final build (held verbs on
world time, below): identical to the end of the leave step (2633 rows:
every step and the runner's marks), two of them identical to the end of
the run (13499 rows), the third differing first at the simulator's
handoff (row 13139, 218.63 s: "What's left"), and every check passing
(86) in all three; the step-5 build with the frame-quantum held verbs gave
the same. The other six seas were run once each on the final build
("Leaving the anchor"), not traced twice: that they repeat is expected
from the causes below, not measured. Before, five runs in six took one
world and one another, identical until about 11 s into leaving the
anchor, after which a 0.01 m/s difference grew; on the way to the fix,
three more worlds showed up, each a step or a frame different.

**The trace.** `sailing-run.mjs --trace <file>` (the page's `?trace`) keeps
one row per ship per step of world time, on the computing view, as the step
was taken (`ctx.sim.stepped(id)`: her spec's key, the controls she stepped
with, her state unrounded), and the runner's marks (`{ mark, t }`, t the
last step's, so a mark is on the grid too). A step that doesn't go on from
the last one recorded (her first on a view: a start, warm or cold) adds
where it started and what it read there: the water's seed and height and
the true wind. `probes/trace-diff.mjs a b [--until <mark>]` names the first
row the two differ at, and every field that differs there.

**Three causes, in the order the trace found them.**

1. *A held verb integrated the frame's dt* (sailing's). The first
   difference between two runs on the old build was row 1310, world time
   21.733 s, just after the "hoist" mark: `controls.sail`
   0.0041666666666860695 against 0.004166666666656965, the halyard's first
   frame. A held verb moved its value by `rate × dt`, `dt` the frame's; the
   page's clock reads `now()` as start + frames × frameMs (scene
   `manualTime`), and a frame's dt is the difference of two readings over
   1000, whose last bits depend on how far the clock has run: one of a
   handful of values for a 60 Hz frame, unevenly and with no period,
   1/60 s give or take 3e-13 (a real browser's frames differ far more). How many frames the page ran before the world
   resumed depends on the wall, so each run's held keys put in values that
   differ in their last bits, and the physics grew those. Fixed in
   sailing: a held station moves by the world time it's held, counted on
   the world's grid (`stations.js` `worldSteps`). Made where the hold
   begins with the view's world clock (`api.clock.t()`), each frame it
   gives back the grid points t has crossed since the last, n × STEP_S
   (scene's STEP_S, 1/60 s, and its `gridIndex`, copied: the grid her
   physics steps on), the same double for the same n. A view's t carries
   the same last-bit noise as the dt it is summed from, but which grid
   points it has crossed doesn't, within scene's own 1e-9 tolerance; and
   nothing is carried from frame to frame but the last grid index, so
   there is nothing to round. Every held station uses it: `heldTrim` (the
   halyard, the sheets, the jib's sheet and furl), `heldWeigh` (the
   windlass) and the wheel. It follows that a held key moves nothing while
   the world is paused, and on a follower moves with the follower's t
   (Decisions (N6) has the question this raises). Held: `stations.test.js`
   (a finite table of world times in and steps out; the steps over any
   readings are exactly the grid points crossed; the halyard and the
   windlass held from five page-clock offsets put in the same values to
   the bit; and each key at the helm held through paused frames moves
   nothing, then moves its rate for a second of world time) and
   `aboard.slow.test.js` (B's keys over the same frames from three
   offsets: every step the same, to the bit). With the world time taken
   unquantized (`t − last`) both fail; so does scene's tolerance dropped.
   Step 5's first fix quantized the frames' dt instead (a 1/60 s
   accumulator on page time); it made the probe repeat, but only because
   the probe's frames are exactly 1/60 s, it ran on while the world was
   paused, and its carry dropped or forgave sub-nanosecond remainders, so
   it was replaced by this.
2. *The world's first step read the template's sea, or the probe's*
   (the probe's, against the scene's flush budget). The runner writes the
   Sea's and the weather's seed into the doc and resumes the world in its
   next call. A doc change reaches a stage's extensions at once (a
   microtask) only while fewer than three passes have run since its last
   frame (scene `stage.js` `requestFlush`, `UI_PASSES`); past that it waits
   for the next frame, and how many passes loading's wall-timed arrivals
   ran in the last frame is the wall's. The start rows showed it: most runs'
   first step read the water of the template's own seed (696349617), some
   seed 1's. Fixed in the probe: after writing the seeds, the runner steps
   paused frames (no world time passes) until both views' water and wind
   ambients carry them (a check of its own).
3. *Then the first step read the right water and the last wind* (sailing's).
   With the water right, runs still split at the first step: the start rows
   read the same water and two winds, (−3.749, 4.779) and (−4.021, 5.200)
   m/s at her origin at t 0, which are `createWind` at seed 696349617 and
   at seed 1. `ctx.sea.wind` was made again only in the frame's tick
   (play.js), which comes after the frame's steps, so a step after the
   ambient changed read the last value's wind until the next tick. Fixed in
   sailing: `ctx.sea.wind` is the ambient's as it is when read, made again
   only when the ambient changed (the water package's reader already
   refreshes at the read). Held: `sea-view.test.js` (five ambient values in
   turn, read with no tick between: each the wind of its value), which
   fails on the old getter.

Each fix was proved the way the trace proves anything: the run with the
fix applied equals, row for row, the odd run that had happened to read the
right thing. With (2) applied, a run's trace equalled an earlier run whose
first step had read seed 1's water and the last wind (18341 rows, to the
end); with (3), it equals the run whose start row had read seed 1's water
and wind, up to the handoff (13139 rows of 13499).

**The keys.** After the leave step, two runs once differed at the
helmsman's first wheel move (world time 45.667 s, the rudder −0.48 against
−0.49: B's wheel a frame, 0.01, ahead in one). A key reaches the page as an
input task of its own, which the dispatch's reply doesn't wait for, so a
step sent straight after it can run first. The probe's keys
(`probes/cdp.mjs`) now wait, on the wall and stepping no frames, until the
page has captured them, and a key the page hasn't seen in 1 s is an error
rather than a silent go-on. Not seen again in the runs since; that this
race was the cause is likely, not proved: the input path below has two
other ways to put a control a step off.

**Ruled out.** `ctx.sea.clock` (it was `api.clock.t()`, and is gone);
iteration order over maps keyed by ids (one ship; every row the same); a
0.25 s quantum in the verbs (there is none: 0.25 s is the most world time
the ships catch up in one frame).

**Not seen, not ruled out: B's input reaching the computing view.** In
the runs measured every control landed on the same step in every run
through the leave step (the rows' controls are identical), but that shows
only that it didn't happen there. Two mechanisms in sailing's input path
can put a control a step off, and neither is tested:
- *Presence coalescing.* A crew view asks for presence at CREW_RATE
  (20 Hz, play.js), so a change waits up to 50 ms (three frames) after
  its last send (scene presence.js `requestSend`), and the 5 s heartbeat
  restarts that window; the heartbeat's phase goes back to the
  wall-timed load.
- *The key-up race.* Let go, a held trim commits its value to the doc
  (`ctx.sim.commit`), and its claim's release clears the live input in
  presence (`ctx.sim.input(id, null)`) and the claim in the doc. The
  computing view reads B's presence input while the doc still shows B's
  claim (`sim.js` `liveInput`); if the presence arrives before the doc's
  commit, it steps on the doc's old value until the commit lands, a frame
  or more, by the wall (the same flush budget as cause 2).
Both are open (FOLLOWUPS, N6 step 5).

**What's left.**
- A view's own world time, `api.clock.t()`, is a sum of the frames' dt and
  carries the same last-bit noise (the runner's clock reads at the same
  moment of two runs: 1.016666666666628 s and 1.0166666666667448 s). The
  physics never reads it (its steps are on the grid, at `k / 60`), but the
  HUD, the crew, the looks and the runner's own waits compare it with
  thresholds; a comparison within 1e-13 of its threshold could still split
  two runs. None did in the runs measured. It is the scene's clock, not
  sailing's.
- At the simulator's handoff, past the leave step: one run in three
  differs from the successor's first step (world time 218.63 s on the final
  build): B's warm start, its pose a few 1e-5 m apart, the controls and the
  step the same. B starts from what it last saw of A's hull (`api.worldOf`,
  the stage's playback of a peer's holds) and A's last published motion;
  which of the two, and why, is not traced (the stage's two-peer playback).
  Open.
- The per-sea table under "Leaving the anchor" was measured again on the
  final build (2026-11-17, one run per sea), and the replay recalibrated
  to it (`breakout.slow.test.js`: where the doc had her when laid, the
  windlass from 29.35 s). The same four seas exercise the leave step (1, 3,
  4, 383967344) and fail it (2, 5, 696349617) as before; sea 1's leave
  step is unchanged (past 45° in 5.85 s). On the new calibration the
  replay's verdict for sea 696349617 when the probe reads the HUD is
  Chrome's (nothing), where it had been to back the jib.

## Parts

`parts.js` gives the parts bin (STAGE.md, "Parts") sailing's parts, each
a scene:part in index.js under "Sailing":

| Part | Pieces (the first is selected) | Tags | Traits |
|---|---|---|---|
| Sea | a water object (open, no source) with `sailing.sea` on it, first in the order | | `water`, `sailing.sea`; and `weather` (the weather package's: `{ wind, from, seed }`) if the scene has none |
| Sloop | the hull, and every part below at her stands | | `sailing.ship`; a Sea (its clip 60 × 11 × 60 m, centred on her: deep enough for her anchor, which lies at 10 m) and `weather` if the scene has no open water |
| Mast and sail | the mast; the boom and sail, and the jib on its forestay, under it | `sailing.mast` | `sailing.sail`, `sailing.jib` |
| Wheel | the wheel, its axle `LIFT` over where it stands | `sailing.helm` | `sailing.helm` |
| Windlass and anchor | the windlass; the anchor under it, at the stemhead | `sailing.windlass` | `sailing.anchor`, `sailing.hook` |
| Ladder | the ladder | `sailing.ladder` | `sailing.ladder` |
| Mainsheet | a traveller across the cockpit's sole and the sheet's block on it, under the boom's end | `sailing.mainsheet` | `sailing.mainsheet` |
| Jib winches | the winch on the side it's put; the other, its mirror across her, under it | `sailing.winch` | `sailing.winch` |
| Companionway | the washboards in the cabin's aft end and the dark hatchway over them; the hatch under it, on the cabin top (tagged `sailing.hatch`, for the companionway's connector) | `sailing.companionway` | `traversal.exit` `{ verb: "Go below" }` (no `to`); the hatch's `joints.slide` (forward, −Z, 0.55 m at 0.5 m/s, shut, no wait) |
| Red buoy, Green buoy | the buoy | | `sailing.float` |
| Islet | the islet | | |

- **Put on a ship** (her hull, or anything aboard her), a part squares
  itself to her body frame: its bow is hers, it stands where it was put
  (the bin's spot, or her stand for its tag), and its origin is its own
  height above that. A ladder put on her port side turns to hang outboard.
  Her frame is `frameOf(trait, ctx.content(ship))`, as the sim reads it;
  until her model has loaded, only her trait's `frame` counts. Put anywhere
  else, a part stands as the bin put it. A part that fits a stand writes its
  tag on what it makes, so the hand snaps it to the same stand. If what it
  was put on goes while its files are made, it puts nothing.
- **The sloop** goes on the water at the scene's root (a ship sails only
  there), under where she was dropped, her bow the way the bin faced her
  (away from the viewer: you see her from astern), at rest with her sail up
  and her anchor up. A scene with no open water gets a Sea and the weather
  with her, the Sea keeping a 60 m box about her where its world has no
  open water; open water that is there (a sea, a flat Water) is left alone.
- **Files:** each kind is the scene's one GLB doc under
  `doc.assets["sailing/<kind>@<n>"]` (`ctx.file`), so ten buoys share one;
  bump `<n>` (`fileKey`) when a kind's drawing changes (`VERSIONS`: the
  hull's is 5 (its companionway became a part), the rig's and the mast's 3,
  the jib's, winch's, windlass's, mainsheet's, wheel's, anchor's and islet's
  2, the rest 1). `ctx.file` is
  required: there is no other way a part makes its files.
- The template is the Sloop part's objects with her way on, the landmarks
  (the buoy and islet parts, locked, in a group), and where people start
  (`view.start`: a home view only, so Look).
  At anchor, her stations' settings are set over the parts' own
  (`sloopObjects(..., { settings })`): the sail lowered, the anchor down.

## Traits (in the doc)

| Trait | On | Fields |
|---|---|---|
| `sailing.sea` | a water object (the water package's `water`) | `{ seed, scale }`: its waves are the spectrum of the world's wind, `scale` their height. On an object without water it does nothing, and says so |
| `sailing.ship` | the hull object | `{ frame?, spec?, motion? }`: `frame: { position?, rotation? }`, where her body frame sits in her hull's, each part over what her GLB says ("The ship's frame"); spec overrides; `motion: { velocity, spin }` (world, her body's) as last saved, beside its object's `transform`, where it last rested or was saved. Only a ship at the scene's root sails |
| `sailing.helm` | a station under the ship | `{ angle }` -1..1, where the wheel was left |
| `sailing.sail` | a station under the ship | `{ raised, sheet }` 0..1 |
| `sailing.jib` | a station under the ship (the jib, on the mast) | `{ sheet, held, furl }`: `sheet` 0 hard in .. 1 eased; `held` null (it tends itself) or the side its clew is made fast on, `"port"` \| `"starboard"`; `furl` 0..1 of it rolled away. Worked from its winches or the helm |
| `sailing.winch` | a winch under the ship, one each side | `{ sail: "jib", side: "port" \| "starboard" }`: the sheet led to it; who stands at it is its `"station"` claim, and where is its `walk.stand` |
| `sailing.anchor` | a station under the ship (the windlass) | `{ down, rode, at? }` (`rode`: metres of chain out; `at`: where the anchor lies, world, while it's down). The windlass writes `down` and `rode`; only the simulator writes `at`: it drops the anchor on the bottom under the bow, clears `at` when it's up, and drops it again where she is when `at` is further from her bow than her rode allows (she was moved, or copied, while nobody sailed) |
| `sailing.mainsheet` | a station under the ship (the cockpit's traveller) | `{}`: where the ship's sail is trimmed and hoisted from (its values are the sail station's); who stands at it is its `"station"` claim |
| `sailing.hook` | the anchor itself, under the ship | `{}`: drawn lying on the bottom at `at` while its windlass has it down, at the bow (its doc place) when it's up |
| `sailing.ladder` | the ladder under the ship | `{}`: the way aboard from the water |
| `sailing.float` | any object | `{}`: bobs and tilts with the waves where it's moored (each view, from the shared clock; no hold) |

walk's traits (walk/DESIGN.md, "The traits"), which her parts write so
people walk her in walk (since N10 step 5; parts.js PIECES, sloopObjects):

| Trait | On | Value |
|---|---|---|
| `walk.support` | the hull | `{}`: walked in her own frame. The stock sloop is written one; a hull made a ship by hand becomes one when the first sailing part is put on her (parts.js `part`) |
| `walk.moves` | the boom and sail (the rig) | `{ blocks: true }`: an obstacle where it's drawn |
| `walk.moves` | the jib; the anchor | `{}`: passed through |
| `walk.moves` | the wheel | `{ swept: "z" }`: the solid its turn about its axle sweeps |
| `walk.stand` | the wheel, the mainsheet, the windlass, the rig (the sail's: placed by the doc, which never swings it), each winch | `{ at, claim }`, `at` in the piece's frame: STAND_OFF aft of the station's origin (0.6 m; the mainsheet 0.35), on what's drawn there (ship.js `standSpot`, `deckSurfaceAt`); a winch's across the well on the far side deck, facing it. `claim` is the one the station's verb holds while you stand there: `"station"`, the rig's `"halyard"` (the sail's `"station"` claim is whoever trims it, from anywhere) |
| `walk.ladder` | the ladder | `{ top }`: INBOARD (0.5 m) in from its hook, on the deck (ship.js `ladderTop`) |
| `walk.spawn` | the wheel | `{}`: on an object with a stand spot, walk's spawn is at that spot: people come aboard where the helmsman stands, facing forward, on any hull the wheel is fitted to |

The weather package's `weather` (a scene trait) is written by her Sea and
Sloop parts and her templates where a scene has none (`newWeather`: the air
of it only, `{ wind, from, seed }`, m/s, degrees and the gusts' seed; every
other field is the weather's default), in the shape weather/WEATHER.md
documents; sailing never reads it, only the `wind` ambient it becomes, and
imports nothing of the weather's.

Two other packages' traits ride on her companionway, written in the shapes
those packages document (traits.js `SLIDE`, `EXIT`); sailing reads neither
and imports neither. Its hatch's `joints.slide` opens it (joints moves it,
in her hull's frame as she heels, and writes where it comes to rest); the
companionway's `traversal.exit` leads nowhere until a scene gives it a `to`.
Both pieces carry a sailing tag, so they are hers: the hand never carries
them in play, a click on them comes aboard, and walk bakes them into her
mesh (the hatch where it rests: a hatch that comes to rest open changes her
bake key, and walk bakes her again off the frame loop, as for any part
moved).

Who is at a station is a **claim** in the doc (`claims: { station | halyard:
{ viewer, session } }` on the object), lapsing when the holder's session
leaves presence; who computes the sea and the ships is the doc's clock's
claim, the stage's (`claims.clock`, scene TOOLS.md §7). `halyard`, on the sail
station, is who stands at the mast; the sail's own `station` claim is held
only while a key works it, from wherever, so someone at the mast doesn't
stop the helmsman trimming. The ship's motion is a
**continuous pose hold** by the computing peer, which every other peer
shows interpolated; it is written to the doc only at the clock's
checkpoints (every 30 s, on pause, on letting go).

The stage's names: `api.claim(id, kind, { onLost })` → release | null,
`api.claimedBy(id, kind)` → `{ viewer, session, mine } | null` (STAGE.md,
"Claims"). A lapse is a presence change, not a doc change, so whoever waits
to take over checks `claimedBy` in its loop. There is no `continuous` flag:
every peer's hold is played back interpolated (about 1.5 send intervals
behind), and `api.presence.rate(hz)` raises the pose rate too.

Presence keys under "sailing": `ships: { [id]: published diagnostics +
{ velocity, spin } }` from the computing view at 5 Hz, `input: { [stationId]:
fields }` from whoever works a station, and `crew: { on, position, yaw,
pitch, station }` from everyone aboard. The presence rate is play.js's to
set: 30 Hz while simulating, 20 aboard, else the stage's default.
The sail is its own node ("Sail") in the rig's GLB, so each view lowers it
toward the boom by the sail's `raised`, and bellies it to leeward of the
boom as drawn (STAGE.md's "dressing": only content that sailing's own
traits mark, put back when it stops).
`api.worldOf` and `api.raycast` see the pose drawn this frame.

## Play: how the modules meet

`play.js` joins six modules through one context object. Each is
`create…(api, ctx) → part`, where a part may have `tick(…)`, `update(scene,
local, prev)`, `receive(type, data, from)` and `dispose()`, and fills in
what the others read. No part calls `api.loop`: play.js runs one loop and
ticks them in the order a frame needs, and no part imports another
(what they share of the doc is traits.js, of the maths frames.js). Nothing of the ship's can be carried:
what can says so with the scene's `scene.carry` trait (a game's cards and
pieces), which the ship and her fittings never have, so a game played aboard
can't carry off her mast and sailing needs no veto. And the sail's
verbs on the use prompt come from the sail station or its mast (what it
hangs from, or what carries the mast's tag), never from
another traitless thing aboard (a card table): stations.js `sailOf`.

```js
// before this, the stage's clock steps the ships (sim.js's process) on the computing view
api.loop((dt) => {
  ctx.sea.tick();     // the surface drawn at the doc's world time
  ctx.sim.tick();     // inputs; computing: the poses the steps reached; following: what the computer publishes, the poses it holds
  ctx.crew.tick(dt);  // at a station, its eye (walk's walker's) and its verbs' tick; not aboard, follow: the orbit rides
                      //   the first ship sideways (api.camera.ride, a base ride, so a seat at a table
                      //   aboard, whose body rides it, wins), or is moved each frame on a stage without rides
  looks.tick(dt);     // floats and sails, dressed
  hud.tick(dt);
  // and the presence rate, when it changes: 30 simulating, 20 aboard, else 0
});
```

```js
// sea-view.js — createSeaView(api) → ctx.sea
ctx.sea.oceanAt(p, not)  // the water p (this stage's frame; p[1] null: from above) is in, leaving out what `not` carries (the water package's reader), null with none, tilted or the world's at another scale
ctx.sea.wind             // the world's wind (the `wind` ambient) as this stage reads it, the ambient's as it is when read ("Determinism"), or null
ctx.sea.world()          // is her doc the world (the outermost)? her camera ride and HUD show only then, or while you're aboard
ctx.sea.tick()           // after every clock has ticked: the wind's time offset for the next frame's reads; answers api.clock.t()
// ctx.sea has no clock: the sea's time is the doc's world time, and every reader (the HUD's wind, the looks) asks api.clock.t()

// sim.js — createSim(api, ctx) → ctx.sim
ctx.sim.ships()          // ids of the ships that sail (sailing.ship, at the scene's root)
ctx.sim.read(shipId)     // what a sailor reads off her (published(): diagnostics, velocity, spin), as simulated or streamed, or null
ctx.sim.stepped(shipId)  // her latest step as taken on this view: { spec, key, controls, from, state } (createShip's spec, the states unrounded); null following, before her first step, or when that step didn't step her (held, no water)
ctx.sim.stationsOf(shipId) → { helm, sail, anchor, mainsheet, jib, ladder, winches }   // object ids anywhere under her (a rig on a mast on the hull), null if missing; winches a list
ctx.sim.value(stationId) // the station's live value: its trait fields, with its holder's input over them
ctx.sim.input(stationId, partial)   // this view's live input at a station it holds (presence), e.g. { angle }
ctx.sim.commit(stationId, fields)   // a lasting change to a station's trait (doc), e.g. { raised: 0 }
ctx.sim.simulating()     // is this view the one computing the ships (between the process's start and stop)?
ctx.sim.simulator()      // the computing session (the doc's "clock" claim), when it's someone else, else null
ctx.sim.tick()           // every view, every frame: stale inputs; computing, the poses held where the steps left them; following, what the computer publishes and holds

// crew.js — createCrew(api, ctx) → ctx.crew
ctx.crew.input           // the extension's input handlers (a click on her comes aboard: walk, at her hull). A click reaches
                         //   her only through something of hers (the ships' part holds no scene trait, so the world's sea, sky and shore
                         //   aren't hers); what nearer takes it (a card's carry) has it first. Seated (seatedView: a body over the stage's
                         //   Look or Edit, not the crew's or walk's, a seat), no click does (Enter or the bar's Come aboard does)
ctx.crew.bodies          // [station]: pushed over walk (in her stage) by take, its keys the station's (declared), reach 2.5 m
                         //   (crew.js REACH), `here: false`. Its eye is walk's: take asks walk's `stand(id)` contribution to stand
                         //   its walker at the station's stand spot (walk.stand, on the station itself) and looks from that
                         //   walker's eye each frame; leaving, walk resumes from that eye, which is the spot
ctx.crew.start(ship?), .stop() // come aboard (Enter: stations.js's "aboard"; walk at her hull, in her stage), and leave her (the body chip's Leave)
ctx.crew.me()            // viewerOf: { on: shipId | null, position, yaw, pitch (walk's avatar's), eye: world [x,y,z], station: id | null, swimming,
                         //   playing, paused (the browser released the lock), free (no lock: drag to look), hint (the station's line),
                         //   keys (the top body's declared keys: the HUD's walking hint is walk's own) }
ctx.crew.take(stationId, handlers) → leave   // stand at a station (coming aboard first if you walk anywhere else): pushes the station
                         //   body over walk; handlers: { keys: [{ code, label }], key, keyup, tick(dt), left(), hint?(), look?() }: keys
                         //   as every body declares them (scene/TOOLS.md §4). Who stands there is the claim the station's verb holds
                         //   (stations.js), the one its stand spot names
ctx.crew.leave()         // step away from the station you're at
ctx.crew.tick(dt)

// looks.js — createLooks(api, ctx) → { tick, update, dispose }: floats bobbed, sails dressed, each view for itself
// stations.js — stationCommands(api, ctx) → commands for the use prompt (and keys)
// hud.js — createHud(api, ctx) → crosshair, wind, speed, heading, what the keys do here; tick(dt)
```

**A station's keys say what they do** (decided unattended (2026-11-16,
lane/n9), for the lead). A station declares its keys as every body, tool
and gesture does, `[{ code, label }]` (scene/TOOLS.md §4: a label names
the action, not its state, and codes labelled alike do the same thing), so
the stage's touch pad (scene.touch) shows one control per label: Steer to
port (A, ←) and Steer to starboard (D, →) in the pad's left and right
places, Haul in (Q), Ease out (E), Halyard (R at a post or the helm),
Furler (R at a winch), Back jib / let fly (B), Leave (F). The labels live
beside the handlers in stations.js (`HAUL`, `STEER`, …); walking her deck,
the keys are walk's own. An action can
be unavailable in some states: a winch declares the jib sheet's Q and E on
either side, because which winch is the working one changes while you
stand there (a tack, backing the jib), and at the lazy one they do
nothing. The HUD's hint line is unchanged. `stations.test.js` asserts
every variant's declaration as a literal (the lazy winch among them),
and checks from one state, the station just taken in the stage's starting
trim, holding each code half a second: exactly the variant's listed idle
codes do nothing (only the lazy winch's Q and E), and among the rest two
codes do the same thing (the same inputs, writes and place) exactly when
they share a label. Open for the lead: the
words, B's above all (it backs the jib, makes it fast at a winch, or lets
it fly, by state), and whether the HUD's hint should drop key names on
touch.

The play instance also carries `debug: ctx`, which nothing in the stage
reads: the browser probe (`probes/sailing-run.mjs`) reads and nudges the
parts through it.

**The sea's time is the world's.** The sea, the wind's gusts, the ships'
physics and the floats' bob all read one time, the doc's world time
(`api.clock.t()`, scene TOOLS.md §7). The view computing it runs it at the
wall's rate, at most a quarter second a frame (a longer stall is skipped;
the physics skips with it, `catchUp`), and steps the ships' process on a
fixed grid of it. A follower's is the computer's at the moment whose held
poses it is drawing, so the hull sits on the waves drawn under it. Paused,
or with nobody able to compute (only read-only viewers, or viewers missing
a listed package), the sea stands still; someone editing her runs the same
extension, so she sails on (scene TOOLS.md step 8). Nobody present, no time
passes.

**Who computes.** The ships are a process of the doc's clock
(`api.clock.process({ start, step, save, stop })`): the view holding the
doc's `"clock"` claim, the stage's, steps their physics on the clock's
grid. Once a frame (`ctx.sim.tick`), not at every step, it holds each
hull's pose and its moving parts' poses (rig, jib, wheel, anchor) where
the steps left her, for everyone, and raises the presence rate: a slow
frame takes many steps of 1/60 s, and holding poses at each cost as much
again as the physics, for nothing anyone sees; everyone else follows, poses played back by the
stage. A follower keeps each hull's matrix as it last saw it held; when it
comes to compute (the computer left, crashed, hid, or was paused and
resumed), `start(t)` carries on from that pose and the last motion
streamed, never from the doc's older save (warm), and from the doc only
when it has followed nothing (cold). The clock's checkpoints (every 30 s,
on pause, on letting go) call `save(d)`: each hull it still holds, its
transform and its motion (`sailing.ship.motion`), stamped by the stage
`saved`; `stop()` lets the holds go *landed* when a checkpoint just wrote
them (peers keep showing her there until their doc agrees).

**A person and a process on one hull.** The hull's hold yields (a
process's, giving way to a person's) unless someone is at the helm: so
someone may carry or drag a ship nobody steers, the process's holds are
refused meanwhile and her physics isn't stepped (she waits where she was
taken, with her motion), and she starts again at rest where she's put
down; put back instead (Escape), she goes on from where she was taken, not
from where hidden physics would have drifted her. One at the helm is
driven, and nobody takes her. A transform that changes in
the doc without the stage's `saved` stamp changing with it was moved by
something other than a checkpoint (the halo, the inspector, a carry): she
starts again from there, at rest, and her anchor is dropped again. One
written with a new stamp is a checkpoint (perhaps a late one, landing after
a handoff) and changes nothing. A state that goes to NaN is never shown,
published or saved: she's put back at her last good pose, still. Physics
runs at the object's scale.

**Controls.** A station's lasting setting is its trait (the sail raised,
where the wheel was left, the anchor down). While someone works a station,
their live input goes in presence (the wheel turning) and the simulator reads
it from whoever holds that station's `"station"` claim; letting go commits the
final value to the doc. The helm commits each time a steering key comes up
too, and a tab that's hidden or closing steps away from its station (which
commits), so the wheel stays where it was left. The helmsman holds the
wheel's pose themselves, so it turns as their key does; the simulator holds
it only while nobody's at the helm.

**Stations** (stations.js). Each verb says `reach: true`: the stage
measures from the body's eye to the point looked at (on the target or
anything under it), else the target's box, against the body's reach (the
crew's 2.5 m, `crew.js` `REACH`; Look's and Edit's everything): the boom over the cockpit is in reach however far its
gooseneck is. Where you lock in (crew.take: at the station's stand spot,
its `walk.stand`; F leaves):

| Station | Locked in | Quick verbs (looking at it, held) |
|---|---|---|
| the wheel (`sailing.helm`) | A / D steer · Q / E sheet · hold R halyard | |
| the mainsheet (`sailing.mainsheet`) | Q / E sheet · hold R halyard | hold Q haul · hold E ease |
| the mast (the rig's mast, or the rig by its gooseneck) | hold R halyard; Q / E only on a ship with no wheel and no mainsheet | hold R |
| the boom and sail, away from the mast | | hold R; hold Q / E on a ship with no mainsheet |
| the windlass | | hold F weigh · F drop |

The sheet and halyard are led aft, so the wheel works both; the mast is no
place to trim from. Every key at a station is a held trim of the sail
station's field under its `"station"` claim (Q / E one at a time, R beside
them). For any one look the prompt has at most three verbs, and a unit case
walks every look (each station kind × reach × where the eye is × the sail up
or down) to say so. Looked at from beyond reach up to `FAR` (12 m), walking
her deck, a station answers greyed with where to go (`walkTo`: "Sail · walk
to the cockpit" when she has a mainsheet), or, when you're already within
`NEAR` (3.5 m) of one of the sail's stations, which to take ("Sail · work it
at the wheel or the mainsheet (F)": at the wheel, the sail overhead isn't
"walk to the cockpit"). The quick hold R is the mast's and the sail's only;
at the wheel and the mainsheet you take the station (F) and then hold R, and
the HUD's advice and the at-anchor notice say exactly that. The mast is a traitless object
aboard that the rig hangs under, or that carries the `sailing.mast` tag; a
card table in the cockpit is neither. The HUD names her stations while you
walk (`stationGuide`) and, sail down with the anchor up, where to raise it.

**People** are walk's: each view's walker publishes walk's presence record
(`{ on, feet, yaw, pitch, swimming }`, its feet local to the support it
stands on, her hull while aboard) and walk.people draws everyone else in
that support's frame, so a peer whose view of the hull lags still sees
them on her deck; whoever holds a station's claim is drawn standing at its
stand spot. Sailing keeps no record of her own ("Walking", below).

## Walking: walk's, on her deck

Walking her deck is walk's (since N10, lane/n10): its one walker stands on
any support, a frame that moves under you, and her hull is one. The bake,
the walker, the invariant, the transitions and their checks are in
walk/DESIGN.md: "Standing on supports" (supports, the traits, the one
body, the bake per support, falling, bodies over walk, presence) and
"Foundations" (the mesh, B1–B7, the move, the unit and enumerated cases,
C1–C7 and C9), moved there from here in step 6 and renamed. Sailing has
no walker, navmesh, aboard body, avatars or presence record of her own.

What is still hers:
- **The traits her parts write** ("Traits (in the doc)"): the hull a
  `walk.support`, the rig a blocker, the jib and anchor passed through, the
  wheel swept about its axle, a stand spot on each station, the ladder's
  top, the wheel her spawn.
- **Come aboard**: `api.body.enter("walk", hull)`, the hull's one verb for
  entering at it (a click on her, Enter, the bar's Come aboard).
- **The station body**, pushed over walk ("Play", crew.js): its eye walk's
  walker's at the station's stand spot, through walk's `stand(id)`.
- **Who is aboard**, read for the HUD and the verbs from the top body and
  walk's `avatar` (crew.js `viewerOf`), never kept.
- **The stock sloop's numbers, and the checks only she has**, below.

### The sloop's deck in walk's numbers

walk's one body (walk DESIGN, "One body") is this deck's: c 5 cm, slope
35°, step 0.58 m, H 1.75 m, r 0.25 m, with walk's jump (5.2 m/s, apex
0.845 m: the lifelines clear more easily than at sailing's old 4.6) and
speeds (4.5, 7.5 m/s). r 0.25, not walk's old 0.35, because 0.35 closes
the side deck at the aft lower shroud (1.33 m out at head height, the
cabin side at 0.675: nothing free); at 0.25 the walkway there is 1.06 m
inboard of the shroud's foot, and you still pass beside the wheel.

**The cockpit is a STEP.** The rises measured from `ship.js`'s own
surfaces (`deckAt`, the sole at 0.72, the benches at 1.08, the cabin top
at 1.72, the coaming's `0.2·smoothstep(4.1, 3.5, z)`):

| From → to | Rise | Class at step 0.58 |
|---|---|---|
| sole → bench | 0.36 | STEP |
| bench → deck, bench → coaming top (z ≤ 3.5) | 0.16, 0.36 | STEP |
| side deck → cabin top | 0.39–0.49 | STEP |
| **sole → deck at the well's sides** | **0.516–0.531** | **STEP** |
| sole → aft deck at the well's aft end | 0.531–0.546 | STEP |
| sole → deck + coaming, z 3.5 → 4.1 | 0.718 → 0.517 | WALL forward of z ≈ 3.88, STEP aft of it |
| deck → upper lifeline (the deck beside it) | 0.61–0.625 | WALL, which a jump clears |
| sole → washboards / cabin top | 0.96–1.0 | WALL |

Why a STEP and not a WALL:
1. **The helm needs it.** The wheel fills the well: 0.58 m out each side,
   handles included, against a well 0.8 m out. That leaves a 0.22 m gap,
   less than 2r. The sole aft of the wheel, where you spawn and steer, then
   has no way out on foot except up its sides or its aft end. With a WALL,
   the helm could only be left or reached by jumping.
2. **It is how a boat is used.** You step up from the cockpit onto the seat
   or the deck.
3. **0.58 sits in a gap.** The highest rise that must be a STEP is 0.546;
   the lowest that must be a WALL is 0.61 (the lifeline). That leaves
   3.4 cm and 3 cm of margin, and C7 rebakes at 0.56 and 0.60 to prove
   nothing hinges on it.

### Her checks

walk's `deck-12m.test.js` runs C1–C7 and C9 on her bake input (her
triangles from `ship.js` and her seeds), a copy in walk's fixtures
(`walk/src/test/fixtures/deck-12m.json`), refreshed by
`probes/export-deck.mjs` and compared by the repo root's
`scripts/check-fixtures.mjs`. Only she has:
- **C8**: no OPEN side anywhere, so you never walk off her; every WALL to
  OFF rises above `step`; on each side there are WALLs to OFF a jump clears
  (173 a side, rise 0.60–0.65). 14 rise above the apex, beside the
  shrouds' and the backstay's feet, where the wires come down low: you
  can't jump over the side there, which is right.
- **The bow**: the full bake reaches as far forward as a bake of her bare
  hull (within 0.1 m), and nothing forward of the windlass was dropped (C2
  only covers kept cells, so it can't see a region pruned whole).
- **Her claims of a right bake** (`claims` in her export, checked by
  walk's `deck-12m.test.js` in walk's words, so walk names nothing of
  hers): her floors (the sole and benches within 2 mm, her plain deck
  within 2 cm where a cell stands, most of it walkable); her rises (the
  sole aft of the wheel steps up to her deck to port, to starboard and
  aft, 0.5–0.58: "The cockpit is a STEP"; the traveller is a STEP you
  cross from forward and from aft, not a WALL); and the mainsheet's stand
  spot stays within a cell with the Card table where the aboard setup puts
  it (probes/cockpit-table.js, shared with aboard-probe.html).
- **Her stand spots, over her drawing** (`stand-spots.test.js`, no
  bake): each jib winch's across the well, inside her rail, its drum in
  reach; from the working winch's, the jib's luff seen past the main and
  the mast; the helm's (her spawn) on the sole aft of the wheel; the
  mainsheet's aft of the traveller, forward of the wheel, its block within
  2 m of the eye (walk's reach, Q9, under her station's 2.5), and the
  table wholly forward of the block, so no look from the spot to it
  crosses the table.

In the browser, `probes/sailing-run.mjs` runs C1–C9 on the bake B's view
made from her loaded GLBs and walks the cockpit's edges with real keys
(both sides of the well and its aft end, out onto the side deck and back,
a jump at the aft end) with walk's assertion on; `probes/camber-run.mjs`
rigs a camber hull from the bin and runs C1–C7 and C9 on hers (C8 is the
sloop's rails).

### As built (her mesh and fittings)

- **Her mesh** has 8,086 cells (12,786 triangles), all one region; 2,402
  of them have a finite headroom. Sailing's seed pruning dropped two
  components, both inside her: the bilge under the cabin, and a 0.24 m²
  patch under the sole (walk keeps every component until its pruning
  lands: its bake is a superset). Every link lands where asked (C1:
  0–3 mm). Before the bake judged floors on the open square she had 8,098
  (a row of twelve cells 1.08 up at z 3.75–3.8 held up only along a column
  line). She bakes in 80–120 ms in Node at quiet moments, under the 500 ms
  limit.
- **Her fittings, refitted for the mesh.** The windlass was 0.92 m across
  its handles, at z −4.35 where her deck is 2.1 m wide inside the toe
  rails, which cut the foredeck off from the rest (pruned: you couldn't
  walk to the bow). It is now 0.43 m across and stands at z −3.8; the bake
  keeps the foredeck to z −5.18, as on her bare hull, and still does at
  r 0.27 (C7). Its top is eroded away (under the 0.57 m erosion disc), so
  walk's higher jump reaches nothing new. The mainsheet's traveller moved
  from z 2.85, where a card table between the benches buried it, to z 3.3,
  just forward of the boom's end; you stand 0.35 m aft of it, between it
  and the wheel.
- **The camber hull** (rigged from the bin, drawn a metre long with her bow
  +X, scaled to 12) bakes 14,370 cells from 5,366 triangles, with links for
  spawn, the stations and the ladder. Its compact windlass is what let C3
  hold there.

### Decisions

- **Step 5 (N10): sailing walks in walk** (each decided unattended
  (2026-11-17, lane/n10), for the lead):
  - *The sail's stand spot is the mast's.* The rig swings (a drawn pose);
    a stand spot is placed by the doc, but walk.people and the station
    body draw it in the support's frame through its object's placement, and
    the mast carries it, aft of the gooseneck on the cabin top, where the
    halyard is worked.
  - *Stand spots are written on what's drawn there* (ship.js `standSpot`:
    `deckSurfaceAt` at the spot), so the eye a station puts EYE over the
    spot is EYE over the deck, and walk's link for it lies within 1 mm of
    it (walk's deck-12m.test.js). On a hull of another shape the same
    offsets in the piece's frame land near its deck; walk's P1 puts you on
    it when you leave.
  - *The station's eye is EYE up her up from the spot*, not up the world's
    Y, and walk lowers it the same way (walk Decision 34), so taking and
    leaving a station on a heeled deck stands you where you were.
    (Superseded by the step 5 fixes below: the eye is walk's.)
  - *Her spawn is an object of its own*, "Spawn", no model, under the stock
    hull at the helm's stand spot. (Superseded by the step 5 fixes below:
    the wheel is her spawn.)
  - *A hull made a ship by hand becomes a support when the first sailing
    part is put on her* (parts.js `part`): sailing writes `walk.support`
    then. Before that she is part of the ground's bake (Q11 in walk's
    DESIGN asks whether the Ship trait's adding should write it).
  - *`sailing.winch` loses `stand`*: where you stand at a winch is its
    `walk.stand`, one fact in one place. *The ladder's Climb is walk's*
    (F, on `walk.ladder`, swimming within walk's reach of its foot):
    sailing's "Climb aboard" verb and `crew.board` are gone; `sailing.ladder`
    stays, as what makes it her ladder (her stations' list, the bin).
  - *The mast is the object the rig hangs under with no station trait of
    its own*. (Undone by the step 5 fixes: the rig carries the sail's stand
    spot and the mast is traitless again, the rule as it was.)
  - *What is the viewer doing* is read, never kept: crew.js `viewerOf`
    over the top body, walk's `avatar` here and the station body's own
    station. The presence rate stays play.js's (20 Hz while playing).
- **Step 5 fixes (N10)** (each decided unattended (2026-11-17, lane/n10),
  for the lead):
  - *The station's eye is walk's.* Taking a station asks walk's `stand(id)`
    contribution to stand its walker at the station's stand spot (P1 of
    it: on the deck under it); the station body looks from that walker's
    eye as walk draws it each frame, and leaving, walk resumes from that
    eye. Sailing keeps no copy of walk's eye height or of its stand-spot
    placement; the round trip is walk's alone and tested there (walk
    body.test, stand spot × deck pose, to 1e-9). On a hull whose deck isn't
    where a stock offset puts the spot, the eye is still over her deck.
  - *One claim says who stands at a station*: the one its verb holds (the
    helm's, the mainsheet's and each winch's `"station"`, the sail's
    `"halyard"` at the mast), which its `walk.stand` names. The station body
    holds none of its own (a refused claim already stops the verb).
  - *The rig carries the sail's stand spot*: its doc placement never swings
    (only its drawn pose does), so no search up the tree for a spot and the
    mast's rule is "no traits" again.
  - *The wheel is her spawn* (`walk.spawn` on an object with a stand spot is
    at that spot: walk Decision 41): no object of its own, and a hull
    fitted from the bin is come aboard at the helm too.
  - *Taking a station while walking in another stage* (a harbour's ground)
    comes aboard her first: the station goes over her own walk, never
    another stage's.
  - *The HUD's walking hint is the top body's declared keys* (hud.js
    `keysHint`), so it is walk's own list, never a copy.

- **Step 6 (N10): the walking text is walk's** (decided unattended
  (2026-11-17, lane/n10), for the lead): what held for any deck (the mesh,
  B1–B7, the move, the unit and enumerated cases, C1–C7 and C9) moved to
  walk's DESIGN, "Foundations", renamed; what is the stock sloop's (the
  cockpit's STEP, her mesh, C8, the bow, the mainsheet's two rows, her
  fittings) stays here. The rows `sloop-navmesh.test.js` held for her
  alone, dropped with it in step 5, are back (step 6's fixes, after
  review): those that need a bake as her export's `claims`, which walk's
  `deck-12m.test.js` checks without naming her parts; those that don't
  in `stand-spots.test.js`, over her drawing. Only the winch stands'
  facing is gone (a stand spot has none). And in Cadboro Bay and
  Ucluelet, whose ground walk's column cap refuses, Come aboard waited
  forever (walk waited for every support's mesh); walk's Decision 43 now
  walks her deck there, the ground absent until walk bakes in tiles. No back-compat: her parts' traits
  changed shape, so every example with her in it is republished and its
  link swapped in the examples folder (the integrator's).
