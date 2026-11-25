# terrain

Real places as a scene's ground. A **Terrain** doc names a place and an
extent, and caches open data for it (heights and bathymetry from NOAA,
the shoreline, docks and marks from OpenStreetMap). A `scene:source` builds
it into a GLB in metres: the ground and seabed as one mesh with the OSM
shoreline burned in, harbour structures, lights and buoys, and the
heightfield itself in `extras.terrain`, so anything in the scene can ask
how deep the water is.

It ships two places, each a scene template with sailing's sloop:

- **Cadboro Bay**, off the Royal Victoria Yacht Club in Victoria BC, the
  sloop on the club's moorings;
- **Ucluelet**, on Vancouver Island's west coast: the harbour and inlet,
  Amphitrite Point and the outer coast to the Broken Group, with Rising Tide
  Boat Works' boatyard at the old RCAF seaplane base (the hangar, the
  planned haul-out pier, travel lift and electrified dock), the sloop at
  anchor off the dock.

Both get the same look (README, "The look"): the ground coloured by what
covers it and by the tide, a forest canopy with instanced trees in front
of it, and OpenStreetMap's buildings.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `terrain` | a place: its frame, extent and cached data (`src/datatype.js`) |
| `patchwork:tool` | `terrain` | a map of it, its settings, **Fetch data**, its sources and licences (`src/tool.js`) |
| `scene:source` | `terrain-mesh` | the GLB (`src/source.js` → `src/build.js`) |
| `scene:template` | `terrain.cadboro-bay` | "Cadboro Bay (RVYC)" (`src/template.js`) |
| `scene:template` | `terrain.ucluelet` | "Ucluelet (Rising Tide Boat Works)" (`src/template-ucluelet.js`) |
| `scene:extension` | `terrain.place` | for the object with the `terrain.place` trait (the place): the shore in the water, the water's shelter, the ground's grain; no sky, which is the world's weather (`src/place.js`) |
| `scene:extension` | `terrain.credit` | the data's credit at the foot of the view, for objects with the `terrain.credit` trait (`src/credit.js`) |

## Cadboro Bay (RVYC)

On an empty scene's start screen, **Cadboro Bay (RVYC)**:

1. fetches the place's data (up to a minute: Overpass is often busy and is
   retried) into a new Terrain doc. OpenStreetMap is asked for the moment
   the place was checked (`OSM_DATE`, 2026-11-09T20:32:33Z, an Overpass
   `[date:…]`), so every scene gets the same shore and a coastline someone
   has just left half-edited can't break it; if what comes back isn't the
   checked data (`EXPECTED`, the SHA-256 of both files), it says so;
2. puts the terrain in at the scene's origin, locked, its About the Terrain
   doc (sources and licences), with the `terrain.credit` trait, so the view
   shows "© OpenStreetMap contributors (ODbL) · NOAA NCEI · CHS · ECCC · not
   for navigation" at its foot, and the `terrain.place` trait (the place:
   the shore in the water, the water's shelter, the ground's grain);
3. gives the world its weather (the weather package's `weather` trait:
   Cadboro Bay at 15:00 on 15 July on its clock, UTC−7 (`OFFSET`); a typical summer afternoon's
   4 m/s from 235°, WSW; a fair afternoon's sky, `SKY` in `cadboro.js`:
   cumulus over a third of it at 1200 m, 10 km visibility, which the
   weather draws as sailing's bright day exactly) and the bay's Sea at y = 0 (open water
   with `sailing.sea`, wave scale 0.5: a south-westerly reaches the bay over
   Uplands and Oak Bay, so the bay is a lee). The Sea's `clip` is the
   terrain's footprint from its known grid, 150 m deep, so the bay placed in
   a world with no open water is a block of its own sea (water/WATER.md,
   "Clipped open water");
4. lays sailing's sloop (the `sailing.sloop` part, found in the registry,
   never imported) on the mooring field, head to wind, main down, jib
   rolled away, anchor down with 25 m of chain (sailing has no mooring buoy, so her anchor
   holds her), in ~8 m of water;
5. starts people in Look (no body named) at its home view (`view.start.home`), above the
   clubhouse looking out over the docks to the moorings; a click on the
   sloop comes aboard.

Without sailing installed it is the place alone, and says so.

The extent is 8.192 km square, 1025 × 1025 nodes 8 m apart: from west of
the club to Haro Strait, from Finnerty Cove to Oak Bay, taking in Ten Mile
Point, Baynes Channel, Strongtide Islet, the Chatham Islands, Discovery
Island and Mayor Channel.

**Assumptions to check against the real place:**
- **The mooring field** is at 48.4540 N, 123.2915 W, just north-east of the
  breakwater: OSM maps no moorings in Cadboro Bay, so this is an estimate.
  It is the frame's origin; to move the boat, move her (the terrain stays).
- **The shoreline is OSM's coastline**, which is nominally the high-water
  line, put at mean water level. Beaches that dry at half tide (the head of
  the bay) are water here.
- **Where the DEM and OSM disagree, depths are made up**: 13,062 water nodes
  (0.84 km² in 520 places) where NCEI says shallower than −0.57 m, or land,
  are held at −0.57 m and flagged `clamped` in `extras.terrain.quality`.
  The largest, 17 ha, is along the west side of the bay by the club's docks
  (centred at x −253, z −86, where the DEM reaches +4.4 m); then Oak Bay
  (−907, 2537), off Ten Mile Point (1189, 401) and north of the bay
  (80, −1978). Treat those depths as unknown.
- **Small islets**: 189 of the 217 OSM islets with a node in the grid are too
  small for the shore's 1-in-20 slope to clear high water; they are raised
  to the DEM's height there, between +1.5 m and +6 m (the two rocks 350 m
  north-east of the mooring: +5.14 m and +2.24 m). 75 more hold no node and
  are drawn as rocks and listed in `extras.terrain.rocks`.
- **Tidal streams aren't modelled** (sailing has none). Baynes Channel's
  are a large part of how the place sails.

## Ucluelet (Rising Tide Boat Works)

On an empty scene's start screen, **Ucluelet (Rising Tide Boat Works)**:

1. fetches the place's data (about 66 MB from four hosts, all with CORS;
   a minute or two) into a new Terrain doc: OpenStreetMap's shore, docks
   and marks, and its buildings and land cover, both as of
   `OSM_DATE` = 2026-11-16T05:30:00Z; then the heights from six rasters,
   layered per node (below). If what comes back isn't the checked data
   (`EXPECTED`: the SHA-256 of the heights, the source-and-canopy layers,
   the features and the look) it says so;
2. puts the terrain in at the origin, locked, its About the Terrain doc,
   with `terrain.credit` and `terrain.place`;
3. gives the world a summer afternoon's weather (the weather package's
   `weather` trait: Ucluelet at 15:00 on 15 July on UTC−7, under Ukee grey:
   Ucluelet's sky, below) with its breeze, 5 m/s from 300° (WNW), which
   blows along the harbour; and the harbour and
   coast one open water (`water`) with `sailing.sea` at scale 0.6, whose
   `clip` is the terrain's footprint from its grid (20.48 km a side,
   centred at (6800, 3340)), 130 m deep, as Cadboro's Sea has (`bayClip`
   takes the place's placeholder box);
4. lays sailing's sloop (found by its part id, never imported) at anchor
   about 70 m north of the planned dock's arm (48.95078 N, 125.5561 W, an
   assumed spot: no anchorage is charted there) in about 12 m of water,
   head to wind, sails down;
5. starts people in Look 30 m over the water 140 m off the old seaplane
   base's frontage, looking south-south-east (about 159°) over the planned
   dock and the sloop to the basins and the forested peninsula behind the
   town, the hangar, wharf and haul-out pier at the frame's right, with a
   few boats about the harbour (dressing: below).

Without sailing it is the place alone, and says so.

### The extent

