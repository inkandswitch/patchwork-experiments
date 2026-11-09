// The "terrain-mesh" scene:source: a Terrain doc to a GLB. build() reads
// only the doc and the two file docs it names (dependencies), checks their
// bytes against the doc's record, and hands them to build.js. Nothing here
// touches the network: fetching is the tool's (and the template's) job,
// once, into those file docs.

import { buildTerrain } from "./build.js";
import { readTerrainData, dataFits, asBytes } from "./store.js";
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
  sources: doc?.sources ?? [],
  attribution: doc?.attribution ?? "",
  credit: doc?.credit ?? "",
  data: doc?.data ? { dem: record(doc.data.dem), features: record(doc.data.features) } : null,
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
    if (!doc?.data?.dem?.url || !doc?.data?.features?.url) throw new Error("This terrain has no data yet: open it and press Fetch data.");
    if (!dataFits(doc)) throw new Error("This terrain's data was fetched for another place or grid: open it and press Fetch data again.");
    const { dem, features } = await readTerrainData(repo, doc);
    const { glb, meta } = buildTerrain({ doc: d, dem, features, params });
    return { kind: "glb", glb, meta };
  },
  fingerprint(doc) {
    // the same however the doc's keys are ordered: a peer on automerge and one on a plain object agree
    return quickHash(new TextEncoder().encode(stableJson(JSON.parse(JSON.stringify(inputs(doc))))));
  },
  dependencies(doc) {
    return [doc?.data?.dem?.url, doc?.data?.features?.url].filter((u) => typeof u === "string");
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
