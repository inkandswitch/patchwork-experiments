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
| `scene:extension` | `terrain.sky` | a place's own sky as the world's `atmosphere`, for an object with the `terrain.sky` trait (`src/sky.js`) |
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
   for navigation" at its foot;
3. gives the scene a sea (`sailing.sea`) with a typical summer afternoon:
   4 m/s from 235° (WSW), wave scale 0.5 (a south-westerly reaches the bay
   over Uplands and Oak Bay, so the bay is a lee);
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
   with `terrain.credit` and `terrain.sky` (Ucluelet's sky: below);
3. gives the world a summer afternoon's breeze (`sailing.weather`): 5 m/s
   from 300° (WNW), which blows along the harbour; and the harbour and
   coast one open water (`water`) with `sailing.sea` at scale 0.6;
4. lays sailing's sloop (found by its part id, never imported) at anchor
   about 70 m north of the planned dock's arm (48.95078 N, 125.5561 W, an
   assumed spot: no anchorage is charted there) in about 12 m of water,
   head to wind, sails down;
5. starts people in Look above the boatyard's south-west corner, looking
   over the hangar and the planned dock across the harbour.

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
are CGVD28: +0.08 m makes them heights about MWL). The tide about MWL: HAT
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
| water | CHS NONNA-10 → NONNA-100 → NCEI Barkley Sound 1″ (raster 147) → NCEI BC 3″ (182) → filled | 685,496 · 22,168 · 16,717 · 3,971 · 1,471 |
| land | NRCan HRDEM lidar DTM → NCEI 1″ → the land floor | 236,999 · 83,574 · 229 |

