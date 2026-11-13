// The whole state of a WebAssembly instance whose module has passed
// prepare(): its linear memory, the memory's size, and its mutable globals.
// Nothing else in an instance can change (see ENGINE.md), so capturing these
// is capturing everything.
//
// A target is { memory: WebAssembly.Memory, globals: [{ global, type }] },
// type one of i32 i64 f32 f64.
//
// Snapshot layout, little-endian, word-aligned throughout:
//   u32 pages | u32 global count | 8 bytes per global | memory bytes

export const PAGE = 65536;

/**
 * The state as bytes. `into`, if given and exactly the right size, is
 * overwritten and returned instead of allocating (a host that snapshots many
 * times a second recycles the ones it drops).
 */
export function snapshot({ memory, globals }, into) {
  const mem = new Uint8Array(memory.buffer);
  const size = headerSize(globals) + mem.length;
  const out = into?.length === size ? into : new Uint8Array(size);
  writeHeader(out, mem.length / PAGE, globals);
  out.set(mem, headerSize(globals));
  return out;
}

/** Pages of memory a snapshot holds. */
export function pages(snap) {
  return view(snap).getUint32(0, true);
}

/** Pages of memory a target has now. */
export function size({ memory }) {
  return memory.buffer.byteLength / PAGE;
}

/**
 * Writes a snapshot back. Memory grows to the snapshot's size; it cannot
 * shrink, so a target bigger than the snapshot is refused with a RangeError
 * and the caller restores into a fresh instance instead.
 */
export function restore(target, snap) {
  const { memory, globals } = target;
  const dv = view(snap);
  if (dv.getUint32(4, true) !== globals.length) throw new Error("snapshot is of another module");
  fit(target, pages(snap));
  globals.forEach((g, i) => (g.global.value = readValue(dv, 8 + 8 * i, g.type)));
  new Uint8Array(memory.buffer).set(snap.subarray(headerSize(globals)));
}

/** Makes target's state equal to source's, without an intermediate copy. */
export function copy(source, target) {
  fit(target, size(source));
  source.globals.forEach((g, i) => (target.globals[i].global.value = g.global.value));
  new Uint8Array(target.memory.buffer).set(new Uint8Array(source.memory.buffer));
}

/** The hash of a target's state; equal to hashSnapshot(snapshot(target)). */
export function hash({ memory, globals }) {
  const header = new Uint8Array(headerSize(globals));
  writeHeader(header, memory.buffer.byteLength / PAGE, globals);
  return digest([header, new Uint8Array(memory.buffer)]);
}

export function hashSnapshot(snap) {
  return digest([snap]);
}

function fit(target, want) {
  const have = size(target);
  if (have > want)
    throw new RangeError(`memory has ${have} pages, the state ${want}; memory cannot shrink`);
  if (have < want) target.memory.grow(want - have);
}

function headerSize(globals) {
  return 8 + 8 * globals.length;
}

function writeHeader(out, pageCount, globals) {
  const dv = view(out);
  dv.setUint32(0, pageCount, true);
  dv.setUint32(4, globals.length, true);
  globals.forEach((g, i) => writeValue(dv, 8 + 8 * i, g.type, g.global.value));
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function writeValue(dv, at, type, v) {
  if (type === "i32") dv.setInt32(at, v, true);
  else if (type === "i64") dv.setBigInt64(at, v, true);
  else if (type === "f32") dv.setFloat32(at, v, true);
  else dv.setFloat64(at, v, true);
}

function readValue(dv, at, type) {
  if (type === "i32") return dv.getInt32(at, true);
  if (type === "i64") return dv.getBigInt64(at, true);
  if (type === "f32") return dv.getFloat32(at, true);
  return dv.getFloat64(at, true);
}

// 64 bits: two MurmurHash3 (x86_32) lanes with different seeds and
// constants, run over the state's 32-bit words as one stream (every part is
// word-aligned). It tells peers' states apart; it does not resist forgery.
function digest(parts) {
  let h1 = 0x9747b28c, h2 = 0x2f8f6a6d, n = 0;
  for (const p of parts) {
    const w = new Uint32Array(p.buffer, p.byteOffset, p.byteLength >>> 2);
    for (let i = 0; i < w.length; i++) {
      h1 = round(h1, w[i], 0xcc9e2d51, 0x1b873593);
      h2 = round(h2, w[i], 0x85ebca77, 0xc2b2ae3d);
    }
    n += w.length;
  }
  return [h1, h2].map((h) => fmix(h ^ n).toString(16).padStart(8, "0")).join("");
}

function round(h, k, c1, c2) {
  k = Math.imul(k, c1);
  k = Math.imul((k << 15) | (k >>> 17), c2);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function fmix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
