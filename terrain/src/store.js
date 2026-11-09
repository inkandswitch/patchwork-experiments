// Keeping a terrain's fetched data in docs: two immutable file docs (the DEM
// as int16 bytes, the OSM features as JSON) and, on the Terrain doc, a
// record of each (url, encoding, sha256) with the sources and their
// licences. Reading it back checks the bytes against the record.

import { ATTRIBUTION, CREDIT, NCEI } from "./fetch-data.js";
import { sha256Hex } from "./hash.js";
import { bytesToInt16 } from "./terrain-sample.js";

/** A file doc's content as bytes, whatever form the repo hands it back in. */
export function asBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content && ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content && typeof content.val === "string") return new TextEncoder().encode(content.val);
  if (content && typeof content.toString === "function") return new TextEncoder().encode(String(content));
  return null;
}

// each file says what it is and whose: the features are a derivative of OSM, so ODbL, with its notice
const fileDoc = (name, extension, mimeType, bytes, rights) => ({ "@patchwork": { type: "file" }, name, extension, mimeType, ...rights, content: bytes });
export const RIGHTS = Object.freeze({
  dem: Object.freeze({ licence: "Public domain (U.S. Government work)", attribution: NCEI.attribution }),
  features: Object.freeze({
    licence: "ODbL-1.0",
    licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors (https://www.openstreetmap.org/copyright). A derivative database of OpenStreetMap, under the Open Database License 1.0.",
  }),
});

/**
 * Store fetched data (fetch-data.js fetchTerrainData's result) and point the Terrain doc at it.
 * @returns {Promise<{ dem: string, features: string }>} the file docs' urls
 */
export async function storeTerrainData(repo, handle, fetched) {
  const title = handle.doc()?.title || "Terrain";
  const [dem, features] = await Promise.all([
    repo.create2(fileDoc(`${title} heights (int16le, NAVD88).bin`, "bin", "application/octet-stream", fetched.dem.bytes, RIGHTS.dem)),
    repo.create2(fileDoc(`${title} OpenStreetMap features.json`, "json", "application/json", fetched.features.bytes, RIGHTS.features)),
  ]);
  handle.change((d) => {
    d.data = { dem: { url: dem.url, ...plain(fetched.dem.record) }, features: { url: features.url, ...plain(fetched.features.record) }, fetched: fetched.summary.fetched, summary: plain(fetched.summary) };
    d.sources = plain(fetched.sources);
    d.attribution = ATTRIBUTION;
    d.credit = CREDIT;
  });
  return { dem: dem.url, features: features.url };
}

// automerge takes fresh plain values, never undefined
const plain = (v) => JSON.parse(JSON.stringify(v));

/**
 * Read a Terrain doc's data back: { dem: Int16Array, features } — checked against the doc's record (size and sha256).
 * @param {{ find(url): Promise<{ doc(): object }> }} repo
 */
export async function readTerrainData(repo, doc) {
  const rec = doc?.data;
  if (!rec?.dem?.url || !rec?.features?.url) throw new Error("This terrain has no data yet: open it and Fetch data.");
  const [demH, featH] = await Promise.all([repo.find(rec.dem.url), repo.find(rec.features.url)]);
  const demBytes = asBytes(demH.doc()?.content), featBytes = asBytes(featH.doc()?.content);
  if (!demBytes || !featBytes) throw new Error("The terrain's data files are empty.");
  const n = rec.dem.n ?? doc.grid?.n;
  if (demBytes.length !== n * n * 2) throw new Error(`The heights file has ${demBytes.length} bytes, not ${n * n * 2}.`);
  const [ds, fs] = await Promise.all([sha256Hex(demBytes), sha256Hex(featBytes)]);
  if (rec.dem.sha256 && ds !== rec.dem.sha256) throw new Error("The heights file isn't what was fetched (its SHA-256 differs).");
  if (rec.features.sha256 && fs !== rec.features.sha256) throw new Error("The features file isn't what was fetched (its SHA-256 differs).");
  return { dem: bytesToInt16(demBytes), features: JSON.parse(new TextDecoder().decode(featBytes)) };
}

/** Whether the doc's data was fetched for its current origin and grid. */
export function dataFits(doc) {
  const r = doc?.data?.dem;
  if (!r) return false;
  const g = doc.grid ?? {};
  return r.n === g.n && r.cell === g.cell && r.x0 === g.x0 && r.z0 === g.z0 && r.origin?.lat === doc.origin?.lat && r.origin?.lon === doc.origin?.lon;
}
