# sailing: a ship you crew together

A scene becomes a sea when it carries the `sailing.sea` trait, and an object
becomes a ship when it carries `sailing.ship`. Everything else is objects
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

## Modules (sailing/src)

| Module | Pure? | What it is |
|---|---|---|
| `ocean.js` | yes | The sea: a wind-driven directional wave spectrum sampled into Gerstner components, and the queries `heightAt(x, z, t)`, `normalAt`, `velocityAt` (the water's orbital velocity) that physics and walking use. The same component list feeds the shader, so what floats is what you see |
| `ocean-material.js` | no (takes `THREE`) | The surface: a camera-following grid and a `ShaderMaterial` running the same Gerstner sum in the vertex shader, with finer normal-only detail, Fresnel sky reflection, subsurface tint, crest foam, sun glint, scene fog |
| `wind.js` | yes | The true wind at (x, z, t): a base speed and direction from the doc, with gusts and veers from smooth deterministic noise |
| `physics.js` | yes | The ship as a rigid body: buoyancy sampled over the hull against the ocean, keel and rudder as hydrofoils, the sail's lift and drag from the apparent wind (the boom swinging toward where the wind and sheet put it, no faster than 200°/s), hull resistance rising toward hull speed (and much more going astern), an anchor whose pull is bounded by what it holds. `step(state, controls, env, dt)` |
| `glb.js`, `ship.js` | yes | A procedural sloop as GLB bytes: hull, deck, mast, boom and sail, wheel, capstan, ladder, companionway and its hatch; the hull's connectors (`STAND`), the sail's size (`extras.sail`) |
| `parts.js` | yes but for files | The parts bin's parts (scene:part): the sloop whole, mast and sail, wheel, windlass and anchor, ladder, mainsheet, jib winches, companionway, buoys, islet; squared to the ship they're put on (`placement`), one GLB doc per kind per scene (`ctx.file`) |
| `layout.js`, `template.js` | no | The "Ship at sea" template: the sea trait, the Sloop part with her way on (`sailing.ship.motion`) on a beam reach, landmarks. "Ship at anchor" (`layOutShip(ctx, { anchored: true })`): head to wind, still, sail down and anchor down (`AT_ANCHOR`), off the islet (`ANCHORAGE`), in a moderate breeze (`ANCHORAGE_AIR`, 6.5 m/s). At anchor her jib is rolled away (`furl: 1`); B at the helm unrolls it backed to leave ("Leaving the anchor") |
| `rig-contract.js` | yes | The rig aid's contract (`extras.rig`, patchwork-rig v1) in her body frame: whether this ship takes it (`contractOn`: a contract naming the hull family it describes only on that family), its frame (`rigFrame`), the whole contract converted (`bodyRig`, with her drawn hull when it's the one the rig was designed on), the spec parts it fills (`rigSpecParts`), the hull it was designed on checked (`checkSource`) |
| `stock-rig.js`, `stock-rig-12m.js` | yes | The stock sloop's own contract (`stockContract(rigDrawing())`, on her `rig@3` GLB): the 12 m fixture's hull, foils, resistance, sail model and loading (`stock-rig-12m.js`, a runtime copy of those parts), with her rig computed from where ship.js draws it by the specification's rules (`stockMain`, `stockJib`, `leadAt`, `lumpedSailOf`, `rollUp`). See "Trim feedback" |
| `resistance.js` | yes | A rig contract's resistance table (§6.5) unpacked for the 120 Hz loop: the canoe body's R(V, φ) with its planing blend, the planing weight, and the induced drag's effective draft (`contractResistance`) |
| `body.js` | yes | A ship's body frame: where it sits in her hull's (`frameOf`), her pose through it and back (`toBody`, `toObject`), her body frame as drawn (`bodyOf`), and where a thing aboard sits in her (`placeIn`) |
| `traits.js` | yes | The doc's vocabulary: trait keys, claim kinds, station defaults, the wheel's and the boom's turn on top of how they were put (`wheelTransform`, `rigTransform`), the quarter view, and walking the tree as the stage resolves it (`parentOf` from `scene().parents`, `shipOf`, `partsOf`). Every part reads the doc through this |
| `frames.js` | yes | Matrices (`apply`, `invert`, `multiply`, `matrixOf`, `rotateM`, `unrotateM`, `headingOf`, `onHeading`) and quaternions (`rotateQ`, `mulQ`, `quatFromEuler`, `eulerFromQuat`, `poseOfMatrix`) |
| `play.js` | no | The sailing extension in play: joins the parts below, runs them in one loop in the order a frame needs, and sets the presence rate |
| `sea-view.js` | stage side thin | ctx.sea: the shared sea clock (pure: `seaTime`, `slew`, `follow`), the ocean and sky drawn (`drawSea`, which edit.js shares, with `seaClock`) only while the scene has a sea |
| `sim.js` | stage side thin | ctx.sim: the "sim" claim and handoff, physics per ship, the holds, the stations' values, saving (pure helpers exported and tested) |
| `looks.js` | stage side thin | What each view dresses for itself: floats bobbing (pure `floatPose`); on a rig with `extras.sail.cloth`, the sails' cloth, battens, bunt and roll, the mainsheet and jib sheets, the telltales, the masthead vane and the burgee, all from trim.js and cloth.js, written into buffers made once; a rig without cloth lowered, bellied to leeward and flat while it luffs (pure `fullness`) |
| `cloth.js` | yes | A sail's cloth grid as a function of its look (`clothVertices`: belly, flog, σ, reef, furl, flat, flutter), its normals, battens and outline; ship.js draws the GLB's `Sail` and `Jib` with it at `NEUTRAL` |
| `navmesh.js` | yes | The bake: a ship's triangles (her body frame) to a navmesh of 5 cm cells, every cell side one record (STEP, WALL, OPEN), her D_r and where a swimmer is put out of it, and links (spawn, stand spots, the ladder). See "Walking" |
| `walker.js` | yes | The walker: a state machine over the navmesh (walking, airborne, vaulting, at a station, on the ladder, swimming), invariant I (`checkWalker`), projection (P1), the seeds a bake starts from |
| `navcheck.js` | yes | Checking a bake: the oracle on the raw triangles, the bake properties B1–B7, the static checks C1–C9 |
| `walk.js` | yes | Walking's pure helpers (`wishVelocity`, `look`, `lookDir`) and the body's numbers (`BODY`, `DECK`, `SWIM`) |
| `crew.js` | stage side thin | ctx.crew: the bake's input adapter (her triangles from `api.content`, the bake key) and her mesh rebaked as her parts change; the walker stepped each frame and the camera at its eye; coming aboard, stations, the ladder, tabletop's `firstPerson`; everyone else's avatars |
| `stations.js` | mostly | The verbs for the use prompt: the helm (with the sheet led aft to it), the sail and sheet (at the rig or the mast), the windlass, the ladder (pure held-verb sessions) |
| `hud.js` | model pure | Crosshair, the sailing panel (speed over the ground, heading, a dial with the apparent and true wind, a row per sail on a contract ship (`sailRow`, from trim.js) or one Sail row, anchor), the hint line, and what to do head to wind before she's in irons (`luffing`) and once she is (`inIrons`) (`hudModel`) |
| `trim.js` | yes | Each sail's trim from the physics' read (`trimOf`): α_sheet, flog, σ, belly, and its state (down, wing, backed, luffing, stalled, drawing), on its family's thresholds (`trimModelOf`); the sheets' slack (`mainsheetSlack`, `jibSheets`, `sheetSlack`) and their curve (`sheetCurve`), the flutter, the telltales, the vane and the burgee |
| `edit.js` | no | The sea while editing, at the sailors' clock when someone is sailing her meanwhile |

`probes/sailing-run.mjs` plays all of it in a browser: two views of one
doc, crewing her together (see its header). Its page seeds `Math.random`
(`--seed N`, default 1), so the template's sea and wind repeat; real time
and frame rates still don't, so a pass count is reported per seed, over
more than one. `probes/camber-run.mjs` takes a
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
// ocean.js
const sea = createOcean({ wind: { speed, from }, seed, scale })  // scale: wave height multiplier, default 1
sea.components  // [{ dir: [dx, dz], k, omega, amp, steep, phase }], ≤ 32, for the shader
sea.heightAt(x, z, t) → y          // surface height above sea level at world (x, z)
sea.normalAt(x, z, t) → [nx, ny, nz]
sea.velocityAt(x, y, z, t) → [vx, vy, vz]  // orbital velocity, decaying with depth

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

