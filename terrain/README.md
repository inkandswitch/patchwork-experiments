# terrain

Real places as a scene's ground. A **Terrain** doc names a place and an
extent, and caches open data for it (heights and bathymetry from NOAA,
the shoreline, docks and marks from OpenStreetMap). A `scene:source` builds
it into a GLB in metres: the ground and seabed as one mesh with the OSM
shoreline burned in, harbour structures, lights and buoys, and the
heightfield itself in `extras.terrain`, so anything in the scene can ask
how deep the water is.

It ships one place so far: **Cadboro Bay**, off the Royal Victoria Yacht
Club in Victoria BC, as a scene template with sailing's sloop on the club's
moorings.

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
5. opens in play; the editor's home view is above the clubhouse looking out
   over the docks to the moorings.

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
  triangles, a 7.8 MB GLB (2.8 MB of it the heightfield, 0.35 MB the
  nodes' quality).
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
