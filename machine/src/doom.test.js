// Chocolate Doom as a machine engine (engines/doom), checked against native
// Chocolate Doom and against itself. Everything is fixed and finite: three
// demos the closed-loop bot of patch 0001 recorded on Freedoom's E1M1 at
// Ultra-Violence (1, 2 and 4 players, 4200 tics each), and the native
// engine's trace hash after every one of their tics (engines/doom/test).
//
// The IWAD is not committed; engines/doom/test/fetch-freedoom.sh fetches it
// (or set FREEDOOM1 to its path). Without it these tests are skipped.
import { existsSync, readFileSync } from "node:fs";
import { compile } from "./engine.js";
import { FULL } from "./test-tier.js";
import {
  BT, INPUT_BYTES, MF, PLAYERS, QUERY, camera, content, demo, events, level, listener, players, sectors,
  sides, sounds, things, ticcmd,
} from "./doom.js";

const dir = new URL("../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", dir).pathname;
const haveIwad = existsSync(iwadPath);
const wasm = readFileSync(new URL("../engines/doom/dist/doom.wasm", import.meta.url));
const machine = await compile(wasm);
const iwad = haveIwad ? readFileSync(iwadPath) : null;

const demos = Object.fromEntries(
  [1, 2, 4].map((n) => [n, demo(readFileSync(new URL(`bot${n}p.lmp`, dir)))]),
);
const native = (n) => readFileSync(new URL(`bot${n}p.strict`, dir), "utf8").trim().split("\n");
const boot = (n, extra = []) => machine.boot(content({ wads: [iwad], args: [...demos[n].args, ...extra] }));

// The trace hashes of patch 0001, taken on a copy of the state.
function trace(e) {
  const { result, memory } = e.inspect("doom_trace");
  return Array.from(new BigUint64Array(memory.buffer, result, 12), (h) => h.toString(16).padStart(16, "0"));
}

const bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
const equal = (x, y) => Buffer.compare(bytes(x), bytes(y)) === 0;

// Byte equality of whole states, through reusable snapshot buffers.
function comparer() {
  let a, b;
  return (x, y) => {
    a = x.snapshot(a);
    b = y.snapshot(b);
    return Buffer.compare(a, b) === 0;
  };
}

const LONG = 180_000;