1025 × 1025 nodes **20 m** apart, 20.48 km a side: 48.8277–49.0120 N,
125.6050–125.3251 W; the origin in the water off the seaplane base piers
(48.9500 N, 125.5580 W, OSM's Ucluelet Water Aerodrome is 8 m away; the
planned haul-out pier's head is 55 m east). It takes in all of Ucluelet
Inlet, the harbour and its basins, Lyche Island and Hitacu, Amphitrite
Point and the Wild Pacific Trail coast, Newcombe, Carolina, Felice and
Alpha channels, Loudoun Channel, the western Broken Group (Benson, Clarke,
Turret, Dodd, Willis, Trickett, Cree), Mount Ozzard (701 m) and about 7 km
of open Pacific. 20 m is the finest spacing at which 1025 nodes reach the
western Broken Group; the harbour still reads finely because its shore,
floats and piers come from vectors. Heights are kept at 2.5 cm a step
(`heightScale`), so int16 holds ±819 m.

The datum is CHS gauge 08595 Ucluelet: MWL 2.04 m above chart datum, 0.12 m
above CGVD2013, 0.08 m below CGVD28's zero (the boatyard survey's heights
are CGVD28: +0.08 m makes them heights about MWL; the site is then
conformed to the lidar's ground, 1.14 m lower: "The boatyard", below). The tide about MWL: HAT
+1.98, HHWLT +1.93, MHHW +1.22, MLLW −1.33, LLWLT −2.11. The land floor is
HHWLT + 0.3 = +2.23 m.

### The heights, layered (`src/layered.js`, `src/resample.js`, `src/fill.js`)

Here NOAA's DEM and CHS's survey disagree (NONNA-10 − NCEI 1″ over 37,488
water nodes: median −6.1 m, p10 −23.8, p90 +2.0; NCEI reads about 0.68 of
NONNA's depth in 10–30 m), unlike in Cadboro Bay. It isn't registration
(no shift helps; 100.00% of 172,206 off-shore NONNA nodes are OSM water),
and NCEI's coarser 3″ BC DEM agrees with NONNA within 5–10%, so CHS's
survey comes first. Each node takes the first source on its side of OSM's
coastline that has a value there (bilinear at the node's latitude and
longitude, never mixing a value with a missing one):

| side | order | nodes |
|---|---|---|
| water | CHS NONNA-10 → NONNA-100 → NCEI Barkley Sound 1″ (raster 147) → NCEI BC 3″ (182) → filled | 685,496 · 22,168 · 16,717 · 3,714 · 1,728 |
| land | NRCan HRDEM lidar DTM → NCEI 1″ → the land floor | 236,999 · 83,574 · 229 |

- **NCEI writes exactly 0** along its shoreline and where it has no
  sounding: 257 of the water nodes raster 182 covers first (the inner
  inlet's arms) read exactly 0 m, which isn't a depth. A source marked
  `zeroIsNoValueOnWater` (both NCEI rasters; 147 has no exact zeros here)
  has no value at a water node where it reads a raw 0, so the node falls
  through to the next source or the fill, and the source layer says
  `filled`, not a survey. On land a 0 is a height.
- The **filled** water (the inner inlet's head and arms, 0.69 km² in 10
  places) is a harmonic fill from the surveyed depths round it and the
  shore; its quality is `clamped` (made up: treat the depth as unknown).
  The land no source covers is `raised`.
- Which source each node took is kept, 4 bits a node, in the `layers` file
  doc and in `extras.terrain.source` (`{ encoding: "uint4-base64", names,
  counts, data }`), so a depth reader can tell NONNA from NCEI.
- The **canopy** is the lidar's first return (HRDEM DSM) less its bare earth,
  the largest over the 10 m pixels round each node, a byte a node at 0.25 m.
  Median 16.5 m on land, p90 30 m; 87% of the lidar's land is over 5 m.
- **The position check** runs on the land's first source alone (the merged
  heights take their side from OSM): off the shore band the lidar is above
  +1 m exactly where OSM says land at **99.70%** of 362,652 nodes; flipped
  north–south 33.2%, mirrored east–west 62.1%, shifted 200 m east 93.1%,
  200 m south 91.8% (each refused below 98%).
- `tiff.js` reads what these services send: big-endian (CHS), a
  ModelTransformation georeference (CHS), PixelIsPoint or PixelIsArea, and
  sparse tiles (NCEI sends a tile with no data as no bytes).

| What | Source | Licence |
|---|---|---|
| Depths | CHS NONNA-10 and NONNA-100, `nonna-geoserver.data.chs-shc.ca` WCS 2.0.1 GetCoverage in EPSG:4326 (the exact requests are the sources' `url`) | CHS NONNA licence: **non-navigational use only** (recorded, not filtered on) |
| Land heights, canopy | NRCan HRDEM mosaic DTM and DSM (lidar, BC-Vancouver_Island_Sunshine_Coast_2018-1m, 2019-10-01), `datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic` WCS 1.1.1 (BoundingBox lat,lon; GridOffsets −dlon,dlat) | OGL – Canada |
| Heights where neither has any | NOAA NCEI Barkley Sound 1″ (2016, raster 147) and British Columbia 3″ (raster 182), asked for in the local frame as Cadboro's is | US public domain; cite NCEI |
| Shore, docks, marks; buildings, land cover | OpenStreetMap via Overpass, two queries pinned to 2026-11-16T05:30:00Z | ODbL |
| Datum, tides | CHS IWLS, station 08595 | OGL – Canada |
| Wind, sky | ECCC climate-hourly 1030426 Amphitrite Point (Jul–Aug 1991–99, 13:00–18:00 PDT); DFO MEDS buoy C46206 | OGL – Canada |
| The boatyard | Bennett Land Surveying Ltd.'s as-built plan R4 (2026-03-12) in the District of Ucluelet's TUP 26-07 public notice; Rising Tide Boat Works' public one-pager (2026-08-23), deck (2026-09-04), website; Ha-Shilth-Sa's photo (2026-07-01) | credited; used for research |

The scene's credit: "Terrain: © OpenStreetMap contributors (ODbL) · CHS
NONNA · NRCan HRDEM · NOAA NCEI · ECCC · site: Bennett Land Surveying, Rising
Tide Boat Works · not for navigation". Every source, its exact request(s),
licence and how its numbers were derived is in the Terrain doc's
`data.sources`.

### The boatyard (`src/ucluelet.js` SITE, drawn by `src/site.js`)

1970 Harbour Crescent (Lot 5, Plan VIP20323), the former RCAF Station
Ucluelet seaplane base (No. 4 (BR) Squadron, 1940–44), now Rising Tide's.
Positions are the survey's, read as vectors from the PDF and georeferenced
from its GNSS base (MAG nail 11087); against imagery they fall within 1–2 m.
Everything is public. Each structure in the doc says its source, its
confidence and what is assumed; the GLB puts them on layers:

| Layer | What | Confidence |
|---|---|---|
| Buildings staying | **The hangar** (survey building A): 39.2 × 34.9 m, 1,369 m², floor +3.06, ridge +14.87, eave +13.66 about MWL (the survey's +4.20 / +16.01 conformed to the lidar: below); a 4° gable, its ridge north-west–south-east (157° true), trusses spanning the 34.8 m faces, white rake trim up both gables and fascia along the eaves; sliding doors across the north-west face to a 7.39 m door head, either side of a 3.1 m small door, a timber header band above, the roof 1.2 m over it; walls diagonal timber sheathing weathered cedar brown and red, doors green, part stripped; dark grey roof. Building B (the old cold storage, possibly their office), building D (silver), both corrugated with a dark trim under the roof (cladding and trim assumed) | footprint and heights high; eave ±0.5 m, doors and colours from the July 2026 photo |
| Buildings marked to be removed | C (the lean-to), E, F, G, H, I (white roof), J (rust roof), K, Q, **hidden by default** (the scene shows the plan; turn the layer on for March 2026) | footprints high; heights partly assumed |
| Existing wharf and pier | the 43.9 × 19.5 m pile wharf with its white corrugated shed, at yard level; the L-pier's north leg (OSM way 751431449); the Pat Leslie public launch | position high; deck heights assumed |
| Buildings staying: D | a galvanised Quonset hut (`site.js quonset`: a half-ellipse arch of 14 strips, ribbed every 0.6 m, flat ends, a door in its end to the shore), drawn so since the second look round from the Ha-Shilth-Sa photo (the survey's box) | footprint and crown height the survey's; form from the photo; door assumed |
| Buildings staying: a red Quonset | a red Quonset with a white end arch and door, 12 × 7 m, 4 m high, about 10 m south-west of lean-to C | the courtyard photograph only: position, size and orientation assumed; it may be gone |
| Buildings staying: the courtyard | pale wet concrete `#8a8a86` from the hangar's north-east face out 45 m, its joints every 6 m (`site.js slab`); the yard's apron the same concrete (was a dark asphalt grey) | the photographs; extent, level and joints assumed |
| Today's pier arm | the L-pier's 64 m east arm as OSM draws it, a fixed pier at yard level, **hidden by default**: the planned dock starts at the same corner and is taken to replace it. For today's harbour turn "planned" off and this and "removed" on. OSM doesn't tag it floating, so no boats are dressed along it | position medium (OSM); width and deck assumed; that the plan replaces it is assumed |
| Planned haul-out pier and dock | two concrete runways about 40 m long, 12.7 m apart, 2.4 m wide (a 10.3 m well for a 30 ft beam), Corten-look screens; a **110 t travel lift** straddling them; a 15 m gangway; the dock's arm, 3.6 m floats at +0.5 m with guide piles and a **solar canopy**, and **three DC fast chargers** | **low**: Rising Tide's schematic registered to the L-pier (position ±15 m, bearing ±5°, length ±10 m); the heights at the runways' heads are only −1.7 and −2.5 m about MWL (`headDepth`: dry, or 0.3 m, at the lowest normal tide; a 110 t lift's well wants 3 m or more), further evidence the position, or the 12 m-west fit, is unsettled; the travel lift's size and colour (blue), the gangway and the canopy's form are assumed |

OSM's buildings inside the lot's extent, and its L-pier, are left out (the
site draws them). Assumptions, in full, are in `src/ucluelet.js`; the
largest: NAD83(CSRS) taken as WGS84 (~1–1.5 m); the hangar's eave from the
photo; the pier from a non-scale schematic (a whole-site fit puts it 12 m
west, over the wharf's east half); whether the wharf stays is not public;
building B's fate is unresolved (shown as staying).

**The survey and the lidar disagree by 1.14 m** (`YARD` in
`src/ucluelet.js`). The survey's slab (AVG. SLAB EL 4.12, CGVD28; test pits
4.08–4.22) is +4.20 about MWL. The HRDEM lidar's bare earth at the hangar's
and building B's corners and middles is +2.96 to +3.24, mean +3.06; the
5 m and 1 m site tiles read within 0.05 m of the 10 m mosaic the place
uses. CGVD28 against CGVD2013 is only 0.20 m here, so the datums don't
explain it, and public data doesn't say which is right. Drawn on the
survey's level, the hangar stood on a metre-high plinth and the decks a
metre and more above their roots. The scene's ground is the lidar's, so
the site is **conformed to it**: every survey height drops 1.14 m, keeping
the survey's differences (door head 7.39 m, ridge 11.81 m above the
floor), and what is built at yard level (the wharf, the pier, the
haul-out's deck, the gangway's top) goes with it. `probes/fetch-ucluelet.mjs`
measures the ten lidar points again from the fetched raster and checks
the hangar's slab is within 0.3 m of the drawn ground (it is 0.03 m above
their mean).

**The door face** is given two ways in the spec: as 12.7 + 3.1 + 19.0 m
(the 3.1 m small door between two stretches) and as leaves across 0.8–34.0
m. It is drawn as eight leaves either side of the small door (0.8–12.7 and
15.8–34.0 m), which is both if the small door is a wicket in its own
panel; the hangar's `assumed` says so.

Two landmarks OSM has but can't shape are drawn from the doc too
(`landmarks`), each replacing OSM's footprint (and mark) of it: **Amphitrite
Point Lighthouse**, a squat white concrete tower battered from 4.4 to 3.8 m
over 5.6 m, a projecting gallery with a railing, a round red lantern with
its glazing and a red dome, on a black rock outcrop (proportions and rock
assumed); and the **Mount Ozzard radar dome**, the "golf ball", a white ball
16.8 m across (OSM's footprint) to OSM's height of 17 m.

The yard's ground inside the lot's box above the highest normal tide is
grey wet asphalt and gravel (`site.apron`: `#6d6c68` with darker wet
patches by node, a grass verge along the waterfront within 14 m of the
water, cobble in the intertidal below it; its edge is the shore cut's at
MHHW, crisp; the surface assumed, from the seaplane-base courtyard
photographs and imagery), with yard gear on its own layer (`boatyard.gear`,
dressing: rows of blue and white fish totes where imagery shows rows of
bins east of building J, a log pile by the gravel west of the hangar), and the place's shore is rock under the town's lots too
(`look.shoreRock`: the bare rock band above the lichen under any cover but
a beach, a dark bank 3–5 m up, not lawn to the waterline).

### Ucluelet's sky (`SKIES` in `src/ucluelet.js`; the weather package)

"Ukee grey": overcast but bright, as most summer afternoons are at
Amphitrite Point (ECCC, Jul–Aug 1991–96, 732 hours: cloudy or mostly cloudy
42%, fog 20%, clear 35%; visibility median 19 km). The place says what the
sky is, as the weather package's fields: a stratocumulus deck, cover 1,
600 m up, 19 km visibility. The weather says how that looks: sky `#c4cacc`
(top) / `#959ea1` (horizon) / `#7a8487`, fog `#959ea1` from 900 to 17,100 m
(Mount Ozzard, 5 km off, about a quarter veiled, so it reads as forest; the
Broken Group's islands and the Mackenzie Range, 13–20 km off, soft
grey-blue shapes), soft light, no shadows, the deck's cells ±12%. Those are
the colours this place was given (the fog's far was 17,000 m), now one of
the weather's anchors: its sky model meets them exactly at these
conditions. The gradient is an overcast's, the CIE standard overcast sky's
way round (brightest overhead, darker to the horizon), not a clear sky's:
the water reflects the horizon at a grazing angle, so with a bright horizon
the far water was a white band; now it is pewter, and the far hills fade
into the same grey.

The sun is the weather's too, computed for the place and the moment
(15:00 on 15 July, UTC−7): azimuth 221.7°, 57.0° up, within 0.41° of the
direction once set by hand for that moment. `SKIES` also has "marine layer"
(stratus, 1 km visibility: fog from 30 to 900 m) and "clear afternoon" (no
cloud, 20 km); the template's `sky` option picks one (`layOut(ctx, url,
{ sky })`), or set the weather's fields in the inspector.

The place's object carries `terrain.place`, which gives no sky: the world's
sky is its weather's, a scene trait, so a place linked into another world
takes that world's weather (the outermost doc's ambients are the world's).

## The look (`src/look-osm.js`, `cover.js`, `palette.js`, `forest.js`, `buildings.js`)

The same machinery for every place with a `look` (Ucluelet and Cadboro Bay):

- **Land cover** from a second Overpass query (buildings, land use, natural
  areas, …), kept in its own file doc: wood, scrub, residential, yard
  (industrial, commercial, quarry…), grass, wetland, beach, bare rock, lakes,
  painted on the grid largest first.
- **No legend**: a ground coloured by what covers it isn't "ground by
  height", so a place with a look carries no `extras.legend` (the scene's
  colour bar was saying so falsely); a place without one keeps it.
- **The water's own colour**: each place's Sea carries it on its `water`
  trait (`colour: { deep, scatter }`, water/WATER.md): Cadboro Bay's the
  Salish Sea's grey-green (`template.js BAY_WATER`), Ucluelet's inlet a
  darker grey-green (`WATER_COLOUR`), and under an overcast a crest
  scatters a third of the light, so the water holds the shore's darkness.
- **The ground's colour** by height, cover and the tide: the intertidal and
  splash bands from the place's own tide levels (kelp below MLLW, mussel,
  rockweed, barnacle to MHHW, black lichen to HHWLT + 1.1 m, bare rock), a
  darker, greener sea floor with depth, lawns, yards, bog, beach (Cadboro's
  sand, Ucluelet's cobble), forest floor. Art direction, `COLOURS`; a place
  overrides any in `look.colours` (Ucluelet's are darker throughout: black
  rock and dark forest, the town's lots among trees, the yard grey gravel).
- **The shore's bands, crisp** (`shore.js`): per-vertex colour smears a
  band a metre or two high across a whole 20 m cell, and a rocky shore
  reads as a tan mudflat. So every ground triangle that spans a band's
  edge (rockweed's top, MHHW, the lichen's, the bare rock's) is cut along
  the level its height crosses it at, and at the shore each piece is its
  band's one colour (the wet ones, rockweed and below, 25% darker); the
  ground doesn't move. A point on an edge is made from the edge's two
  nodes, lower id first, and the level, so both triangles on the edge make
  it to the bit, and every triangle that spans a level is cut, at the shore
  or not, so no edge is cut on one side and whole on the other (away from
  the shore a piece keeps the triangle's colours exactly). Ucluelet: 29,326
  triangles cut, 134,638 vertices more (about 4.5 MB). What it can't fix:
  `burn.js` holds the shore band (the first ~28 m of land) on a 1-in-20
  slope, so the first node inland sits at about +1 m and a rocky point like
  Amphitrite has a 20 m shelf at the waterline, now drawn as banded rock
  rather than mud. Steepening the band where the land behind it is high
  would move the drawn shoreline off OSM's (the band is symmetric about it)
  and change the depths sailing reads there: not done here.
- **The forest**: the canopy (the lidar's where measured; else an assumed
  height in OSM's woods: `look.trees.assumed`, 18 m ±20%), and none where
  something is built: the lidar's surface less its terrain is a roof's
  height as much as a tree's (in Ucluelet 248 of 450 OSM buildings had over
  5 m of "canopy" at their middle, 27 under the forest roof, and 232 of the
  trees stood on footprints; now none, and no building's middle is forest
  or roof, on the real data). `builtMask`
  marks every node on an OSM footprint, the site's lot box or a site
  structure, or within a tree's reach of one (0.45·√2 of a cell, as far as
  a trunk is jittered from its node), so no tree stands on a footprint and
  the roof (which needs a node and its eight neighbours forest) stays two
  nodes clear of anything built. Then a forest *roof*
  (an RTIN over the ground plus the smoothed canopy, where a node and its
  eight neighbours are forest at least 20 m from the water), and
  **instanced trees** in front of it: on the 40 m fringe at the water, along
  the roof's edges, on residential lots (`townPerHectare`: three or four a
  node where none is built at Ucluelet's 80, so the town peeks out of the
  trees; its mix conifers, alder rare). Where a place's trees have `stands` (Ucluelet's
  4 to 6), a fringe node gets one stand of that many crowns by its hash,
  in place of a tree or two: the tallest in the middle, the rest round it
  0.16 of its height out and shorter, crowns overlapping, trunks to 0.2
  below the foot (a mesh a species and size, instanced like the trees), so
  the forest stands tight at the top of the rock. A place may darken the
  roof (`roofColours`) and roughen it (`roofJitter`: each roof node up or
  down by its own hash, Ucluelet ±3 m) so the hills read as ragged
  conifers, not turf. Species by the place's
  mixes (assumptions: Ucluelet's on the Coastal Western Hemlock zone, spruce,
  hemlock, cedar, shore pine, alder; Cadboro's on the Coastal Douglas-fir
  zone, fir, Garry oak, arbutus, cedar), heights the canopy's ±15%, all by
  hash of the node's index: local, so tile by tile is the whole (tested).
  Each species is one mesh; the trees are nodes sharing it, which the scene
  draws as one InstancedMesh a species. Capped (`max`, Ucluelet's 55,000)
  by each tree's own key.
- **The forest's skin** (`trees.skin`, `skinAt`): from the water the roof
  alone is a smooth dark hill, its ridgelines curves. Within the place's
  circles (Ucluelet's: the harbour and the inlet to Hitacu, 2.3 km; the
  Wild Pacific Trail's coast and Amphitrite, 2 km) every roof node gets a
  clump of 3 or 4 crowns (12 triangles each: a wide six-sided cone and a
  narrow one over it, no caps) laid out in its cell by one of three
  layouts, their tops its canopy ±8%, turned by hash, so ridgelines and
  shores are serrated; the roof stays under them, the dark underlayer.
  A clump is one instance of one of six meshes (14,410 at Ucluelet, about
  3.3 MB). Every choice is the node's: local, tested tile by tile.
  Where the skin covers **all** the forest (`trees.skin.all`, Ucluelet's):
  every other forest node in the circles gets a clump of *low* crowns too
  (`SKIN_PROFILES.low`: whole conifers down to a metre over the ground, 7 m
  across, sunk 1.5 m into a slope), where the second growth among the lots
  and behind the basins is too patchy for a roof (the lidar says over 5 m
  on 70% of the hill south of the basins, 43% of the town's peninsula, 70%
  of Amphitrite's headland; the roof covered a third of that); a node at
  the water keeps its stand instead (a node is a stand's or a clump's,
  never both, never neither: `clumpOf`, checked at every node in the tests
  and on the real data by `probes/fetch-ucluelet.mjs`); and where the
  canopy is 3 to 5 m on wild ground or a lot (`skin.scrub`), squat shore
  pine and salal clumps. Under the skin the roof sits at 0.72 of the canopy
  (`skin.roofDepth`; Ucluelet's 0.6 since the second look round), so the crowns stand out of it as cones, and the
  ground in the trees' shade (canopy over 5 m) is nearly black
  (`look.colours.forestShade`), not lawn between the crowns. Ucluelet:
  14,103 roof, 4,815 low and 1,697 scrub clumps (20,615 in all; the roof's
  clumps on a stand's node, 307 of them, went: the stand is its crowns).
- **The canopy closed from above** (the second look round): from a raised
  eye the clumps were separate cones on lighter ground, a Christmas-tree
  lot. A clump is now turned only by quarter turns and never shrunk (width
  1 to 1.12), its crowns spread to ±0.3 of a cell so neighbours interlock,
  and wide enough that at least 90% of every 20 m cell is under some
  crown's foot whatever layouts and turns stand round it (tested by
  enumeration over every layout, turn and neighbourhood of one layout):
  a roof clump is four crowns 6.5 m across in near-square layouts, a low
  clump three or four 8.5 m across, a scrub clump four squat bushes 6 m
  across. The crowns are darker and bluer (`#16241c` to `#2a3a2c`), each
  ±12% in value by hash, the roof under them as dark. Two silhouettes of
  this coast stand out of it, keyed by the layout a node's hash picks
  (`LAYOUT_WEIGHTS`): about one crown in ten a lighter Sitka spruce
  (`#36463a`, 15% taller) and about one in thirty a dead snag, a grey
  spike 3–6 m over the canopy. Where the lidar's canopy is 1 to 5 m
  (Ucluelet's `skin.scrub.min: 1`), the scrub's clumps stand on the
  scrub's sheet, which is darker (`#232b20`), barely bumped (±0.6 m),
  finer inside the skin's circles (RTIN tolerance 0.3, `trees.scrub.fine`)
  and, like the roof, mottled ±15% a vertex (`MOTTLE`, Cadboro's roof too),
  so no facet is one flat tone.
- **The detail falls off with distance** (`trees.bands`, metres beyond
  the skin's circles, `beyondCircles`): stands at the water only inside
  them (`stands: 0`), the roof's edge trees to 2 km beyond, the fringe's
  single trees to 5 km, then the roof alone (the far hills are grey shapes
  in the fog). Ucluelet's trees went from 55,000 (capped from 111,269, the
  cap dropping the harbour's own edge trees first) to 27,520, none capped.
- **Instances by tile** (`tileInstances`, `trees.tiles`): the scene draws
  the nodes sharing a mesh as one InstancedMesh, culled by its bounds; one
  mesh a species over 20 km was never culled (9.2 M triangles in every
  view). Each kind's mesh is written again for every tile its nodes fall
  in (1 km inside the circles, 4 km beyond; glb.js `sameAs`: new accessors
  on the same bytes, so three's loader makes each a geometry of its own),
  so a tile out of view isn't drawn. The nodes are the same nodes (tested:
  the union of the tiles is the whole); about 600 meshes, 270–480 draw
  calls a view.
- **Low scrub** (`trees.scrub`, `scrubCover`): where the lidar's canopy is
  0.8 to 5 m on wild land (Amphitrite's headland, Ozzard's upper slopes),
  salal and shore pine, not turf: a bumpy sheet over the ground at its
  canopy's height (at least 1 m), ±1.5 m by hash, in salal greens, through
  the same RTIN as the roof (18,843 nodes at Ucluelet).
- **Buildings**: OSM's footprints extruded, gables over near-rectangles
  (ridge along the long side), flat roofs otherwise; heights and pitches by
  kind and cover (houses 5.5 m to the eave, 32°; hotels 9.5 m; industrial
  8.5 m, 8°: assumptions, as OSM rarely says); colours from the West Coast
  palette by a hash of the OSM id (not checked house by house). OSM maps
  about half of Ucluelet's buildings. A place's `look.buildings` may give
  its own walls (Ucluelet's muted siding: weathered cedar, grey-green, barn
  red, slate blue, white), facade `details` (`facade`: white corner boards
  and an eave band on every wall, a row of dark windows a storey; an
  industrial building's walls ribbed instead) and `decks`: a building whose
  ground reaches the water stands on a pile deck above the highest tide
  (`pileDeck`: a slab with a dark edge, black piles every 4 m where the
  ground is under it), an industrial one there in cream corrugated cladding
  (a fish plant). Ucluelet: 36 buildings on decks.
  A place may draw some of OSM's buildings as it knows them
  (`look.buildings.overrides`, by OSM id: walls, roof, storeys, a stone
  base, trim, and a `form`): Ucluelet's two waterfront landmarks, from
  photographs (assumed): Whiskey Landing Lodge (way/360389716) three
  storeys of timber brown `#6b4a2e` on a grey stone base, a red metal roof
  `#c0432c` with four cross-gables to the water (`crossGables`, the side
  whose ground is lower) and white trim; the Ucluelet Aquarium
  (way/334446398) navy `#2d3f66` under a curved metal roof (`barrel`). And
  a place may dress one of OSM's structures (`look.structures`, by id):
  the Whiskey Dock's red railings over a yellow curb (`structures.js
  railing`).

The small solids carry no normals (a glTF loader draws them flat-shaded,
which they are), and the buildings are a primitive a colour: Ucluelet's GLB
is about 38.7 MB (37.6 MB before the dense forest, its tiles, the shore's dressing and the buildings' details; 32.9 MB before the skin, the scrub and 55,000 trees; 23.5
MB before the shore's cut, the stands, the surf and the cloud), Cadboro Bay's was 15.3 MB before the shore's cut
(not measured since; it was 7.8 MB before its 5,910 buildings, most of the
rest).

- **Surf** (`surf.js`, where a place has a `swell` and `look.surf`):
  dressing, from the place's shape (the source reads the swell's `from`
  and nothing else of it, so its fingerprint follows the direction). OSM's coastline cut into pieces a cell
  long, each with its sea side (where the grid is water a cell out) and its
  exposure: the share of 9 rays fanned ±75° about the swell's direction
  (285°, Ucluelet's assumed; wide, as a swell bends round a headland) that
  get 3 km over open water (a closed ring's closing side included). Where
  it is at least 0.35, a ribbon of foam along the shore, continuous along
  each run of exposed pieces (each knows its neighbours; both pieces at a
  shared end agree on its width and direction, `endOf`), 2 to 12 m wide by
  the exposure and a hash of the point, tapering to nothing at a run's
  ends, white to under half its width and fading to the sea in two steps;
  a sheet of spray along it (white at the water, greying by 0.4 to 2 m up:
  a flat band is a hairline from a boat), and broken lace further out where
  it is open. Unlit and opaque, `#e4ebe8` to the sea's grey-green `#5f6e6e`
  (drawn blended, at the water's surface, it didn't show in the stage).
  Where the place asks (`surf.reef`, `surf.boulders`): irregular patches of
  white water over the shallows under 2.5 m where the swell gets in (a fan
  of seven triangles a node, its rim 3–8 m by hash, never more than 0.7 of
  the way to white, fading to the water's grey `#64737c`), and boulders at
  the most exposed waterline (dressing, assumed; Ucluelet's grey stones, 7- or 9-sided, in three sizes). Ucluelet: 1,934 of 14,696
  pieces in 289 runs (Amphitrite, the Wild Pacific Trail shore, the outer
  islets), 608 reef patches, 203 boulders.
- **Drift logs and the harbour's boulders** (`shore-dressing.js`, where a
  place's look has `shore`): dressing. Along the coastline's pieces inside
  the place's circles, a piece by its own hash gets a silver-grey log or two
  (8 to 20 m, 0.5 to 1 m across) lying roughly along the shore where the
  ground first reaches the highest tide (HHWLT) walking inland; and the
  surf's boulders along the sheltered waterline too, at a lower chance;
  where the place names a frontage (`shore.frontage`, Ucluelet's yard
  from the launch to the wharf), three to five stones on every piece of
  it. A place may give the logs' width, colour, how deep they lie
  (`bury`: Ucluelet's a third buried in the cobble, 0.8–1.2 m across, silver
  `#a8a49a`) and their darker ends (`cap`), and the stones' sides (7 or 9),
  sizes and greys (`#4d4b47`, `#5a5752`), squashed. On their own layer.
- **Grain at the eye** (`grain.js`): the ground is coloured at its nodes,
  so close up the yard and the intertidal were flat planes. Each ground
  vertex carries its grain (`_GRAIN`, `build.js groundGrain`: the shore's
  cobble and rock, bare rock 1, beach 0.8, other land 0.6, the site's apron
  0.5, under the water 0), and the place's extension (`place.js`) dresses
  the ground's materials: two octaves of world-space luminance noise, ±12%
  at 1.5 m and ±18% at 8 m (at ±8% and ±12% it didn't show), by the grain, fading out from 150 to 300 m,
  and a fine one underfoot, ±12% at 0.35 m, fading out from 25 to 60 m.
  The grain scales all the light the ground sends back (`outgoingLight`,
  its sheen as well as its colour): from a standing eye the ground is seen
  at a grazing angle, where the overcast's sheen on a dark ground is as
  bright as its colour, and grain on the colour alone washed out. The noise's
  hash is sine-free (Hoskins' hash12 shape on the cell wrapped to 256), and
  `grainHash` mirrors it in 32-bit floats: a sine of a dot product in the
  tens of thousands, the hash before, is only as precise as the GPU's sin,
  and on a laptop's it came out correlated along lines.
  Both places; the materials are put back when the extension stops.
- **The shore in the water** (`horizon.js`; water/WATER.md, "The shore in
  the water"): extras.terrain carries the canopy too (`canopy`: the most
  in each cell of 32 m or more, whole metres; the sampler's `surfaceAt`),
  and the place's extension (`place.js`) gives the water the shore's shape
  round the eye (the contribution `water.shore`): for 256 azimuths and 16
  distance bins (15 m to 9 km), the highest the land and its trees stand
  above the horizontal of the mirror eye (as far under the water as the eye
  is over it) at that distance or beyond, how far off, how far off the
  nearest land is and how high the near shore stands; made again when
  the eye moves 25 m or its height by a fifth. The water draws the shore's
  tint (its body's `colour.shore`: Ucluelet `#1a231d`, Cadboro `#26302a`)
  where its reflected ray is under it, fogged to the land's distance: the
  dark band under every shore in a calm overcast.
- **Low cloud and mist** (`cloud.js`, where a place's look has `clouds`):
  weather dressing. Stratus banks at about 380 m wherever the ground at
  every 14th node is near that level (the cloud base meeting a slope:
  Mount Ozzard, the Mackenzie Range's flanks), by hash; thin mist over the
  canopy in the forest's hollows; and a cap round each summit the place
  names (`clouds.caps`: a collar under Ozzard's radome). A bank is a lens,
  not a flat sheet (a flat sheet seen from the water, a few degrees under
  it, was a pale stripe across the hill like a contour line): its top domed
  over its base, its underside sagging under it, its rim ragged (a smoothed
  hash a sector, 0.6–1 of its half-size), its alpha falling to nothing at
  the rim and wherever the ground is close under it, so it thins into a
  hillside rather than cutting it. The sky's "marine layer" doesn't thicken them (they are in
  the GLB, the sky in the world's weather): a follow-up. Where a place asks
  (`clouds.bake`, Ucluelet's), the stratus is baked into colours instead
  (`bakeStratus`): above 250 m the ground's, the roof's and the scrub's
  vertices lerp toward the fog's colour by (h − 250) / 300 (at most 0.85),
  ± 30% by a hash of where each vertex is, so the hilltops dissolve into
  the overcast in ragged patches. With a `peak` the bake is a band, not a
  cap (`stratusAt`): Ucluelet's rises from 280 m to its thickest (0.7) at
  420 m and eases back to 0.45 over the next 200 m, so the tops' dark forest
  and the radome show in and out of it; its colour is the grey the horizon
  reads as once lit (`#737b7e`, under the horizon's `#959ea1`: lit, the
  horizon's own colour came out brighter than the sky, as snow), and no
  baked colour is lighter than the horizon (tested every 20 m to 800 m).
  Ucluelet keeps no banks, mist or caps (`caps: []`): seen from the town
  the lenses were pale saucers over it. Its GLB has no cloud mesh.
- **Boats about the harbour** (`look.boats`): a few placed by hand, each
  an assumption in at least 10 m of water: a troller outbound, a
  whale-watching boat past Lyche Island, a water taxi coming in, a seiner
  at anchor. Not the *Canadian Princess*: she was towed out of Ucluelet
  in 2016 (CBC, Times Colonist).
- **Boats on the floats** (`boats.js`): dressing, not data. Nobody maps
  which boat is in which slip, so each float's slips (one every 12 m a side,
  about five in six taken) get a troller (its two trolling poles 1.5 times
  her length, raised in a V), a small seiner or crabber, an aluminium
  sportfisher or a sailboat (a mast 1.3 times her length, a boom, on some
  a blue cover) by hash of the float's id and the slip, the same every
  build; every hull rises to its bow. A working boat (troller, seiner) is
  painted as the West Coast fleet is (`paintOf`; the second look round):
  about 60% of hulls navy, dark green, red, black or light blue, the rest
  white; the wheelhouse and its top white or pale grey, never the trim
  colour; red bottom paint under a white boot stripe; two to four orange
  buoys over the rail. A seiner has a short mast and boom; poles, masts
  and booms are 0.14 m across, to hold at 150 m. A place may fill some
  floats fuller (`look.moored`: Ucluelet's Inner Basin, 19 slips in 20).
  Their layer says they are dressing. Every float stands among tall black
  guide piles (`structures.js floatPiles`: every 15 m, alternating sides,
  5 to 7 m above mean water).
- **The third look round** (Ucluelet; the general parts Cadboro's too):
  - *Glassy water* (water/WATER.md, "The shore in the water"): the shore's
    and the sky's reflection taken off a calmed normal, its edge as soft as
    a pixel's footprint, a tree's tip in each degree of its top edge.
  - *Crowns that aren't cones* (`forest.js CROWN_SHAPES`): the skin's
    crowns are western red cedar (three stacked, ragged frusta, the leader
    bent over), western hemlock (narrow tiers, the tip drooping) and Sitka
    spruce (four flat tiers), 18 to 24 triangles, each shaded from 0.55 of
    its colour at its foot to its full colour at its tip (the trees' too),
    so the gaps between crowns read as shadow; every clump stretched 1 to
    1.15 on x and z on its own and leaning up to 6°; a stand at the water
    leaning 8 to 12° toward it (down the distance's slope). The canopy
    still closes over 90% of every cell (tested over every layout).
  - *Dark ground between crowns* (`look.shade`, `palette.js groundRGB`):
    the forest floor's shade wherever the canopy is over 2 m and on every
    node a town tree stands on (`forest.js townTreeAt`); a lot without
    trees lawn and garden, mottled ±12%, a third of its nodes dark shrub
    (`colours.lawnPatch`); the barnacles' band, the rock and the scrub
    darker.
  - *Stratus as wisps* (`cloud.js WISPS`, `stratusFactor`): the band torn
    by a coarse 3-D value noise (350 and 120 m cells, three times finer in
    height, so a wisp lies along a slope's contour), about 40% of it the
    band's whole factor and the rest a quarter of it at most; and mist low
    on the hills (from 60 m, at most 0.35) only in three named circles.
  - *Fish plants over the water* (`buildings.js deckOf`): a building on a
    pile deck is a fish plant (cream ribs, no window grid, one or two blue
    or yellow roller doors to its deck, a low metal roof) unless the place
    draws it itself; its deck reaches seaward (2 m steps, up to 50 m) until
    the water under every pile of its outer row is half a metre under the
    lower low water, piles in rows from edge to edge, a black tyre fender on
    every third outer pile; the ground under it and 10 m round wet and
    black, a rockweed band at mid-tide.
  - *Every pier lined* (`boats.js PIER_MOORING`, `look.moorPiers`,
    `look.moorMix`): boats alongside every fixed pier in the harbour (an
    area pier's outline too, outside it), six slips in ten, never two empty
    deep slips running, each only where the water under her ends and her
    middle is 2 m deep at mean water (the 20 m grid smooths a dredged
    berth: at chart datum nearly every pier would be bare); whale-watching
    boats and water taxis, grey aluminium, round the Whiskey Dock; decks
    weathered grey, black creosote piles every 15 m on piers as on floats,
    the breakwaters dark rubble.
  - *Surf in bursts* (`surf.js BURSTS`, `look.surf.bursts`): each end of a
    run white or a lull by a Weyl sequence along its chain (36 to 52% white
    by its exposure, never more than two running), a lull's foam a quarter
    of its width or less in grey-white, domes of spray over the exposed
    white ends; stones stretched 0.6 to 1.4 on each axis (`stretch`).
  - *A textured overcast* (scene CONVENTIONS.md's atmosphere `clouds`): Ukee
    grey a stratocumulus deck 600 m up (cover 1, ±12%); sailing's bright
    day fair-weather cumulus over a third of its sky, which Cadboro shows.
    (Both are the weather package's now: the places' weathers name the
    deck, cover and base, and the weather draws them.)

  The fourth look critic's round:

  - *The far hills as forest* (`forest.js farRoof`, `FAR_ROOF`,
    `look.trees.far`): outside the skin's circles the roof is patched by a
    two-octave value noise (300 and 90 m) from `#121d16` to `#2b3828`, cut
    by lighter second growth (`#47513a`, blocks 150–300 m in about one cell
    in eight of a 250 m lattice, on slopes over 12° under 600 m), and every
    crest node (a summit, or a ridge across one of four axes by 1.5 m each
    side: `crestAt`) lifted 4–9 m by hash, so Ozzard's and the range's
    skylines are toothed. The stratus over them thinner (at most 0.6, 0.15
    above the band). Tested on a made-up mountain at every node.
  - *Shelter* (`exposure.js`, water's WATER.md "Shelter"): the place's part
    (`place.js`) gives the water `exposure(from)`: a 256² grid over the place,
    each water cell's fetch upwind (five rays, ±30°, cos² weighted, a cell a
    step, off the grid open sea) over 6 km; the water's shader scales its
    shading normal's tilt by it (a quarter in the most sheltered water) and
    calms the reflection under 0.5. The harbour reads glassier, the open
    coast keeps its chop; the waves and what floats on them are untouched.
    Cadboro Bay gets it too: its terrain carries the place's trait (then
    `terrain.sky` with no sky of its own, now `terrain.place`), which also
    gives it the shore in the water and the ground's grain.
  - *Boats that read from above* (`boats.js DECKS`): working decks
    green-grey or tan (30%) inside a 0.7 m bulwark, freeboard 1.3 m
    (trollers) and 1.6 m (seiners), every gunwale capped white; sailboats a
    pale deck and a dark cockpit; floats wet timber `#5e5a53` with a pale
    bull rail; boats 0.7 m off a float and, by `structureRings`, never over
    another float, pier or wall (0.3 m clear).
  - *Salal and a ragged canopy* (`forest.js BUSH`, `EMERGENT`,
    `SKIN_LAYOUTS`): the scrub's bush a squat seven-sided dome, 1–3 m tall,
    greener and darker; each layout's crowns span 0.3 of the clump's height
    or more, one crown in seven an emergent (×1.36–1.45, radius ×1.1, its
    foot no higher than the others', a cedar's top flattened with two
    leaders).
  - *West Coast houses* (`buildings.js HOUSE`, `palette.houseWalls`,
    `houseRoofs`): a house (tagged, or untagged and under 220 m²) is its
    oriented rectangle under a 25–35° gable with a 0.5 m overhang, at most
    two storeys, two windows a wall a storey, a deck on the downhill side on
    40%; walls weathered cedar, grey-green, slate blue, white, pale yellow,
    barn red on 8%; metal or asphalt roofs.
  - *A rockweed foreshore* (`palette.js withBands`, `look.bands`): wet black
    under mean water, olive rockweed to half a metre under MHHW, a thin pale
    barnacle band over it; black rock (`#1f1f1e`) on the coast open to the
    swell round Amphitrite (`build.js blackRockMask`, `look.blackRock`).
  - *A worked yard* (`grain.js PUDDLES`, `site.js wetPanels`, `slabCurb`):
    the apron takes the full grain and puddles (about 18%, 35% darker, 2–4 m
    across: `cells` 4 and 1.75 m, so a few metres of yard have some); the
    courtyard slab's seams dark enough to hold at 60 m, a fifth of its
    panels wet, a 0.2 m curb; drift logs grey and half sunk.

## Layers

The GLB declares layers (scene README, "GLB conventions"): **Forest**,
**Buildings**, **Docks, floats and breakwaters**, **Lights, buoys and
beacons**, **Landmarks**, **Moored boats (dressing)**, **Surf**, **Low
cloud and mist**, **Drift logs and boulders**, and a place's own
(Ucluelet's boatyard and its six sub-layers, the removed buildings and today's pier arm hidden by default:
the scene shows the plan). The ground is on none.

## The frame

Every GLB and doc here is in one **local frame** per Terrain doc
(`src/tmerc.js`): transverse Mercator on WGS84 about the doc's `origin`,
scale 1, so **x east, y up, z south, in metres**, grid north true north
along x = 0, and a bearing from −Z toward +X a compass bearing (sailing's
wind `from`). **y = 0 is mean water level** (MWL) at the CHS gauge named
in `datum` (Cadboro Bay: Finnerty Cove, 07140; MWL is 1.99 m above chart
datum). The tide's levels about MWL are in `datum.tide` (HHWLT +1.20,
MHHW +0.84, MLLW −1.22, LLWLT −2.14).

The grid is node-registered: node (i, j) is at (x0 + i·cell, z0 + j·cell),
row j = 0 the north edge.

## The data, and where it comes from

Fetched once, by the tool's **Fetch data** or the template, into two
immutable file docs the Terrain doc points at (`data.dem`, `data.features`),
each with its SHA-256. `build()` reads only those, checks their hashes,
and never touches the network, so a build is a pure function of the docs:
two peers make the same bytes, and it works offline.

| What | Source | Licence |
|---|---|---|
| Heights, land and sea | NOAA NCEI, *Port Townsend, WA 1/3 arc-second NAVD88 Coastal DEM* (2011), raster 171 of `gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer`, asked for directly in the local frame and grid (bilinear); the exact request is the source's `url` | US public domain; cite NCEI |
| Shoreline, docks, breakwaters, marks | OpenStreetMap via `overpass-api.de` (POST; the query, with its `[date:…]`, is the source's `query`) | ODbL: © OpenStreetMap contributors; share-alike applies to a published derivative |
| Vertical datum, tides | CHS water level stations 07140, 07130: `api-iwls.dfo-mpo.gc.ca/api/v1/stations/{id}/metadata` and `/height-types` (the source's `requests` and `derivation`) | OGL – Canada |
| Typical wind | ECCC climate-hourly, station 1012475 Discovery Island, Jul–Aug 2019–2025, 13:00–18:00 PDT: seven `api.weather.gc.ca/collections/climate-hourly/items` requests (the source's `requests`) and the filter that reduces them (its `derivation`) | OGL – Canada |

**Accuracy, as NCEI states it** (the DEM's metadata, also the source's
`accuracy`): vertically, the Canadian land is CDED, **5 to 10 m: coarse**;
bathymetry "30 meters to 5% of water depth", CHS and NGDC multibeam about
0.1 m, early soundings sparse; horizontally CDED 8 m, bathymetry a few tens
to several hundreds of metres, CHS multibeam about 5 m. In Cadboro Bay the
bathymetry agrees with CHS's NONNA-10: over 606 cells the difference has a
median of −0.29 m and 10th/90th percentiles of about ±1 m; at the mooring
field 8.04 m here, 8.57 m in NONNA.

**Credit travels with the work**: the GLB's `asset.copyright` is the full
attribution, `extras.terrain` has it and a short `credit`, the scene shows
the credit (`terrain.credit`), and the two data file docs carry their own
licence and attribution (the OSM features file is a derivative database:
`licence: "ODbL-1.0"`, with the notice).

The DEM is NAVD88; heights above MWL are the DEM's **less 0.68 m**
(`demToMWL`): over 207,000 water cells of the grid, CHS's NONNA-10
converted to CGVD2013 minus NCEI has a median of −0.57 m, and MWL is
0.11 m above CGVD2013 at Finnerty Cove. That is a comparison of two
surveys (good to a few decimetres), not a geodetic transformation.

CHS's NONNA-10 bathymetry is better in the bay but isn't used: its licence
forbids passing the data to third parties, which caching it in a shared doc
would. The 1 m NRCan lidar (HRDEM) would sharpen the land; it isn't used
yet.

Not for navigation.

(Cadboro Bay's look: its buildings and land cover are a second Overpass
query pinned to the same moment, checked on 2026-11-15; no lidar is fetched
there, so its trees stand in OSM's woods at an assumed canopy.)

### How Fetch data runs (`src/fetch-task.js`)

Fetch data is a task: `src/fetch-task.js`, whose input is the Terrain doc's
url and what the doc asks for (`fetchRequest` in `src/fetch-spec.js`: the
place, the grid, the datum, OSM's date, a layered place's heights and look).
The tool asks for it with the task kit's `doWork` (`src/task-client.js` and
`src/task-rules.js`, copies of the tasks package's), under a key made of the
doc's url and the SHA-256 of that same spec, so a task fetches exactly what
its key names. So:

- When one of the person's machines serves their own queue, the fetch runs
  there: closing the page does not stop it, and two pages pressing Fetch for
  the same place and grid are one fetch. The tool says so, and follows the
  doc's key with the kit's `watchWork` from the moment it opens (also when
  the person makes their queue while it is open), showing a fetch already
  under way instead of offering another; Cancel stops it with `stopWork`.
  Otherwise it runs in the page, and the tool says that closing the page
  stops it; a fetch done in another page is not seen from this one.
- It stores only if the doc still asks for what it was asked for, looked at
  when it starts and again in the change that stores: a frame moved
  meanwhile stores nothing, and the log says so. A changed frame is a new
  key, so a new fetch.
- What it stores is one value on the doc, `data`: the files' records, the
  sources, the credits and the hash of what was fetched (the hash its key is
  made of). Two stores at once on two machines keep one of them whole. The
  data fits the doc while that hash is the hash of what the doc asks for now
  (`dataFits`), so data stored by a machine that had not heard the frame
  move reads as stale, and the tool says to fetch again.
- Cancel stops it wherever it runs; requests are given up and Overpass's
  retries are not waited out.
- It returns the file docs' urls and a line, never the data.

The build puts the task at `dist/fetch-task.js` (a second entry in
`vite.config.js`, a name that does not change from build to build); the
unbuilt package's is `src/fetch-task.js`. The templates fetch at creation
in the page, with `fetchTerrainData` and `storeTerrainData`.

## How the ground is made (`src/build.js`)

```
coast (OSM) ──classify──▶ land or water at every node ─┐
DEM (NCEI) ──to MWL─────────────────────────────────────┴─burn──▶ heights (int16, 2 cm)
heights ──RTIN, tolerance by height──▶ the ground mesh, checked at every node
```

- **Land or water** (`src/coast.js`): OSM's coastline ways are joined end to
  end by node id into rings and chains (land on their left). Nodes within
  one cell·√2 of the coast take the side of their nearest point on it (a
  segment's side, or at a vertex the wedge rule); the rest, by 4-connected
  region, take the label of the band around them. Why that's right, and
  what is checked rather than assumed (no region bordered by both, no open
  end of the coastline near the grid), is in the file's header.
- **The shore** (`src/burn.js`): within the band a node's height is 0.05 ×
  its signed distance from the shore (1 in 20), so the mesh crosses y = 0
  on the OSM line, not the DEM's 0 m contour (which wanders a cell or more:
  14% of OSM coastline nodes are below 0 in the DEM). Beyond it, the DEM,
  held to its side of the water: land at least the **land floor**, 0.3 m
  above the highest normal tide (+1.5 m), since OSM's coastline is the
  high-water line; water at least 0.57 m deep. Land ⇒ height ≥ +2 cm and
  water ⇒ ≤ −2 cm at every node.
- **Islets**: a closed coastline ring whose highest node is below the land
  floor (every node of it is in the band) has its nodes raised to the DEM
  there, held to +1.5…+6 m; its shore then crosses y = 0 within the cell
  edge OSM's line crosses rather than on it. A ring with no node is a rock:
  a prism in the mesh and an outline in `extras.terrain.rocks`. Checked:
  every ring with a node inside reaches the land floor.
- **Every node says what its height is made from** (`quality`): `dem`, `shore`
  (the band), `raised` (land held to the floor, islets), `clamped` (water
  the DEM puts shallower than the floor, or on land: made up).
- **The DEM's position is checked against OSM** (`shape()`): OSM sets every
  node's side, so nothing else would notice heights that are flipped,
  mirrored or shifted. Off the band, the share of nodes where the raw DEM is
  on OSM's side of the water must be at least 98%, or the data is refused.
  Cadboro Bay: 99.09%; the same DEM flipped north–south 78.3%, mirrored
  east–west 59.5%, shifted 200 m east 94.3%, 200 m south 95.0%.
- **The mesh** (`src/rtin.js`): a right-triangulated irregular network as
  Martini makes one, but whose error is every node's deviation from its
  triangle (not only the hypotenuse midpoints'), divided by that node's
  tolerance: 0.25 m at the shore, up to 1.5 m on land, a tenth of the depth
  (up to 6 m) in deep water, and never more than half the node's height, so
  nothing crosses the waterline. `checkMesh` then checks every one of the
  1,050,625 nodes, with its sign, on every build. Cadboro Bay: ~140,000
  triangles (its ground alone 7.8 MB of GLB, 2.8 MB of it the
  heightfield, 0.35 MB the nodes' quality; with the look, 15.3 MB);
  Ucluelet's ground, at 20 m over hills to 770 m, ~430,000 triangles.
- **Structures** (`src/structures.js`): floats (`man_made=pier`,
  `floating=yes`) 2.4 m wide, +0.5 m, among guide piles; fixed piers as decks at +2.0…2.8 m;
  breakwaters as rock walls to +3 m; groynes. Heights are about MWL (the
  floats don't rise and fall with the tide).
- **Marks** (`src/marks.js`): lighthouses, light towers and beacons on
  their rock, cardinal buoys with topmarks, lateral buoys in IALA B
  colours, special-purpose marks, mooring buoys, radio masts. Typical sizes.

## `extras.terrain`

On the GLB's glTF scene, so a scene extension reads it as
`api.content(id).extras.terrain`:

```js
{ version: 1,
  frame: "x east, y up, z south; metres; y = 0 mean water level",
  origin: { lat, lon }, projection: "tmerc-wgs84-k1",
  grid: { nx, nz, x0, z0, cell },                 // node-registered; bilinear between nodes
  heights: { encoding: "int16le-base64", scale: 0.02, offset: 0, data },  // height = offset + scale·v
  outside: null,                                   // off the grid: open water, no bottom
  quality: { encoding: "uint2-base64", names: ["dem", "shore", "raised", "clamped"], meaning, data,
             counts, clamped: [{ nodes, x, z, area }] },   // 2 bits a node, the first in a byte's low bits
  rocks: [{ id, top, points: [[x, z], …] }],      // islets too small to hold a node
  source: { encoding: "uint4-base64", names, counts, data },  // layered heights only: which source each node is from
  seaLevel: 0, exaggeration, datum: { …, tide: { HHWLT, MHHW, MLLW, LLWLT } },
  places: [{ name, kind, position: [x, y, z] }],
  sources: [{ id, name, url, fetched, licence, attribution, accuracy?, requests? }], attribution, credit }
```

**`src/terrain-sample.js` is meant to be copied** into a package that wants
depths (sailing, for grounding and the anchor's depth): `decodeTerrain(t)`
→ `heightAt(x, z)`, `depthAt(x, z, level)`, `qualityAt(x, z)` (the least
trustworthy node a sample reads: treat `clamped` depths as unknown) and
`rockAt(x, z)` (a rock the heightfield can't hold). It has no imports.

The terrain object sits at the scene's identity and is locked, so a world
point is a terrain point. With a vertical exaggeration other than 1, the
land in the mesh is stretched; the heightfield stays true.

## Testing

`pnpm test` runs finite checks, no randomness:

- the TIFF reader on big-endian tiles, sparse tiles, a ModelTransformation,
  PixelIsPoint, and a rotating transformation refused;
- the 4326 resampler exact on a linear field at every node, nothing exactly
  where a missing pixel is weighed (every node), the canopy the largest over
  each node's pixels (every node); the frame raster refused half a cell off;
- the layered choice in every combination of three sources' coverage on
  land and water; a source's raw 0 as no value on water and a height on
  land, at two datum offsets (every case); the layers file round-tripping every code and canopy step;
  the harmonic fill bringing back a plane at every node;
- Fetch data as a task on a made-up place (`fetch-task.test.js`): it stores
  and returns only urls; a frame, origin, grid or OSM date moved while it
  fetched (or while it made the files) stores nothing; a stop mid-request or
  during Overpass's retry wait rejects at once and stores nothing; NCEI's
  error is the message a person sees; the key changes with each field a
  fetch reads and with none of the others; the tool's button through a
  stand-in `doWork`, `watchWork` and `stopWork` (`tool-fetch.test.js`): here and on the
  person's queue, Cancel, a fetch already under way shown, where the task's
  code is;
- what a store writes (`store.test.js`, on real automerge documents): one
  value, `data`; two stores at once on two machines keep one whole, each way
  round; a store made before the frame move was heard reads as stale; each
  of frame, origin, OSM date and look makes stored data stale and fits again
  when put back; data with no request never fits; a layered place's own
  credits are left alone, so its key is the same after a store; the SHA-256
  computed at once is WebCrypto's at every length to five blocks;
- a whole layered fetch on a made-up place, every answer a fixture: what is
  asked for, from which source each node is, the bytes it makes (pinned
  SHA-256), and the land source flipped is refused;
- the boatyard against its spec (the hangar's sides, area, floor, eave,
  ridge, pitch, bearing, doors; the pier's runways, spacing, well; the
  travel lift's gauge; the wharf; the dock's bearing and length; the
  chargers in order), every structure's source and assumption, the layers;
  the survey conformed to the lidar (the slab within 0.3 m of the recorded
  lidar mean, the survey's differences kept, every yard-level deck with
  it); the door leaves never over the small door (and wherever a small door
  might sit); today's pier arm on OSM's line from the leg's end, hidden by
  default; the haul-out's head depths recorded; what the build counts as
  built on; the extent and every named place in it;
- the forest: species picked in exact proportion; the trees of the grid the
  trees of its tiles for every split into rows; every tree on a node that
  may have one, inside its cell, of its node's mix, at its canopy ±15%;
  trees exactly on the fringe and the roof's edges; thinning to exactly
  `max`; the roof over its nodes only, at the ground plus the smoothed
  canopy; the trees' meshes a metre tall; the built mask exactly the nodes
  on or within a tree's reach of 24 footprints (every node, against brute
  force), and with the canopy over every node no tree on a footprint and no
  roof within two nodes of one (every tree, every node);
- the probes' Chrome lock: refused without --lock or $CHROME_LOCK; released
  when its holder exits, throws, or gets SIGINT, SIGTERM or SIGHUP alone or
  under another handler (child processes); waited for, taken over when
  stale, kept fresh while held; and what a publisher sends, a dry run in a
  never-synced checkout going on unstamped (every case);
- the land cover painted largest first with holes, at every node; the
  chamfer distance to water within 8.3% at every node; the shore's bands
  ordered by the tide and coloured as named;
- the shore's cut: every triangle with corner heights from seven round
  three levels (343) tiled exactly by its pieces, each inside its slab, its
  winding kept, one piece a slab it reaches; a 5 × 5 mesh cut with no
  crack (every inner edge two triangles', point for point), its bands
  painted where they lie, every other colour exactly as it was;
- the surf: exposure all, none and between behind a spit; pieces a cell
  long facing the sea, none where land is on both sides, the same pieces
  however the chain is cut, each knowing its neighbours, a closed ring's
  join included; both pieces at every shared end agreeing on it (one
  ribbon), 2–12 m wide, every run's ends tapered to nothing; foam only
  where exposed, flat foam facing up, spray within its height, every colour
  between white and the sea's, the same bytes every time; reef patches on
  exactly the shallow, exposed water nodes (every node), facing up, local
  tile by tile; boulders on exactly the pieces exposed enough, within their
  reach;
- the clouds: the banks of the grid the banks of its tiles (every split
  into rows); a bank at a level exactly where the ground meets it; mist
  only in the forest's hollows; nothing seen where the ground is close
  under it; two surfaces a bank, every vertex inside its ragged rim (0.6–1,
  not a circle), its top over its base and its underside under it, its
  rim clear; a cap under the highest node round where it is named;
- the forest's skin: the zone exactly the nodes within its circles (every
  node); a clump on exactly the roof nodes in it (every node), 3 or 4
  crowns, its canopy ±8%; local tile by tile; none where built; thinning to
  exactly `max`; every layout 12 triangles a crown within its reach; each
  instanced from its own mesh on the ground; the scrub exactly where the
  canopy is 0.8–5 m on wild land, at its height ±1.5 m, never on lots;
- the palette's rock band under every cover but a beach where the shore is
  rock (every cover through the band), only on bare ground where not; the
  apron exactly the land nodes in the box (every node); a landmark's OSM
  building left out; the lighthouse's and radome's heights;
- the stands: one stand of 4–6 on every fringe node (each size used), the
  same tree otherwise, two town trees a node at 50 a hectare, local tile by
  tile; a stand's mesh its crowns, within its reach; each kind instanced
  from its own mesh; the roof's jitter within ±3 m on roof nodes only;
- corrugated cladding: ribs every 0.9 m and a band under the eave, just
  outside the walls, either way round;
- buildings: the oriented box of a rectangle at twelve turns and four
  starting corners; classes; a house's eave and ridge; what's left out;
- a build with a look and a site: layers declared and used, the trees as
  nodes of a few shared meshes, what the site clears left out, determinism;
  the shore cut; no surf, cloud or boats about without a swell and a look
  asking, and with them each on its layer, unlit (the cloud blended), determinism;
- the deterministic sine, cosine and length the geometry uses (the engines'
  Math.sin and Math.hypot have been seen to differ by an ulp between node
  and Chrome, which made the two GLBs differ);
- the Ucluelet template on a fake scene (terrain, the place, the weather
  under each of its skies, water, home view, the sloop at anchor; without
  sailing; a sky it hasn't refused before anything is written); the place
  (`place.test.js`: which object, no fields, and no terrain extension
  offering an ambient on either template's scene); a place's weather
  (`placeWeather`, the weather package's field names);
- the boats: only along floats, beside them at the middle of their slips,
  each slip by its own hash (the same with or without other floats);

- the projection against a fixed proj4 table (12 places, under a millimetre);
- the TIFF reader and the DEM's grid check (a wrong size, cell or tie point
  is refused); the request's WKT carries exactly the proj4 definition the
  projection is checked against (Latitude_Of_Origin included), and pixel
  (i, j) is node (i, j);
- the coastline classification at every node of a 33² grid against an
  independent point-in-polygon, with concave corners, a star's sharp
  vertices and a spit; a coastline that stops inside the grid, and an
  island drawn the wrong way round, are reported;
- the burned shore crossing y = 0 within half a metre of a straight OSM
  shore on every grid edge that crosses it; the floors, with their quality;
  islets of one node, four, a row, none (a rock) and a big one, each
  checked against an independent point-in-polygon and the land floor;
- a DEM flipped north–south or mirrored east–west against the fixture's
  coastline is refused;
- the RTIN over five surfaces, at every node, with its sign;
- the sampler exact at nodes and bilinear between; base64 at every length;
- a whole build (GLB through three's GLTFLoader, `extras.terrain` decoding
  to exactly the burned heights and qualities, `asset.copyright`,
  determinism byte for byte), the marks (no lateral buoy coloured without a
  colour or side; three-band east and west cardinals), the source over a
  fake repo (hash checks, fingerprints, a fingerprint unchanged by new
  urls, the files' licences), the template on a fake scene (its About, its
  credit, the pinned OSM date, changed data reported).

Probes, against the real data:

```sh
node probes/fetch-ucluelet.mjs [--cache <dir>] [--seed <dir>] [--offline] [--out <dir>]
#   fetches (or replays, or records from the research's downloads with --seed, each
#   checked to answer exactly the request this package makes) the six rasters and both
#   Overpass queries, and checks: the grid; the classification; the lidar lines up with
#   OSM (and misplaced would be refused); every node's source in the counts research
#   found; islets; 8 known places; the canopy; the data is what was checked (SHA-256 of
#   the heights, layers, features and look); the anchorage deep enough all round a swing;
#   the yard's ten lidar points (YARD) the fetched lidar's, the hangar's slab within 0.3 m
#   of the drawn ground; the haul-out's head depths the fetched heights'
node probes/publish-ucluelet.mjs --dry-run --lock <dir> [--shots <dir>] [--gpu]   # build scene/, sailing/, water/, weather/, terrain/
#   the template in headless Chrome (one Chrome at a time while it holds the lock: --lock
#   or $CHROME_LOCK, refused with neither; released however it ends), 50-odd
#   checks (see the file), node's GLB byte for byte, the Terrain doc's fingerprint the
#   render's when it is built and nothing written to the doc after (every write is logged
#   with its stack: one run of the url-rewrite check saw a stale render, not seen since),
#   a viewer without the terrain plugin,
#   and screens: home, the boatyard close, the dock, the inlet, Amphitrite Point, the
#   town's waterfront from the water, the surf under the lighthouse, the cloud on Mount
#   Ozzard, low on the water off the yard, off the town and under the lighthouse; the top
#   of every screen not black (the sky drawn at every eye). With --gpu (the machine's GPU,
#   Metal on a Mac) every view's frame time (40 frames, the stage's render and a 1-pixel
#   readPixels; median and p90, draw calls, triangles), and the home view against 22.7 ms (reported, not a check: the lead, 2026-11-17);
#   and the look's own checks: no height legend, the ground's grain dressed, the water
#   off the yard glassy, no horizontal stripes in the harbour's mirror (low-town's ratio
#   sits at 1.23–1.32 against 1.3 from run to run, as the water moves: rerun before
#   reading a failure there as a regression), the yard's ground varied by 8%
#   (each of these pixel strips is carried to the stage canvas the page has, as a fraction of
#   its height: since scene's bar of tools (N8) the canvas starts lower, and at fixed rows
#   low-town's strip took in the shore itself, 1.44; carried, 1.30; integrator of lane/n6, 2026-11-17)
#   Published 2026-11-16 (merge 07053407, lane/ukee): Ucluelet automerge:3uqC18J1FtGJPAAvucN2HP7thFm6
#   (home 16.9 ms, the worst views lighthouse-sea 22.7 and overview 27.0, GLB 45.7 MB),
#   Cadboro Bay automerge:JjZVTNDWJnvw9Gp5nZ936e7KRZ4 (its terrain carried terrain.sky then; both predate the weather)
node probes/fetch-cadboro.mjs [--cache <dir>] [--offline] [--out <dir>]
#   fetches (or replays its recording of) NCEI and Overpass, and checks: the grid; every node
#   classified with no conflicts; no open coastline end near the grid; the data is what was checked
#   (SHA-256); the DEM lines up with OSM (and flipped, mirrored or shifted it would be refused);
#   every islet clears the land floor; 13 places known to be land or water; the mooring field
#   deep enough for a 2 m keel at the lowest normal tide
node probes/fetch-task-run.mjs [--sync wss://…] [--verbose]     # build ../tasks first: pnpm build:node there
#   Fetch data as a task through the real sync server and the real sources (a 65 × 65 grid
#   off Cadboro Bay): starts a tasks host (TASKS_HOST, default ../tasks/dist-node/host.mjs)
#   on a new queue with this directory as a made-up package (--local), asks from a Repo of
#   its own, and checks: the Terrain doc points at file docs whose bytes match their SHA-256;
#   asking again under the key while it runs is the same task; a cancel mid-fetch ends the
#   task cancelled and stores nothing; a moved frame is another key and another task
node probes/publish-rvyc.mjs --dry-run --lock <dir>     # build scene/, sailing/, water/, weather/ and terrain/ first
#   in headless Chrome, the BUILT scene, sailing and terrain plugins on an empty scene: the
#   template from the start screen (its fetches answered from the recording), and checks the
#   scene (see the file); node rebuilds the GLB from the same docs and compares bytes; a viewer
#   without the terrain plugin opens a snapshot and still sees it; the fingerprint survives
#   rewriting every url. A dry run in a checkout never synced with pushwork (no package
#   urls) says the scene isn't stamped and still exits 0. Without --dry-run it publishes every doc (a render's builtFrom.heads
#   become its source's, as published) and reads each back from a fresh repo, the terrain's
#   render checked fresh for its source there.
```
