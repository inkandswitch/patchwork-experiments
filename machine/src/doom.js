// The host's side of the Doom engine (engines/doom): its content, its
// input, its events, its sounds, reading a vanilla demo as inputs, and
// reading the engine's state (queries). Everything here is plain data in
// and out, except camera(), which asks an engine to draw.
import { picture } from "./engine.js";

export const PLAYERS = 4;
export const INPUT_BYTES = 6;
export const HZ = 35;

/**
 * The engine's content: the game's arguments (Chocolate Doom's own command
 * line: -skill, -warp, -players, -deathmatch, ...) and its WAD files, the
 * IWAD first. Records of (u32 length, bytes); the arguments are
 * NUL-separated.
 */
export function content({ wads, args = [] }) {
  if (!wads?.length) throw new Error("content needs at least an IWAD");
  const text = new TextEncoder().encode(args.map((a) => `${a}\0`).join(""));
  const parts = [text, ...wads.map((w) => new Uint8Array(w.buffer ?? w, w.byteOffset ?? 0, w.byteLength))];
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const p of parts) {
    view.setUint32(at, p.length, true);
    out.set(p, at + 4);
    at += 4 + p.length;
  }
  return out;
}

// Buttons of a ticcmd (d_event.h).
export const BT = { ATTACK: 1, USE: 2, CHANGE: 4, WEAPONSHIFT: 3, SPECIAL: 128, PAUSE: 128 | 1 };

/**
 * One port's input: a network ticcmd. forward and side are -127..127 (50 is
 * a run, 25 a walk); turn is the full 16-bit angleturn (1/65536 of a circle
 * per tic, counterclockwise); buttons as BT; chat a character or 0.
 */
export function ticcmd({ forward = 0, side = 0, turn = 0, buttons = 0, chat = 0 } = {}, into = new Uint8Array(INPUT_BYTES), at = 0) {
  into[at] = forward & 0xff;
  into[at + 1] = side & 0xff;
  into[at + 2] = turn & 0xff;
  into[at + 3] = (turn >> 8) & 0xff;
  into[at + 4] = buttons & 0xff;
  into[at + 5] = chat & 0xff;
  return into;
}

/**
 * A vanilla demo (.lmp, Doom 1.9 format) as what the engine needs to play
 * it: the content arguments that set up the same game, and one step's
 * inputs per tic. A demo's turn is the high byte of angleturn.
 */
export function demo(lmp) {
  const b = new Uint8Array(lmp);
  const longtics = b[0] === 111;
  if (b[0] !== 109 && !longtics) throw new Error(`demo version ${b[0]}: only 1.9 demos`);
  const [skill, episode, map, deathmatch, respawn, fast, nomonsters, consoleplayer] = b.subarray(1, 9);
  const ingame = Array.from(b.subarray(9, 13), Boolean);
  const players = ingame.filter(Boolean).length;
  if (ingame.some((p, i) => p !== i < players)) throw new Error("demo's players are not ports 0 to n-1");
  if (consoleplayer !== 0) throw new Error("demo is not recorded from port 0");
  const args = ["-skill", `${skill + 1}`, "-warp", `${episode}`, `${map}`, "-players", `${players}`];
  if (deathmatch) args.push(deathmatch === 2 ? "-altdeath" : "-deathmatch");
  if (respawn) args.push("-respawn");
  if (fast) args.push("-fast");
  if (nomonsters) args.push("-nomonsters");

  const per = longtics ? 5 : 4;
  const tics = [];
  for (let at = 13; b[at] !== 0x80; at += per * players) {
    if (at + per * players > b.length) throw new Error("demo ends without its end marker");
    const step = new Uint8Array(PLAYERS * INPUT_BYTES);
    for (let p = 0; p < players; p++) {
      const c = at + p * per;
      const turn = longtics ? b[c + 2] | (b[c + 3] << 8) : b[c + 2] << 8;
      ticcmd(
        { forward: (b[c] << 24) >> 24, side: (b[c + 1] << 24) >> 24, turn, buttons: b[c + per - 1] },
        step,
        p * INPUT_BYTES,
      );
    }
    tics.push(step);
  }
  return { args, players, tics };
}

const KIND = { 1: "music", 2: "sound", 3: "stop" };

/**
 * A step's events (engine.output().events): first the music that should be
 * playing ({ kind: "music", name | null, loops, paused }), then each sound
 * the game started or stopped, in order: { kind: "sound" | "stop", name,
 * volume (0..127), origin: { handle, x, y, z } | null, player }. x, y, z
 * are map units. player is whose body the origin is (-1: none); a host
 * plays its own player's sounds, and those with no origin, without
 * position, as Doom does. A new sound from an origin replaces the one it
 * was making.
 */