describe.skipIf(!haveIwad)("doom (needs engines/doom/test/freedoom1.wad)", () => {
  // Fast tier: 1p, its first 700 tics; full: every tic of all three.
  test.each(FULL ? [1, 2, 4] : [1])(
    "%ip: every tic's state hashes as native Chocolate Doom's does",
    (n) => {
      const want = native(n);
      expect(want.length).toBe(demos[n].tics.length + 1);
      const tics = FULL ? demos[n].tics : demos[n].tics.slice(0, 700);
      const e = boot(n);
      const pages = e.snapshot().length;
      expect(trace(e)[1]).toBe(want[0]);
      for (let t = 0; t < tics.length; t++) {
        e.step(tics[t]);
        const strict = trace(e)[1];
        if (strict !== want[t + 1]) throw new Error(`${n}p tic ${t + 1}: ${strict}, native ${want[t + 1]}`);
      }
      // Doom's memory is its fixed zone: it never grows in play.
      expect(e.snapshot().length).toBe(pages);
    },
    LONG,
  );

  // Rollback and late join. A reference engine plays the demo. At every
  // K-th tic t its snapshot is restored into two others: a peer that has
  // just stepped K tics on predicted inputs (each port repeating its input
  // of tic t - 1), so it restores backwards from a wrong future; and a
  // freshly booted engine, which restores forwards from tick 0. Both then
  // step the true inputs, and after every tic both states must equal the
  // reference's byte for byte.
  test.each(FULL ? [[1, 35], [2, 35], [4, 35], [4, 1]] : [[4, 1]])(
    "%ip: restoring every %i-th tic's snapshot, from a mispredicted future or from boot, re-steps exactly",
    (n, K) => {
      const tics = K === 1 ? demos[n].tics.slice(0, 140) : demos[n].tics;
      const same = comparer();
      const ref = boot(n);
      const peer = boot(n);
      let diverged = 0;
      for (let t = 0; t < tics.length; t += K) {
        const s = ref.snapshot();
        const predicted = t === 0 ? new Uint8Array(PLAYERS * INPUT_BYTES) : tics[t - 1];
        for (let j = 0; j < K && t + j < tics.length; j++) peer.step(predicted);
        const late = boot(n);
        peer.restore(s);
        late.restore(s);
        for (let j = 0; j < K && t + j < tics.length; j++) {
          ref.step(tics[t + j]);
          // the misprediction mattered if the true input differs
          if (j === 0 && Buffer.compare(tics[t], predicted) !== 0) diverged++;
          peer.step(tics[t + j]);
          late.step(tics[t + j]);
          if (!same(peer, ref)) throw new Error(`${n}p: peer differs at tic ${t + j + 1} after restoring ${t}`);
          if (!same(late, ref)) throw new Error(`${n}p: late joiner differs at tic ${t + j + 1} after restoring ${t}`);
        }
      }
      expect(diverged).toBeGreaterThan(tics.length / K / 4);
    },
    LONG,
  );

  test(
    "4p: drawing every player's view and a camera at each one's eyes, every query, reading output and tracing, every tic, never change the state",
    async () => {
      const same = comparer();
      const tics = FULL ? demos[4].tics : demos[4].tics.slice(0, 140); // fast tier: the first 4 seconds
      const plain = boot(4);
      const busy = boot(4);
      const kinds = [...Object.values(QUERY), Object.keys(QUERY).length]; // and one there is not
      for (let t = 0; t < tics.length; t++) {
        plain.step(tics[t]);
        busy.step(tics[t]);
        busy.output();
        for (let v = -1; v < PLAYERS; v++) busy.frame(v);
        for (const k of kinds) busy.query(k);
        for (const eyes of players(busy.query(QUERY.players))) camera(busy, eyes);
        trace(busy);
        if (!same(plain, busy)) throw new Error(`observing changed the state at tic ${t + 1}`);
        if (t % 350 === 0) await new Promise(setImmediate); // let the test runner breathe
      }
      expect(plain.hash()).toBe(busy.hash());
    },
    LONG,
  );

  test("drawing writes memory, which is why it happens on a copy", { timeout: 60_000 }, () => {
    const e = boot(4);
    for (const tic of demos[4].tics.slice(0, 700)) e.step(tic);
    const live = e.snapshot();
    const size = new DataView(live.buffer).getUint32(0, true) * 65536; // the snapshot's pages
    const { memory } = e.inspect("machine_frame", 0);
    const drawn = new Uint8Array(memory.buffer, 0, size);
    expect(equal(drawn, live.subarray(live.length - size))).toBe(false);
    expect(equal(e.snapshot(), live)).toBe(true);
  });

  test("each player's frame is that player's view, and equal states draw equal frames", () => {
    const a = boot(4);
    const b = boot(4);
    for (const tic of demos[4].tics.slice(0, 1500)) {
      a.step(tic);
      b.step(tic);
    }
    const frames = [0, 1, 2, 3].map((v) => a.frame(v));
    for (const f of frames) {
      expect([f.width, f.height]).toEqual([320, 200]);
      expect(f.rgba.length).toBe(320 * 200 * 4);
    }
    expect(new Set(frames.map((f) => bytes(f.rgba).toString("base64"))).size).toBe(4);
    for (let v = 0; v < 4; v++) expect(equal(b.frame(v).rgba, frames[v].rgba)).toBe(true);
    // a view that is not a player in the game shows player 0's
    expect(equal(a.frame(-1).rgba, frames[0].rgba)).toBe(true);
    const two = boot(2);
    for (const tic of demos[2].tics.slice(0, 100)) two.step(tic);
    expect(equal(two.frame(3).rgba, two.frame(0).rgba)).toBe(true);
  });

  test("2p: every sound is a lump the host can play, and pickups say whose they are", () => {
    const pcm = sounds(iwad);
    const e = boot(2);
    const pickups = new Set();
    let records = 0;
    for (const tic of demos[2].tics) {
      e.step(tic);
      const [music, ...rest] = events(e.output().events);
      expect(music).toEqual({ kind: "music", name: "D_E1M1", loops: true, paused: false });
      for (const ev of rest) {
        records++;
        expect(ev.kind === "sound" || ev.kind === "stop").toBe(true);
        if (ev.kind === "stop") continue;
        expect(pcm.has(ev.name)).toBe(true);
        expect(ev.volume).toBeGreaterThan(0);
        if (ev.name === "DSITEMUP" || ev.name === "DSWPNUP") pickups.add(ev.player);
      }
    }
    expect(records).toBeGreaterThan(100);
    // vanilla plays a pickup only for the console player; here both are heard
    expect([...pickups].sort()).toEqual([0, 1]);
    const pistol = pcm.get("DSPISTOL");
    expect([11025, 22050]).toContain(pistol.rate);
    expect(pistol.samples.every((s) => s >= -1 && s < 1)).toBe(true);
  });

  test("the save button is dropped and the pause button pauses", () => {
    const same = comparer();
    const idle = new Uint8Array(PLAYERS * INPUT_BYTES);
    const press = (buttons) => ticcmd({ buttons }, new Uint8Array(PLAYERS * INPUT_BYTES));
    const a = boot(1);
    const b = boot(1);
    a.step(press(BT.SPECIAL | 2 /* BTS_SAVEGAME */ | (3 << 2)));
    b.step(idle);
    expect(same(a, b)).toBe(true);

    a.step(press(BT.PAUSE));
    expect(events(a.output().events)[0].paused).toBe(true);
    const paused = trace(a);
    for (let i = 0; i < 10; i++) a.step(ticcmd({ forward: 50 }, new Uint8Array(PLAYERS * INPUT_BYTES)));
    const [, , mobjs, player] = trace(a);
    expect(mobjs).toBe(paused[2]); // nothing moves while paused,
    expect(player).not.toBe(paused[3]); // though each player's ticcmd is still read
    a.step(press(BT.PAUSE));
    expect(events(a.output().events)[0].paused).toBe(false);
  });

  test("content: the IWAD stays out of memory, and bad content is refused with Doom's reason", () => {
    const e = boot(1);
    expect(e.snapshot().length).toBeLessThan(8 << 20);
    expect(iwad.length).toBeGreaterThan(8 << 20);
    expect(e.hash()).toBe(boot(1).hash());
    expect(() => machine.boot(iwad)).toThrow(/bare WAD/);
    const only = (...args) => machine.boot(content({ wads: [iwad], args }));
    expect(() => only("-players", "5")).toThrow(/-players: 5/);
    expect(() => only("-mb", "1")).toThrow(/Z_Malloc: failed/);
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => `${i.module}.${i.name}`);
    expect(imports.sort()).toEqual(["env.emscripten_notify_memory_growth", "machine.content_read", "machine.content_size"]);
  });
  // E1M1 as the IWAD has it: its lumps follow the map's marker.
  function mapLumps(wad, map) {
    const v = new DataView(wad.buffer, wad.byteOffset, wad.byteLength);
    const dir = v.getInt32(8, true);
    const name = (i) => new TextDecoder().decode(wad.subarray(dir + 16 * i + 8, dir + 16 * i + 16)).replace(/\0.*$/, "");
    const lump = (i) => wad.subarray(v.getInt32(dir + 16 * i, true), v.getInt32(dir + 16 * i, true) + v.getInt32(dir + 16 * i + 4, true));
    let i = 0;
    while (name(i) !== map) i++;
    const out = {};
    for (let j = i + 1; j <= i + 10; j++) out[name(j)] = lump(j);
    return out;
  }
  const s16 = (b, at) => (b[at] | (b[at + 1] << 8)) << 16 >> 16;
  const str8 = (b, at) => new TextDecoder().decode(b.subarray(at, at + 8)).replace(/\0.*$/, "").toUpperCase();
  const FRACUNIT = 65536;
  const bam = (radians) => Math.round(radians / ((2 * Math.PI) / 2 ** 32));

  test("4p, tic 0: the queries are the map as the WAD has it, and the players stand on its starts", () => {
    const e = boot(4);
    const map = mapLumps(iwad, "E1M1");

    // Sectors (26 bytes each) and sidedefs (30), in the map's order. The
    // light and timed-door specials become thinkers when the level loads
    // (P_SpawnSpecials), which clears them from the sector.
    const THINKERS = new Set([1, 2, 3, 8, 10, 12, 13, 14, 17]);
    const sec = sectors(e.query(QUERY.sectors));
    expect(sec.length).toBe(map.SECTORS.length / 26);
    sec.forEach((s, i) => {
      const at = i * 26;
      expect(s).toEqual({
        floor: s16(map.SECTORS, at), ceiling: s16(map.SECTORS, at + 2),
        floorpic: str8(map.SECTORS, at + 4), ceilingpic: str8(map.SECTORS, at + 12),
        light: s16(map.SECTORS, at + 20), tag: s16(map.SECTORS, at + 24),
        special: THINKERS.has(s16(map.SECTORS, at + 22)) ? 0 : s16(map.SECTORS, at + 22),
      });
    });
    const sd = sides(e.query(QUERY.sides));
    expect(sd.length).toBe(map.SIDEDEFS.length / 30);
    const tex = (at) => (str8(map.SIDEDEFS, at) === "-" ? null : str8(map.SIDEDEFS, at));
    sd.forEach((s, i) => {
      const at = i * 30;
      expect(s).toEqual({
        xoffset: s16(map.SIDEDEFS, at), yoffset: s16(map.SIDEDEFS, at + 2),
        top: tex(at + 4), bottom: tex(at + 12), middle: tex(at + 20),
      });
    });

    // Things (10 bytes each): every one P_SpawnMapThing spawns in a co-op
    // netgame at Ultra-Violence (skill bit 4, multiplayer things included),
    // with its map number, position and angle; then the four players.
    const spawned = [];
    const starts = [];
    for (let at = 0; at < map.THINGS.length; at += 10) {
      const [x, y, angle, type, options] = [0, 2, 4, 6, 8].map((o) => s16(map.THINGS, at + o));
      if (type >= 1 && type <= 4) starts[type - 1] = { x, y, angle };
      else if (type !== 11 && options & 4) spawned.push(`${type} ${x} ${y} ${(Math.floor(angle / 45) * 2 ** 29) >>> 0}`);
    }
    const th = things(e.query(QUERY.things));
    const mapped = th.filter((t) => t.doomednum >= 0);
    expect(mapped.map((t) => `${t.doomednum} ${t.x} ${t.y} ${bam(t.angle) >>> 0}`).sort()).toEqual(spawned.sort());
    expect(th.length).toBe(mapped.length + PLAYERS);

    expect(level(e.query(QUERY.level))).toEqual({
      state: "level", skill: 3, episode: 1, map: 1, paused: false, deathmatch: 0,
      ingame: [true, true, true, true], leveltime: 0, gametic: 0,
    });

    // The players' eyes are set by their first tic (P_CalcHeight): standing
    // still, 41 units above their feet.
    e.step(new Uint8Array(PLAYERS * INPUT_BYTES));
    const bodies = things(e.query(QUERY.things));
    players(e.query(QUERY.players)).forEach((p, i) => {
      const body = bodies.find((t) => t.id === p.thing);
      expect(body).toMatchObject({ player: i, x: starts[i].x, y: starts[i].y, sprite: "PLAY", translation: i });
      expect(body.flags & (MF.SOLID | MF.SHOOTABLE)).toBe(MF.SOLID | MF.SHOOTABLE);
      expect(p).toMatchObject({ ingame: true, state: "alive", x: body.x, y: body.y, z: body.z + 41, health: 100 });
      expect(bam(p.angle) >>> 0).toBe((Math.floor(starts[i].angle / 45) * 2 ** 29) >>> 0);
    });
    expect(e.query(Object.keys(QUERY).length)).toBe(null);
  });

  test.skipIf(!FULL)("4p: the queries follow the game: time, bodies, doors and lifts, lights, corpses", () => {
    const e = boot(4);
    const first = sectors(e.query(QUERY.sectors));
    const moved = new Set();
    const lit = new Set();
    let corpses = 0;
    const { tics } = demos[4];
    for (let t = 0; t < tics.length; t++) {
      e.step(tics[t]);
      const ps = players(e.query(QUERY.players));
      const th = new Map(things(e.query(QUERY.things)).map((x) => [x.id, x]));
      ps.forEach((p, i) => expect(th.get(p.thing)).toMatchObject({ player: i, x: p.x, y: p.y }));
      sectors(e.query(QUERY.sectors)).forEach((s, i) => {
        if (s.floor !== first[i].floor || s.ceiling !== first[i].ceiling) moved.add(i);
        if (s.light !== first[i].light) lit.add(i);
        expect(s.floor).toBeLessThanOrEqual(s.ceiling);
      });
      corpses = Math.max(corpses, [...th.values()].filter((x) => x.flags & MF.CORPSE).length);
    }
    expect(level(e.query(QUERY.level))).toMatchObject({ leveltime: tics.length, gametic: tics.length });
    // The doors and the lift the bots open, and the flickering lights.
    expect([...moved].sort((a, b) => a - b)).toEqual([10, 98, 100, 103]);
    expect(lit.size).toBeGreaterThan(0);
    expect(corpses).toBeGreaterThan(0);
  }, LONG);

  test("a camera at a player's eyes sees what that player sees, and anywhere else something else", () => {
    const e = boot(4);
    const twin = boot(4);
    for (const tic of demos[4].tics.slice(0, 1800)) {
      e.step(tic);
      twin.step(tic);
    }
    const ps = players(e.query(QUERY.players));
    for (let v = 0; v < PLAYERS; v++) {
      const c = camera(e, ps[v]);
      expect([c.width, c.height]).toEqual([320, 200]);
      expect(equal(camera(twin, ps[v]).rgba, c.rgba)).toBe(true);
      // The camera fills the screen (200 rows) where the player's view is
      // 168 above the status bar, both centred on the horizon: camera row
      // y + 16 is view row y. The weapon is drawn in the view's middle
      // columns; outside them the two agree exactly.
      const f = e.frame(v);
      for (let y = 0; y < 168; y++)
        for (const [from, to] of [[0, 100], [220, 320]]) {
          const a = f.rgba.subarray((y * 320 + from) * 4, (y * 320 + to) * 4);
          const b = c.rgba.subarray(((y + 16) * 320 + from) * 4, ((y + 16) * 320 + to) * 4);
          if (!equal(a, b)) throw new Error(`view ${v}, row ${y}: the camera differs from the player's view`);
        }
    }
    const turned = camera(e, { ...ps[0], angle: ps[0].angle + Math.PI });
    const raised = camera(e, { ...ps[0], z: ps[0].z + 24 });
    const at0 = camera(e, ps[0]).rgba;
    expect(equal(turned.rgba, at0)).toBe(false);
    expect(equal(raised.rgba, at0)).toBe(false);
  });

  test("a view hears from its player's eyes; a view not in the game is player 0's", () => {
    const e = boot(2);
    for (const tic of demos[2].tics.slice(0, 500)) e.step(tic);
    const q = e.query(QUERY.players);
    const ps = players(q);
    for (const v of [0, 1]) expect(listener(q, v)).toEqual({ x: ps[v].x, y: ps[v].y, z: ps[v].z, angle: ps[v].angle });
    expect(listener(q, 3)).toEqual(listener(q, 0));
    expect(ps[3].ingame).toBe(false);
  });

  test("every sound effect in the IWAD decodes from DMX to PCM", () => {
    const all = sounds(iwad);
    const lumps = [...mapLumpNames(iwad)].filter((n) => n.startsWith("DS"));
    expect([...all.keys()].sort()).toEqual(lumps.sort());
    for (const { rate, samples } of all.values()) {
      expect(rate).toBeGreaterThan(0);
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.every((x) => x >= -1 && x < 1)).toBe(true);
    }
  });
});

function mapLumpNames(wad) {
  const v = new DataView(wad.buffer, wad.byteOffset, wad.byteLength);
  const dir = v.getInt32(8, true);
  return new Set(Array.from({ length: v.getInt32(4, true) }, (_, i) =>
    new TextDecoder().decode(wad.subarray(dir + 16 * i + 8, dir + 16 * i + 16)).replace(/\0.*$/, "").toUpperCase()));
}
