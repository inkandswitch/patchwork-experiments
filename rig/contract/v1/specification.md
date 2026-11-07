# patchwork-rig v1 — specification

**Status: v1, Patchwork-local.** This contract carries one rig design, as
the rig aid (`rig/`, the "Rig" datatype) worked it out over one hull at one
loading: the frame it stands in, the hull as floated, the masses, the foils
and sails with their coefficients, the resistance, the hardware points and
loads fit-out needs, and the aid's own predictions. It is the only way
anything downstream learns about the design. Consumers read it and never
write back.

- Structural schema: [schema.json](schema.json)
- Readable types and shared constants: [types.js](types.js)
- Both stages of validation: [validate.js](validate.js)
- §6 as code, against the contract alone: [reference/compose.js](reference/compose.js)
- Example: [examples/minimal.json](examples/minimal.json)
- Conformance fixtures: [fixtures/](fixtures/) and their [manifest](fixtures/manifest.json)

The layout follows Rising Tide's Chartroom formats (`hydrostatic-table` v1,
`marine-geometry` v1): a structural schema, a specification of the
numerical and cross-field rules it can't express, and valid and invalid
fixtures with the stage and error code each must fail with. Nothing here is
a Chartroom format; the geometric parts could become `sail-plan` and
`loading-condition` proposals once sailing and fit-out both read them.

```text
camber (a real hull) → rig aid (a real design) → extras.rig → sailing's physics
                                                            → fit-out (hardware, crew, helm)
```

## 1. Smallest useful document

The fields are all required (a value may be null where the schema says so),
so even a small contract is long. `examples/minimal.json` is a Laser with
coarse tables and no polar; abridged:

```json
{
  "format": "patchwork-rig",
  "version": 1,
  "name": "Laser / ILCA 7",
  "frame": {
    "axes": "x-forward-y-port-z-up",
    "units": "m",
    "originDescription": "The synthetic hull's frame: x from mid-LWL of the hull as built, y port, z up, the floated waterplane at z = 0.",
    "glbToFrame": [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
    "glbAxes": { "bow": "+X", "up": "+Y" },
    "design": { "heelDeg": 0, "trimDeg": 0, "waterplaneZM": 0, "sourceWaterplaneZM": 0, "displacementKg": 160, "volumeM3": 0.156097561, "rhoWaterKgM3": 1025 }
  },
  "loading": { "massKg": 160, "cgM": […], "items": [{ "id": "mast", "kind": "rig", "massKg": 4.63, "atM": [0.852, 0, 3.13], "estimated": true }, …], … },
  "sails": [{ "id": "main", "polygonM": [[0.852, 0, 0.85], [0.852, 0, 5.98], …], "areaM2": 7.06, "ceM": [-0.0634, 0, 2.564], … }],
  "predicted": {
    "status": "not-computed",
    "why": "the polar wasn't computed for this export",
    "reference": { "twsKn": 12, "twaDeg": 45, "speedMs": 2.92, "heelDeg": 15.0, "leewayDeg": 3.43, "rudderDeg": 1.42, "flags": [{ "id": "dsyhs", … }], "hollow": false, … },
    "helm": { "id": "weather", "text": "weather helm 1.4°", "rudderDeg": 1.42 },
    …
  },
  "lumpedSail": { "tackM": [0.852, 0, 0.85], "luffM": 4.51, "footM": 2.746, "areaM2": 7.06, "ceM": [-0.0634, 0, 2.564], "ceHeightFrac": 0.38 },
  "rules": "contract/v1/specification.md §6",
  …
}
```

It travels two ways:

- as `extras.rig` on the scene of the rig GLB that the `rig-design`
  scene:source builds (§8), which is what a scene, sailing and fit-out
  read;
- as a JSON file from the Rig tool's **Export contract JSON**, the same
  object built the same way, for tests (sailing's agreement test copies the
  valid fixtures here).

## 2. Frame and units

All positions are in one **hull-fixed, right-handed frame**: x forward,
y port, z up, metres (`axes: "x-forward-y-port-z-up"`, `units: "m"`), with
the waterplane the hull floats at for this loading at **z = 0**, upright
and at the hull's own trim (`frame.design`: heel 0, trim 0,
`waterplaneZM` 0). x and y keep the hull's own origin: a linked hull's,
after its bow/up choice; a synthetic hull's, mid-LWL of the hull as built.
Every point is `[x, y, z]`; the sails, foils and rig lie on the
centreplane (y = 0) except the chainplates, spreader tips, sheet leads,
traveller and crew stations.

Field suffixes give units, as Chartroom's do: `M` metres (and a point in
metres), `M2` m², `M3` m³, `Kg` kg, `N` newtons, `Nm` N·m, `Ms` m/s,
`Deg` degrees, `KgM3`, `M2s`. A field with no suffix is a ratio or a
coefficient, with two exceptions: ISO 8666 rig dimensions keep their ISO
names (`I`, `J`, `P`, `E`, `BAS`, `ISP`, `LP`, metres), and `twsKn` is in
knots beside `twsMs`.

**The hull's GLB.** `frame.glbToFrame` is the column-major 4 × 4 that takes
a point of the hull's glTF coordinates (and of the rig GLB's, which are the
same, §8) into this frame: the rotation the bow/up choice `glbAxes` names
(rows: bow, up × bow, up), then minus `[0, 0, sourceWaterplaneZM]`, the
height of the floated waterplane in the rotated hull frame. For camber's
hulls (bow +X, up +Y) that is p = (x, −z, y − h). A synthetic hull (no
linked hull) uses the same default axes, so its rig GLB is Y-up too.