export function events(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let at = 0; at + 28 <= bytes.length; at += 28) {
    const kind = KIND[v.getUint8(at)];
    const raw = bytes.subarray(at + 4, at + 12);
    const end = raw.indexOf(0);
    const name = new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)) || null;
    if (kind === "music") {
      out.push({ kind, name, loops: v.getUint8(at + 2) === 1, paused: v.getInt8(at + 1) === 1 });
      continue;
    }
    const handle = v.getUint32(at + 12, true);
    const origin = handle
      ? { handle, x: v.getInt32(at + 16, true) / 65536, y: v.getInt32(at + 20, true) / 65536, z: v.getInt32(at + 24, true) / 65536 }
      : null;
    out.push({ kind, name, volume: v.getUint8(at + 2), origin, player: v.getInt8(at + 1) });
  }
  return out;
}

/** The lumps of WAD files, later files overriding earlier: Map(name -> bytes). */
export function lumps(...wads) {
  const all = new Map();
  for (const wad of wads) {
    const b = new Uint8Array(wad.buffer ?? wad, wad.byteOffset ?? 0, wad.byteLength);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = v.getInt32(4, true);
    const dir = v.getInt32(8, true);
    for (let i = 0; i < n; i++) {
      const e = dir + 16 * i;
      const raw = b.subarray(e + 8, e + 16);
      const end = raw.indexOf(0);
      const name = new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)).toUpperCase();
      const at = v.getInt32(e, true);
      all.set(name, b.subarray(at, at + v.getInt32(e + 4, true)));
    }
  }
  return all;
}

/**
 * The sound effects of WAD files (DMX format lumps, "DS*"), as PCM a host
 * can play: Map(name -> { rate, samples: Float32Array in -1..1 }). As the
 * DMX library did, the 16 padding bytes at each end are not played.
 */
export function sounds(...wads) {
  const out = new Map();
  for (const [name, b] of lumps(...wads)) {
    if (!name.startsWith("DS") || b.length < 8) continue;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (v.getUint16(0, true) !== 3) continue;
    const rate = v.getUint16(2, true);
    const count = Math.min(v.getUint32(4, true), b.length - 8);
    if (count <= 32) continue;
    const pcm = b.subarray(8 + 16, 8 + count - 16);
    out.set(name, { rate, samples: Float32Array.from(pcm, (s) => (s - 128) / 128) });
  }
  return out;
}

// ---------------------------------------------------------------------
// The engine's state, read: engine.query(QUERY.things) and the rest, each
// decoded by the function of the same name below. Positions are map units
// (16.16 fixed in the engine), angles radians counterclockwise from east
// (the map's +x), as Doom has them. Doom has no pitch.

export const QUERY = { level: 0, players: 1, things: 2, sectors: 3, sides: 4 };

const FIXED = 65536;
const TURN = (2 * Math.PI) / 2 ** 32;
const GAMESTATE = ["level", "intermission", "finale", "demoscreen"];
const PLAYERSTATE = ["alive", "dead", "reborn"];

function name8(bytes, at, len = 8) {
  const raw = bytes.subarray(at, at + len);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)) || null;
}

function records(bytes, size, read) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / size }, (_, i) => read(v, i * size));
}

/** Where the game is: { state, skill, episode, map, paused, deathmatch, ingame: [bool x4], leveltime, gametic }. */
export function level(bytes) {
  return records(bytes, 16, (v, at) => ({
    state: GAMESTATE[v.getUint8(at)],
    skill: v.getUint8(at + 1),
    episode: v.getUint8(at + 2),
    map: v.getUint8(at + 3),
    paused: v.getUint8(at + 4) === 1,
    deathmatch: v.getUint8(at + 5),
    ingame: [0, 1, 2, 3].map((p) => ((v.getUint8(at + 6) >> p) & 1) === 1),
    leveltime: v.getUint32(at + 8, true),
    gametic: v.getUint32(at + 12, true),
  }))[0];
}

/**
 * Each of the four players: { ingame, state, thing (its body's id, 0 if
 * none), x, y, z, angle, health, armor, weapon, extralight }. x, y, z,
 * angle are the player's eyes: what frame(view) draws from, and where the
 * player hears from.
 */
