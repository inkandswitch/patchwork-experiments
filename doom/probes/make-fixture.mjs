// The tests' WAD: one map of a full WAD and only what drawing it needs, as a
// PWAD, so the tests run anywhere without the 28 MB IWAD.
//
//   node probes/make-fixture.mjs <freedoom1.wad> [E1M1]
//
// Writes src/test/<map>.wad: the map's lumps verbatim, PLAYPAL, PNAMES,
// TEXTURE1/2, the FREEDOOM marker, the patches its textures are made of
// (between P_START/P_END) and its flats (between F_START/F_END). Freedoom's
// data is BSD-licensed: its notice goes beside it (src/test/COPYING.txt).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findLump, lumpBytes, readMap, readTextures, readWad } from "../src/wad.js";

const [src, mapName = "E1M1"] = process.argv.slice(2);
if (!src) throw new Error("usage: node probes/make-fixture.mjs <wad> [map]");
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wad = readWad(new Uint8Array(readFileSync(src)));
const map = readMap(wad, mapName);
const walls = new Set(map.sidedefs.flatMap((s) => [s.upper, s.lower, s.middle]).filter((n) => n && n !== "-"));
const flats = new Set(map.sectors.flatMap((s) => [s.floorFlat, s.ceilingFlat]));
const textures = readTextures(wad);
const patches = new Set([...walls].flatMap((n) => textures.get(n)?.patches.map((p) => p.patch) ?? []).filter(Boolean));

const out = []; // [name, bytes]
const put = (name, bytes) => out.push([name, bytes]);
const lump = (name) => {
  const l = findLump(wad, name);
  if (!l) throw new Error(`no ${name}`);
  return lumpBytes(wad, l);
};
for (const name of ["PLAYPAL", "PNAMES", "TEXTURE1", "TEXTURE2", "FREEDOOM"]) if (findLump(wad, name)) put(name, lump(name));
put(mapName, new Uint8Array(0));
const i = wad.lumps.findIndex((l) => l.name === mapName);
for (let k = i + 1; k < i + 11 && k < wad.lumps.length; k++) put(wad.lumps[k].name, lumpBytes(wad, wad.lumps[k]));
put("P_START", new Uint8Array(0));
for (const p of [...patches].sort()) {
  const l = findLump(wad, p, "P_START", "P_END") ?? findLump(wad, p);
  if (l) put(p, lumpBytes(wad, l));
}
put("P_END", new Uint8Array(0));
put("F_START", new Uint8Array(0));
for (const f of [...flats].sort()) {
  const l = findLump(wad, f, "F_START", "F_END");
  if (l) put(f, lumpBytes(wad, l));
}
put("F_END", new Uint8Array(0));

const size = 12 + out.reduce((a, [, b]) => a + b.length, 0) + out.length * 16;
const bytes = new Uint8Array(size);
const v = new DataView(bytes.buffer);
bytes.set([..."PWAD"].map((c) => c.charCodeAt(0)), 0);
v.setInt32(4, out.length, true);
let at = 12;
const dir = [];
for (const [name, b] of out) {
  bytes.set(b, at);
  dir.push([name, at, b.length]);
  at += b.length;
}
v.setInt32(8, at, true);
for (const [name, pos, len] of dir) {
  v.setInt32(at, pos, true);
  v.setInt32(at + 4, len, true);
  for (let c = 0; c < 8; c++) bytes[at + 8 + c] = c < name.length ? name.charCodeAt(c) : 0;
  at += 16;
}
const dest = join(PKG, "src", "test", `${mapName.toLowerCase()}.wad`);
writeFileSync(dest, bytes);
const copying = join(dirname(src), "COPYING.txt");
if (existsSync(copying)) copyFileSync(copying, join(PKG, "src", "test", "COPYING.txt"));
console.log(`${dest}: ${bytes.length} bytes, ${out.length} lumps (${patches.size} patches, ${flats.size} flats)`);