const surface = createOceanSurface(api.THREE, sea, opts?)   // ocean-material.js
surface.object                                       // add to an api.world() group; never picked
surface.update(t, cameraPosition, atmosphere.sun, atmosphere.sky)   // every frame
surface.setSea(sea); surface.dispose()

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
`stock-rig.test.js` pins the plain spec key for key for both.

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
  its lumped sail (§6.8: what places the mast's windage and the wind she
  reads; her sails are flown separately, below), her keel and rudder the contract's areas at their
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
    mast or the stay), and its CE with it. That is a moment §6.6 doesn't
    have: eased right out, the main's drive acts to leeward of the
    centreplane and turns her to windward (on the Laser's dead run, 0.9 m
    out, a yaw residual of 1.08 tolerances at 16 kn; on her reaches and runs
    at 20 kn, up to 1.6).
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
  and out they hold her there. The 12 m sloop and the Catalina 30 pass at
  every point, and they and the J/24 settle within every tolerance. The
  Laser settles 2.1° short of her heel and cuvature 16.4% slow (3.24 m/s
  against 3.88), both by windage: cuvature's is 395 N, a quarter of her
  drive at 12 kn 45°, and without it she settles 0.8% slow. What still
  fails is listed in `KNOWN_GAPS`
  point by point with its measured values, each held to them, so the list
  moves when the physics does: windage, which §6.1 leaves out and sailing
  doesn't (all of the Laser's surge, sway and roll failures; less windage,
  every fixture's surge residual is within 0.07 of its tolerance),
  cuvature's stand-in hull's righting moment, one J/24 point where her
  righting curve is near flat (14 kn 52°, 2.2° less heel), and the Laser's
  main's CE swung out on reaches and runs (weather helm 1.5–2.2° more than
  predicted running, yaw past tolerance from 90° at 16 kn and up, planing
  points included). The report beside it gives each fixture's residual at
  the reference point and how much of it is windage. Each
  mechanism also has its own finite cases: `foils-mass-crew.test.js` (item
  9), `hull-resistance.test.js` (her hull, resistance, planing, side force
  and induced drag, and one seeded sea run as a guard), `sails-jib.test.js`
  (item 11: the coefficients, the sets' trimmed tables through the wrench,
  each sail at its own CE and in its own air, the jib's swing, sheet and
  lead, backing and goose-winging, furling, reefing's CE, and irons).

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
input is the sea clock, which every view shares (`ctx.sea.clock()`). It
only sets the phase of a flutter whose amplitude the physics gives.

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
    reach (`sloop-navmesh.test.js`). The old spot, 0.22 m out on its own
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
| **Cloth** (main and jib) | `angle`, belly, flog, σ, `area` (reef or furl), `controls.flat`, the sea clock t, `q` | `clothVertices(out, sail, cloth, trim, t)`. Rows run parallel to the foot from the luff to the leech (the stock main's rows already are: `lerp(clew, head, h) + roach`, `lerp(tack, head, h)`). The camber depth is cloth.depth·chord·flat·belly·max(FLAT, 1 − flog), deepest at cloth.draft. The twist is cloth.twist·(1 − ½σ): a stalled sail's leech closes. The luff's bubble pushes the front BUBBLE.width (0.3) of each row back to windward by 0.8·luff of the camber, breathing ±25%. A flutter is added (cosmetic constants below) |
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
filed under `sailing/rig@2` then (`rig@3` today: parts.js `VERSIONS`). Where the build differs
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
`cdp.mjs`, `ocean-cdp.mjs` and `ship-shots.mjs`, scene's `cdp.mjs`,
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
(`aboard.slow.test.js`) and the walker's random property test
(`walker.property.slow.test.js`): 38 cases in about 5 s. Their shared
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

**Walking.** Each winch seeds a stand spot from its trait (`walker.facing`:
at `stand`, facing the winch; crew.js `navInput`); the jib is moving, so
not baked (`bakedObjects`). On her static bake (`sloop-navmesh.test.js`,
`test/sloop.js` gains the winches): C1–C9 hold with them; each stand lands
on the side deck across the well from its winch, at (∓1.30, 1.22, 2.25)
for the winch at (±0.95, 1.23, 2.25), facing it across the well (yaw
±π/2), its drum's top within 3 m of the eye; the "plain deck within 2 cm"
case skips the winches' bases.

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
they are `rig@3` and `jib@2` since, their cloth taking no shadows.

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

At anchor she lies head to wind; that's what an anchor is for. The moment
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
| jib backed (wheel to port) | 7.20 / 7.03 / 6.87 / 6.60 s to 45° (±0.05 s) | under 10 s |
| jib backed, 6 kn | – / 14.73 / 14.50 / 14.03 s | under 18 s |
| B at the helm: 0–10° off either bow, the wheel to port, amidships or to starboard, the jib's sheet 0, ½ and 1 (99 cases) | the side B holds it on is backed from the first read; past 45° the way the hint names in 6.1–10.1 s | within 11 s, the hint's way |
| jib luffing, wheel reversed in sternway | – / 48.40 / 45.77 / 38.50 s (±5%) | under a minute, slower than backing the jib and sooner than left alone |
| left alone | 70.80 s from 2° (±5%) | none sourced: falls off by herself, slower than the rudder |

Without the jib she starts on an unstable equilibrium and creeps off it,
so those times move with the smallest change in where she starts: they're
pinned to a band, not to 0.05 s.

The reversed rudder's time is what her sternway allows, and the diagnosis'
first estimate for it (15–30 s, unsourced) was wrong for this breeze. In
12 kn, luffing, about 150 N of windage pushes 8 t astern: she makes
0.07 m/s after 5 s, 0.26 m/s after 30 s and 0.37 m/s after 45 s (from 2°
off). A rudder of 0.6 m² at 0.26 m/s has 35 Pa to work with, so nothing
turns her until she has that sternway: from 2° off she passes 5° at 20 s,
10° at 30 s, 20° at 38 s and 45° at 45.8 s, having drifted back less than
her own length. The time goes with the wind: in 20 kn the same move takes
20.0–24.0 s (5°–1° off). So the target is the ordering and a bound, both
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
head to wind when it starts, in the HUD's own sense (the apparent wind
within 40°, under 0.5 m/s: no sail drives her; else the step fails, not
exercised; measured 14° and 23° off after weighing in waves), and her heading must swing past 45° the way the hint names
within 15 s of sea time, with the jib unrolled, recorded either way, never
retried. The station's verbs (the wheel, sheets, furler, halyard,
windlass) run in sea time, as far as the ships step a frame (0.25 s), so
at a few frames a second the jib still unrolls in its 4 s.

## Parts

`parts.js` gives the parts bin (STAGE.md, "Parts") sailing's parts, each
a scene:part in index.js under "Sailing":

| Part | Pieces (the first is selected) | Tags | Traits |
|---|---|---|---|
| Sloop | the hull, and every part below at her stands | | `sailing.ship`, and a `sailing.sea` if the scene has none |
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
  and her anchor up. A ship brings her sea.
- **Files:** each kind is the scene's one GLB doc under
  `doc.assets["sailing/<kind>@<n>"]` (`ctx.file`), so ten buoys share one;
  bump `<n>` (`fileKey`) when a kind's drawing changes (`VERSIONS`: the
  hull's is 5 (its companionway became a part), the rig's and the mast's 3,
  the jib's, winch's, windlass's, mainsheet's, wheel's, anchor's and islet's
  2, the rest 1). `ctx.file` is
  required: there is no other way a part makes its files.
- The template is the Sloop part's objects with her way on, the landmarks
  (the buoy and islet parts, locked, in a group), the home view and "play".
  At anchor, her stations' settings are set over the parts' own
  (`sloopObjects(..., { settings })`): the sail lowered, the anchor down.

## Traits (in the doc)

