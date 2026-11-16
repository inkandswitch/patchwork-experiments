// A run's flow volume read back: only what's asked for (the mesh, some
// fields, some pieces), and OpenFOAM's binary files as typed arrays.
// daemon/volume.mjs writes it; see there for the doc's shape.

import { getBytes, isRef, FETCH_PARALLEL } from "./segments.js";

export const VOLUME_TYPE = "openfoam-volume";
export const VOLUME_VERSION = 1;
/** The mesh files kept: what a reader needs to rebuild the cells (snappy's leftovers aren't). */
export const MESH_FILES = ["points", "faces", "owner", "neighbour", "boundary", "cellZones", "faceZones", "pointZones"];

const sizeOf = (v) => (v == null ? 0 : isRef(v) ? v.size : v.byteLength ?? 0);

/**
 * How many bytes a read would fetch.
 * @param {object} doc  the volume doc
 * @param {{ mesh?: boolean|string[], fields?: string[], pieces?: number[] }} want
 */
export function volumeBytes(doc, { mesh = true, fields = [], pieces = null } = {}) {
  const at = pieces ?? doc.pieces.map((_, i) => i);
  const meshNames = mesh === true ? Object.keys(doc.mesh ?? {}) : Array.isArray(mesh) ? mesh : [];
  let n = 0;
  for (const name of meshNames) for (const i of at) n += sizeOf(doc.mesh?.[name]?.[i]);
  for (const name of fields) for (const i of at) n += sizeOf(doc.fields?.[name]?.[i]);
  return n;
}

/**
 * Fetch some of a volume: the bytes of each file asked for, per piece.
 * @returns {Promise<{ time: string, pieces: string[], mesh: Record<string, Uint8Array[]>, fields: Record<string, Uint8Array[]> }>}
 *   arrays indexed like `pieces` (unasked pieces left undefined)
 */
export async function readVolume(repo, doc, { mesh = true, fields = [], pieces = null, parallel = FETCH_PARALLEL, find } = {}) {
  if (doc?.["@patchwork"]?.type !== VOLUME_TYPE || doc.version !== VOLUME_VERSION) throw new Error("not a flow volume this reads");
  const at = pieces ?? doc.pieces.map((_, i) => i);
  const meshNames = mesh === true ? Object.keys(doc.mesh ?? {}) : Array.isArray(mesh) ? mesh : [];
  const out = { time: doc.time, pieces: [...doc.pieces], mesh: {}, fields: {} };
  const jobs = [];
  for (const name of meshNames) {
    out.mesh[name] = new Array(doc.pieces.length);
    for (const i of at) jobs.push([out.mesh[name], i, doc.mesh?.[name]?.[i]]);
  }
  for (const name of fields) {
    if (!doc.fields?.[name]) throw new Error(`the volume has no ${name}`);
    out.fields[name] = new Array(doc.pieces.length);
    for (const i of at) jobs.push([out.fields[name], i, doc.fields[name][i]]);
  }
  // one file at a time; getBytes fetches a file's segments `parallel` at once
  for (const [arr, i, v] of jobs) arr[i] = v == null ? null : await getBytes(repo, v, { parallel, ...(find ? { find } : {}) });
  return out;
}

// ---------------------------------------------------------------- OpenFOAM binary files

const COMPONENTS = { scalar: 1, vector: 3, symmTensor: 6, tensor: 9, sphericalTensor: 1 };
const LATIN1 = new TextDecoder("latin1");

/** Read a decimal count, then "(", from `at`; returns the count and where the binary starts. */
function listAt(bytes, at) {
  const text = LATIN1.decode(bytes.subarray(at, Math.min(bytes.length, at + 256)));
  const m = /^(?:\s|\/\/[^\n]*\n)*(\d+)\s*\(/.exec(text); // past whitespace and // comments
  if (!m) throw new Error("no list here");
  return { count: +m[1], start: at + m[0].length };
}

/** A typed array over `n` items of `width` bytes at `start` (copied, so it's aligned). */
function take(bytes, start, n, width, Kind) {
  const end = start + n * width;
  if (end > bytes.length) throw new Error("the list runs past the end of the file");
  if (bytes[end] !== 0x29) throw new Error("the list doesn't end where its count says"); // ")"
  // a copy (Uint8Array's slice: a node Buffer's slice is a view onto a shared pool)
  return new Kind(Uint8Array.prototype.slice.call(bytes, start, end).buffer);
}

/**
 * The data of an OpenFOAM binary file: points, faces, owner, neighbour, or a
 * volume field's internal values.
 * @returns {{ class: string, object: string,
 *   values?: Float64Array|Int32Array, components?: number,     // a list, or a field's internal values
 *   offsets?: Int32Array, labels?: Int32Array,                 // faceCompactList
 *   uniform?: number[] }}                                      // a field that's one value everywhere
 */
export function parseFoam(bytes) {
  const head = LATIN1.decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const field = (k) => {
    const m = new RegExp(`\\b${k}\\s+(?:"([^"]*)"|([^;\\s]+))\\s*;`).exec(head);
    return m ? (m[1] ?? m[2]).trim() : undefined;
  };
  if (field("format") !== "binary") throw new Error("not a binary OpenFOAM file");
  const arch = field("arch") ?? "LSB;label=32;scalar=64";
  if (!/LSB/.test(arch) || !/label=32/.test(arch) || !/scalar=64/.test(arch)) throw new Error(`can't read arch ${arch}`);
  const cls = field("class");
  const object = field("object");
  const body = head.indexOf("}") + 1;
  if (cls === "vectorField") {
    const { count, start } = listAt(bytes, body);
    return { class: cls, object, components: 3, values: take(bytes, start, count, 24, Float64Array) };
  }
  if (cls === "labelList") {
    const { count, start } = listAt(bytes, body);
    return { class: cls, object, components: 1, values: take(bytes, start, count, 4, Int32Array) };
  }
  if (cls === "faceCompactList") {
    const a = listAt(bytes, body);
    const offsets = take(bytes, a.start, a.count, 4, Int32Array);
    const b = listAt(bytes, a.start + a.count * 4 + 1);
    return { class: cls, object, offsets, labels: take(bytes, b.start, b.count, 4, Int32Array) };
  }
  const vol = /^vol(\w+)Field$/.exec(cls ?? "");
  if (vol) {
    const kind = vol[1][0].toLowerCase() + vol[1].slice(1);
    const components = COMPONENTS[kind];
    const i = head.indexOf("internalField");
    if (i < 0 || !components) throw new Error(`can't read a ${cls}`);
    const uni = /^internalField\s+uniform\s+(\(([^)]*)\)|[^;\s]+)\s*;/.exec(head.slice(i));
    if (uni) return { class: cls, object, components, uniform: (uni[2] ?? uni[1]).trim().split(/\s+/).map(Number) };
    const m = /^internalField\s+nonuniform\s+List<\w+>\s*/.exec(head.slice(i));
    if (!m) throw new Error(`can't read ${object}'s internal field`);
    const { count, start } = listAt(bytes, i + m[0].length);
    return { class: cls, object, components, values: take(bytes, start, count, 8 * components, Float64Array) };
  }
  throw new Error(`can't read a ${cls}`);
}
