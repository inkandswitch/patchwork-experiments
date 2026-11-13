// Doom's world for a spectator (doom-world.js), checked against what Doom
// itself does: the rotation a viewer sees, by r_things.c's own expression and
// by the geometry it means; the sector a point is in, by the BSP and by the
// map's lines; things standing on the floors Doom put them on; and every
// sprite in Freedoom, decoded and checked against a second decoder. All
// finite. Without the IWAD the cases that need it are skipped.
import { existsSync, readFileSync } from "node:fs";
import { compile } from "../engine.js";
import { FULL } from "../test-tier.js";
import { content, demo, MF, QUERY, sectors as decodeSectors, things as decodeThings } from "../doom.js";
import {
  ANG45, anchorOf, bam, bearing, decodePicture, directory, doomWorld, mapLumps, pointOnSide, rotationIndex,
  sectorFinder, spriteTable, UNITS_PER_METRE,
} from "./doom-world.js";

const dir = new URL("../../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", dir).pathname;
const haveIwad = existsSync(iwadPath);
const iwad = haveIwad ? readFileSync(iwadPath) : null;

const TURN = 2 ** 32;
const u32 = (x) => Number(BigInt.asUintN(32, BigInt(x)));

// ---------------------------------------------------------------------
// Rotations

/** r_things.c:515, as C computes it: rot = (ang - thing->angle + (unsigned)(ANG45/2)*9) >> 29, all unsigned 32-bit. */
const doomRot = (ang, facing) => Number(BigInt.asUintN(32, BigInt(ang) - BigInt(facing) + BigInt(ANG45 / 2) * 9n) >> 29n);

/**
 * The geometry it means: a viewer standing at φ counterclockwise from the
 * thing's facing (φ the viewer's bearing from the thing, less the facing)
 * sees rotation r for φ in [45(r-1) - 22.5, 45(r-1) + 22.5), in BAM.
 */
function seen(facing, bearingToThing) {
  const phi = u32(bearingToThing + TURN / 2 - facing); // the viewer, as seen from the thing
  const eighth = TURN / 8;
  return Math.floor(u32(phi + eighth / 2) / eighth); // index r - 1
}

describe("which rotation a viewer sees", () => {
  test("every 1/32 turn of facing by every 1/32 turn of bearing, and either side of every edge: Doom's expression and its geometry", () => {
    let n = 0;
    const step = TURN / 32;
    const check = (facing, ang) => {
      const r = rotationIndex(facing, ang);
      expect(r).toBe(doomRot(ang, facing));
      expect(r).toBe(seen(facing, ang));
      n++;
    };
    for (let f = 0; f < 32; f++)
      for (let b = 0; b < 32; b++) {
        const facing = f * step;
        const ang = u32(b * step);
        check(facing, ang);
        // On an odd 1/16 turn the viewer is on an edge between rotations: the lower edge belongs.
        check(facing, u32(ang - 1));
        check(facing, u32(ang + 1));
      }
    expect(n).toBe(32 * 32 * 3);
    // The edges are where they should be: from in front (bearing opposite the facing), rotation 1,
    // through 2 (the thing's left, seen from the viewer's 45 degrees counterclockwise) to 8.
    const facing = 0;
    const ahead = TURN / 2; // the viewer is east of the thing, looking west at it
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => rotationIndex(facing, u32(ahead + (k * TURN) / 8)))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rotationIndex(facing, u32(ahead + TURN / 16))).toBe(1); // the lower edge of rotation 2
    expect(rotationIndex(facing, u32(ahead + TURN / 16 - 1))).toBe(0);
  });

  test("bam and bearing: radians to BAM, the angle from viewer to thing", () => {
    for (let k = -16; k <= 32; k++) expect(bam((k * Math.PI) / 8)).toBe(u32((k * TURN) / 16));
    // Each of 16 compass points, a viewer 100 units out looking at a thing at the origin.
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      expect(bearing(100 * Math.cos(a), 100 * Math.sin(a), 0, 0)).toBe(u32((k * TURN) / 16 + TURN / 2));
    }
  });
});