- The **filled** water (the inner inlet's head, 0.59 km² in 17 places) is a
  harmonic fill from the surveyed depths round it and the shore; its
  quality is `clamped` (made up: treat the depth as unknown). The land no
  source covers is `raised`.
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
licence and how its numbers were derived is in the Terrain doc's `sources`.

### The boatyard (`src/ucluelet.js` SITE, drawn by `src/site.js`)

1970 Harbour Crescent (Lot 5, Plan VIP20323), the former RCAF Station
Ucluelet seaplane base (No. 4 (BR) Squadron, 1940–44), now Rising Tide's.
Positions are the survey's, read as vectors from the PDF and georeferenced
from its GNSS base (MAG nail 11087); against imagery they fall within 1–2 m.
Everything is public. Each structure in the doc says its source, its
confidence and what is assumed; the GLB puts them on layers:

| Layer | What | Confidence |
|---|---|---|
| Buildings staying | **The hangar** (survey building A): 39.2 × 34.9 m, 1,369 m², floor +4.20, ridge +16.01, eave +14.8 about MWL; a 4° gable, its ridge north-west–south-east (157° true), trusses spanning the 34.8 m faces; sliding doors across the north-west face to a 7.39 m door head, a timber header band above, a 3.1 m door; walls diagonal timber sheathing weathered cedar brown and red, doors green, part stripped; dark grey roof. Building B (the old cold storage, possibly their office), building D (silver) | footprint and heights high; eave ±0.5 m, doors and colours from the July 2026 photo |
| Buildings marked to be removed | C (the lean-to), E, F, G, H, I (white roof), J (rust roof), K, Q, **hidden by default** (the scene shows the plan; turn the layer on for March 2026) | footprints high; heights partly assumed |
| Existing wharf and pier | the 43.9 × 19.5 m pile wharf with its white shed, at yard level; the L-pier's north leg (OSM way 751431449); the Pat Leslie public launch | position high; deck heights assumed |
| Planned haul-out pier and dock | two concrete runways about 40 m long, 12.7 m apart, 2.4 m wide (a 10.3 m well for a 30 ft beam), Corten-look screens; a **110 t travel lift** straddling them; a 15 m gangway; the dock's arm, 3.6 m floats at +0.5 m with guide piles and a **solar canopy**, and **three DC fast chargers** | **low**: Rising Tide's schematic registered to the L-pier (position ±15 m, bearing ±5°, length ±10 m); the travel lift's size and colour (blue), the gangway and the canopy's form are assumed |

OSM's buildings inside the lot's extent, and its L-pier, are left out (the
site draws them). Assumptions, in full, are in `src/ucluelet.js`; the
largest: NAD83(CSRS) taken as WGS84 (~1–1.5 m); the hangar's eave from the
photo; the pier from a non-scale schematic (a whole-site fit puts it 12 m
west, over the wharf's east half); whether the wharf stays is not public;
building B's fate is unresolved (shown as staying).

Two landmarks OSM has but can't shape are drawn from the doc too
(`landmarks`): **Amphitrite Point Lighthouse**, a squat white concrete tower
about 6 m tall with a balcony and a red lantern (its OSM mark is replaced),
and the **Mount Ozzard radar dome** (both sizes assumed).

### Ucluelet's sky (`terrain.sky`, `src/sky.js`)

"Ukee grey": overcast but bright, as most summer afternoons are at
Amphitrite Point (ECCC, Jul–Aug 1991–96, 732 hours: cloudy or mostly cloudy
42%, fog 20%, clear 35%; visibility median 19 km): sky `#7f8b94` / `#c5cbcc`
/ `#8f9a9b`, fog `#bcc3c4` from 400 to 9,000 m (the Broken Group's islands,
13–17 km off, are pale shapes in it), the sun where it is on 15 July at
15:00 PDT, soft, no shadows. `SKIES` also has "marine layer" (fog from 30
to 900 m) and "clear afternoon"; put either in the trait.

The trait is on the terrain object. The stage stacks ambients in running
order, a later offer winning, and runs a doc's scene-trait extensions before
its object-trait ones (scene `activation.js`), so the place's sky wins over
`sailing.weather`'s bright day. No scene change.

## The look (`src/look-osm.js`, `cover.js`, `palette.js`, `forest.js`, `buildings.js`)

The same machinery for every place with a `look` (Ucluelet and Cadboro Bay):

- **Land cover** from a second Overpass query (buildings, land use, natural
  areas, …), kept in its own file doc: wood, scrub, residential, yard
  (industrial, commercial, quarry…), grass, wetland, beach, bare rock, lakes,
  painted on the grid largest first.
- **The ground's colour** by height, cover and the tide: the intertidal and
  splash bands from the place's own tide levels (kelp below MLLW, mussel,
  rockweed, barnacle to MHHW, black lichen to HHWLT + 1.1 m, bare rock), a
  darker, greener sea floor with depth, lawns, yards, bog, beach (Cadboro's
  sand, Ucluelet's cobble), forest floor. Art direction, `COLOURS`; a place
  overrides any in `look.colours`. At 20 m the bands get only a few vertices.
- **The forest**: the canopy (the lidar's where measured; else an assumed
  height in OSM's woods: `look.trees.assumed`, 18 m ±20%), a forest *roof*
  (an RTIN over the ground plus the smoothed canopy, where a node and its
  eight neighbours are forest at least 20 m from the water), and
  **instanced trees** in front of it: on the 40 m fringe at the water, along
  the roof's edges, sparsely on residential lots. Species by the place's
  mixes (assumptions: Ucluelet's on the Coastal Western Hemlock zone, spruce,
  hemlock, cedar, shore pine, alder; Cadboro's on the Coastal Douglas-fir
  zone, fir, Garry oak, arbutus, cedar), heights the canopy's ±15%, all by
  hash of the node's index: local, so tile by tile is the whole (tested).
  Each species is one mesh; the trees are nodes sharing it, which the scene
  draws as one InstancedMesh a species. Capped (`max`) by each tree's own key.
- **Buildings**: OSM's footprints extruded, gables over near-rectangles
  (ridge along the long side), flat roofs otherwise; heights and pitches by
  kind and cover (houses 5.5 m to the eave, 32°; hotels 9.5 m; industrial
  8.5 m, 8°: assumptions, as OSM rarely says); colours from the West Coast
  palette by a hash of the OSM id (not checked house by house). OSM maps
  about half of Ucluelet's buildings.

The small solids carry no normals (a glTF loader draws them flat-shaded,
which they are), and the buildings are a primitive a colour: Ucluelet's GLB
is about 22.5 MB, Cadboro Bay's 15.3 MB (it was 7.8 MB; its 5,910
buildings are most of the rest).

- **Boats on the floats** (`boats.js`): dressing, not data. Nobody maps
  which boat is in which slip, so each float's slips (one every 12 m a side,
  about two in three taken) get a troller, a small seiner or crabber, or an
  aluminium sportfisher by hash of the float's id and the slip, the same
  every build. Their layer says they are dressing.

## Layers

The GLB declares layers (scene README, "GLB conventions"): **Forest**,
**Buildings**, **Docks, floats and breakwaters**, **Lights, buoys and
beacons**, **Landmarks**, **Moored boats (dressing)**, and a place's own (Ucluelet's boatyard and its four
sub-layers, the removed buildings hidden by default). The ground is on none.

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
  `floating=yes`) 2.4 m wide, +0.5 m; fixed piers as decks at +2.0…2.8 m;
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
  land and water; the layers file round-tripping every code and canopy step;
  the harmonic fill bringing back a plane at every node;