| Trait | On | Fields |
|---|---|---|
| `sailing.sea` | scene | `{ wind: { speed, from }, seed, scale }` — speed m/s, from degrees |
| `sailing.ship` | the hull object | `{ frame?, spec?, motion? }`: `frame: { position?, rotation? }`, where her body frame sits in her hull's, each part over what her GLB says ("The ship's frame"); spec overrides; `motion: { velocity, spin }` (world, her body's) as last saved, beside its object's `transform`, where it last rested or was saved. Only a ship at the scene's root sails |
| `sailing.helm` | a station under the ship | `{ angle }` -1..1, where the wheel was left |
| `sailing.sail` | a station under the ship | `{ raised, sheet }` 0..1 |
| `sailing.jib` | a station under the ship (the jib, on the mast) | `{ sheet, held, furl }`: `sheet` 0 hard in .. 1 eased; `held` null (it tends itself) or the side its clew is made fast on, `"port"` \| `"starboard"`; `furl` 0..1 of it rolled away. Worked from its winches or the helm |
| `sailing.winch` | a winch under the ship, one each side | `{ sail: "jib", side: "port" \| "starboard", stand: [x, y, z] }`: the sheet led to it, and where you stand to work it, in the winch's own frame; who stands at it is its `"station"` claim |
| `sailing.anchor` | a station under the ship (the windlass) | `{ down, rode, at? }` (`rode`: metres of chain out; `at`: where the anchor lies, world, while it's down). The windlass writes `down` and `rode`; only the simulator writes `at`: it drops the anchor on the bottom under the bow, clears `at` when it's up, and drops it again where she is when `at` is further from her bow than her rode allows (she was moved, or copied, while nobody sailed) |
| `sailing.mainsheet` | a station under the ship (the cockpit's traveller) | `{}`: where the ship's sail is trimmed and hoisted from (its values are the sail station's); who stands at it is its `"station"` claim |
| `sailing.hook` | the anchor itself, under the ship | `{}`: drawn lying on the bottom at `at` while its windlass has it down, at the bow (its doc place) when it's up |
| `sailing.ladder` | the ladder under the ship | `{}`: the way aboard from the water |
| `sailing.float` | any object | `{}`: bobs and tilts with the waves where it's moored (each view, from the shared clock; no hold) |

Two other packages' traits ride on her companionway, written in the shapes
those packages document (traits.js `SLIDE`, `EXIT`); sailing reads neither
and imports neither. Its hatch's `joints.slide` opens it (joints moves it,
in her hull's frame as she heels, and writes where it comes to rest); the
companionway's `traversal.exit` leads nowhere until a scene gives it a `to`.
Both pieces carry a sailing tag, so they are hers: the hand never carries
them in play, a click on them comes aboard, and her navmesh bakes them (the
hatch where it rests: a hatch that comes to rest open changes her bake key,
and she is baked again off the frame loop, as for any part moved).

Who is at a station, and who simulates the sea, are **claims** in the doc
(`claims: { station | halyard | sim: { viewer, session } }` on the object),
lapsing when the holder's session leaves presence. `halyard`, on the sail
station, is who stands at the mast; the sail's own `station` claim is held
only while a key works it, from wherever, so someone at the mast doesn't
stop the helmsman trimming. The ship's motion is a
**continuous pose hold** by the simulating peer, which every other peer
shows interpolated; it is written to the doc only now and then and when the
sim stops.

The stage's names: `api.claim(id, kind, { onLost })` → release | null,
`api.claimedBy(id, kind)` → `{ viewer, session, mine } | null` (STAGE.md,
"Claims"). A lapse is a presence change, not a doc change, so whoever waits
to take over checks `claimedBy` in its loop. There is no `continuous` flag:
every peer's hold is played back interpolated (about 1.5 send intervals
behind), and `api.presence.rate(hz)` raises the pose rate too.

Presence keys under "sailing": `clock: { t, at }` from the simulator (the
sea's time at its `Date.now`), `ships: { [id]: published diagnostics +
{ velocity, spin } }` from the simulator at 5 Hz, `input: { [stationId]:
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
ticks them in the order a frame needs, and no part imports another, but
for hud.js taking crew.js's `seatedView` (what they share of the doc is
traits.js, of the maths frames.js). play.js also
answers the hand's `carryable` (traits.js `carryableAboard`): never the ship
or anything with a sailing trait or tag, so a game played aboard can't carry
off her mast; anything else aboard is the game's business. And the sail's
verbs on the use prompt come from the sail station or its mast (what it
hangs from, or what carries the mast's tag), never from
another traitless thing aboard (a card table): stations.js `sailOf`.

```js
api.loop((dt, now) => {
  ctx.sea.tick(dt, now, ctx.sim.simulating(), ctx.sim.simulator()); // the clock first: what the ships step to
  ctx.sim.tick(dt);   // take over, follow, or step and hold the ships
  ctx.crew.tick(dt);  // walk on the deck as it now is; draw everyone else; not aboard, follow: the orbit rides
                      //   the first ship sideways (api.camera.ride, a fallback ride, so a seat at a table
                      //   aboard, riding her too, wins), or is moved each frame on a stage without rides
  looks.tick(dt);     // floats and sails, dressed
  hud.tick(dt);
  // and the presence rate, when it changes: 30 simulating, 20 aboard, else 0
});
```

```js
// sea-view.js — createSeaView(api) → ctx.sea
ctx.sea.ocean            // the current createOcean(...) (rebuilt when sailing.sea changes), null with no sea trait
ctx.sea.wind             // the current createWind(...), or null
ctx.sea.clock()          // the sea's time t (s), the same on every peer (the simulating peer's clock)
ctx.sea.atmosphere()     // { sky, fog, sun, exposure } for the stage, or null with no sea
ctx.sea.tick(dt, now, own, simulator)   // the clock on (its own, or following `simulator`'s), published if own, the surface drawn

// sim.js — createSim(api, ctx) → ctx.sim
ctx.sim.ships()          // ids of the ships that sail (sailing.ship, at the scene's root)
ctx.sim.read(shipId)     // what a sailor reads off her (published(): diagnostics, velocity, spin), as simulated or streamed, or null
ctx.sim.stationsOf(shipId) → { helm, sail, anchor, mainsheet, jib, ladder, winches }   // object ids anywhere under her (a rig on a mast on the hull), null if missing; winches a list
ctx.sim.value(stationId) // the station's live value: its trait fields, with its holder's input over them
ctx.sim.input(stationId, partial)   // this view's live input at a station it holds (presence), e.g. { angle }
ctx.sim.commit(stationId, fields)   // a lasting change to a station's trait (doc), e.g. { raised: 0 }
ctx.sim.simulating()     // is this view the one simulating (holds the scene's "sim" claim)?
ctx.sim.simulator()      // the simulating session, when it's someone else, else null
ctx.sim.tick()

// crew.js — createCrew(api, ctx) → ctx.crew
ctx.crew.input           // the extension's input handlers (click to come aboard: an arm with pointer lock). Only a click on
                         //   the sea, the sky, a ship, a fitting of hers or anything not aboard a ship (the islet) (boardsOn): one on
                         //   anything else aboard (a card) goes on. Seated (seatedView: the camera riding something, not her own
                         //   fallback follow), only the sea or sky; the HUD (hudModel's `seated`) then offers Enter, no walking keys
ctx.crew.start(), .stop() // come aboard (Enter: stations.js's "aboard"), and Esc back to the orbit off the quarter
ctx.crew.me()            // { on: shipId | null, position (local to on, else world), yaw, pitch, eye: world [x,y,z], station: id | null, swimming,
                         //   playing, paused (the lock lost), free (the lock refused: drag to look), hint (the station's line) }
ctx.crew.take(stationId, handlers) → leave   // stand at a station (its stand spot: her mesh's link for it; the sail's for the mast):
                         //   pushes an arm over walking; handlers: { key, keyup, tick(dt), left(), hint?() }
ctx.crew.firstPerson     // { enter({ seat, eye, target, frame }) → boolean, leave() }: tabletop's seats (tabletop/README.md); enter
                         //   stands you at the projection (P1) of the seat's eye onto her mesh, a seated eye's height down
ctx.crew.leave()         // step away from the station you're at
ctx.crew.board(shipId)   // climb aboard (from the water, by the ladder)
ctx.crew.place(on, position, yaw?, pitch?)   // put the body somewhere (local to ship `on`, else in the water): a respawn
ctx.crew.tick(dt)

// looks.js — createLooks(api, ctx) → { tick, update, dispose }: floats bobbed, sails dressed, each view for itself
// stations.js — stationCommands(api, ctx) → commands for the use prompt (and keys)
// hud.js — createHud(api, ctx) → crosshair, wind, speed, heading, what the keys do here; tick(dt)
```

The play instance also carries `debug: ctx`, which nothing in the stage
reads: the browser probe (`probes/sailing-run.mjs`) reads and nudges the
parts through it.

**The sea's clock is the wall's.** The simulator's sea time runs at the
frame clock's real rate (the loop's `now`), not the stage's `dt`, which is
clamped to 0.1 s: followers run its clock on at wall rate between samples,
and the stage plays the hull back by the wall too, so at a slow frame rate
the three would drift apart. Only a stall longer than a second (a hidden
tab) is skipped; the physics skips with it (`catchUp`: what one step of 30
substeps can't make up is dropped, so she stays on the waves drawn).

**A follower's sea is shown when its hull is.** The simulator publishes
`{ t, at }`; a follower shows `t + (shownAt − at)`, where `shownAt` is the
stage's `api.presence.shownAt(simulator)`: the moment on the simulator's
clock whose held poses this view is drawing now. So the hull sits on the
waves drawn under it whatever rate either peer streams at, and nothing here
copies the stage's playout delay. The clock slews toward that (never
backwards, never more than twice as fast) and jumps when it's more than
half a second off: back from a hidden tab, or after the simulator stalled.
edit.js keeps the same clock, so an editor watching someone sail sees the
hull on the right waves.


**Who simulates.** One peer holds the scene-wide claim `"sim"`
(`api.claim(null, "sim")`): it steps every ship's physics in `api.loop`,
holds each hull's pose and its moving parts' poses (rig, wheel, anchor) for
everyone, raises the presence rate, and publishes the sea clock in presence.
Everyone else follows: poses come played back by the stage, the clock from
the simulator's presence. A follower keeps each hull's matrix as it last
saw the simulator hold it. When the claim lapses (a bye, a crash), any peer
still here claims, Automerge settles who won, and the winner carries on from
that pose and the last motion streamed, never from the doc's older save.
The simulator writes each hull's transform (and its motion, in
`sailing.ship.motion`) to the doc now and then, and when it stops or its
tab is hidden or closing; then it lets the holds go as *landed* (peers keep
showing her there until their doc agrees) and lets go of the claim, so a
visible peer carries on (a hidden tab gets no frames). Back, it follows.
A transform that changes in the doc without her motion changing with it is
an editor's move: she starts again from there, at rest, and her anchor is
dropped again. One written with her motion is a simulator's save (perhaps
a late one, landing after a handoff) and changes nothing. A state that goes
to NaN is never shown, published or saved: she's put back at her last good
pose, still. Physics runs at the object's scale.

