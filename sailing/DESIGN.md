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
| `glb.js`, `ship.js` | yes | A procedural sloop as GLB bytes: hull, deck, mast, boom and sail, wheel, capstan, ladder; the hull's connectors (`STAND`), the sail's size (`extras.sail`) |
| `parts.js` | yes but for files | The parts bin's parts (scene:part): the sloop whole, mast and sail, wheel, windlass and anchor, ladder, buoys, islet; squared to the ship they're put on (`placement`), one GLB doc per kind per scene (`ctx.file`) |
| `layout.js`, `template.js` | no | The "Ship at sea" template: the sea trait, the Sloop part with her way on (`sailing.ship.motion`) on a beam reach, landmarks. "Ship at anchor" (`layOutShip(ctx, { anchored: true })`): head to wind, still, sail down and anchor down (`AT_ANCHOR`), off the islet (`ANCHORAGE`), in a moderate breeze (`ANCHORAGE_AIR`, 6.5 m/s: enough to get her out of irons once the anchor is up) |
| `rig-contract.js` | yes | The rig aid's contract (`extras.rig`, patchwork-rig v1) in her body frame: its frame (`rigFrame`), the whole contract converted (`bodyRig`, with her drawn hull when it's the one the rig was designed on), the spec parts it fills (`rigSpecParts`), the hull it was designed on checked (`checkSource`) |
| `resistance.js` | yes | A rig contract's resistance table (§6.5) unpacked for the 120 Hz loop: the canoe body's R(V, φ) with its planing blend, the planing weight, and the induced drag's effective draft (`contractResistance`) |
| `body.js` | yes | A ship's body frame: where it sits in her hull's (`frameOf`), her pose through it and back (`toBody`, `toObject`), her body frame as drawn (`bodyOf`), and where a thing aboard sits in her (`placeIn`) |
| `traits.js` | yes | The doc's vocabulary: trait keys, claim kinds, station defaults, the wheel's and the boom's turn on top of how they were put (`wheelTransform`, `rigTransform`), the quarter view, and walking the tree as the stage resolves it (`parentOf` from `scene().parents`, `shipOf`, `partsOf`). Every part reads the doc through this |
| `frames.js` | yes | Matrices (`apply`, `invert`, `multiply`, `matrixOf`, `rotateM`, `unrotateM`, `headingOf`, `onHeading`) and quaternions (`rotateQ`, `mulQ`, `quatFromEuler`, `eulerFromQuat`, `poseOfMatrix`) |
| `play.js` | no | The sailing extension in play: joins the parts below, runs them in one loop in the order a frame needs, and sets the presence rate |
| `sea-view.js` | stage side thin | ctx.sea: the shared sea clock (pure: `seaTime`, `slew`, `follow`), the ocean and sky drawn (`drawSea`, which edit.js shares, with `seaClock`) only while the scene has a sea |
| `sim.js` | stage side thin | ctx.sim: the "sim" claim and handoff, physics per ship, the holds, the stations' values, saving (pure helpers exported and tested) |
| `looks.js` | stage side thin | What each view dresses for itself: floats bobbing (pure `floatPose`), the sail lowered, bellied to leeward and flat while it luffs (pure `fullness`) |
| `walk.js` | yes | The arena's walker, plus a ledge (you don't walk off the deck's edge), a probe at the brow (a spar stops you) and swimming at the surface |
| `crew.js` | stage side thin | ctx.crew: coming aboard, walking a moving deck (and stepping across onto another), overboard and swimming, standing at a station, the camera, everyone else's avatars |
| `stations.js` | mostly | The verbs for the use prompt: the helm (with the sheet led aft to it), the sail and sheet (at the rig or the mast), the windlass, the ladder (pure held-verb sessions) |
| `hud.js` | model pure | Crosshair, the sailing panel (speed over the ground, heading, a dial with the apparent and true wind, sail, anchor), the hint line, and what to do in irons (`hudModel`) |
| `edit.js` | no | The sea while editing, at the sailors' clock when someone is sailing her meanwhile |

`probes/sailing-run.mjs` plays all of it in a browser: two views of one
doc, crewing her together (see its header). `probes/camber-run.mjs` takes a
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