- a whole layered fetch on a made-up place, every answer a fixture: what is
  asked for, from which source each node is, the bytes it makes (pinned
  SHA-256), and the land source flipped is refused;
- the boatyard against its spec (the hangar's sides, area, floor, eave,
  ridge, pitch, bearing, doors; the pier's runways, spacing, well; the
  travel lift's gauge; the wharf; the dock's bearing and length; the
  chargers in order), every structure's source and assumption, the layers;
  the extent and every named place in it;
- the forest: species picked in exact proportion; the trees of the grid the
  trees of its tiles for every split into rows; every tree on a node that
  may have one, inside its cell, of its node's mix, at its canopy ±15%;
  trees exactly on the fringe and the roof's edges; thinning to exactly
  `max`; the roof over its nodes only, at the ground plus the smoothed
  canopy; the trees' meshes a metre tall;
- the land cover painted largest first with holes, at every node; the
  chamfer distance to water within 8.3% at every node; the shore's bands
  ordered by the tide and coloured as named;
- buildings: the oriented box of a rectangle at twelve turns and four
  starting corners; classes; a house's eave and ridge; what's left out;
- a build with a look and a site: layers declared and used, the trees as
  nodes of a few shared meshes, what the site clears left out, determinism;
- the deterministic sine, cosine and length the geometry uses (the engines'
  Math.sin and Math.hypot have been seen to differ by an ulp between node
  and Chrome, which made the two GLBs differ);
- the Ucluelet template on a fake scene (terrain, sky, weather, water, home
  view, the sloop at anchor; without sailing), the sky extension;

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
#   the heights, layers, features and look); the anchorage deep enough all round a swing
node probes/publish-ucluelet.mjs --dry-run [--lock <dir>] [--shots <dir>]   # build scene/, sailing/, water/, terrain/
#   the template in headless Chrome (one Chrome at a time while it holds --lock), 40-odd
#   checks (see the file), node's GLB byte for byte, a viewer without the terrain plugin,
#   and screens: home, the boatyard close, the dock, the inlet, Amphitrite Point
node probes/fetch-cadboro.mjs [--cache <dir>] [--offline] [--out <dir>]
#   fetches (or replays its recording of) NCEI and Overpass, and checks: the grid; every node
#   classified with no conflicts; no open coastline end near the grid; the data is what was checked
#   (SHA-256); the DEM lines up with OSM (and flipped, mirrored or shifted it would be refused);
#   every islet clears the land floor; 13 places known to be land or water; the mooring field
#   deep enough for a 2 m keel at the lowest normal tide
node probes/publish-rvyc.mjs --dry-run      # build scene/, sailing/ and terrain/ first
#   in headless Chrome, the BUILT scene, sailing and terrain plugins on an empty scene: the
#   template from the start screen (its fetches answered from the recording), and checks the
#   scene (see the file); node rebuilds the GLB from the same docs and compares bytes; a viewer
#   without the terrain plugin opens a snapshot and still sees it; the fingerprint survives
#   rewriting every url. Without --dry-run it publishes every doc (a render's builtFrom.heads
#   become its source's, as published) and reads each back from a fresh repo, the terrain's
#   render checked fresh for its source there.
```