**Controls.** A station's lasting setting is its trait (the sail raised,
where the wheel was left, the anchor down). While someone works a station,
their live input goes in presence (the wheel turning) and the simulator reads
it from whoever holds that station's `"station"` claim; letting go commits the
final value to the doc. The helm commits each time a steering key comes up
too, and a tab that's hidden or closing steps away from its station (which
commits), so the wheel stays where it was left. The helmsman holds the
wheel's pose themselves, so it turns as their key does; the simulator holds
it only while nobody's at the helm.

**Stations** (stations.js). Reach is to the point looked at (the prompt's
`hit`, on the target or anything under it), else the target's origin, within
`REACH` 2.5 m: the boom over the cockpit is in reach however far its
gooseneck is. Where you lock in (crew.take: at the station's stand spot, a
link of her navmesh; F leaves):

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

**People.** A person is presence: `{ on, position, yaw, pitch, station }`,
with position local to the ship they stand on (her body frame), or world when in the water,
so a peer whose view of the hull lags still sees them on the deck. Walking
is over her navmesh, in her frame ("Walking", below): the walker's state is
a cell and a place in it, and the world pose is derived from her drawn
matrix each frame and never fed back, so her motion can't move anyone
through her. Over the side (a jump over the rail, or awash) you swim at the
ocean's height and can climb the ladder. Each view draws everyone else as a
simple figure in their frame.

## Walking: a navmesh in the ship's frame

*Built: `navmesh.js` (the bake), `walker.js` (the walker), `navcheck.js`
(the checks), crew.js's input adapter. It replaced the ray walker
(`walk.js` `step` and `swim`, the ledge, the knee and brow rays, `crew.js`
`deckStep`, `overboard`, `groundAt`, `stepAcross`'s ray and swimming's hull
ray). Where the build refined the spec, "As built" at the end says so.*

The ray walker asked the scene, each frame and in the world, where the floor
and the walls are, and it could be wrong in any frame where a ray missed:
- the band between the step height and the lowest wall ray;
- a single centre ray across a heeled well wall;
- a lifeline taken for a floor.

Checking it took hundreds of walked routes. This design moves the
geometry questions to a **bake**, done once per hull in her body frame and
checked statically. **Motion** is a small state machine over the baked
mesh, and its state cannot name a place off the mesh. Correctness rests on
three things, each finite:
- the bake's properties (B1–B7 below), checked on every baked hull;
- the transitions, each shown to preserve the invariant;
- a list of unit cases, one per kind of situation.

### Words

- **Column**: a `c × c` square of her body frame's plan (x, z), indexed
  `(i, k)` from the grid's origin. Rasterising triangles into a column gives
  its **intervals**: the closed y-ranges where any triangle's part inside the
  square lies, merged where they overlap.
- **Cell**: a floor in a column (the top of one interval) that passes the
  bake. It is the navmesh's face. A position on it is `(cell, u, v)` with
  `u, v ∈ [0, 1]`, so the plan point is `origin + ((i + u)c, (k + v)c)` and
  the surface height is the cell's plane there.
- **Side**: one of a cell's four edges, directed out of it (−X, +X, −Z, +Z).
  Every side of every cell carries exactly one record: STEP, WALL or OPEN.
  Two cells that share an edge each see it as their own STEP side.
- **Rise**: how far above this cell's surface the body's feet must be to go
  across a side. It is signed for a STEP (negative is a step down).
- **Silhouette**: the columns holding any of her baked geometry. `D_r` is the
  silhouette dilated by the radius. A point outside `D_r` is in the water,
  clear of her.

### Parameters (the sloop's: `DECK`)

| Name | Value | Why |
|---|---|---|
| `cell` c | 0.05 m | Fine enough for the 0.04 m coaming top and a 6 mm lifeline (rasterising is conservative: any overlap counts). 12 × 3.8 m is about 18k columns |
| `slope` | 35° | Her deck slopes at most about 10° (forward sheer, crown); hull sides, well walls and cabin sides are 80–90° |
| `step` | **0.58 m** | Walkable up *and* down without jumping (symmetric). See the cockpit decision below |
| `height` H | 1.75 m | Headroom a cell needs, and the body's top. The eye is 1.6 |
| `radius` r | **0.25 m** | Was 0.35, which closes the side deck at the aft lower shroud (1.33 m out at head height, cabin side at 0.675: free 1.025…0.98, i.e. nothing). At 0.25 the walkway there is 1.06 m inboard of the shroud's foot, and you can still pass beside the wheel |
| `jump` | 4.6 m/s at gravity 16 | Apex 0.661 m: over the lifelines (0.61–0.625 above the deck beside them), never onto the windlass (0.68) |
| `walk`, `run` | 3.2, 5.5 m/s | As now |
| `march` | 1.5 m | The furthest a vault looks across a WALL side for somewhere to come down |
| `SUNK` | 1.5 m | Feet this far under the sea surface: awash, so you swim |