The rig aid (`rig/`, a separate package) designs a rig on a hull and
states it as `extras.rig` on the rig GLB it builds: patchwork-rig v1, whose
specification (`rig/contract/v1/specification.md`) is the authority,
§6 most of all (how a consumer composes forces from it). Sailing reads the
JSON; it imports nothing of the rig package's. Everything that follows is
gated on a contract being present: a ship without one (the Sloop, the
stock "Mast and sail" part) sails bit for bit as before
(`stock-golden.test.js`).

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
  where §6.4 puts it, with the Munk moment N_h = q·LWL³·|N'v|·sin λ·cos φ
  turning her bow to windward. Y_h is lift, as §6.4–6.6 treat it: it lies
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
    sheet angle within that. Inside the least angle (within 7° of the wind)
    the jib lies along the wind, luffing. `controls.jibBacked` holds it to
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
    off past 60° in 14.6 s, the J/24 in 6.5 s, the Catalina in 8.0 s,
    cuvature in 8.9 s; with the jib sheeted instead it takes 2.5–2.8 times
    as long (the sloop doesn't come out within 30 s). The rudder does little
    with no way on (amidships, the backed times are within 0.2 s), and once
    she gathers sternway it works backwards.
  - A contract without sails flies its lumped sail on the stock boom.
  - The sim's input has the jib's controls (`controlsOf` reads a jib value,
    `v.jib`: sheet, backed, furl); no station gives one yet.
- **Wrench.** `ship.wrench(pose, motion, controls, env)` is the sum of
  forces and moments `step` integrates (gravity, buoyancy, resistance,
  foils, sails, windage, anchor), at a state, about her CG, with the boom
  at its goal rather than where its swing has got to, and the jib at
  `pose.jib` if given, else at its goal. It changes nothing: stepping
  after a wrench is stepping without one.
- **Agreement** (`agreement.test.js`, `test/agreement-harness.js`). The
  rig package's valid fixtures and its reference consumer of §6
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
  every point; every fixture but the Laser settles within every tolerance
  (cuvature's heel by 0.04°). What still fails is listed in `KNOWN_GAPS`
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

## Parts

`parts.js` gives the parts bin (STAGE.md, "Parts") sailing's parts, each
a scene:part in index.js under "Sailing":

| Part | Pieces (the first is selected) | Tags | Traits |
|---|---|---|---|
| Sloop | the hull, and every part below at her stands | | `sailing.ship`, and a `sailing.sea` if the scene has none |
| Mast and sail | the mast; the boom and sail under it | `sailing.mast` | `sailing.sail` |
| Wheel | the wheel, its axle `LIFT` over where it stands | `sailing.helm` | `sailing.helm` |
| Windlass and anchor | the windlass; the anchor under it, at the stemhead | `sailing.windlass` | `sailing.anchor`, `sailing.hook` |
| Ladder | the ladder | `sailing.ladder` | `sailing.ladder` |
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
  bump `<n>` (`fileKey`) when a kind's drawing changes. A stage without
  `ctx.file` gets a doc of its own per kind, as before parts.
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
| `sailing.anchor` | a station under the ship (the windlass) | `{ down, rode, at? }` (`rode`: metres of chain out; `at`: where the anchor lies, world, while it's down). The windlass writes `down` and `rode`; only the simulator writes `at`: it drops the anchor on the bottom under the bow, clears `at` when it's up, and drops it again where she is when `at` is further from her bow than her rode allows (she was moved, or copied, while nobody sailed) |
| `sailing.hook` | the anchor itself, under the ship | `{}`: drawn lying on the bottom at `at` while its windlass has it down, at the bow (its doc place) when it's up |
| `sailing.ladder` | the ladder under the ship | `{}`: the way aboard from the water |
| `sailing.float` | any object | `{}`: bobs and tilts with the waves where it's moored (each view, from the shared clock; no hold) |

Who is at a station, and who simulates the sea, are **claims** in the doc
(`claims: { station | sim: { viewer, session } }` on the object), lapsing
when the holder's session leaves presence. The ship's motion is a
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
ticks them in the order a frame needs, and no part imports another (what
they share of the doc is traits.js, of the maths frames.js). play.js also
answers the hand's `carryable` (traits.js `carryableAboard`): never the ship
or anything with a sailing trait or tag, so a game played aboard can't carry
off her mast; anything else aboard is the game's business. And the sail's
verbs on the use prompt come from the sail station or what it hangs from
below the hull (the mast), never from another traitless thing aboard (a card
table): stations.js `sailOf`.

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
ctx.sim.stationsOf(shipId) → { helm, sail, anchor, ladder }   // object ids anywhere under her (a rig on a mast on the hull), null if missing
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
ctx.crew.take(stationId, handlers) → leave   // stand at a station: pushes an arm over walking; handlers: { key, keyup, tick(dt), left(), hint?() }
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
it only while nobody's at the helm. The mainsheet is led aft: Q and E trim it
from the helm as at the mast, and looking at the mast offers the sail's verbs.

**People.** A person is presence: `{ on, position, yaw, pitch, station }`,
with position local to the ship they stand on (her body frame), or world when in the water,
so a peer whose view of the hull lags still sees them on the deck. Walking
keeps the body in the ship's frame between frames: each frame it goes out
to the world through her drawn matrix, takes one step of the walker there
against the stage's rays, and comes back; standing on another ship's deck
moves you into her frame. Off the deck (fallen below the surface with no
deck under your feet) you swim at the ocean's height and can climb the
ladder. Each view draws everyone else as a simple figure in their frame.
