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