**The cockpit is a STEP.** These are the rises measured from `ship.js`'s
own surfaces (`deckAt`, the sole at 0.72, the benches at 1.08, the cabin top
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
   3.4 cm and 3 cm of margin, and static check C7 rebakes at 0.56 and 0.60
   to prove nothing hinges on it.

The old `DECK.step` of 0.5 sat 1.6–4.6 cm *below* the well's rise. That
was the blind band's own number.

### The bake

`bake(input, params) → NavMesh`. It is pure, deterministic and
independent of triangle order.

**Input**: triangles in her body frame, and the seeds (spawn, the stations'
stand spots, the ladder top). The input adapter (stage side) gathers
triangles from:
- her hull's GLB through her frame (`frameOf`);
- every object under her except:
  - the moving parts: the sail station's subtree (boom and sail), and the
    anchor (`sailing.hook`);
  - unlocked loose pieces (cards, dice).

  Locked furniture aboard (a card table) is baked.
- Geometry comes from `api.content(id).root`'s meshes at the GLB's rest
  pose, placed by the objects' doc transforms down the tree. Neither the
  drawn pose nor any dressing is used.
- A part that turns about an axle in play (the wheel) is baked as the solid
  swept by the turn: the cylinder about the axle that bounds it.
- For the stock sloop, the tests take the same triangles straight from
  `ship.js` (`partMeshes` + `FIT`), with no stage. A camber hull's
  come from its GLB, exactly the same way. Nothing reads `deckAt` at
  runtime: what you walk on is what is drawn.

**Steps**:
1. **Rasterise.** For each triangle and each column its plan bounds touch:
   - clip the triangle to the column's closed square (Sutherland–Hodgman);
   - record the clipped polygon's `[ymin, ymax]`, and whether the triangle
     is walkable (`|n_y| ≥ cos slope`, either winding).

   Then merge overlapping intervals per column. A vertical wall on a
   column boundary lands in both columns, conservatively.
2. **Floors.** An interval's top is a floor if either:
   - (a) the triangle that reaches the top is walkable; the floor's plane is
     that triangle's;
   - (b) the interval also holds a walkable triangle's top within `step`
     below its top: steep stuff standing on a floor (a curb, a toe rail, a
     leaning cabin side straddling a column). The floor is flat at the
     interval's top.

   Rule (b) is Recast's merge rule. It is what joins the side deck to the
   cabin top across her 4.7 cm of leaning wall. A stanchion (0.62 tall) or
   the windlass (0.68) is above `step`, so neither becomes a floor.
3. **Headroom.** A floor's `ceil` is the bottom of the next interval up
   (+∞ if none). A floor with `ceil − s < H` is dropped. This removes the
   deck under the lifelines, the sole under the wheel's rim, the deck under
   a leaning shroud, the bilge under the sole and the interior under the
   cabin top. Obstacles need no separate footprints: anything solid within H
   of a floor removes it.
4. **Connect.** Floor `f` and the floor `g` in the next column are
   connected if both hold:
   - `|s_g − s_f| ≤ step`;
   - `max(s_f, s_g) + H ≤ min(ceil_f, ceil_g)`.

   At most one `g` qualifies, because two floors in one column are at least
   H apart and H > 2·step. So connection is symmetric and unique.
5. **Erode.** Keep floor `f` only if every column whose square meets the
   disc of radius `r + c/√2` about f's centre has a floor `g` such that:
   - g is connected to f through columns in that disc;
   - `s_g ≤ s_f + step`;
   - `ceil_g ≥ s_f + H`.

   The `c/√2` covers every `(u, v)` in the cell. This one rule erodes from
   walls, wires, the mast, the wheel, ledges and unrailed edges alike. It
   doesn't erode at the steps themselves (the well's edge, a bench), so
   you walk right up to them and onto them.
6. **Prune.** Keep the connected components that hold a seed, and drop the
   rest. These are:
   - the bilge inside her (headroom there reaches 1.8 m);
   - wire tops, the wheel's rim;
   - a tiny curb top.

   They are reported, not silent (check C3).
7. **Classify every side of every kept cell, once:**
   - **STEP `to g`**: the next column holds a kept `g` connected to it.
     `rise = s_g − s_f` at the edge's midpoint.
   - Otherwise, **march** column by column along the side's axis, in the
     cell's row, up to `march`. For each marched column, `fit` is the
     lowest height above `s_f` at which the body (the disc of `r + c/√2`,
     from feet to `+H`) is clear of every interval there. `rise` is the
     running max of `fit`. The march stops at the first column that either:
     - holds a kept `g` with `s_g ≤ s_f + rise ≤ s_g + headroom(g)` (you
       can come down onto it, and the whole body fits there):
       **WALL `to g`**, `gap` = the distance to it;
     - lies outside `D_r` (the first column whose disc meets no silhouette
       column): **OPEN** if `rise ≤ step`, else **WALL `to OVERBOARD`**.
       `exit` = that column's centre at the cell's row: where you go into
       the water.
     - Hitting `march` or an unbounded `fit` gives **WALL `to NONE`**.

   So a WALL says three things: walking stops here; a jump at least `rise`
   high gets across (to `g` or into the sea); or nothing gets across.
   A ledge (a drop deeper than `step`, such as the cabin top's aft end over
   the companionway) is a WALL `to` the floor below, with a rise of about
   0, so it can be jumped off but not walked off.
8. **Silhouette and links.**
   - `D_r` as a bit per column, and for each `D_r` column its nearest column
     centre outside `D_r` (where a swimmer is put out).
   - **Links**, each `{ kind, id, at: (cell, u, v), yaw }` or a water
     point:
     - `spawn`;
     - one per station (helm, mainsheet, mast, windlass);
     - the ladder: a `top` cell and a `foot` water point outside `D_r`
       beside it;
     - seats come in at run time (below).

     A spot is placed by **projection**: the kept cell nearest in plan
     whose surface is within `step` of the spot's height.

**NavMesh** (typed arrays, one object per hull):

```js
{
  key,                          // the bake key: what it was baked from (below)
  params,                       // { cell, slope, step, height, radius, jump, march }
  origin: [x0, z0], nx, nz,     // the grid, body frame
  cells: { i, k, y, gx, gz, ceil, headroom, region },   // Int32/Float32Array, one entry per kept cell
                                //   y(u,v) = y + gx·(u−½)c + gz·(v−½)c; headroom = min over the erode disc of ceil − y − H
  column: Int32Array(nx·nz + 1),// cells by column (prefix offsets), for projection
  side: {                       // 4 per cell: −X, +X, −Z, +Z
    kind: Uint8Array,           //   STEP | WALL | OPEN
    to: Int32Array,             //   a cell, OVERBOARD (−1) or NONE (−2)
    rise: Float32Array, gap: Float32Array,
    exit: Float32Array,         //   [x, z] for OVERBOARD and OPEN
    normal: Float32Array,       //   [x, z], the source wall's plan normal: only for how a slide feels
  },
  outside: Uint8Array(nx·nz), putOut: Float32Array,  // D_r and where to put a swimmer
  links: [{ kind: "spawn" | "station" | "ladder", id, at: { cell, u, v }, yaw, foot? }],
  dropped: [{ region, area, centroid, why }],         // what step 6 pruned
}
```

**When to bake.** The key is a hash of her frame plus, for each baked
object: id, file key, transform relative to her, and whether it has
loaded.
- A doc change that changes the key (a part added, moved or removed, a
  model loaded) rebakes off the frame loop. Until the new mesh lands, the
  old mesh is used.
- Meshes are cached by key, so two identical sloops bake once.
- Budget: about 13.6k triangles for the sloop and her fittings, under
  50 ms (measured in a test, which fails at 500 ms).

### The walker: state and invariant

The walker is `walker.js`: pure, no THREE, no rays. Its state is one of:

| State | Fields |
|---|---|
| `boarding` | `ship`, `t` (how long it has waited), and where it was asked for: `at`, `offset`, `from` (a world point to swim at if she never comes). Her mesh isn't baked yet: no position |
| `walking` | `ship, cell, u, v, vel[2]` (plan, her frame) |
| `airborne` | `ship, cell, u, v, h, vy, vel[2]` (h: feet above the cell's surface, her up) |
| `vaulting` | `ship, cell, side, d, h, vy, vel[2]` (d: how far across the side's gap) |
| `station` | `ship, cell, u, v, station` |
| `ladder` | `ship, link, t` |
| `swimming` | `p[2]` (world x, z: at the surface), `vel[2]` |

Plus `yaw` (to her bow) and `pitch`, which belong to the person, not the
state. The **world pose is derived** each frame:
- feet = `M · local(state)`, where `M = bodyOf(api, ship)`;
- eye = `M · (local feet + [0, 1.6, 0])`, along *her* up, so the eye stays
  inside the cylinder the bake checked;
- the look direction stays level with the world's horizon, as now.

Her motion is never an input to the state. A wave, a heel or her speed
cannot move a walker through anything, because nothing that moves the
ship touches `(cell, u, v, h)`.

**Invariant I**, per state, for the mesh `N` of `ship`:
- `walking`, `station`: `cell ∈ N.cells`, `u, v ∈ [0, 1]`.
- `airborne`: the same, and `0 ≤ h ≤ headroom(cell)`.
- `vaulting`: `side(cell)` is a WALL with `to ≠ NONE`, `0 ≤ d ≤ gap`, and
  `h ≥ rise`.
- `ladder`: `link` is her ladder link, `t ∈ [0, 1]`.
- `swimming`: for every ship with a mesh, `p` in her frame lies outside her
  `D_r`: outside the *union* of all their `D_r`, ships rafted close
  together included.
- `boarding`: no position.

`assertWalker(state, meshes)` checks I after every step while
`walker.asserting()`: under vitest (`import.meta.env.DEV`), in every probe
page (sailing-, aboard- and camber-probe.html set
`globalThis.__SAILING_ASSERT__`), and in any page that sets the flag. A
breach then throws in the crew's tick. A production build (`DEV` compiled to
false) logs a failure, which the transitions below say can't happen, once and
resolves it by projection.

**What I buys**, given the bake properties B1–B7 (each a static check):
- **B1**: every cell is a floor with headroom ≥ H.
- **B2**: every column within `r + c/√2` of a cell has a floor connected to
  it no more than `step` above it, and headroom up to its `+H`.
- **B3**: a STEP's `to` is a kept cell; a WALL's `to` is a kept cell,
  OVERBOARD or NONE; an OPEN's `to` is OVERBOARD.
- **B4**: STEP is symmetric.
- **B5**: every `exit`, every `putOut` and the ladder's `foot` lie outside
  `D_r`.
- **B6**: no cell lies inside her closed hull.
- **B7**: every vault's marched band is clear of the body at `s_f + rise`.

Together they give the guarantee: in `walking`, `station` or `airborne`,
- the feet are on a floor;
- the body from `step` above the feet to its top (radius r) meets no baked
  surface;
- an airborne body's whole height is clear.

Below `step`, the legs are allowed to overlap what they step over: a curb,
the bench's edge.
- A vaulting body is clear by B7.
- A swimmer is clear of her plan outline.
- `M` is rigid and her geometry rides with her, so all of this holds in the
  world too.

Not covered:
- the boom and sail, which move and aren't baked (they only block: see
  "Dynamic blockers");