**Sailing's frame** (x starboard, y up, z aft, the bow −z, about the same
origin): sailing = (−y, z, −x).

**Mass and gravity.** ρ_water = `frame.design.rhoWaterKgM3` (1025),
g = 9.80665 m/s² (§6.5.6 excepted). `frame.design.displacementKg` is what
the hull was floated at; it equals `loading.massKg` to 0.1% (§5).

## 3. Fields

Every field is listed in `schema.json` and typed in `types.js`; this
section says what each means and how it was made. "Estimated" is the aid's
word for a figure no source or designer gave: a rule of thumb, marked.

### 3.1 Top level

`format` "patchwork-rig", `version` 1, `name` (the rig doc's title),
`frame`, `source`, `hull`, `loading`, `appendages`, `sails`, `sailModel`,
`sets`, `rig`, `resistance`, `hardpoints`, `loads` (null until the
stability is built), `predicted`, `lumpedSail` (null with no sails),
`warnings` (the aid's plain-text warnings for this design, e.g. a hull
under 2 m "looks like a model, not a boat"), `rules` (where §6 is). No
other field is allowed.

### 3.2 `source`

`generator`; `rigDoc` and `rigHeads` (the rig doc's URL and heads at the
build, when known); `hull`: `kind` (`linked` or `synthetic`), `url` (the
linked doc), `path` (`render`, a scene render's current GLB; `file`, a GLB
file doc; `source`, any doc a scene:source builds with its default
params), `label`, `heads` (a file or source doc's heads; null for a render,
whose identity is `glbKey`), `glbKey`. `statics`: where the heeled
hydrostatics came from: `chartroom-table` (the linked hull's own Chartroom
hydrostatic table), `mesh` (a table the aid built from the floated mesh)
or `gm` (upright GM only, approximate). A consumer that also has the hull
checks `source.hull.url` against it and warns on a mismatch.

### 3.3 `hull`

The canoe body as floated (no keel or rudder): `loaM`, `beamM` (mesh
extents), `lwlM`, `bwlM`, `tcM`, `xFwdM` and `xAftM` (the waterline's
ends), `volumeM3`, `wsaM2` (wetted skin, an immersed transom excluded:
`transomWetM2`), `awM2`, `lcbM`, `lcfM`, `vcbM`, `cp` and `cm` (on the
largest section), `cb`, `zMetacentreM`, `halfEntranceDeg`, `stemheadM` and
`sternM` (the sheer's ends, found on the mesh), `keelZM` (its lowest
point), `lateral` (the underwater profile's area and centroid),
`sideForce` (§6.4), `dsyhs` (§6.5's inputs), `envelope` (each DSYHS
parameter outside its fitted range: `param`, `label`, `value`, `min`,
`max`) and `prov` (`mesh` for a linked hull, `synthetic` for one built from
principal dimensions). Hull facts never come from a GLB's `extras.ship`.

### 3.4 `loading`

`massKg` and `cgM` (the roll-up's total and centroid); `items` (`id`,
`name`, `kind`: lightship / ballast / rig / appendage / crew, `massKg`,
`atM`, `estimated`), which sum to them. The lightship's LCG is set so G
sits over the LCB (the table is at fixed trim); with a lightship mass
given, any shortfall is an "unaccounted" item. The crew is on the
centreline in `cgM`; their righting arm is applied separately (§6.6).

`gyradiiM` [roll, pitch, yaw] about the CG, estimated (`gyradiiBasis`):
each item a point mass, the mast and boom thin rods (mL²/12 about their
own centre, by their direction), and the lightship with its own
k_roll = 0.35·beam and k_pitch = k_yaw = 0.25·LOA.

`crew`: `count`, `kgEach`, `mode` (none / sitting / rail / hiking /
trapeze), `massKg`, `armM` (the righting arm the stability used: given, or
by mode from the half-breadth at the station), `armGiven`, `stations`
(one, `side: "windward"`, at `[x, armM, z]`: y > 0 is port, windward on
starboard tack; mirror y on the other tack).

`righting`: the righting moment the VPP used, `boatNm` and `crewNm` against
`heelsDeg` (to 90° at most), `wettedAreaM2` (the canoe body's wetted skin
at each heel, or null), and its `source` (`table`, or `gm`: W·GM·sin φ).
`heelLimitDeg`: the heel the VPP flattens and reefs to stay under.

### 3.5 `appendages`

One entry per foil (`id` keel or rudder; none for a keel of kind "none"),
a trapezoid in the centreplane: `cornersM` (root and tip, leading and
trailing edges), `spanM`, `rootChordM`, `tipChordM`, `sweepDeg` (the
leading edge, + = tip aft), `sweepHalfDeg`, `tc` (NACA 00xx thickness),
`taper`, `areaM2`, `macM` and `macFromRootM`, `qcM` (the MAC's quarter
chord: where its force acts), `arGeom`, `endPlateFactor` (2 when the
canoe body is its end plate: root on the immersed hull; 1 for a
transom-hung or kick-up rudder, or a root where the hull isn't immersed),
`arEff`, `liftSlope` and `clMax` (upright; §6.4 gives them at heel),
`stallDeg` (15), `volumeM3` and `volumeCentroidM` (0.685·t·c² per
section), `bulb` (a prolate spheroid: `lengthM`, `diameterM`, `centreM`,
`volumeM3`) and, for the rudder, `stock`: `axisM` [tip, deck] (the straight
line through each section's point at `balanceFrac` of its chord aft of the
leading edge, so through the MAC's balance point the torque uses, carried
up to the deck), `bearingM` (where it enters the hull: the blade's root),
`deckM`, `balanceFrac`, `maxDeg` (the rudder's travel).

### 3.6 `sails`, `sailModel`, `sets`

`sails[]`: `id` (main, jib, staysail), `kind` (main, jib, genoa,
self-tacking, staysail), `model` (§6.2's constants of its `family`),
`polygonM` (the sail as drawn on the centreplane; the main's leech carries
its roach as a parabola), `areaM2` and `ceM` (the polygon's area and
centroid), `tackM`, `headM`, `clewM` (the main's are the gooseneck, the
head at P and the clew at E, without roach), `luffM`, `footM`, `ar`,
`liftSlope`, `reefs` (the main's: `fraction` of P taken off, the reefed
`polygonM`, `areaM2`, `ceM`, `luffM`), `furl` (the doc's furl, the jib
only), `sheeting` (`minDeg`, `maxDeg`, `wing`; `boom` for the main:
`gooseneckM`, `endM`, `lengthM`; `lead` for a headsail: its sheet lead at
full sail, §3.9) and `coeffs` (§6.2's table).

`sailModel`: `rhoAirKgM3`, `interaction`, `flatMin`, `spanFactor`,
`cnExp` (§6.2–6.3). `sets[]`: full sail, then a set per reef of the main
(`id` full / reef1 / reef2…, `reef` −1 / 0 / 1…), with its `sails`,
`areaM2`, `ceM`, `heM`, `are` and `trimmed` (§6.3; null when the
performance model couldn't be built, or left out of the minimal example).

### 3.7 `rig`

`type` (masthead, fractional, cat, cutter), the ISO dimensions `I`, `J`,
`P`, `E`, `BAS`, `ISP` (null: the mast top), `LP` (null: no headsail),
`rakeDeg` (+ = head aft, about the partners; heights on the mast are along
it), `mast` (`stepM`: on deck, or on the hull's bottom when keel-stepped;
`partnersM`: its front at the sheer; `headM`; `heightM` above the partners;
`lengthM` from the step; `massKg` and `kgPerM`; `stepped`; `stayed`, false
for a cat; `sectionM`, the drawn diameter, 0.0055·L + 0.01 m: a drawing,
not a scantling), `boom` (`gooseneckM`, `endM`, `lengthM`), `designer` and
`actual` (the two sail-area conventions: ½PE + ½IJ, and the sails as
drawn, each with its CE).

`standing[]` (`id`, `fromM`, `toM`, `viaM`): the forestay (tack to
hounds); the backstay (masthead to the transom's top, found on the mesh);
on a cutter the inner forestay (staysail tack to its head); the cap
shrouds (hounds, over the spreader tip, to the chainplate) and lower
shrouds (spreader root to the chainplate), port and starboard. A cat is
unstayed: no standing rigging, no spreaders, no chainplates. Running
backstays aren't stated. `spreaders[]`: one pair, at half the hounds'
height (`heightM` along the mast), `rootM`, `tipsM` [port, starboard],
reaching the chainplates' half-breadth (`lengthM`). The rigging is a
schematic of where loads go, not a rig design.

### 3.8 `resistance`

§6.5's model, its inputs and its table: `status` (`computed`, or
`not-computed` with `why` and empty tables), `model`
("ITTC57+DSYHS+Savitsky"), `rhoWaterKgM3`, `nuM2s`, the table (§6.5,
"The table"), `fn` (each speed's Froude number), `induced`, `coefficients`
(the DSYHS regression tables, so the formulas can be evaluated from the
contract alone), `planing` (`capability`, `dL`, `weightN`, `beamM`,
`deadriseDeg` and where it came from, `lcgFromAftM`, `fnBlend`), `fnMax`
(0.75) and `formFactor` (0).

### 3.9 `hardpoints`

What fit-out places hardware on. Each is a rule of thumb, stated:

- `mastStepM`, `mastPartnersM`, `mastheadM`, `stemheadM`, `forestayTackM`
  (null for a cat), `innerForestayTackM` (a cutter's), `backstayPlateM`.
- `chainplates[]` (`id` port / starboard, `atM`): abreast the mast, at
  0.9 × the hull's half-breadth there, on the sheer.
- `rudderStock`: `axisM`, `bearingM`, `deckM` (as `appendages`' stock).
- `mainsheet`: `boomM` (0.95·E aft of the gooseneck: end-boom sheeting) and
  `travellerM` [port, starboard] (athwartships at the boom end, or the
  stern if the boom overhangs it, 0.8 × the half-breadth, on the deck).
- `jibLeads[]` (a headsail's, per side): the sheet lead is on the line from
  the luff's midpoint through the clew, carried down to the deck, at the
  sail family's least sheeting angle from the tack (`sheeting.minDeg`,
  the VPP's limit). `leads` gives it for the clew furled 0, 10, 20 and 30%
  (and the doc's furl if more): the clew slides toward the luff along the
  LP line, LP × (1 − furl). `trackFromM` and `trackToM` are the foremost
  and aftmost of them: the track fit-out must provide.
- `halyardExits[]`: the main's at the head of P on the mast, a headsail's
  at its head.
- `crewStations[]`: where the righting moment assumed the crew (§3.4), with
  their `mode`.

### 3.10 `loads`

Design loads at a stated basis, static, no safety factor, no pretension
(`notes` says so): `basis` "RM30", `rm30Nm` (the righting moment at 30°,
crew included, from §3.4's curve), `chainplateBaseM` and `chainplatesN`
(RM30 over the base: each chainplate is the windward one on its tack),
`mastCompressionN` (the same, before rig tension), `atAwsMs` (the reef
wind: the apparent wind that heels her to `heelLimitDeg` at full sail),
`sheetN` (Harken's rule at that wind: the jib on its area, the main on its
triangle × (1 + roach); the staysail's isn't estimated), `halyardN` (all
null: no rule found to cite), `rudderTorqueNm` (the larger of the torque
at stall and stalled at `maxDeg`, at hull speed, `rudderAtSpeedMs`).

### 3.11 `predicted`

The aid's static VPP (§6.6): `status` and `why`, `conditions` (`twsMs`,
`twaDeg`, the `reference` point), `reference` (the point the helm verdict
is read at), `helm` (`id` weather / lee / neutral / cannot / none /
unknown, `text`, `rudderDeg`), `points` (every TWS × TWA), `beat` and `run`
(best VMG per TWS). A point: `twsMs`, `twsKn`, `twaDeg`, `ok`, `speedMs`
(null with no equilibrium or beyond the model), `VMs` (the solver's speed
even then), `heelDeg`, `leewayDeg`, `rudderDeg` (+ weather), `flat`,
`set` and `reef`, `sheetsDeg` (per sail, §6.3), `awsMs`, `awaDeg` (off the
track), `fn`, `regime` (displacement / transition / planing / beyond),
`planingWeight` (§6.5.7's w), `vmgMs`, `residual`, `flags` (§6.7) and
`hollow`. White sails only: no spinnaker.

### 3.12 `lumpedSail`

§6.8: `tackM`, `luffM`, `footM`, `areaM2`, `ceM`, `ceHeightFrac`.

## 4. What a consumer must and mustn't do

- Read the contract; never write back to the rig doc or the hull. Where it
  can't honour an assumption (a crew station the cockpit can't reach, deck
  gear heavier than the lightship budget), report the mismatch: the
  physics stays the contract's.
- Don't extrapolate silently. Past a table's last heel or speed, the
  contract states nothing; say so. An `estimated` item is a rule of thumb,
  and so are the hardpoints (§3.9).
- Skip `hollow` points when testing agreement (§6.7).
- Take hull facts from the contract (or the hull's Chartroom outputs),
  never from `extras.ship`.
- Convert frames once, by `frame.glbToFrame` and §2.

## 5. Validation

`validate.js` runs two stages and stops at the first that fails.

**Structural** (`schema.json`): types, required fields, no unknown
fields, enums, bounds; every number finite. Error code `schema`.

**Semantic** (tolerances: 1e-6 relative for sums and areas, 1e-4 m for
positions):

| code | rule |
| --- | --- |
| `frame-matrix` | `glbToFrame` is a rotation (orthonormal, det +1, to 1e-9) and a translation, last row 0 0 0 1 |
| `duplicate-id` | sail, appendage and chainplate ids are unique |
| `mass-sum` | the items sum to `massKg`, their centroid is `cgM`; `frame.design.displacementKg` is `massKg` to 0.1% |
| `sail-plane` | every sail point is on the centreplane (\|y\| ≤ 1e-9) |
| `sail-area` | a sail's (and each reef's) polygon has its stated area and centroid |
| `coeff-shape` | `coeffs` arrays are one per α, α increasing |
| `appendage-area` | a foil's area is ½(root + tip)·span |
| `unknown-sail` | sets, trimmed tables, leads, halyard exits and sheets name sails that exist (in the set, for `trimmed`) |
| `unknown-set` | an `ok` point's `set` is one of `sets` |
| `unknown-hardpoint` | `loads.chainplatesN` names chainplates that exist |
| `table-shape` | the resistance, righting and trimmed tables are complete, on increasing axes; a computed resistance has speeds |
| `predicted-speed` | a point with no equilibrium or flagged `beyond` has `speedMs` null; `hollow` is exactly "a flag other than `dsyhs`"; a computed prediction has points |

`fixtures/manifest.json` lists every fixture with the stage it must reach
(`valid`, or the failing stage and code). The invalid fixtures are each one
mutation of the minimal example.

## 6. Force composition

A consumer that composes forces by these rules from the contract's
`sets`, `sails`, `sailModel`, `appendages`, `resistance`, `loading` and
`hull` reproduces the aid's `predicted` points: at each unflagged predicted
state the force and moment residuals are zero to solver precision (to the
fixtures' 9 significant digits, about 1e-7 of the force scale; §9).
`reference/compose.js` is this section written as code against the
contract alone, and the rig package's `src/contract-agreement.test.js`
holds it to that on every valid fixture, the Laser's planing points
included.

Units are SI; angles are degrees unless marked (rad). g = 9.80665 m/s²
(§6.5.6 excepted). The frame is the contract's (§2): x forward, y port,
z up, the floated waterplane at z = 0. "Windward" is the side the wind
comes from; heel φ ≥ 0 is to leeward. A sail set is one of `sets[]` (full
sail, then each reef of the main); its area A, CE (`ceM`), effective span
h_e (`heM`) and ARe (`are`) are the set's.

### 6.1 Air

ρ_air = 1.225 kg/m³ (`sailModel.rhoAirKgM3`). Flat water, steady wind, **no wind gradient**: every
sail sees the same apparent wind. No windage of hull, mast or crew.

Apparent wind. With the boat at speed V along its track, true wind TWS
from TWA off the track:

    AWA_track = atan2(TWS·sin TWA, TWS·cos TWA + V),   AWS = |·|
    β = AWA_track − λ          (λ leeway: the heading is λ to windward of the track)

Heeled sail plane:

    β_e   = atan2(sin β·cos φ, cos β)
    AWS_e = AWS·√(cos²β + sin²β·cos²φ)

### 6.2 One sail: coefficients against angle of attack

For a sail of family k (`sails[].model.family`: main, jib or staysail; a
genoa or a self-tacker flies the jib's), sheeted at δ_s (its chord off the
centreline; negative is goose-winged on the windward side), the angle of
attack is α = wrap₁₈₀(β_e − δ_s), with the interaction shift of §6.3. With
`alpha0`, `clMax`, `clBack`, `cdp`, `kv`, `stall`, `width`, `cn90` and
`ease` the family's constants (`sails[].model`; `sailModel.cnExp` is the
0.3 below), and `a` the sail's lift slope per radian (`sails[].liftSlope`),
Helmbold on AR = 2·luff²/area (`sails[].ar`; a reef shortens the luff to
`reefs[].luffM`):

    a = 2π·AR / (2 + √(AR² + 4))
    sat(x) = x / (1 + x⁴)^¼
    L  = 1 − ease.loss·S(|δ_s|; ease.from, ease.to)         (main only; 1 otherwise)
    d  = (α − alpha0) in rad
    CL_a = clMax·L·sat(a·d/(clMax·L))         if α ≥ alpha0
         = −clBack·L·sat(a·(−d)/(clBack·L))   if α < alpha0   (backed)
    CN   = cn90·|sin α|^0.3
    CL_s = sign(α)·CN·cos α,   CD_s = CN·|sin α|
    σ    = S(|α − alpha0|; stall, stall + width)
    CL   = (1 − σ)·CL_a + σ·CL_s
    CDv  = cdp + (kv·CL_a² + ease.drag·S(|δ_s|; ease.from, ease.to))·(1 − σ) + σ·CD_s

S(x; lo, hi) is smoothstep: t = clamp((x − lo)/(hi − lo), 0, 1), S = t²(3 − 2t).
The contract also tabulates CL and CDv against α (`sails[].coeffs`: α
from −30° to 120°, 2.5° steps, unflattened, δ_s = 0); a consumer may
interpolate the table linearly instead of evaluating the formula, but then
the easing terms are lost, so the formula is preferred.

### 6.3 Sails together

- **Upwash on the main.** The main sees α − ε,
  ε = 4°·CL_jib·(1 − S(β_e; 30°, 90°)), CL_jib the headsails' area-weighted CL
  (`sailModel.interaction.kIntDeg`, `.upwash`).
- **Blanketing of the headsail.** A headsail on the leeward side gets its
  coefficients × (1 − 0.35·S(β_e; 90°, 160°)) (`.blanket`); goose-winged
  (δ_s < 0, allowed from β_e ≥ `model.wing.fromBeta`, 140°) ×
  `model.wing.qFactor` (0.75) instead.
- **Sheeting limits** (δ_s, `model.sheet`, and `sails[].sheeting.minDeg`,
  `.maxDeg`): main 0 … 85°; jib 7 … 30° (or `model.wing.sheet`, −90 … −30°,
  goose-winged); staysail 9 … 28°.
- **Rig level.** CL = Σ CL_i·A_i / A, CDv = Σ CDv_i·A_i / A over the sails
  set (A = Σ A_i), and

      CL ← flat·CL                        flat ∈ [sailModel.flatMin, 1] = [0.5, 1]
      CD = CDv + CL² / (π·ARe),           ARe = h_e² / A,  h_e = 1.1 (sailModel.spanFactor) × masthead height above the DWL

- **Forces.** q = ½·ρ_air·AWS_e²·A:

      drive       Fx = q·(CL·sin β_e − CD·cos β_e)            along the boat, at the set's CE
      heel force  Fh = q·(CL·cos β_e + CD·sin β_e)            ⟂ the mast, at the set's CE
      horizontal side force Fh·cos φ (to leeward); heeling moment Fh·(z_CE − z_Y), §6.6

- **Reefing.** A reef lowers the main's head (the sail above a line r·P
  up the luff, brought down to the boom): its area, CE and luff change; the
  coefficients do not.

The aid's VPP trims every sail of a set to the δ_s that maximises the
set's drive, CL·sin β_e − (CDv + CL²/(π·ARe))·cos β_e, at each whole
degree of β_e from 0° to 180°, and interpolates the set's CL and CDv
linearly between those degrees. That table is the set's `trimmed`
(`betaDeg`, `cl`, `cdv`, and each sail's `sheetsDeg`); a consumer that
reads CL and CDv from it at |β_e| (unflattened: flat is applied after)
reproduces the aid exactly, and one with its own sheets evaluates §6.2–6.3
per sail instead. A point's `sheetsDeg` is the table's at the whole degree
nearest its β_e. Then the VPP chooses flat and the reef. The sim takes δ_s
from its boom and sheets.

### 6.4 Water: foils and canoe body (side force)

ρ = 1025 kg/m³, ν = 1.18831·10⁻⁶ m²/s (ITTC, 15 °C; `resistance.rhoWaterKgM3`,
`.nuM2s`). q = ½ρV². Each foil is an `appendages[]` entry: `arGeom`,
`endPlateFactor` (k), `sweepHalfDeg` (Λ½), `stallDeg`, `areaM2` (S), `qcM`
(where its force acts); the canoe body's derivatives are `hull.sideForce`
(`yv`, `nv` as magnitudes, `lwlM`, `xMidM`, `atM`).

    AR_eff(φ) = AR_geom·(1 + (k − 1)·cos²φ)     k = 2 with the hull as end plate, else 1
    a(φ)      = 2π·A / (2 + √(A²·(1 + tan²Λ½) + 4)),  A = AR_eff(φ), Λ½ half-chord sweep
    CL(α)     = a·α / (1 + (a·α/CLmax)⁸)^⅛,  CLmax = a·15°   (α in rad)
    keel      α_k = λ·cos φ;                       Y_k = q·S_k·CL_k(α_k)
    rudder    α_r = α_k·(1 − dε/dα) + δ,  dε/dα = a_k/(π·AR_eff,k);  Y_r = q·S_r·CL_r(α_r)
    hull      Y_h = q·LWL²·|Y'v|·sin λ·cos φ,   N_h = q·LWL³·|N'v|·sin λ·cos φ
              Y'v = −π(Tc/LWL)²(1 + 0.40·Cb·BWL/Tc),  N'v = −π(Tc/LWL)²(0.5 + 2.4·Tc/LWL)
              (Clarke, Gedling & Hine 1983; a ship regression, an extrapolation)
    Y = Y_k + Y_r + Y_h      (each in its heeled plane; horizontal part Y·cos φ)

δ > 0 is weather helm (rudder force to windward at the stern). Y_k and
Y_r act at the keel's and rudder's MAC quarter chords; Y_h at mid-LWL
(with N_h, which turns the bow to windward); for the heeling arm, Y_h is at
the canoe body's lateral-profile centroid depth. z_Y = Σ Y_i·z_i / Y.
A foil past |α| = 15° is stalled (CL saturates, the point is flagged).

**Not modelled: heel-induced hull side force and yaw moment.** The canoe
body's Y_h and N_h above depend on leeway only. Keuning & Sonnenberg's
DSYHS side-force and yaw-moment regressions also carry terms in heel alone
(the heeled waterline is asymmetric), which are the main hull-borne source
of weather helm as she heels; their coefficients were not in hand, so they
are left out. The effect is a bias toward lee helm that grows with heel:
helm (δ) at large heel reads low (less weather helm) than a boat with
those terms would carry. Lead-of-CE rules of thumb absorb this implicitly,
which is one reason the VPP's helm and the lead band can disagree. A
consumer that adds them is departing from these rules and should say so.

### 6.5 Water: resistance

    R = (1 − w)·[R_f + R_r + ΔR_r(φ)] + w·R_p + R_app + R_i

1. **Friction** (ITTC-57): R_f = q·S_c(φ)·0.075/(log₁₀Re − 2)², Re = V·0.7·LWL/ν,
   S_c(φ) the canoe body's wetted skin at that heel (`loading.righting.wettedAreaM2`
   against `heelsDeg`, linear; beyond it, or when it is null, the upright
   `hull.dsyhs.wsaM2`). No form factor (`resistance.formFactor` 0): the
   DSYHS residuary was fitted as total minus plain ITTC friction.
2. **Upright residuary** (DSYHS, Keuning & Katgert 2008, Eq. 1.7 / Table 2):

       R_r/(∇_c·ρ·g) = a0 + (a1·LCB_fpp/LWL + a2·Cp + a3·∇_c^⅔/Aw + a4·BWL/LWL
                             + a5·LCB_fpp/LCF_fpp + a6·BWL/Tc + a7·Cm)·∇_c^⅓/LWL

   a0…a7 linear in Fn = V/√(g·LWL) between the table's rows (0.15…0.75),
   × Fn/0.15 below 0.15, the last row held above 0.75. The hull's inputs
   are `hull.dsyhs` (LCB_fpp, LCF_fpp from the forward end of the
   waterline), the table `resistance.coefficients.residuaryFn` and
   `.residuaryA`.
3. **Heel** (DSYHS): ΔR_r = ΔR_r20·6·φ_rad^1.7,
   ΔR_r20/(∇_c·ρ·g) = (u0 + u1·LWL/BWL + u2·BWL/Tc + u3·(BWL/Tc)² + u4·LCB + u5·LCB²)/1000,
   LCB in % of LWL from mid-LWL (+ forward, `hull.dsyhs.lcbPct`); u at Fn
   0.25…0.55 (`.heelFn`, `.heelU`), × Fn/0.25 below, the last row held
   above.
4. **Appendages**: Σ q·S_i·cd0_i, cd0 = 2·C_f(Re_MAC)·(1 + 2·t/c + 60·(t/c)⁴),
   Re_MAC = V·`macM`/ν, t/c = `tc`; a bulb q·S_spheroid·C_f(Re_L)·(1 + 1.5(D/L)^1.5 + 7(D/L)³),
   S_spheroid = 2πb²(1 + a·asin(e)/(b·e)), a = L/2, b = D/2, e = √(1 − b²/a²).
5. **Induced**: R_i = F_H² / (π·T_e²·q), F_H = Y·cos φ the horizontal side
   force (Keuning & Sonnenberg define R_i on it; Y is in the heeled foil
   plane, §6.4). With the cos φ on T_e below this is Y²/(π·T_e(0)²·q): the
   heeled foil's own span carries its own lift.
   T_e = T·(3.7455·r − 3.6246·r² + 0.0589·BWL/Tc − 0.0296·TR)·(1.2306 − 0.7256·Fn)·cos φ,
   r = min(1, Tc/T), T the draft overall (`resistance.induced.draftM`), TR
   the keel's taper (`.keelTaper`, 0.5 if absent), the six constants
   `resistance.coefficients.teUpright` (Fn clamped to 0…0.75, T_e ≥ 0.1·T
   before the cos φ). The cos φ is an assumption standing in for the DSYHS
   heeled rows.
6. **Planing** (Savitsky 1964), for the boat's weight W (crew included),
   beam b = BWL, deadrise β (deg; given, or from the hull's section 20% of
   LWL forward of its aft end, tan β = 4(BT − A)/B²), LCG forward of the
   aft end of the waterline (`resistance.planing`: `weightN`, `beamM`,
   `deadriseDeg`, `lcgFromAftM`); upright, no spray. Here g = 9.8066 m/s²,
   as in Rising Tide's `resistance`, the implementation it was checked
   against:

       C_V = V/√(g·b),  C_Lβ = W/(½ρV²b²)
       C_Lβ = C_L0 − 0.0065·β·C_L0^0.6                         → C_L0
       (0.75 − 1/(5.21·(C_V/λ)² + 2.39))·λ·b = LCG              → λ (mean wetted length / b)
       C_L0 = τ^1.1·(0.0120·λ^½ + 0.0055·λ^2.5/C_V²)            → τ (deg)
       V_m = V·√(1 − (0.012·τ^1.1·λ^½ − 0.0065·β·(0.012·τ^1.1·λ^½)^0.6)/(λ·cos τ))
       R_p = W·tan τ + ½ρ·V_m²·(λb²/cos β)·(C_f(V_m·λb/ν) + ΔC_f)/cos τ

   C_f is ITTC-57 at Re = V_m·λb/ν; the wetted bottom is λb²/cos β (both
   faces of the V, Savitsky's own area) and ΔC_f = 0.0004 is Savitsky's
   roughness allowance, kept for a dinghy (a stated choice that errs slow;
   with both terms OpenPlaning's base-'64 run is reproduced to ±2%). The three unknowns are solved in turn:
   C_L0 from C_Lβ on [C_Lβ, C_Lβ + 0.0065·β·(C_Lβ + 1)^0.6 + 1], λ from the
   LCG on [0.2, 12] (both monotone; the aid bisects 60 times, taking the
   nearer end when there is no sign change), then τ explicitly.
   Range: C_V ≥ 1, 2° ≤ τ ≤ 15°, λ ≤ 4; outside it the point is flagged
   "planing model extrapolated". Where R_p is not finite (V_m = 0 on an
   absurd hull) w is taken as 0 at that speed and the point is flagged
   `planing-range` ("no solution").
7. **Blend**: w = S(Fn; 0.55, 0.75) × capability (`resistance.planing.fnBlend`,
   `.capability`), capability = 1 − S(D/L; 110, 160), D/L =
   Δ[long tons]/(0.01·LWL[ft])³ (`.dL`). A hull of capability < 0.5 past
   Fn 0.75 (`resistance.fnMax`) is "beyond model": no speed is shown.

**The table.** `resistance` also samples R(V, φ) with Y = 0: `hullN[φ][V]`
(friction, residuary and heel, blended with planing: everything in the
square bracket and w·R_p), with its parts `frictionN[φ][V]`,
`heelResiduaryN[φ][V]`, `residuaryN[V]`, `planingN[V]` (null where w = 0),
`planingWeight[V]`, `appendagesN[V]` and `regime[V]`, on `speedsMs` (Fn
steps of 0.025 up to 0.75, or 1.2 for a planing-capable hull) and
`heelsDeg` (0…35°). A consumer that can't evaluate the formulas in its
loop interpolates `hullN` bilinearly (V² below the first speed; past the
last speed or heel it holds the last row and says so: the contract states
nothing there) and adds the appendages and the induced term by formula.
The interpolation error at the fixtures' predicted points is about 0.1% of
the force scale.

### 6.6 Balance

At an equilibrium (V, φ, λ, δ), with Fx, Fh from §6.3 and R from §6.5:

    surge   Fx − R·cos λ + Y·cos φ·sin λ = 0
    sway    −Fh·cos φ + R·sin λ + Y·cos φ·cos λ = 0
    roll    Fh·(z_CE − z_Y) = RM(φ)       RM = Δ·g·GZ(φ) + crew·g·arm·cos φ (the stability curve)
    yaw     (Y_k·x_k + Y_r·x_r + Y_h·x_mid)·cos φ + N_h − Fh·cos φ·x_CE
            + Fx·z_CE·sin φ − (R_app + R_i)·z_Y·sin φ + R·sin λ·x_LCB = 0

Yaw is positive turning the bow to windward. There is no yaw term from
heel alone (the asymmetric heeled hull, §6.4 "Not modelled"), so δ reads
toward lee helm as φ grows; a consumer judging helm should say so. x_CE and z_CE are the set's
`ceM`; x_LCB is `hull.lcbM`. RM(φ) is `loading.righting`: `boatNm` +
`crewNm`, linear between `heelsDeg` (it includes the appendages' buoyancy,
the crew's m·g·arm·cos φ, and G from the mass roll-up; nothing beyond its
last heel). When the heeling moment upright is less than the crew's
righting moment she sails upright (φ = 0) with the crew partly in, and
roll is not an equation. Fixed trim; no sinkage.

The aid solves φ inside (a bracketed root of roll) and (V, λ, δ) by damped
Newton, then chooses flat ∈ [0.5, 1] and the main's reef for the fastest
speed whose heel is within the doc's limit (flatten first, reef only when
flat can't hold it). A planing-capable hull that balances both below the
hump and on the plane is taken on the plane. The residual a point was
solved to is its `residual` (scaled as in `reference/compose.js`).

### 6.7 Flags

`no-equilibrium`, `over-heel`, `helm` (|δ| above the rudder's limit:
"cannot be held"), `rudder-stall`, `keel-stall`, `beyond` (§6.5.7),
`planing-range` (§6.5.6), `dsyhs` (a DSYHS parameter outside Keuning &
Katgert's Table 1 ranges: LCB_fpp/LWL 0.500–0.582, Cp 0.519–0.599,
∇^⅔/Aw 0.079–0.265, BWL/LWL 0.170–0.366, LCB_fpp/LCF_fpp 0.920–1.002,
BWL/Tc 2.46–19.38, Cm 0.646–0.790, ∇^⅓/LWL 0.12–0.23; `hull.envelope`
lists the hull's own). A point is `hollow` exactly when it carries a flag
other than `dsyhs`: the DSYHS caveat is the hull's, stated once. A
consumer's agreement test skips hollow points; a point flagged only
`planing-range` is still an equilibrium of these rules.

### 6.8 The lumped sail (today's sailing)

Until sailing flies the sets above, it flies one foil (`lumpedSail`, and
the GLB's `extras.sail.plan`, §8): area A = the actual sails' total, its CE
at `ceHeightFrac` (0.38, sailing's CE_HEIGHT) up its luff from the tack and
a third of its foot aft of it. The contract chooses it so that CE is the
actual sails' combined CE, and so that the foot is three times the sails'
area-weighted swing arm (each sail's CE aft of its own pivot: the
gooseneck for the main, the tack for a headsail), since the sim swings
that CE about the tack with the boom. The tack is at the boom's height
(luff ≥ 1 m, foot ≥ 0.3 m). It is a stop-gap: none of §6.1–6.7 applies to
it, and the agreement test doesn't use it.


## 7. Who reads what

- **Sailing's physics**: `frame` (to put the rig on the hull and convert to
  its own frame), `loading` (mass, CG, gyradii, crew and the righting
  curve), `appendages`, `sails`, `sailModel`, `sets`, `hull.sideForce`,
  `hull.dsyhs`, `resistance`, and `rules`; `predicted` for its agreement
  test. Today it reads only the lumped `extras.sail.plan` (§6.8).
- **Fit-out**: `hardpoints`, `loads`, `rig.standing` and `rig.spreaders`,
  `sails` (clews, reefs, furl, sheeting), `loading.crew.stations`,
  `appendages[].stock`. From them it decides the helm type (stock position
  and torque), sizes winches and tracks (loads, lead track spans), bounds
  the cockpit (partners, stock, traveller) and places the crew.

## 8. The rig GLB

The `rig-design` scene:source (`src/scene-build.js`) builds a glTF 2.0
binary in the **hull's own glTF coordinates** (the inverse of
`frame.glbToFrame`), metres (`asset.extras.units` "m"), so a rig object
attached to its hull at the identity stands on her real stem, sheer and
transom. Its scene's `extras` hold `rig` (this contract) and `sail`
(`{ plan: { tack, luff, foot, area } }`: §6.8's lumped sail, its tack in
the GLB's coordinates, the form sailing's `sim.js sailOf` reads).

Nodes (one root, "Rig"; no spaces, so three.js keeps the names): "Mast",
"Boom", "Spreaders", "Rigging" (the standing rigging, as lines), "Sail"
(the main, its origin at the gooseneck, so scaling its Y lowers it to the
boom), "Jib" and "Staysail" (each with its origin at its tack), "Keel",
"Bulb", "Rudder", "Stock" (the rudder stock), and "SyntheticHull" only
when no hull is linked. The foils are NACA sections lofted root to
tip, their roots carried up into the hull to its underside at the leading
and trailing edges.

Build params: `sails` (draw the sails) and `hull` (draw the synthetic
hull). `fingerprint(doc)` hashes the whole normalized doc (its title is
the contract's `name`); `dependencies(doc)` is the linked hull, which the
scene watches (a render by its GLB, any other doc by its heads). A build
whose linked hull can't be read returns an empty GLB whose notes say why.

## 9. Versions and fixtures

A change to a field's meaning, or to a §6 rule, is a new version; adding
an optional field is not (there are none yet: every v1 field is
required). The scene source's own `version` (in `src/index.js`) moves when
the GLB a doc builds changes.

The valid fixtures are built by this package from its own fixture boats
(`src/test/contract-cases.js`): the stock 12 m sloop, the Catalina 30, the
J/24 in its ORC condition, the Laser, camber's cuvature-kink at 12 m with
the first guess's rig, and the minimal example. Their numbers are rounded
to 9 significant digits. `src/contract-fixtures.test.js` fails when they
drift from what the package builds; rewrite them with
`RIG_WRITE_CONTRACT_FIXTURES=1 npx vitest run src/contract-fixtures.test.js`.

## Sources

Each formula's citation, with what was and wasn't checked, is in the
module that implements it: `src/naval/sails.js` (ORC sets, Day 2017),
`src/naval/resistance.js` (Keuning & Katgert 2008, Larsson, Eliasson &
Orych, Keuning & Sonnenberg 1998, Savitsky 1964 via Rising Tide's
`resistance`), `src/naval/design.js` (Clarke, Gedling & Hine 1983),
`src/naval/foils.js` (Helmbold, Hoerner), `src/naval/stability.js`
(Harken's sheet-load rule, the crew stations), `src/naval/balance.js`
(Larsson & Eliasson's lead bands). The hardware rules of §3.7 and §3.9,
the gyradii of §3.4 and the lumped sail of §6.8 are this contract's own
rules of thumb (`src/contract.js`).