export function players(bytes) {
  return records(bytes, 32, (v, at) => ({
    ingame: v.getUint8(at + 28) === 1,
    state: PLAYERSTATE[v.getUint8(at + 29)],
    thing: v.getUint32(at, true),
    x: v.getInt32(at + 4, true) / FIXED,
    y: v.getInt32(at + 8, true) / FIXED,
    z: v.getInt32(at + 12, true) / FIXED,
    angle: v.getUint32(at + 16, true) * TURN,
    health: v.getInt32(at + 20, true),
    armor: v.getInt32(at + 24, true),
    weapon: v.getUint8(at + 30),
    extralight: v.getUint8(at + 31),
  }));
}

// Mobj flags (p_mobj.h) a view of the things is likely to want.
export const MF = {
  SPECIAL: 0x1, SOLID: 0x2, SHOOTABLE: 0x4, NOSECTOR: 0x8, NOBLOCKMAP: 0x10,
  MISSILE: 0x10000, SHADOW: 0x40000, CORPSE: 0x100000, COUNTKILL: 0x400000,
};

/**
 * Every thing (mobj) in the level, in the game's thinker order: { id, type
 * (mobjtype_t), doomednum (the map's thing number, -1 for none), x, y, z
 * (its feet), angle, radius, height, flags (MF bits), health, sprite (4
 * letters), frame (0 is A), fullbright, player (whose body, -1 if none),
 * translation (a player body's colour, 0-3) }. id is stable while the thing
 * exists and is the origin handle of its sounds (events()). A thing whose
 * flags have NOSECTOR is not drawn by Doom.
 */
export function things(bytes) {
  return records(bytes, 48, (v, at) => {
    const flags = v.getUint32(at + 28, true);
    const frame = v.getUint16(at + 44, true);
    return {
      id: v.getUint32(at, true),
      type: v.getUint16(at + 36, true),
      doomednum: v.getInt16(at + 38, true),
      x: v.getInt32(at + 4, true) / FIXED,
      y: v.getInt32(at + 8, true) / FIXED,
      z: v.getInt32(at + 12, true) / FIXED,
      angle: v.getUint32(at + 16, true) * TURN,
      radius: v.getInt32(at + 20, true) / FIXED,
      height: v.getInt32(at + 24, true) / FIXED,
      flags,
      health: v.getInt32(at + 32, true),
      sprite: name8(bytes, at + 40, 4),
      frame: frame & 0x7fff,
      fullbright: (frame & 0x8000) !== 0,
      player: v.getInt8(at + 46),
      translation: (flags >>> 26) & 3,
    };
  });
}

/** Every sector, in the map's order (its SECTORS lump): { floor, ceiling, floorpic, ceilingpic, light, special, tag }. */
export function sectors(bytes) {
  return records(bytes, 32, (v, at) => ({
    floor: v.getInt32(at, true) / FIXED,
    ceiling: v.getInt32(at + 4, true) / FIXED,
    floorpic: name8(bytes, at + 8),
    ceilingpic: name8(bytes, at + 16),
    light: v.getInt16(at + 24, true),
    special: v.getInt16(at + 26, true),
    tag: v.getInt16(at + 28, true),
  }));
}

/** Every sidedef, in the map's order (its SIDEDEFS lump): { xoffset, yoffset, top, middle, bottom } (null: no texture). */
export function sides(bytes) {
  return records(bytes, 32, (v, at) => ({
    xoffset: v.getInt32(at, true) / FIXED,
    yoffset: v.getInt32(at + 4, true) / FIXED,
    top: name8(bytes, at + 8),
    middle: name8(bytes, at + 16),
    bottom: name8(bytes, at + 24),
  }));
}

/**
 * Where `view` hears from: { x, y, z, angle } of that player's eyes, the
 * same view frame(view) draws (a view not in the game is player 0's). A
 * host places each sound event's origin relative to it, as Doom does
 * (README, Output).
 */
export function listener(playersBytes, view) {
  const all = players(playersBytes);
  const { x, y, z, angle } = all[view]?.ingame ? all[view] : all[0];
  return { x, y, z, angle };
}

/**
 * A picture from anywhere in the level: the engine's renderer at eyes x, y,
 * z (map units, z absolute) looking along angle (radians), full screen,
 * 320x200, through the plain palette. Doom cannot look up or down. Outside
 * a level the picture is 0 by 0. Drawn on a copy of the state, as frames
 * are.
 */
export function camera(engine, { x, y, z, angle }) {
  const fixed = (u) => Math.round(u * FIXED) | 0;
  const bam = Math.round(((angle / (2 * Math.PI)) % 1) * 2 ** 32) | 0;
  const { result, memory } = engine.inspect("doom_camera", fixed(x), fixed(y), fixed(z), bam);
  return picture(memory, result);
}