- other people;
- other ships, except a swimmer being put out of them.

### Motion: the transitions

**One move** (`walking`, `airborne`): the plan displacement this frame is
`(dx, dz) = vel · dt`. It is capped at 1 m, so any `dt` works. It is walked
side by side, as a DDA walks a grid. For each next crossing:
- **within the cell**: move; `u, v` stay in `[0, 1]` (clamped after the
  arithmetic, which only moves within the cell);
- **at a side**, by its record (below). STEP sets `u` or `v` to the
  opposite edge (0 ↔ 1) of `to`.
- **corner rule**: a crossing exactly through a corner takes X before Z.
  The diagonal cell is only ever reached through one of the two orthogonal
  neighbours, and only if that neighbour's side is crossable too. So two
  WALL sides meeting at a corner let nothing through it.

Each pass either ends the move, crosses one side (at most `|dx|/c + |dz|/c +
2` of these), or zeroes one axis (at most twice), so it terminates.

**Sliding.** A blocked axis has its remaining displacement and its velocity
along that axis set to 0, and the other axis carries on. That alone is a
correct slide along a wall, and a stop in a concave corner. For feel, the
velocity is first projected along the wall's smoothed `normal`, so a
45° wall doesn't stair-step. The projection changes only the velocity;
the side test still decides.

| # | From → to | When | Why I still holds |
|---|---|---|---|
| W1 | walking → walking | a move within a cell or across a STEP | `to ∈ cells` (B3); `u, v` set to an edge, in `[0, 1]` |
| W2 | walking → walking | a move into a WALL side | That axis is zeroed; you stay in the cell |
| W3 | walking → swimming | a move across an OPEN side (no rail; none on the sloop) | You swim at `M · exit`, outside `D_r` (B5). First, if another ship has a kept cell under that world point within `step` of your feet, you go to `walking` on her (stepping across, walker.js `intoWater`) |
| W4 | walking → airborne | jump | Same cell, `h = 0 ≤ headroom` (B1) |
| W5 | walking/airborne/station → swimming | awash: feet `SUNK` under the sea (she's going down) | You're put at `putOut` of the column you're in (B5) |
| A1 | airborne → airborne | `h += vy·dt` under gravity (her −Y), clamped to `[0, headroom]`; touching the top zeroes `vy` (a head bump) | Clamped into the invariant's range |
| A2 | airborne → walking | `h` reaches 0 | Same cell |
| A3 | airborne → airborne / walking | across a STEP: `h' = h − rise`. If `h' ≥ 0` and `h' ≤ headroom(to)`, airborne on `to`. If `h' < 0`, walking on `to` (a step up in the air). If `h' > headroom(to)`, blocked like W2 | `to ∈ cells`; `h'` checked against `to`'s range |
| A4 | airborne → vaulting | into a WALL with `h ≥ rise` and `to ≠ NONE`; otherwise blocked like W2 | `d = 0`; `h ≥ rise` |
| A5 | airborne → swimming | across an OPEN | As W3 |
| V1 | vaulting → vaulting | `d += |vel along the axis|·dt` (at least 1.5 m/s), `h` ballistic but at least `rise` | `d` capped at `gap`; the band is clear at `rise` (B7) |
| V2 | vaulting → airborne / walking / swimming | `d = gap`: onto `to` with `h = min(s_f + h − s_g, headroom(to))`. That is ≥ 0 because the march only stops where `s_g ≤ s_f + rise`; the march also checked that `s_f + rise − s_g ≤ headroom(to)`, so the min only trims a jump that is still rising. 0 means walking. For OVERBOARD: as W3 | `to ∈ cells` (B3) and `h ∈ [0, headroom]`, or outside `D_r` (B5) |
| S1 | walking/airborne → station | take a station: you go to its link's `at` | Links are projected onto kept cells (C1) |
| S2 | station → walking | leave | Same cell |
| L1 | swimming → ladder | F within reach of the ladder's `foot` | `t = 0` |
| L2 | ladder → walking | `t` reaches 1 (for now `t` jumps 0 → 1, as boarding does today; a climb animation is a later choice) | At the link's `top`, a kept cell (C1) |
| P1 | any → walking / swimming | `place(on, p)`, spawn, `firstPerson.enter` | **Projection** is total and returns only valid states: the kept cell nearest `p` in plan within `step` of `p`'s height; else, if `p` is outside `D_r` (over the water), swimming there; else the nearest kept cell. An empty mesh means swimming at `putOut` |
| R1 | any aboard → by projection | her mesh is rebaked (parts changed) | The old local point is projected onto the new mesh (P1). Projected into the water, `yaw` gains her heading, so the look doesn't turn |
| G1 | any aboard → swimming | she's gone | At the last world point, by SW1's push (clear of any other ship) |
| B1 | boarding → walking (or swimming) | her first mesh lands | Spawn projected (P1). Into the water (an empty mesh), `yaw` gains her heading, as everywhere else into the water |
| B2 | boarding → swimming | she's gone (no frame), or her mesh hasn't come in `boardWait` (15 s: her model never loaded) | At `from` (the camera, given by the crew) or where you were to board, by SW1's push; `yaw` gains her heading |
| SW1 | swimming → swimming | Move in the world at the surface, then `pushOut`: (1) up to four passes, each moving `p` to `M · putOut` of the ship whose `D_r` holds it; (2) if it's still in any ship's `D_r` (two ships so close their `D_r` overlap, each one's `putOut` in the other's), rings about the original `p`, a cell apart and sampled a cell apart round, to the first sample outside every ship's `D_r` | Each answer is tested by checkWalker's own test over every ship with a mesh, so it is outside the union. The search is total: at horizontal distance `D` from a ship's origin a surface point is at least `√((D(1−sinθ) − Y)(D(1+sinθ) + Y))` from it in her plan (θ her tilt, Y the surface's height off hers, ≤ 10 m + the difference at `p`), which exceeds her grid's reach `E` once `D(1−sinθ) − Y > E`; the last ring is there. Only a ship on her beam ends (sinθ ≥ 0.999) has no such ring; then the search stops at 200 m and, asserting, throws. This also covers a ship sailing into a swimmer |

**Dynamic blockers.** The boom swings, so it isn't baked. In her frame it
is a capsule (from the gooseneck, along the boom's current angle, radius
0.07). A move that would bring the body's cylinder into it is cut short
(W2), and an airborne `h` is capped under it (A1). A rule that only shortens
a move or lowers `h` can't break I. A boom swinging into someone standing
passes through them; it never pushes.

