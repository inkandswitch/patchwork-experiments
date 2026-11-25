// Keeping a terrain's fetched data in docs: immutable file docs (the DEM as
// int16 bytes, the OSM features as JSON, and for some places the height
// sources and the look) and, on the Terrain doc, one value, `data`: a record
// of each file (url, encoding, sha256), the sources and their licences, the
// credits, and the hash of what the fetch asked for (fetch-spec.js). Reading
// it back checks the bytes against the record.
//
// `data` is written whole, in one assignment, so that two stores made at once
// on two machines keep one of them whole, and never one's files with the
// other's credits. What it was fetched for is in it for the same reason: a
// machine that had not yet heard that the frame moved may store data for the
// old frame after the move, and the record then says so (dataFits).

import { ATTRIBUTION, CREDIT, NCEI } from "./fetch-data.js";
import { fetchSpec, specHash } from "./fetch-spec.js";
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
 * Store fetched data (fetch-data.js fetchTerrainData's result, for `spec`)
 * and point the Terrain doc at it. With `when`, the doc is pointed at the data
 * only if `when(doc)` holds, looked at before the file docs are made and again
 * inside the change that points at them; otherwise nothing is written to the
 * Terrain doc and this is null (file docs made between the two looks are left
 * to nobody).
 * @param {{ spec: object, when?: (doc: object) => boolean }} options  spec: what the fetch asked for (fetch-spec.js fetchSpec)
 * @returns {Promise<{ dem: string, features: string, layers: string | null, look: string | null } | null>} the file docs' urls
 */
export async function storeTerrainData(repo, handle, fetched, { spec, when = () => true }) {
  if (!spec || typeof spec !== "object") throw new Error("storeTerrainData needs the spec the data was fetched for.");
  const request = specHash(spec);
  if (!when(handle.doc())) return null;
  const title = handle.doc()?.title || "Terrain";
  const layered = !!fetched.dem.record.layered;
  const demRights = layered ? { licence: "Mixed: see the Terrain doc's sources (CHS NONNA non-navigational; OGL – Canada; NOAA public domain)", attribution: fetched.attribution ?? "" } : RIGHTS.dem;
  const [dem, features, layers, look] = await Promise.all([
    repo.create2(fileDoc(`${title} heights (int16le, ${fetched.dem.record.datum}).bin`, "bin", "application/octet-stream", fetched.dem.bytes, demRights)),
    repo.create2(fileDoc(`${title} OpenStreetMap features.json`, "json", "application/json", fetched.features.bytes, RIGHTS.features)),
    fetched.layers ? repo.create2(fileDoc(`${title} height sources and canopy.bin`, "bin", "application/octet-stream", fetched.layers.bytes, demRights)) : null,
    fetched.look ? repo.create2(fileDoc(`${title} OpenStreetMap buildings and land cover.json`, "json", "application/json", fetched.look.bytes, RIGHTS.features)) : null,
  ]);
  let stored = false;
  handle.change((d) => {
    if (!when(d)) return;
    stored = true;
    d.data = {
      request,
      dem: { url: dem.url, ...plain(fetched.dem.record) },
      features: { url: features.url, ...plain(fetched.features.record) },
      ...(layers ? { layers: { url: layers.url, ...plain(fetched.layers.record) } } : {}),
      ...(look ? { look: { url: look.url, ...plain(fetched.look.record) } } : {}),
      fetched: fetched.summary.fetched,
      summary: plain(fetched.summary),
      sources: plain(fetched.sources),
      attribution: fetched.attribution ?? ATTRIBUTION,
      credit: fetched.credit ?? CREDIT,
    };
  });
  if (!stored) return null;
  return { dem: dem.url, features: features.url, layers: layers?.url ?? null, look: look?.url ?? null };
}

// automerge takes fresh plain values, never undefined
const plain = (v) => JSON.parse(JSON.stringify(v));

/** A file doc's bytes, checked against its record's sha256; null without a record. */
async function readChecked(repo, rec, what) {
  if (!rec?.url) return null;
  const bytes = asBytes((await repo.find(rec.url)).doc()?.content);
  if (!bytes) throw new Error(`The terrain's ${what} file is empty.`);
  if (rec.sha256 && (await sha256Hex(bytes)) !== rec.sha256) throw new Error(`The ${what} file isn't what was fetched (its SHA-256 differs).`);
  return bytes;
}

/**
 * Read a Terrain doc's data back: { dem: Int16Array, features, layers?: Uint8Array, look? } — checked against the doc's record (size and sha256).
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
  const [layers, look] = await Promise.all([readChecked(repo, rec.layers, "height sources"), readChecked(repo, rec.look, "buildings and land cover")]);
  return { dem: bytesToInt16(demBytes), features: JSON.parse(new TextDecoder().decode(featBytes)), layers: layers ?? null, look: look ? JSON.parse(new TextDecoder().decode(look)) : null };
}

/**
 * Whether the doc's data was fetched for what the doc asks for now (its
 * place, grid, OpenStreetMap date and the rest of fetchSpec). Data stored
 * without saying what it was fetched for never fits.
 */
export function dataFits(doc) {
  const request = doc?.data?.request;
  return typeof request === "string" && request === specHash(fetchSpec(doc));
}
