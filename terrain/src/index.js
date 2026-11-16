// terrain: real places as a scene's ground. Plugin metadata only (this
// module is evaluated in a worker: no DOM, no bare imports; everything else
// is behind load()).
//
// - patchwork:datatype "terrain": a place, its frame and extent, and the
//   open data fetched for it (datatype.js)
// - patchwork:tool "terrain": a map of it, its settings, Fetch data, and its
//   sources and licences (tool.js)
// - scene:source "terrain-mesh": the GLB (ground, harbour structures, marks,
//   and the heightfield in extras.terrain) (source.js, build.js)
// - scene:template "terrain.cadboro-bay": Cadboro Bay off the Royal Victoria
//   Yacht Club, with a sloop on the moorings (template.js)
// - scene:template "terrain.ucluelet": Ucluelet and the waters round it,
//   with Rising Tide Boat Works' boatyard (template-ucluelet.js)
// - scene:extension "terrain.credit": the open data's credit at the foot
//   of the view, for objects with the "terrain.credit" trait (credit.js)
// - scene:extension "terrain.sky": a place's own sky, the world's
//   atmosphere, for an object with the "terrain.sky" trait (sky.js)

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "terrain",
    name: "Terrain",
    icon: "Mountain",
    async load() {
      return (await import("./datatype.js")).TerrainDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "terrain",
    name: "Terrain",
    icon: "Mountain",
    supportedDatatypes: ["terrain"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
  {
    type: "scene:source",
    id: "terrain-mesh",
    content: "built",
    name: "Terrain",
    icon: "Mountain",
    supportedDatatypes: ["terrain"],
    cost: "expensive",
    version: 2,
    params: [
      { key: "shoreTolerance", label: "Shore tolerance (m)", kind: "number", default: 0.25, min: 0.05, max: 2, step: 0.05 },
      { key: "landTolerance", label: "Land tolerance (m)", kind: "number", default: 1.5, min: 0.1, max: 10, step: 0.1 },
      { key: "deepTolerance", label: "Deep-water tolerance (m)", kind: "number", default: 6, min: 0.5, max: 20, step: 0.5 },
      { key: "heightfieldCell", label: "Heightfield for depth (m)", kind: "enum", default: 8, options: [{ value: 8, label: "8 m (full)" }, { value: 16, label: "16 m" }, { value: 32, label: "32 m" }] },
      { key: "structures", label: "Docks and breakwaters", kind: "boolean", default: true },
      { key: "marks", label: "Lights, buoys and beacons", kind: "boolean", default: true },
      { key: "skirt", label: "Skirt round the edge", kind: "boolean", default: true },
      { key: "forest", label: "Forest (canopy and trees)", kind: "boolean", default: true },
      { key: "buildings", label: "Buildings (OpenStreetMap)", kind: "boolean", default: true },
      { key: "site", label: "The place's own structures", kind: "boolean", default: true },
      { key: "boats", label: "Boats on the floats (dressing)", kind: "boolean", default: true },
    ],
    async load() {
      return (await import("./source.js")).default;
    },
  },
  {
    type: "scene:template",
    id: "terrain.cadboro-bay",
    name: "Cadboro Bay (RVYC)",
    icon: "Sailboat",
    description: "The waters off the Royal Victoria Yacht Club, Victoria BC, from open data (NOAA heights, OpenStreetMap shore and docks), with a sloop on the club's moorings in a summer afternoon's breeze",
    async load() {
      return (await import("./template.js")).default;
    },
  },
  {
    type: "scene:template",
    id: "terrain.ucluelet",
    name: "Ucluelet (Rising Tide Boat Works)",
    icon: "Sailboat",
    description: "The waters in and around Ucluelet on Vancouver Island's west coast, from open data (CHS depths, NRCan lidar, OpenStreetMap shore, docks and town), with Rising Tide Boat Works' boatyard at the old seaplane base: the restored hangar, the planned haul-out pier and electrified dock",
    async load() {
      return (await import("./template-ucluelet.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "terrain.sky",
    name: "Place's sky",
    traits: ["terrain.sky"],
    describes: {
      "terrain.sky": {
        name: "Place's sky",
        on: "object",
        blurb: "This place's own sky, fog and sun (overcast, misty or clear) as the world's atmosphere, over the weather's",
        fields: [
          { key: "sky", label: "Sky (top, horizon, bottom)", kind: "json", default: { top: "#7f8b94", horizon: "#c5cbcc", bottom: "#8f9a9b" } },
          { key: "fog", label: "Fog (colour, near, far m)", kind: "json", default: { color: "#bcc3c4", near: 400, far: 9000 } },
          { key: "sun", label: "Sun (direction, colour, intensity, shadows)", kind: "json", default: { direction: [-0.36, 0.84, 0.4], color: "#eef0f0", intensity: 1.1, shadows: false } },
          { key: "exposure", label: "Exposure", kind: "number", default: 1.05 },
        ],
        init: { sky: { top: "#7f8b94", horizon: "#c5cbcc", bottom: "#8f9a9b" }, fog: { color: "#bcc3c4", near: 400, far: 9000 }, sun: { direction: [-0.36, 0.84, 0.4], color: "#eef0f0", intensity: 1.1, shadows: false }, exposure: 1.05 },
      },
    },
    async load() {
      return (await import("./sky.js")).default;
    },
  },
  {
    type: "scene:extension",
    id: "terrain.credit",
    name: "Map credit",
    traits: ["terrain.credit"],
    describes: {
      "terrain.credit": { name: "Map credit", on: "object", blurb: "Shows who the terrain's open data is from (OpenStreetMap, NOAA…) at the foot of the view, as their licences ask" },
    },
    async load() {
      return (await import("./credit.js")).default;
    },
  },
];
