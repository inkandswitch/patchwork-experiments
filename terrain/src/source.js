// The "terrain-mesh" scene:source: a Terrain doc to a GLB. build() reads
// only the doc and the two file docs it names (dependencies), checks their
// bytes against the doc's record, and hands them to build.js. Nothing here
// touches the network: fetching is the tool's (and the template's) job,
// once, into those file docs.

import { buildTerrain } from "./build.js";
import { readTerrainData, dataFits, hasData, asBytes } from "./store.js";
import { quickHash } from "./hash.js";

// a data file's record without its url: the sha256 names the bytes (and
// dependencies() / fingerprintDependency cover the files), so a copy of the
// docs under new urls (publishing does that) isn't stale
const record = (r) => {
  if (!r) return null;
  const { url, ...rest } = JSON.parse(JSON.stringify(r));
  return rest;
};

// what build() reads from the source doc, and nothing else (so a rename doesn't rebuild, nor new urls for the same data)
export const inputs = (doc) => ({
  origin: doc?.origin ?? null,
  grid: doc?.grid ?? null,
  exaggeration: doc?.exaggeration ?? 1,
  datum: doc?.datum ?? null,
  demToMWL: doc?.demToMWL ?? 0,
  places: doc?.places ?? [],
  // the credits of the data, which are stored with it
  sources: doc?.data?.sources ?? [],
  attribution: doc?.data?.attribution ?? "",
  credit: doc?.data?.credit ?? "",
  data: doc?.data ? { dem: record(doc.data.dem), features: record(doc.data.features), ...(doc.data.layers ? { layers: record(doc.data.layers) } : {}), ...(doc.data.look ? { look: record(doc.data.look) } : {}) } : null,
  // a place's look and its own structures (only when it has them, so a doc without them fingerprints as it did)
  ...(doc?.heightScale != null ? { heightScale: doc.heightScale } : {}),
  ...(doc?.heights ? { heights: { canopy: doc.heights.canopy ?? null } } : {}),
  ...(doc?.look ? { look: doc.look } : {}),
  ...(doc?.site ? { site: doc.site } : {}),
  ...(doc?.landmarks ? { landmarks: doc.landmarks } : {}),
  // the swell's direction, for the surf (surf.js): only the direction, only when the place has one
  ...(Number.isFinite(doc?.swell?.from) ? { swell: { from: doc.swell.from } } : {}),
});

/** JSON with every object's keys sorted: automerge hands a map's keys back sorted, a plain object in the order they were set. */
export function stableJson(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
    .join(",")}}`;
}

const hashes = new WeakMap();

export default {
  async build({ doc, repo, params }) {
    const d = JSON.parse(JSON.stringify(inputs(doc)));
    if (!hasData(doc) || !doc.data.dem?.url || !doc.data.features?.url) throw new Error("This terrain has no data yet: open it and press Fetch data.");
    if (!dataFits(doc)) throw new Error("This terrain's data was fetched for another place, grid or settings: open it and press Fetch data again.");
    const { dem, features, layers, look } = await readTerrainData(repo, doc);
    const { glb, meta } = buildTerrain({ doc: d, dem, features, layers, look, params });
    return { kind: "glb", glb, meta };
  },
  fingerprint(doc) {
    // the same however the doc's keys are ordered: a peer on automerge and one on a plain object agree
    return quickHash(new TextEncoder().encode(stableJson(JSON.parse(JSON.stringify(inputs(doc))))));
  },
  dependencies(doc) {
    return [doc?.data?.dem?.url, doc?.data?.features?.url, doc?.data?.layers?.url, doc?.data?.look?.url].filter((u) => typeof u === "string");
  },
  // the data files are immutable; their content is what counts, not their heads
  fingerprintDependency(url, doc) {
    const content = doc?.content;
    if (!content) return null;
    if (typeof content === "object" && hashes.has(content)) return hashes.get(content);
    const bytes = asBytes(content);
    if (!bytes) return null;
    const key = `${bytes.length}:${quickHash(bytes)}`;
    if (typeof content === "object") hashes.set(content, key);
    return key;
  },
};
