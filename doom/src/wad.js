// Reading a WAD: Doom's archive of lumps, and the lumps a map is drawn from.
// Our own reading of the Unofficial Doom Specs v1.666 (dmsp1666, sections 2,
// 4 and 8): fixed-size little-endian records, nothing else. Pure; no DOM.
//
//   const wad = readWad(bytes)
//   wad.maps                    → ["E1M1", …] in directory order
//   readMap(wad, "E1M1")        → { things, linedefs, sidedefs, vertexes, sectors }
//   readPalette(wad)            → Uint8Array(768): palette 0 of PLAYPAL
//   readTextures(wad)           → Map NAME → { name, width, height, patches: [{ x, y, patch }] }
//   readPicture(bytes)          → { width, height, left, top, pixels: Int16Array (palette index, -1 clear) }
//   flat(wad, name)             → Uint8Array(4096) palette indices, or null
//   patch(wad, name)            → the picture lump's bytes, or null
//
// Names are upper-cased: Doom compares them without case.

const MAP_LUMPS = ["THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SEGS", "SSECTORS", "NODES", "SECTORS", "REJECT", "BLOCKMAP"];
const MAP_NAME = /^(E\dM\d|MAP\d\d)$/;

/** An 8-byte name: up to the first NUL, upper-cased. */
export function nameAt(view, at) {
  let s = "";
  for (let i = 0; i < 8; i++) {
    const c = view.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.toUpperCase();
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * The archive: its kind, its directory and where each map's lumps are.
 * @param {Uint8Array} bytes
 */
export function readWad(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("a WAD is bytes");
  if (bytes.byteLength < 12) throw new Error("too short to be a WAD");
  const v = viewOf(bytes);
  const kind = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (kind !== "IWAD" && kind !== "PWAD") throw new Error(`not a WAD (starts “${kind}”)`);
  const count = v.getInt32(4, true);
  const at = v.getInt32(8, true);
  if (count < 0 || at < 12 || at + count * 16 > bytes.byteLength) throw new Error("the WAD's directory runs past its end");
  const lumps = [];
  for (let i = 0; i < count; i++) {
    const o = at + i * 16;
    const pos = v.getInt32(o, true);
    const size = v.getInt32(o + 4, true);
    const name = nameAt(v, o + 8);
    if (size < 0 || (size > 0 && (pos < 0 || pos + size > bytes.byteLength))) throw new Error(`lump ${name} runs past the end of the WAD`);
    lumps.push({ name, pos, size });
  }
  const maps = [];
  for (let i = 0; i < lumps.length; i++) if (MAP_NAME.test(lumps[i].name) && lumps[i + 1]?.name === "THINGS") maps.push(lumps[i].name);
  const wad = { kind, bytes, lumps, maps, cache: new Map() };
  return wad;
}

/** The bytes of a lump. */
export const lumpBytes = (wad, l) => wad.bytes.subarray(l.pos, l.pos + l.size);

/** The last lump of this name between markers `from` and `to` (exclusive), or anywhere: Doom finds names from the end. */
export function findLump(wad, name, from = null, to = null) {
  const N = name.toUpperCase();
  let lo = 0;
  let hi = wad.lumps.length;
  if (from) {
    const a = wad.lumps.findIndex((l) => l.name === from);
    const b = wad.lumps.findIndex((l, i) => i > a && l.name === to);
    if (a < 0 || b < 0) return null;
    lo = a + 1;
    hi = b;
  }
  for (let i = hi - 1; i >= lo; i--) if (wad.lumps[i].name === N) return wad.lumps[i];
  return null;
}

/** Records of `size` bytes, each read by `read(view, at, index)`. */
function records(bytes, size, read) {
  if (bytes.byteLength % size) throw new Error(`a lump of ${size}-byte records is ${bytes.byteLength} bytes`);
  const v = viewOf(bytes);
  const out = [];
  for (let i = 0, at = 0; at < bytes.byteLength; i++, at += size) out.push(read(v, at, i));
  return out;
}

const side16 = (v, at) => {
  const n = v.getUint16(at, true);
  return n === 0xffff ? -1 : n;
};

/**
 * A map's lumps, decoded. Coordinates are Doom's: x east, y north, heights up,
 * in map units.
 * @returns {{ name, things: object[], linedefs: object[], sidedefs: object[], vertexes: object[], sectors: object[] }}
 */
export function readMap(wad, name) {
  const key = `map:${name}`;
  if (wad.cache.has(key)) return wad.cache.get(key);
  const i = wad.lumps.findIndex((l) => l.name === name);
  if (i < 0 || !wad.maps.includes(name)) throw new Error(`no map ${name} in this WAD (it has ${wad.maps.join(", ") || "none"})`);
  const lump = {};
  for (let k = i + 1; k < Math.min(wad.lumps.length, i + 1 + MAP_LUMPS.length); k++) {
    if (!MAP_LUMPS.includes(wad.lumps[k].name)) break;
    lump[wad.lumps[k].name] = lumpBytes(wad, wad.lumps[k]);
  }
  for (const need of ["THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SECTORS"]) if (!lump[need]) throw new Error(`map ${name} has no ${need}`);
  const map = {
    name,
    things: records(lump.THINGS, 10, (v, at) => ({ x: v.getInt16(at, true), y: v.getInt16(at + 2, true), angle: v.getInt16(at + 4, true), type: v.getInt16(at + 6, true), flags: v.getInt16(at + 8, true) })),
    linedefs: records(lump.LINEDEFS, 14, (v, at) => ({
      v1: v.getUint16(at, true),
      v2: v.getUint16(at + 2, true),
      flags: v.getUint16(at + 4, true),
      special: v.getUint16(at + 6, true),
      tag: v.getUint16(at + 8, true),
      right: side16(v, at + 10),
      left: side16(v, at + 12),
    })),
    sidedefs: records(lump.SIDEDEFS, 30, (v, at) => ({
      xoff: v.getInt16(at, true),
      yoff: v.getInt16(at + 2, true),
      upper: nameAt(v, at + 4),
      lower: nameAt(v, at + 12),
      middle: nameAt(v, at + 20),
      sector: v.getUint16(at + 28, true),
    })),
    vertexes: records(lump.VERTEXES, 4, (v, at) => ({ x: v.getInt16(at, true), y: v.getInt16(at + 2, true) })),
    sectors: records(lump.SECTORS, 26, (v, at) => ({
      floor: v.getInt16(at, true),
      ceiling: v.getInt16(at + 2, true),
      floorFlat: nameAt(v, at + 4),
      ceilingFlat: nameAt(v, at + 12),
      light: v.getInt16(at + 20, true),
      special: v.getUint16(at + 22, true),
      tag: v.getUint16(at + 24, true),
    })),
  };
  checkMap(map);
  wad.cache.set(key, map);
  return map;
}

/** Every reference in a map points at something there (else the map can't be drawn). */
function checkMap(map) {
  const nv = map.vertexes.length;
  const ns = map.sidedefs.length;
  map.linedefs.forEach((l, i) => {
    if (l.v1 >= nv || l.v2 >= nv) throw new Error(`${map.name}: line ${i} names a vertex that isn't there`);
    if (l.right < 0 || l.right >= ns) throw new Error(`${map.name}: line ${i} has no front side`);
    if (l.left >= ns) throw new Error(`${map.name}: line ${i} names a side that isn't there`);
  });
  map.sidedefs.forEach((s, i) => {
    if (s.sector >= map.sectors.length) throw new Error(`${map.name}: side ${i} names a sector that isn't there`);
  });
}

/** Palette 0 of PLAYPAL: 256 × rgb. */
export function readPalette(wad) {
  const l = findLump(wad, "PLAYPAL");
  if (!l || l.size < 768) throw new Error("this WAD has no palette (PLAYPAL)");
  return lumpBytes(wad, l).subarray(0, 768);
}

/** PNAMES: the patch names textures refer to by number. */
export function readPatchNames(wad) {
  const l = findLump(wad, "PNAMES");
  if (!l) return [];
  const b = lumpBytes(wad, l);
  const v = viewOf(b);
  const n = v.getInt32(0, true);
  const out = [];
  for (let i = 0; i < n; i++) out.push(nameAt(v, 4 + i * 8));
  return out;
}

/** TEXTURE1 and TEXTURE2: each wall texture as patches laid on a canvas. A later definition of a name wins. */
export function readTextures(wad) {
  if (wad.cache.has("textures")) return wad.cache.get("textures");
  const names = readPatchNames(wad);
  const out = new Map();
  for (const lumpName of ["TEXTURE1", "TEXTURE2"]) {
    const l = findLump(wad, lumpName);
    if (!l) continue;
    const b = lumpBytes(wad, l);
    const v = viewOf(b);
    const n = v.getInt32(0, true);
    for (let i = 0; i < n; i++) {
      const at = v.getInt32(4 + i * 4, true);
      const name = nameAt(v, at);
      const width = v.getInt16(at + 12, true);
      const height = v.getInt16(at + 14, true);
      const count = v.getInt16(at + 20, true);
      const patches = [];
      for (let k = 0; k < count; k++) {
        const p = at + 22 + k * 10;
        patches.push({ x: v.getInt16(p, true), y: v.getInt16(p + 2, true), patch: names[v.getInt16(p + 4, true)] ?? null });
      }
      out.set(name, { name, width, height, patches });
    }
  }
  wad.cache.set("textures", out);
  return out;
}

/**
 * A picture (a patch): columns of posts. Pixels are palette indices, row by
 * row from the top, -1 where nothing is drawn.
 */
export function readPicture(bytes) {
  const v = viewOf(bytes);
  const width = v.getInt16(0, true);
  const height = v.getInt16(2, true);
  const left = v.getInt16(4, true);
  const top = v.getInt16(6, true);
  if (width <= 0 || height <= 0 || 8 + width * 4 > bytes.byteLength) throw new Error("not a picture");
  const pixels = new Int16Array(width * height).fill(-1);
  for (let x = 0; x < width; x++) {
    let at = v.getInt32(8 + x * 4, true);
    // posts until 0xff; a post is its top row, its length, a pad byte, the pixels, a pad byte
    for (let guard = 0; guard < 256 && at < bytes.byteLength; guard++) {
      const row = bytes[at];
      if (row === 0xff) break;
      const len = bytes[at + 1];
      for (let k = 0; k < len; k++) {
        const y = row + k;
        if (y < height) pixels[y * width + x] = bytes[at + 3 + k];
      }
      at += len + 4;
    }
  }
  return { width, height, left, top, pixels };
}

/** A patch's picture bytes, by name (between P_START and P_END, else anywhere). */
export function patch(wad, name) {
  const l = findLump(wad, name, "P_START", "P_END") ?? findLump(wad, name, "PP_START", "PP_END") ?? findLump(wad, name);
  return l ? lumpBytes(wad, l) : null;
}

/** A flat (64 × 64 palette indices, row by row), by name. */
export function flat(wad, name) {
  const l = findLump(wad, name, "F_START", "F_END") ?? findLump(wad, name, "FF_START", "FF_END");
  return l && l.size >= 4096 ? lumpBytes(wad, l).subarray(0, 4096) : null;
}