// ---------------------------------------------------------------------
// The BSP

describe("pointOnSide (R_PointOnSide)", () => {
  test("agrees with the side of the line by exact arithmetic, off the line, for every direction on a grid", () => {
    // Nodes through (0, 0) in every direction with integer dx, dy in [-3, 3]; points on a grid.
    let n = 0;
    for (let ndx = -3; ndx <= 3; ndx++)
      for (let ndy = -3; ndy <= 3; ndy++) {
        if (!ndx && !ndy) continue;
        const node = { x: 0, y: 0, dx: ndx * 65536, dy: ndy * 65536 };
        for (let px = -5; px <= 5; px++)
          for (let py = -5; py <= 5; py++) {
            const cross = ndx * py - ndy * px; // > 0: left of the direction, Doom's back (1)
            if (cross === 0) continue;
            expect(pointOnSide(px * 65536, py * 65536, node)).toBe(cross > 0 ? 1 : 0);
            n++;
          }
      }
    expect(n).toBeGreaterThan(4000);
  });
});

/**
 * The sector a point is in, from the map's lines alone: cast a ray east and
 * take the side of the nearest line it crosses that faces the point. The
 * ray runs at a half-integer y, so it never meets a vertex (they are all
 * integers). null outside the map, and null within `near` map units of a
 * line: the BSP's subsectors are bounded by segs whose split points the
 * node builder rounded to whole units, so there Doom's answer and the
 * line's may part, by design.
 */
function linesOf(map) {
  const V = new DataView(map.VERTEXES.buffer, map.VERTEXES.byteOffset, map.VERTEXES.byteLength);
  const L = new DataView(map.LINEDEFS.buffer, map.LINEDEFS.byteOffset, map.LINEDEFS.byteLength);
  const S = new DataView(map.SIDEDEFS.buffer, map.SIDEDEFS.byteOffset, map.SIDEDEFS.byteLength);
  const sectorOf = (sd) => (sd === 0xffff ? null : S.getInt16(sd * 30 + 28, true));
  const out = [];
  for (let at = 0; at < map.LINEDEFS.length; at += 14) {
    const a = L.getUint16(at, true) * 4;
    const b = L.getUint16(at + 2, true) * 4;
    out.push({
      x1: V.getInt16(a, true), y1: V.getInt16(a + 2, true), x2: V.getInt16(b, true), y2: V.getInt16(b + 2, true),
      front: sectorOf(L.getUint16(at + 10, true)), back: sectorOf(L.getUint16(at + 12, true)),
    });
  }
  return out;
}

function sectorByLines(lines, x, y, near = 1) {
  let best = Infinity;
  let sector = null;
  for (const { x1, y1, x2, y2, front, back } of lines) {
    const [dx, dy] = [x2 - x1, y2 - y1];
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const [ex, ey] = [x - x1 - t * dx, y - y1 - t * dy];
    if (ex * ex + ey * ey < near * near) return null;
    if ((y1 > y) === (y2 > y)) continue;
    const cx = x1 + ((y - y1) * dx) / dy;
    if (cx <= x || cx - x >= best) continue;
    best = cx - x;
    // The point is on the line's right (front) when the line runs down past it, going v1 to v2 with y falling.
    sector = y2 < y1 ? front : back;
  }
  return sector;
}

