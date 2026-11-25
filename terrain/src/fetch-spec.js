// What a fetch reads from a Terrain doc, and the key that names a fetch.
//
// The spec is everything fetchTerrainData looks at: the place and its grid,
// the datum and offsets that decide whether the data can be built, OSM's
// date, and for a layered place its heights, look, provenance and credits.
// The Terrain tool and the fetch task both take it from here, so what is
// fetched, what is checked before storing, and what the key names are the
// same thing.

import { sha256HexNow } from "./hash.js";

/** The spec a fetch of this Terrain doc asks for, as plain JSON: fields the doc leaves empty are left out. */
export function fetchSpec(d) {
  const spec = {
    origin: d?.origin,
    grid: d?.grid,
    demToMWL: d?.demToMWL ?? 0,
    datum: d?.datum ?? null,
    osmDate: d?.osmDate ?? null,
    heightScale: d?.heightScale ?? null,
    heights: d?.heights ?? null,
    look: d?.look ?? null,
    provenance: d?.provenance ?? null,
    // a layered place's credits come from the place, so they are part of what it asks for
    attribution: d?.heights ? d.attribution || null : null,
    credit: d?.heights ? d.credit || null : null,
  };
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(spec).filter(([, v]) => v != null))));
}

/**
 * JSON with every object's keys in order, so that one spec reads the same
 * whatever order its fields were written in (two replicas, or a copy).
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Whether two specs ask for the same data. */
export function sameSpec(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * The SHA-256 of what a spec asks for: what a fetch's key names, and what
 * stored data records it was fetched for (store.js), so that whether the data
 * fits what the doc asks for now is one comparison.
 */
export function specHash(spec) {
  return sha256HexNow(new TextEncoder().encode(canonicalJson(spec)));
}

/**
 * The key a fetch of `terrainUrl` is asked under: the doc and the hash of
 * what it asks for. Asking twice for the same place and grid is asking once;
 * a changed frame is another fetch.
 */
export function fetchKey(terrainUrl, spec) {
  return `terrain-fetch:${terrainUrl}:${specHash(spec)}`;
}

/**
 * What Fetch data asks for this Terrain doc now: the task's input (the doc
 * and the spec) and the key it is asked under, both from one spec, so the
 * task fetches exactly what its key names.
 */
export function fetchRequest(terrainUrl, doc) {
  const spec = fetchSpec(doc);
  return { input: { terrain: terrainUrl, spec }, key: fetchKey(terrainUrl, spec) };
}