**Seats (tabletop's `firstPerson`).** `enter({ seat, eye, target, frame })`
puts you `walking` at the projection (P1) of the eye's plan point, dropped
by the seat's eye height. The ship is the one `frame` is aboard. Your
`yaw` faces `target`. `leave()` stops first person and leaves the
walker's state where it was.

**What crew.js keeps.** Its API to the package is unchanged:
`input, start, stop, me, take, leave, board, place, tick, update, dispose`.
`me().position` is the derived local feet, and the presence record keeps
its format. `walk.js` keeps the pure helpers (`wishVelocity`, `look`,
`lookDir`) and the parameter objects. The bake is `navmesh.js` (pure); the
state machine is `walker.js` (pure). The stage-side input adapter, which
gathers triangles from `api.content`, lives in crew.js.

### Verification

No random routes through the real ship.

**Unit cases** (`walker.test.js`, `navmesh.test.js`). Each is a fixture of a
few boxes as triangles, baked, then driven. This is the full list:

1. A flat floor: walk within a cell, and across cells. `u, v` stay in range.
2. A STEP up (0.3) and down: the cell changes, the feet follow the new
   plane, and the side back is a STEP (B4).
3. The threshold: a rise of exactly `step` is a STEP; `step + 1 mm` is a
   WALL. A drop of `step + 1 mm` is a WALL (ledge) with a rise of about 0.
4. A WALL (1.0): you stop with your centre `r` ± `c` from its face.
5. Sliding: walking at 30° into the wall keeps the along-wall component.
   Head on, you stop.
6. A concave corner (two walls at 90°): a diagonal move into it stops at
   the corner, and both axes are zeroed.
7. A convex corner (an L-shaped floor): walking along one wall carries on
   past the corner. A diagonal across the corner's cell goes through an
   orthogonal neighbour, never cutting the corner.
8. Exact diagonal through a vertex, both orthogonal sides WALL and the
   diagonal cell open: blocked. Then the same with one side STEP: through
   that side (the X-first tie order is checked both ways round).
9. A corner between a STEP (+X) and a WALL (+Z): a diagonal move crosses
   the STEP and slides along the WALL.
10. Head clearance: a floor under a ceiling lower than H isn't a cell. A
    jump under a ceiling at `H + 0.3` caps `h` at 0.3 and zeroes `vy`.
11. A wire pair over a floor (0.34 and 0.62, 6 mm): no cell under it or on
    it; the floor beside it is eroded by r; jumping over it works.
12. Jump over a low wall (rise 0.62 < apex 0.661): walking is blocked,
    a jump vaults it and lands beyond. A rise of 0.7: the jump is blocked.
13. Jump off a ledge (the cabin top to the sole): walking is blocked; the
    jump vaults down and lands.
14. OPEN: walking off an unrailed edge, you swim at `exit`, outside `D_r`.
15. A rail (WALL to OVERBOARD at 0.62): walking is held; a jump puts you
    in the water.
16. Ramps: 20° is walkable with STEP sides all the way up; 50° isn't.
17. Rule (b): a riser leaning 4.7 cm between a deck and a roof 0.45 above,
    in both alignments to the grid (inside one column, straddling two):
    STEP all the way. A 0.62 stanchion isn't a floor.
18. Swimming: pushed out of `D_r`. A ship moved onto a swimmer puts them
    out.
18b. Two ships rafted 0.1, 0.3 and 0.6 m apart (their `D_r` overlap):
    walking off one's OPEN edge, jumping her rail, and the other closing on
    a swimmer between them each leave the swimmer outside both `D_r`, and
    at least r clear of both hulls.
19. The ladder: from `foot` with F you're walking at `top`.
20. A station: take puts you at its link; WASD don't move you; leave puts
    you walking in the same cell.
21. **Her motion under a standing walker:** under any sequence of `M`
    (translation, heave, 30° heel, 20° pitch, yaw), the local state is
    bit-identical and the world feet equal `M · local`.
22. Her motion under a walking walker: the same input sequence gives the
    same local trajectory under two different `M` sequences.
23. Rebake under a walker: the floor under you is removed, so you're
    projected to the nearest cell. An empty mesh means you swim, and on a
    ship heading 90° the look direction is unchanged across it (R1's yaw).
23b. Boarding (B1, B2): her first mesh lands, you walk; an empty first
    mesh, you swim facing the same way; she's removed while you wait, you
    swim at `from`; her mesh never comes, after `boardWait` you swim.
24. `place`: a point over the water means swimming; a point by the deck is
    projected to a cell (the probes' `place` calls keep working).
25. `firstPerson.enter`: you stand at the projection of the seat's eye,
    facing its target.
26. Stepping across: an OPEN side over another ship's kept cell puts you
    on her deck, in her frame (walker.js `intoWater`).
27. A huge `dt` or speed: the move is capped, and I holds.
28. The boom blocker: walking into the capsule stops you; a jump under it
    is capped.
29. The cockpit's STEP (0.52 up, then down): the state is exact (the feet
    jump in one frame), `step` reports the jump as `lift`, and the drawn eye
    (`easeEye`, only the camera) moves under 0.1 m a frame and catches up
    within 0.15 s.
30. The assertion is on under vitest without the flag (`asserting()`).

Each step of every case runs `assertWalker`.

**One property test** (`walker.property.slow.test.js`, `fast-check` 4.10.2 as a
devDependency, seeded, under 2 s). Each case is:
- a 4 × 4 m arena: a floor plus 0–8 boxes (some floating: wires,
  overhangs, low ceilings), 0–2 ramps (0–60°) and 0–3 thin rods;
- a sequence of up to 200 steps: keys, run, jump, yaw, and `dt` from
  1/240 to 1/20;
- a sequence of ship matrices.

Each step checks I, and also an **oracle on the raw triangles, not the
mesh**:
- the feet are within `h + 2 mm` above a triangle;
- no triangle meets the cylinder of radius r over `[s + step, s + H]`
  (over `[s + h, s + h + H]` while airborne).

Every case's bake also passes B3–B5. Two cases in three raft a second
baked ship (a 4 × 4 m deck, with or without a rail) 0–1 m off one of the
first one's sides, riding with her, and half of those start in the water
between them. A swimmer must then be clear of both ships (I, and no
triangle of either within r), and a walker who steps across is checked
against the other ship's triangles. A failure shrinks to the fewest boxes
and steps, and prints the seed. About 100 runs. (Without the ring search,
it finds the rafted-swimmer breach and shrinks it to no boxes and no steps.)

**Static checks** on each baked hull. They run on the stock sloop in vitest
(`sloop-navmesh.test.js`, triangles from `ship.js`), and on the camber hull
with its parts in `probes/camber-run.mjs`.
- **C1**: spawn, each station's stand spot (helm, mainsheet, mast,
  windlass) and the ladder's top project onto a kept cell, within 0.35 m in
  plan and `step` in height of where they were asked for.
- **C2**: every kept cell is reachable on foot (STEP sides only) from
  spawn. So is every C1 spot.
- **C3**: every dropped component is one of:
  - inside her closed hull (C6's test);
  - smaller than 0.25 m²;
  - reached by no WALL side of a kept cell with a rise ≤ the jump apex.

  So nothing you could walk or jump to was dropped.
- **C4**: every side of every kept cell has exactly one record. B3 and B4
  hold, and B5 too: every `exit`, every `putOut` and the ladder's `foot`
  are outside `D_r`.
- **C5**: B1, B2 and B7, recomputed by brute force from the triangles, and
  the headroom with them. Per cell, exactly what the erosion promises: the
  cylinder of radius `r + c/√2` about the cell's centre (so radius r about
  every `(u, v)` in it) meets no triangle from `smin + step` to
  `smax + H + headroom`, and to the sky where the headroom is infinite: the
  standing band and the whole airborne envelope at once. Where it's
  finite, a triangle stands within 5 mm above that top in the disc's
  columns, so an understated or stale headroom fails too. Then B7 along
  every vault band. A bake that set every headroom to infinity, or halved
  them, fails C5 (`sloop-navmesh.test.js`).
- **C6**: no kept cell lies inside her closed hull. A point 5 cm above its
  surface is outside by ray parity, and three directions must agree.
- **C7**: stability. Rebaking at `step` 0.56 and 0.60, and at r 0.23 and
  0.27, keeps C1 and C2 true.
- **C8** (sloop): no OPEN side anywhere, so you never walk off her. Every
  way to OVERBOARD is a WALL with `step < rise ≤ apex`, so you can jump
  over the side.
- **C9**: two bakes of the same input are byte-identical; a shuffled
  triangle order too.
- **The bow** (sloop): the full bake reaches as far forward as a bake of
  her bare hull (within 0.1 m), and nothing forward of the windlass was
  dropped. C2 only covers kept cells, so it can't see a region pruned
  whole.
- **The mainsheet beside a card table** (sloop): baked with tabletop's
  table where the aboard setup puts it, the mainsheet's stand spot doesn't
  move, and the look from its eye to the block misses the table.

**One browser check** goes into `probes/sailing-run.mjs`. It uses real input
and the pointer-lock shim from the diagnosis' scratch probes. From the
helm spawn, a fixed sequence of about 10 s of real keys:
- along both sides of the well and its aft end;
- out over the side onto the side deck and back;
- a jump at the aft end.

Every frame, the page's assertion count stays 0. The feet lie within 2 cm
of `ship.js`'s analytic surfaces, or above them mid-jump. No route
marathons.

### Decisions in brief

- **The faces are grid cells, not welded source triangles.** A triangle
  navmesh needs polygon offsetting and booleans on a curved deck to erode
  and to cut out obstacles. Those are where bakes go wrong, and they can
  only be checked by sampling. On a 5 cm grid, each bake step is exact and
  finite:
  - clip a triangle to a square;
  - merge intervals;
  - the disc test;
  - one march per side.

  So the checks can cover every cell. The cost is a boundary quantised to
  5 cm, and the erosion disc is padded by `c/√2` to keep it conservative.
  The input is still triangles, so the sloop and a camber hull bake alike.
- **Baked from what's drawn** (the GLBs), not from `deckAt`. It is
  equally exact for the sloop, it is the same code for every hull, and it
  is right for docs whose GLB predates today's `ship.js`.
- **Step 0.58, radius 0.25, symmetric step.** A drop deeper than `step` is
  a WALL (ledge) you can jump off, which replaces `DECK.ledge`.
- **Obstacles come in by headroom.** No footprint input; the boom is a
  dynamic blocker.
- **The body rides her up.** The eye is along her up, not the world's,
  so the camera stays in the checked volume; the horizon stays level.
- **The ladder and stepping across** are links and checks at the mesh's
  edges. They are no longer rays.

### As built

Where the implementation departs from or sharpens the text above, and what
it measured.

- **Intervals merge across gaps no body can use.** Two ranges in a column
  merge when they overlap *or* the gap between them is less than
  `H − step` (1.17 m). B2 needs that much clear over a neighbour's floor and
  a fit needs H, so no later rule can tell such a gap from solid: treating
  it as solid is exact. It matters on the sloop: her portlights sit 1 cm
  off the cabin's leaning side, and a column straddling the side held the
  wall below and the port above with an 8 cm gap between. That made the
  cabin's edge a floor without headroom, and the cabin top lost its STEP to
  the side deck. Rule (b) then sees the walkable top under the port.
- **A floor's surface is its triangle's plane clamped to that triangle's
  range in the column** (`cells.lo`, `cells.hi`). So there is always a
  point of the triangle, in the feet's column, at the feet's height. That
  is what the oracle's support check tests: the feet within h + 2 mm above
  a triangle *in their 5 cm column*. Coplanar triangles that tie for a
  column's floor share the plane and join their ranges, so triangle order
  can't matter (C9). Gradients are stored without −0.
- **Sides carry `top`**: the highest a vault's feet may rise and keep its
  band clear. The march checks the band at the final rise in every column
  before the stop (else `to` is NONE), and the vault clamps `h` to
  `[rise, top]`. C5 checks every band at both heights.
- **P1 asks "over the water?" first.** A point outside her D_r swims. In
  the order first written, any point at deck height anywhere projects onto
  her (case 24).
  - Else it goes to a cell whose surface is at most a step above it and at
    most 2 m below it. The score is plan distance, with a drop deeper than
    a step counting metre for metre, so a point in the air lands on what's
    under it.
  - Else it goes to the nearest cell in 3D.

  The bake's seeds are projected the same way. Two plainer rules each
  failed on camber's hull:
  - With a symmetric ±step window, a point just over a step above her aft
    deck snapped to her foredeck 7 m away, which her sheer had brought
    within a step of it.
  - With "nearest in plan within the window", a seed over her deck took
    the bilge under it whenever the nearest deck cell was a cell away. A seed with no kept floor
  within a step of it keeps the nearest component instead (the property
  test found this: a 0.59 m post standing on the spawn point).
- **Erosion has two exact shortcuts before its BFS.**
  - A disc column with no alive floor fails f; per-row prefix sums answer
    that in 2K + 1 looks.
  - In a square window of "plain" columns, f passes outright. Plain means:
    one alive floor, open sky, all four neighbours connected to it within
    δ = (step − slope·c√2)/(4K + 2) of its height.

  D_r uses the same row sums. The march's disc gathers are cached per
  column.
- **C3** re-marches every non-STEP side over the bake's intervals, as the
  bake marches, offering the dropped floors as places to come down. A
  dropped component passes if it is inside her hull, smaller than 0.25 m²,
  or no such jump reaches it.
- **C8 as checked:**
  - no OPEN side;
  - every WALL to OVERBOARD rises above `step`;
  - on each side there are WALLs to OVERBOARD a jump clears (173 a side,
    rise 0.60–0.65).

  14 overboard sides rise above the apex: beside the shrouds' and the
  backstay's feet, where the wires come down low. You can't jump over the
  side there, which is right.
- **The sloop's mesh** has 8,088 cells (12,026 triangles), all one region;
  2,456 of them have a finite headroom. It drops two components, both
  inside her: the bilge under the cabin, and a 0.2 m² patch under the
  sole. (Before the windlass was refitted it had 7,890 cells and dropped
  four more: the windlass's top, a sliver at the bow, and the whole
  foredeck beyond the windlass, which nothing checked.)

  Every link lands where asked (C1: 0–3 mm). Every static check holds both
  on ship.js's triangles (sloop-navmesh.test.js) and on the triangles the
  page's crew gathered from her loaded GLBs (sailing-run.mjs).
- **Speed.** The sloop (11,570 triangles) bakes in 80–120 ms in Node at
  quiet moments, down from 530 ms as first written. That is over the 50 ms
  aim and under the test's 500 ms limit. In a loaded browser it measured
  219 ms.
- **The property test bakes its arenas at 10 cm, not 5.** A hundred cases
  then fit the budget: 1.0 s in a full run of the suite. Everything reads
  the cell size from the mesh's own params; the unit cases and the hull
  checks run at 5 cm. On its first run it found the seed fallback above
  and shrank it to one box.
- **The browser check uses real keys without pointer lock.** Walking reads
  only the keys, and each leg's yaw is set by `place`. `lock-shim.js`
  (the diagnosis' shim) is in the probe page behind `?lock=1`, for the
  stations work, whose use prompt needs the centre ray.
- **The bake runs off the frame loop** once she has a mesh, as a
  `setTimeout`. Her first mesh is baked when first asked for (coming
  aboard). A walker waiting for it is `boarding`. Meshes are cached by key
  for the whole page. The key holds object ids, so two identical sloops
  still bake twice.
- **The camber hull** (probes/camber-run.mjs: rigged from the bin, drawn a
  metre long with her bow +X, scaled to 12) bakes 14,370 cells from 5,366
  triangles, with links for spawn, the three stations and the ladder.
  C1–C7 and C9 hold; C8 is the sloop's rails.

  C3 failed there until the windlass was refitted (below). Its top
  (0.68 m²) stood 0.658 m above her curved foredeck, 3 mm under the apex,
  and was pruned, so C3 ("nothing you could jump to was dropped") caught
  it. With the compact windlass (0.43 m across) C3 holds there.
- **The sloop's fittings, refitted for the mesh.** The windlass was 0.92 m
  across its handles, at z −4.35 where her deck is 2.1 m wide inside the
  toe rails. A body passing it needed more than the lifelines left, so the
  foredeck forward of it was a component of its own, pruned (no seed): you
  couldn't walk to the bow. It is now 0.43 m across and stands at z −3.8.
  The bake then keeps the foredeck to z −5.18, as on her bare hull, and
  still does at r 0.27 (C7). The mainsheet's traveller moved from z 2.85,
  where a card table between the benches buried it, to z 3.3, just forward
  of the boom's end. You stand 0.35 m aft of it (`walker.standOff`), between
  it and the wheel.
- **The eye eases across a STEP.** The walker's state is exact, so stepping
  into or out of the cockpit moves the feet 0.52 m in one frame. `step`
  returns that jump as `lift`, and crew.js draws the eye with a lag along
  her up that closes at 5 m/s going up and 3.5 m/s going down
  (`walk.js easeEye`). Only the camera lags: I and the feet are untouched.
- **Tabletop's `firstPerson`** is on the play instance (`api.collect`).
  `enter` drops the seat's eye by a seated eye's height (1.15 m) and
  projects it (P1). `leave` ends first person without setting her quarter
  view, so the seat's view takes the camera.