describe.skipIf(!haveIwad)("doom's world (needs engines/doom/test/freedoom1.wad)", () => {
  const wads = haveIwad ? [iwad] : [];
  const lumpDir = haveIwad ? directory(iwad) : [];
  const maps = lumpDir.map((l) => l.name).filter((n) => /^E\dM\d$/.test(n));

  test("the BSP's sector is the one the map's lines enclose, at every point of a 16-unit grid (E1M1; every map in test:full)", () => {
    const report = {};
    for (const name of FULL ? maps : ["E1M1"]) {
      const map = mapLumps(lumpDir, name);
      const at = sectorFinder(map);
      const lines = linesOf(map);
      const V = new DataView(map.VERTEXES.buffer, map.VERTEXES.byteOffset, map.VERTEXES.byteLength);
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < map.VERTEXES.length; i += 4) {
        const [x, y] = [V.getInt16(i, true), V.getInt16(i + 2, true)];
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
      let inside = 0;
      const differ = [];
      for (let y = y0 + 0.5; y < y1; y += 16)
        for (let x = x0 + 0.25; x < x1; x += 16) {
          const want = sectorByLines(lines, x, y);
          if (want === null) continue;
          inside++;
          const got = at(Math.round(x * 65536), Math.round(y * 65536));
          if (got !== want) differ.push([x, y, got, want]);
        }
      report[name] = { inside, differ: differ.length };
      expect([name, differ.slice(0, 3)]).toEqual([name, []]);
    }
    expect(report.E1M1).toEqual({ inside: 24036, differ: 0 });
    if (FULL) expect(Object.keys(report).length).toBe(maps.length);
  });

  // ---------------------------------------------------------------------
  // Placement

  test("map units to metres as doom/ builds the map: 36 to the metre, x east, y up, z south, from the vertex bounds' middle", () => {
    expect(UNITS_PER_METRE).toBe(36);
    const world = doomWorld(wads, "E1M1");
    const map = mapLumps(lumpDir, "E1M1");
    expect(world.anchor).toEqual(anchorOf(map.VERTEXES));
    const [ax, ay] = world.anchor;
    expect(world.metres([ax, ay, 0])).toEqual([0, 0, -0]);
    expect(world.metres([ax + 36, ay, 0])).toEqual([1, 0, -0]); // east
    expect(world.metres([ax, ay + 36, 0])).toEqual([0, 0, -1]); // north is -z
    expect(world.metres([ax, ay, 36])).toEqual([0, 1, -0]); // up
    for (const p of [[ax - 100, ay + 37, 12], [0, 0, 0], [-768, 2000.5, -24]]) {
      const back = world.units(world.metres(p));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i], 9);
    }
  });

  test("a thing's yaw turns an object whose front is -z to face where the thing faces, every 1/16 turn", () => {
    const world = doomWorld(wads, "E1M1");
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const facing = [Math.cos(a) * 36, Math.sin(a) * 36, 0]; // a step the way it faces, map units
      const want = world.metres([world.anchor[0] + facing[0], world.anchor[1] + facing[1], 0]);
      const yaw = a - Math.PI / 2; // read()'s, doom/src/layout.js:51 yawOf
      const front = [-Math.sin(yaw), 0, -Math.cos(yaw)]; // -z turned by yaw about +Y
      for (let i = 0; i < 3; i++) expect(front[i]).toBeCloseTo(want[i], 12);
    }
  });

  // ---------------------------------------------------------------------
  // The world from the engine's queries

  const doomWasm = readFileSync(new URL("../../engines/doom/dist/doom.wasm", import.meta.url));
  const four = haveIwad ? demo(readFileSync(new URL("bot4p.lmp", dir))) : null;
  const boot = async () => (await compile(doomWasm)).boot(content({ wads, args: four.args }));
  const query = (e) => ({ things: e.query(QUERY.things), sectors: e.query(QUERY.sectors) });

  test("tic 0: every thing stands on the floor of the sector it is found in (or hangs from its ceiling), as Doom spawned it there", async () => {
    const e = await boot();
    const world = doomWorld(wads, "E1M1");
    const q = query(e);
    const state = world.read(q);
    const raw = decodeThings(q.things);
    const sec = decodeSectors(q.sectors);
    expect(state.things.length).toBe(raw.filter((t) => !(t.flags & MF.NOSECTOR)).length);
    expect(state.things.length).toBeGreaterThan(100);
    const SPAWNCEILING = 0x100;
    let hanging = 0;
    for (const [i, t] of state.things.entries()) {
      const r = raw.find((x) => x.id === t.id);
      // P_SpawnMobj (p_mobj.c:560-563): z is the subsector's sector's floor, or its ceiling less the height.
      const want = r.flags & SPAWNCEILING ? sec[t.sector].ceiling - r.height : sec[t.sector].floor;
      if (r.flags & SPAWNCEILING) hanging++;
      expect([i, r.z]).toEqual([i, want]);
      expect(t.position).toEqual(world.metres([r.x, r.y, r.z]));
      expect([t.radius, t.height]).toEqual([r.radius / 36, r.height / 36]);
      expect(t.light).toBe(r.fullbright ? 255 : sec[t.sector].light);
      expect(t.angle).toBe(u32(Math.round((r.angle / (2 * Math.PI)) * TURN)));
    }
    expect({ things: state.things.length, hanging }).toEqual({ things: 260, hanging: 2 });
    // Sectors as the map has them, in metres, nothing risen yet.
    const map = mapLumps(lumpDir, "E1M1");
    const S = new DataView(map.SECTORS.buffer, map.SECTORS.byteOffset, map.SECTORS.byteLength);
    expect(state.sectors.length).toBe(map.SECTORS.length / 26);
    state.sectors.forEach((s, i) => {
      expect(s.floor).toBe(S.getInt16(i * 26, true) / 36);
      expect(s.ceiling).toBe(S.getInt16(i * 26 + 2, true) / 36);
      expect(s.light).toBe(sec[i].light);
      expect(s.rise).toEqual({ floor: 0, ceiling: 0 });
      expect(s.gap).toBeCloseTo(s.ceiling - s.floor, 12);
    });
  });

  test("through the 4-player demo: the doors and the lift rise as the engine moves them, every thing in a sector, lights followed", async () => {
    const e = await boot();
    const world = doomWorld(wads, "E1M1");
    const risen = new Set();
    const every = FULL ? 1 : 105; // every tic in test:full, else 40 tics spread over the demo
    for (let t = 0; t < four.tics.length; t++) {
      e.step(four.tics[t]);
      if (t % every) continue;
      const q = query(e);
      const state = world.read(q);
      const sec = decodeSectors(q.sectors);
      state.sectors.forEach((s, i) => {
        if (s.rise.floor || s.rise.ceiling) risen.add(i);
        expect(s.light).toBe(sec[i].light);
      });
      for (const th of state.things) {
        expect(th.sector).toBeGreaterThanOrEqual(0);
        expect(th.light).toBe(th.fullbright ? 255 : sec[th.sector].light);
      }
    }
    // doom.test.js: the doors and lift the bots open are sectors 10, 98, 100 and 103.
    expect([...risen].every((i) => [10, 98, 100, 103].includes(i))).toBe(true);
    expect(risen.size).toBeGreaterThan(0);
  });

  test("look(): each thing's lump, mirror and rotation are its frame's, as a viewer at each of 16 bearings sees it", async () => {
    const e = await boot();
    const world = doomWorld(wads, "E1M1");
    const state = world.read(query(e));
    let checked = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8 + Math.PI / 32; // between the edges
      for (const t of state.things) {
        const eye = world.metres([t.units[0] + 300 * Math.cos(a), t.units[1] + 300 * Math.sin(a), t.units[2] + 41]);
        const [s] = world.look({ things: [t] }, eye);
        const frames = world.sprites.get(t.sprite);
        const f = frames[t.frame];
        const letter = String.fromCharCode(65 + t.frame);
        if (!f.rotate) {
          expect(s).toMatchObject({ rotation: 0, lump: f.lumps[0] });
          continue;
        }
        // The viewer stands at a + π from the thing's line of sight to it; φ from the thing's facing.
        const phi = (((a - (t.angle / TURN) * 2 * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const r = (Math.floor((phi + Math.PI / 8) / (Math.PI / 4)) % 8) + 1;
        expect(s.rotation).toBe(r);
        // The lump's name says it: frame and rotation in its first half, or mirrored in its second.
        const name = s.lump;
        const own = name.slice(4, 6) === `${letter}${r}`;
        const mirrored = name.length > 6 && name.slice(6, 8) === `${letter}${r}`;
        expect(own || mirrored).toBe(true);
        expect(s.flip).toBe(!own);
        const p = world.image(s.lump, t.translation);
        expect([s.width, s.height, s.left, s.top]).toEqual([p.width / 36, p.height / 36, p.left / 36, p.top / 36]);
        checked++;
      }
    }
    expect(checked).toBe(16 * 50); // the 50 things whose frames rotate (the rest are the same from everywhere)
  });

  // ---------------------------------------------------------------------
  // Sprites

  /** A second patch decoder: column by column into palette indices, then colours. */
  function reference(bytes, palette) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const [w, h] = [v.getInt16(0, true), v.getInt16(2, true)];
    const index = new Int16Array(w * h).fill(-1);
    for (let x = 0; x < w; x++) {
      let p = v.getUint32(8 + 4 * x, true);
      while (bytes[p] !== 0xff) {
        const [top, len] = [bytes[p], bytes[p + 1]];
        for (let k = 0; k < len; k++) if (top + k < h) index[(top + k) * w + x] = bytes[p + 3 + k];
        p += len + 4;
      }
    }
    const rgba = new Uint8Array(w * h * 4);
    index.forEach((c, i) => {
      if (c < 0) return;
      rgba.set([palette[3 * c], palette[3 * c + 1], palette[3 * c + 2], 255], 4 * i);
    });
    return rgba;
  }

  // Freedoom's two IWADs: the second (Doom II's monsters and more) when it is there (fetch-freedoom.sh fetches both).
  const iwad2Path = process.env.FREEDOOM2 ?? new URL("freedoom2.wad", dir).pathname;
  const SPRITES = {
    "freedoom1.wad": { sprites: 113, frames: 440, lumps: 853, pixels: 1910031 },
    "freedoom2.wad": { sprites: 140, frames: 652, lumps: 1350, pixels: 2878193 },
  };
  test.each(Object.keys(SPRITES).filter((f) => f === "freedoom1.wad" || existsSync(iwad2Path)))("every sprite in %s: Doom accepts its frames, and every lump decodes through PLAYPAL as a second decoder reads it", (file) => {
    const lumpDir = file === "freedoom1.wad" ? directory(iwad) : directory(readFileSync(iwad2Path));
    const table = spriteTable(lumpDir);
    const palette = lumpDir.findLast((l) => l.name === "PLAYPAL").bytes.subarray(0, 768);
    let frames = 0;
    const lumps = new Set();
    for (const prefix of table.prefixes) {
      const fs = table.get(prefix);
      expect(fs.length).toBeGreaterThan(0);
      for (const f of fs) {
        frames++;
        expect(f.lumps.every((l) => l !== null)).toBe(true);
        f.lumps.forEach((l) => lumps.add(l));
        if (!f.rotate) expect(new Set(f.lumps).size).toBe(1);
      }
    }
    let pixels = 0;
    for (const lump of lumps) {
      const bytes = table.bytes(lump);
      const p = decodePicture(bytes, palette);
      expect([lump, p.overrun]).toEqual([lump, 0]);
      expect(p.opaque).toBeGreaterThan(0);
      const want = reference(bytes, palette);
      expect([lump, Buffer.compare(Buffer.from(p.rgba), Buffer.from(want))]).toEqual([lump, 0]);
      pixels += p.opaque;
    }
    expect({ sprites: table.prefixes.length, frames, lumps: lumps.size, pixels }).toEqual(SPRITES[file]);
  });

  test("a player's colour recolours the green ramp and nothing else (R_InitTranslationTables)", () => {
    const table = spriteTable(lumpDir);
    const palette = lumpDir.findLast((l) => l.name === "PLAYPAL").bytes.subarray(0, 768);
    const lump = table.get("PLAY")[0].lumps[0];
    const bytes = table.bytes(lump);
    const plain = decodePicture(bytes, palette);
    for (const [t, base] of [[1, 0x60], [2, 0x40], [3, 0x20]]) {
      // The same picture with every 0x70-0x7f index rewritten, decoded plainly, is the translated one.
      const copy = Uint8Array.from(bytes);
      const v = new DataView(copy.buffer);
      const w = v.getInt16(0, true);
      for (let x = 0; x < w; x++) {
        let p = v.getUint32(8 + 4 * x, true);
        while (copy[p] !== 0xff) {
          const len = copy[p + 1];
          for (let k = 0; k < len; k++) if (copy[p + 3 + k] >= 0x70 && copy[p + 3 + k] <= 0x7f) copy[p + 3 + k] = base + (copy[p + 3 + k] & 0xf);
          p += len + 4;
        }
      }
      const got = decodePicture(bytes, palette, t);
      expect(Buffer.compare(Buffer.from(got.rgba), Buffer.from(decodePicture(copy, palette).rgba))).toBe(0);
      expect(Buffer.compare(Buffer.from(got.rgba), Buffer.from(plain.rgba))).not.toBe(0); // the marine has green in him
    }
  });

  test("Doom's refusals: a frame missing a rotation, or with a rotation and a rot=0 lump", () => {
    const wad = (names) => {
      // A WAD of S_START, the named one-pixel pictures, S_END.
      const pic = Uint8Array.from([1, 0, 1, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 1, 0, 7, 0, 0xff]);
      const all = ["S_START", ...names, "S_END"];
      const data = all.map((n) => (n.startsWith("S_") ? new Uint8Array() : pic));
      const size = 12 + data.reduce((a, d) => a + d.length, 0) + 16 * all.length;
      const out = new Uint8Array(size);
      const v = new DataView(out.buffer);
      out.set([73, 87, 65, 68]); // IWAD
      v.setInt32(4, all.length, true);
      let at = 12;
      const offsets = data.map((d) => {
        out.set(d, at);
        at += d.length;
        return at - d.length;
      });
      v.setInt32(8, at, true);
      all.forEach((n, i) => {
        v.setInt32(at + 16 * i, offsets[i], true);
        v.setInt32(at + 16 * i + 4, data[i].length, true);
        out.set(new TextEncoder().encode(n), at + 16 * i + 8);
      });
      return out;
    };
    const t = (names) => spriteTable(directory(wad(names)));
    expect(t(["TESTA0"]).get("TEST")[0]).toMatchObject({ rotate: false });
    expect(t(["TESTA1", "TESTA2A8", "TESTA3A7", "TESTA4A6", "TESTA5"]).get("TEST")[0].flips).toEqual([false, false, false, false, false, true, true, true]);
    expect(() => t(["TESTA1", "TESTA2"]).get("TEST")).toThrow("is missing rotations");
    expect(() => t(["TESTA0", "TESTA1"]).get("TEST")).toThrow("has rotations and a rot=0 lump");
    expect(() => t(["TESTA1", "TESTA1"]).get("TEST")).toThrow("has two lumps mapped to it");
    expect(() => t(["TESTB0"]).get("TEST")).toThrow("No patches found for TEST frame A");
    expect(() => t(["TESTA0", "TESTA0"]).get("TEST")).toThrow("multip rot=0 lump");
    expect(t(["TESTA0"]).get("NONE")).toBe(null);
  });
});
