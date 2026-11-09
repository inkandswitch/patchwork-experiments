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
| `body.js` | yes | A ship's body frame: where it sits in her hull's (`frameOf`), her pose through it and back (`toBody`, `toObject`), her body frame as drawn (`bodyOf`), and where a thing aboard sits in her (`placeIn`) |
| `traits.js` | yes | The doc's vocabulary: trait keys, claim kinds, station defaults, the wheel's and the boom's turn on top of how they were put (`wheelTransform`, `rigTransform`), the quarter view, and walking the tree as the stage resolves it (`parentOf` from `scene().parents`, `shipOf`, `partsOf`). Every part reads the doc through this |
| `frames.js` | yes | Matrices (`apply`, `invert`, `multiply`, `matrixOf`, `rotateM`, `unrotateM`, `headingOf`, `onHeading`) and quaternions (`rotateQ`, `mulQ`, `quatFromEuler`, `eulerFromQuat`, `poseOfMatrix`) |
| `play.js` | no | The sailing extension in play: joins the parts below, runs them in one loop in the order a frame needs, and sets the presence rate |
| `sea-view.js` | stage side thin | ctx.sea: the shared sea clock (pure: `seaTime`, `slew`, `follow`), the ocean and sky drawn (`drawSea`, which edit.js shares, with `seaClock`) only while the scene has a sea |
| `sim.js` | stage side thin | ctx.sim: the "sim" claim and handoff, physics per ship, the holds, the stations' values, saving (pure helpers exported and tested) |
| `looks.js` | stage side thin | What each view dresses for itself: floats bobbing (pure `floatPose`), the sail lowered, bellied to leeward and flat while it luffs (pure `fullness`) |
| `navmesh.js` | yes | The bake: a ship's triangles (her body frame) to a navmesh of 5 cm cells, every cell side one record (STEP, WALL, OPEN), her D_r and where a swimmer is put out of it, and links (spawn, stand spots, the ladder). See "Walking" |
| `walker.js` | yes | The walker: a state machine over the navmesh (walking, airborne, vaulting, at a station, on the ladder, swimming), invariant I (`checkWalker`), projection (P1), the seeds a bake starts from |
| `navcheck.js` | yes | Checking a bake: the oracle on the raw triangles, the bake properties B1–B7, the static checks C1–C9 |
| `walk.js` | yes | Walking's pure helpers (`wishVelocity`, `look`, `lookDir`) and the body's numbers (`BODY`, `DECK`, `SWIM`) |
| `crew.js` | stage side thin | ctx.crew: the bake's input adapter (her triangles from `api.content`, the bake key) and her mesh rebaked as her parts change; the walker stepped each frame and the camera at its eye; coming aboard, stations, the ladder, tabletop's `firstPerson`; everyone else's avatars |
| `stations.js` | mostly | The verbs for the use prompt: the helm (with the sheet led aft to it), the sail and sheet (at the rig or the mast), the windlass, the ladder (pure held-verb sessions) |
| `hud.js` | model pure | Crosshair, the sailing panel (speed over the ground, heading, a dial with the apparent and true wind, sail, anchor), the hint line, and what to do head to wind before she's in irons (`luffing`) and once she is (`inIrons`) (`hudModel`) |
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
// step takes at most MAX_SUBSTEPS (30) a call and drops the rest: the caller skips it (sim.js catchUp)
// controls.anchor.at: where the anchor lies (world); sheet defaults to 0.5
// read(): speed forward through the water (− astern), pitch + bow up, leeway + to starboard,
//         submerged: fraction of the whole hull's volume under water (~0.19 at rest)
// spec extras: cg (body y of the centre of gravity), center ([x, z]); specFromBox(box, overrides)

// sim.js: a ship's spec from what she's made of, in her body frame
specFor(content, overrides, scale, { frame, rig: { matrix, sail } })
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

- `frameOf(trait, content)`: what her GLB says (`glbFrame`: turned to
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
| Mainsheet | a traveller across the cockpit's sole and the sheet's block on it, under the boom's end | `sailing.mainsheet` | `sailing.mainsheet` |
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
| `sailing.mainsheet` | a station under the ship (the cockpit's traveller) | `{}`: where the ship's sail is trimmed and hoisted from (its values are the sail station's); who stands at it is its `"station"` claim |
| `sailing.hook` | the anchor itself, under the ship | `{}`: drawn lying on the bottom at `at` while its windlass has it down, at the bow (its doc place) when it's up |
| `sailing.ladder` | the ladder under the ship | `{}`: the way aboard from the water |
| `sailing.float` | any object | `{}`: bobs and tilts with the waves where it's moored (each view, from the shared clock; no hold) |

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
ticks them in the order a frame needs, and no part imports another (what
they share of the doc is traits.js, of the maths frames.js). play.js also
answers the hand's `carryable` (traits.js `carryableAboard`): never the ship
or anything with a sailing trait or tag, so a game played aboard can't carry
off her mast; anything else aboard is the game's business. And the sail's
verbs on the use prompt come from the sail station or its mast (what it
hangs from, or what stands under its gooseneck in an older doc), never from
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
ctx.sim.stationsOf(shipId) → { helm, sail, anchor, mainsheet, ladder }   // object ids anywhere under her (a rig on a mast on the hull), null if missing
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
aboard that the rig hangs under, or that carries the `sailing.mast` tag, or
(a doc made before the rig hung from the mast: both under the hull) whose
origin is within `MAST_NEAR` (0.6 m) of the gooseneck in her plan; a card
table in the cockpit is none of these. The HUD names her stations while you
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
  runtime: what you walk on is what is drawn, including in older docs whose
  GLBs predate today's `ship.js`.

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
| W3 | walking → swimming | a move across an OPEN side (no rail; none on the sloop) | You swim at `M · exit`, outside `D_r` (B5). First, if another ship has a kept cell under that world point within `step` of your feet, you go to `walking` on her (stepping across, `reframe`) |
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
    on her deck, in her frame (`reframe`).
27. A huge `dt` or speed: the move is capped, and I holds.
28. The boom blocker: walking into the capsule stops you; a jump under it
    is capped.
29. The cockpit's STEP (0.52 up, then down): the state is exact (the feet
    jump in one frame), `step` reports the jump as `lift`, and the drawn eye
    (`easeEye`, only the camera) moves under 0.1 m a frame and catches up
    within 0.15 s.
30. The assertion is on under vitest without the flag (`asserting()`).

Each step of every case runs `assertWalker`.

**One property test** (`walker.property.test.js`, `fast-check` 4.10.2 as a
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

