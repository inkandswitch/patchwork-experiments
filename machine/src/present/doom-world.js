// Doom's world as a spectator sees it in a scene: the engine's things and
// sectors at this tic, placed over the doom/ package's geometry of the same
// map, and each thing's sprite as Doom would choose it for a viewer
// standing anywhere. Pure: bytes in (the WADs, engine.query()), plain data
// out. No HUD and no player's view: this is the 3D world seen from outside
// the game, never a way to play it.
//
//   const world = doomWorld([iwad], "E1M1", content.extras.doom);   // the frame: the map part's own say
//   const state = world.read({ things: engine.query(QUERY.things), sectors: engine.query(QUERY.sectors) });
//   for (const s of world.look(state, viewerMetres)) draw(s.position, world.image(s.lump, s.translation), s);
//
// Where things are. The doom/ package builds a map's static part as a GLB in
// metres, Y up, at 36 map units to the metre (doom/src/parts.js:49,
// UNITS_PER_METRE), mapping map units (x east, y north, z up) to metres
// (x east, y up, z south) (doom/src/source.js:55 and :70-76), each vertex
// taken relative to the part's anchor (doom/src/parts.js:303, subtracted in
// the collector at :169). The static part's anchor is the middle of the
// map's vertex bounds, each rounded as Math.round does, at height 0
// (doom/src/parts.js:68-76, mapModel's centre; anchorOf at :119-128). So a
// position here is in that static part's own frame, and a scene places it
// by the static object's transform as it places the part itself. Every part
// doom/ builds also says where its frame is (its GLB's extras.doom: map,
// anchor, unitsPerMetre); given as `frame`, that is what places things, and
// the rule above is only the default (the tests hold the two equal). Facing
// follows doom/src/layout.js:51 (yawOf): a turn about +Y of an object whose
// front is -z, which for Doom's angle a (counterclockwise from east) is
// a - π/2.
//
// Which sprite. Doom picks one of a frame's 8 rotations by the angle from
// the viewer to the thing less the thing's facing, in BAM (2^32 to a turn),
// offset by 9 half-eighths and shifted down 29 (chocolate-doom a2dfd51f,
// src/doom/r_things.c:513-518, R_ProjectSprite); rotation r (1..8) is what a
// viewer sees standing at 45(r-1) ± 22.5 degrees counterclockwise from the
// thing's facing, the lower edge included. A frame drawn for one rotation
// can stand in mirrored for another (the second half of a lump name like
// TROOA2A8), and a frame with rotation 0 is the same from everywhere
// (R_InstallSpriteLump, r_things.c:96-151; R_InitSpriteDefs, :171-273). The
// one difference from Doom: Doom measures the viewer's bearing with its
// 2048-entry arctangent table (R_PointToAngle, r_main.c:275), within about
// 0.03 degrees of the true angle; a viewer in a scene is not Doom's, so
// here it is the true angle, rounded to BAM.
//
// How it looks. A sprite is a billboard facing the viewer, its lump's
// picture at one map unit per pixel both ways: it spans `left` to the
// viewer's left of the thing's centre and `width - left` to its right, and
// hangs from `top` above the thing's feet (r_things.c:527-532, 548). A
// mirrored lump flips the picture but not those offsets (r_things.c:554-563).
// Light is the light of the sector the thing's centre is in (Doom draws a
// sector's things at its light, R_AddSprites, r_things.c:605-628), found as
// Doom finds it, through the map's BSP (R_PointInSubsector, r_main.c:793-815),
// or 255 for a fullbright frame (r_things.c:580). MF_SHADOW things
// (spectres) are drawn by Doom as a fuzz (r_things.c:570); `shadow` says so.

import { MF, sectors as decodeSectors, things as decodeThings } from "../doom.js";

/** Map units to the metre: the doom/ package's scale (doom/src/parts.js:49). */
export const UNITS_PER_METRE = 36;

const FIXED = 65536;
const TURN = 2 ** 32;
export const ANG45 = 0x20000000;

// ---------------------------------------------------------------------
// WADs

/**
 * The lump directories of WAD files, in order, as Doom concatenates them
 * (the IWAD first): [{ name, bytes }]. Names are upper-cased.
 */
export function directory(...wads) {
  const out = [];
  for (const wad of wads) {
    const b = new Uint8Array(wad.buffer ?? wad, wad.byteOffset ?? 0, wad.byteLength);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (magic !== "IWAD" && magic !== "PWAD") throw new Error("not a WAD");
    const n = v.getInt32(4, true);
    const dir = v.getInt32(8, true);
    for (let i = 0; i < n; i++) {
      const e = dir + 16 * i;
      let name = "";
      for (let k = 8; k < 16 && b[e + k]; k++) name += String.fromCharCode(b[e + k]);
      const at = v.getInt32(e, true);
      out.push({ name: name.toUpperCase(), bytes: b.subarray(at, at + v.getInt32(e + 4, true)) });
    }
  }
  return out;
}

/** The index of the last lump of that name, as W_GetNumForName finds it; -1 if none. */
const lastIndex = (dir, name) => {
  for (let i = dir.length - 1; i >= 0; i--) if (dir[i].name === name) return i;
  return -1;
};

const MAP_LUMPS = ["THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SEGS", "SSECTORS", "NODES", "SECTORS"];

/** A map's lumps by name: the ten after its marker (P_SetupLevel's order). */
export function mapLumps(dir, name) {
  const at = lastIndex(dir, name.toUpperCase());
  if (at < 0) throw new Error(`no map ${name}`);
  const out = {};
  for (let i = at + 1; i <= at + 10 && i < dir.length; i++) out[dir[i].name] = dir[i].bytes;
  for (const k of MAP_LUMPS) if (!out[k]) throw new Error(`map ${name} has no ${k}`);
  return out;
}

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/**
 * Where a part of doom/'s map sits, in map units: the middle of the
 * vertexes' bounds, each rounded as Math.round does (doom/src/parts.js:68-76).
 */
export function anchorOf(vertexes) {
  const v = view(vertexes);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let at = 0; at + 4 <= vertexes.length; at += 4) {
    const x = v.getInt16(at, true);
    const y = v.getInt16(at + 2, true);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [Math.round((minX + maxX) / 2), Math.round((minY + maxY) / 2)];
}

// ---------------------------------------------------------------------
// The BSP: which sector a point is in, exactly as Doom decides it.

/** FixedMul (m_fixed.c): the 64-bit product shifted down 16, kept to 32 bits. */
const fixedMul = (a, b) => Math.floor((a * b) / FIXED) | 0;

/** R_PointOnSide (r_main.c:145-192), on 16.16 integers: 0 front (right), 1 back. */
export function pointOnSide(x, y, node) {
  if (!node.dx) return x <= node.x ? (node.dy > 0 ? 1 : 0) : node.dy < 0 ? 1 : 0;
  if (!node.dy) return y <= node.y ? (node.dx < 0 ? 1 : 0) : node.dx > 0 ? 1 : 0;
  const dx = (x - node.x) | 0;
  const dy = (y - node.y) | 0;
  if ((node.dy ^ node.dx ^ dx ^ dy) & 0x80000000) return (node.dy ^ dx) & 0x80000000 ? 1 : 0;
  const left = fixedMul(node.dy >> 16, dx);
  const right = fixedMul(dy, node.dx >> 16);
  return right < left ? 0 : 1;
}

/** A map's BSP as a function (x, y in 16.16) -> its sector, R_PointInSubsector (r_main.c:793-815). */
export function sectorFinder(map) {
  const n = view(map.NODES);
  const nodes = Array.from({ length: map.NODES.length / 28 }, (_, i) => {
    const at = i * 28;
    const s = (o) => n.getInt16(at + o, true) * FIXED;
    return { x: s(0), y: s(2), dx: s(4), dy: s(6), children: [n.getUint16(at + 24, true), n.getUint16(at + 26, true)] };
  });
  const ss = view(map.SSECTORS);
  const segs = view(map.SEGS);
  const lines = view(map.LINEDEFS);
  const sides = view(map.SIDEDEFS);
  // A subsector's sector is its first seg's side's (P_LoadSegs, P_GroupLines).
  const sectorOf = Array.from({ length: map.SSECTORS.length / 4 }, (_, i) => {
    const seg = ss.getUint16(i * 4 + 2, true) * 12;
    const line = segs.getUint16(seg + 6, true) * 14;
    const side = lines.getUint16(line + 10 + 2 * segs.getInt16(seg + 8, true), true);
    return sides.getInt16(side * 30 + 28, true);
  });
  return (x, y) => {
    if (!nodes.length) return sectorOf[0];
    let num = nodes.length - 1;
    while (!(num & 0x8000)) {
      const node = nodes[num];
      num = node.children[pointOnSide(x, y, node)];
    }
    return sectorOf[num & 0x7fff];
  };
}

// ---------------------------------------------------------------------
// Sprites

/**
 * The sprites Doom knows (R_InitSpriteDefs and R_InstallSpriteLump,
 * r_things.c:96-273), from the lumps between the last S_START and the last
 * S_END: { prefixes, get(prefix), bytes(lump) }. get(prefix) is that
 * sprite's frames, [{ rotate, lumps: [8 names], flips: [8 booleans] }]
 * with rotation r at index r - 1, or null for a sprite with no lumps; a
 * sprite Doom would refuse is refused with Doom's reason. Doom checks only
 * the sprites the game names, so each is built (and checked) when first
 * asked for. In a modified game (a PWAD loaded) a lump is read by its name,
 * so a later WAD's lump of the same name replaces it, as in Doom.
 */
export function spriteTable(dir, { modified = false } = {}) {
  const start = lastIndex(dir, "S_START");
  const end = lastIndex(dir, "S_END");
  if (start < 0 || end < start) throw new Error("no sprites (S_START ... S_END)");
  const byPrefix = new Map();
  const inRange = new Map();
  for (let l = start + 1; l < end; l++) {
    const { name, bytes } = dir[l];
    const prefix = name.slice(0, 4);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
    inRange.set(name, bytes);
  }
  const last = new Map(dir.map((l) => [l.name, l.bytes]));
  const built = new Map();

  function build(prefix) {
    const names = byPrefix.get(prefix);
    if (!names) return null;
    const tmp = Array.from({ length: 29 }, () => ({ rotate: -1, lumps: Array(8).fill(null), flips: Array(8).fill(false) }));
    let maxframe = -1;
    const install = (lump, frame, rotation, flipped) => {
      if (!(frame >= 0 && frame < 29 && rotation >= 0 && rotation <= 8)) throw new Error(`R_InstallSpriteLump: Bad frame characters in lump ${lump}`);
      if (frame > maxframe) maxframe = frame;
      const f = tmp[frame];
      const letter = String.fromCharCode(65 + frame);
      if (rotation === 0) {
        if (f.rotate === 0) throw new Error(`R_InitSprites: Sprite ${prefix} frame ${letter} has multip rot=0 lump`);
        if (f.rotate === 1) throw new Error(`R_InitSprites: Sprite ${prefix} frame ${letter} has rotations and a rot=0 lump`);
        f.rotate = 0;
        f.lumps.fill(lump);
        f.flips.fill(flipped);
        return;
      }
      if (f.rotate === 0) throw new Error(`R_InitSprites: Sprite ${prefix} frame ${letter} has rotations and a rot=0 lump`);
      f.rotate = 1;
      if (f.lumps[rotation - 1] !== null) throw new Error(`R_InitSprites: Sprite ${prefix} : ${letter} : ${rotation} has two lumps mapped to it`);
      f.lumps[rotation - 1] = lump;
      f.flips[rotation - 1] = flipped;
    };
    for (const name of names) {
      install(name, name.charCodeAt(4) - 65, name.charCodeAt(5) - 48, false);
      if (name.length > 6) install(name, name.charCodeAt(6) - 65, name.charCodeAt(7) - 48, true);
    }
    const frames = [];
    for (let frame = 0; frame <= maxframe; frame++) {
      const f = tmp[frame];
      const letter = String.fromCharCode(65 + frame);
      if (f.rotate === -1) throw new Error(`R_InitSprites: No patches found for ${prefix} frame ${letter}`);
      if (f.rotate === 1 && f.lumps.includes(null)) throw new Error(`R_InitSprites: Sprite ${prefix} frame ${letter} is missing rotations`);
      frames.push({ rotate: f.rotate === 1, lumps: f.lumps, flips: f.flips });
    }
    return frames;
  }

  return {
    prefixes: [...byPrefix.keys()],
    get(prefix) {
      if (!built.has(prefix)) built.set(prefix, build(prefix));
      return built.get(prefix);
    },
    /** A sprite lump's bytes: the one in the sprite range, or in a modified game the last of that name. */
    bytes(lump) {
      return (modified ? last.get(lump) : inRange.get(lump)) ?? null;
    },
  };
}

/** An angle in radians as BAM, Doom's unsigned 32-bit turn. */
export const bam = (radians) => {
  const t = Math.round((radians / (2 * Math.PI)) * TURN) % TURN;
  return (t < 0 ? t + TURN : t) >>> 0;
};

/**
 * Which rotation (0..7, rotation r is r + 1) a frame shows, from the
 * thing's facing and the angle from the viewer to the thing, both BAM
 * (r_things.c:515, R_ProjectSprite).
 */
export const rotationIndex = (facing, bearing) => ((bearing - facing + (ANG45 / 2) * 9) >>> 0) >>> 29;

/** The angle (BAM) from a viewer at (vx, vy) to a point (x, y), in map units: the true angle, rounded. */
export const bearing = (vx, vy, x, y) => bam(Math.atan2(y - vy, x - vx));

// The player colours (R_InitTranslationTables, r_draw.c:514-535): the green
// ramp 0x70-0x7f becomes grey, brown or red for translations 1, 2, 3.
const TRANSLATIONS = [0, 0x60, 0x40, 0x20].map((base, t) =>
  Uint8Array.from({ length: 256 }, (_, i) => (t && i >= 0x70 && i <= 0x7f ? base + (i & 0xf) : i)),
);

/**
 * A picture lump (Doom's patch format) as RGBA through a palette (768
 * bytes): { width, height, left, top, rgba, opaque, overrun }. Clear pixels
 * are 0,0,0,0. `translation` 1-3 recolours the green ramp as Doom colours
 * players. Posts are read as vanilla Doom reads them (a post's top row is
 * absolute; 0xff ends a column); `overrun` counts pixels a post puts below
 * the picture's height, which Doom draws and a quad of that height would
 * lose (Freedoom has none).
 */
export function decodePicture(bytes, palette, translation = 0) {
  const v = view(bytes);
  if (bytes.length < 8) throw new Error("not a picture");
  const width = v.getInt16(0, true);
  const height = v.getInt16(2, true);
  const left = v.getInt16(4, true);
  const top = v.getInt16(6, true);
  if (width <= 0 || height <= 0 || 8 + 4 * width > bytes.length) throw new Error("not a picture");
  const map = TRANSLATIONS[translation] ?? TRANSLATIONS[0];
  const rgba = new Uint8Array(width * height * 4);
  let opaque = 0;
  let overrun = 0;
  for (let x = 0; x < width; x++) {
    let at = v.getInt32(8 + 4 * x, true);
    for (;;) {
      if (at >= bytes.length) throw new Error(`column ${x} runs off the lump`);
      const row = bytes[at];
      if (row === 0xff) break;
      const len = bytes[at + 1];
      if (at + 4 + len > bytes.length) throw new Error(`column ${x} runs off the lump`);
      for (let k = 0; k < len; k++) {
        const y = row + k;
        if (y >= height) {
          overrun++;
          continue;
        }
        const c = map[bytes[at + 3 + k]] * 3;
        const o = (y * width + x) * 4;
        if (!rgba[o + 3]) opaque++;
        rgba[o] = palette[c];
        rgba[o + 1] = palette[c + 1];
        rgba[o + 2] = palette[c + 2];
        rgba[o + 3] = 255;
      }
      at += len + 4;
    }
  }
  return { width, height, left, top, rgba, opaque, overrun };
}

/**
 * The name of the map a game is on (doom.js level(): its episode and map),
 * as its WADs name their maps: ExMy, or MAPxx in a game without episodes
 * (WADs with no E1M1: Doom II's, G_InitNew's gamemode commercial).
 */
export function mapOf(wads, level) {
  const episodic = directory(...wads).some((l) => l.name === "E1M1");
  return episodic ? `E${level.episode}M${level.map}` : `MAP${String(level.map).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Drawing it

/**
 * How high a door of doom/'s stands open (metres), from read()'s sector:
 * its ceiling above the floor it shuts to, which is where the map has its
 * floor (doom/ builds a door's part shut at its floor at rest, and a door
 * moved up by this is where the engine has its underside).
 */
export const doorAt = (sector) => sector.gap + sector.rise.floor;

/**
 * A light level (0-255) as the linear grey doom/ multiplies its textures by:
 * the level read as an sRGB value (doom/src/parts.js lightOf), so a thing
 * is lit as the walls around it are.
 */
export function greyOf(level) {
  const f = Math.max(0, Math.min(255, level)) / 255;
  return f <= 0.04045 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4);
}

/**
 * Where a thing's billboard is, in the frame look() was given the eye in:
 * an upright quad standing at the thing's feet and turned about the
 * vertical to face the eye, as Doom draws a sprite (r_things.c:527-532:
 * the picture spans `left` to the viewer's left of the thing and `width -
 * left` to its right, and hangs from `top` above its feet).
 *   { feet, right, facing, x: [from, to], y: [from, to], flip }
 * `right` is the viewer's right and `facing` the way the quad faces (to the
 * eye), both level unit vectors; x along `right` and y up are metres from
 * the feet. A mirrored lump flips the picture, not those offsets
 * (r_things.c:554-563). An eye straight above or below the thing faces it
 * north (-z): every way is as good.
 */
export function billboard(sprite, eye) {
  const [px, , pz] = sprite.position;
  let dx = eye[0] - px;
  let dz = eye[2] - pz;
  const d = Math.hypot(dx, dz);
  if (d > 0) (dx /= d), (dz /= d);
  else (dx = 0), (dz = -1);
  return {
    feet: sprite.position,
    right: [dz, 0, -dx],
    facing: [dx, 0, dz],
    x: [-sprite.left, sprite.width - sprite.left],
    y: [sprite.top - sprite.height, sprite.top],
    flip: sprite.flip,
  };
}

// ---------------------------------------------------------------------
// The world

/**
 * A map of WAD files (the IWAD first, then any PWADs), ready to read the
 * engine's queries of a game on that map.
 */
export function doomWorld(wads, mapName, frame = {}) {
  const dir = directory(...wads);
  const map = mapLumps(dir, mapName);
  // the frame things are placed in: the part's own say (its GLB's extras.doom) when given, else doom/'s rule for its static part
  const [ax, ay, az = 0] = frame.anchor ?? anchorOf(map.VERTEXES);
  const anchor = [ax, ay, az];
  const k = frame.unitsPerMetre ?? UNITS_PER_METRE;
  const lumps = view(map.SECTORS);
  const rest = Array.from({ length: map.SECTORS.length / 26 }, (_, i) => ({
    floor: lumps.getInt16(i * 26, true),
    ceiling: lumps.getInt16(i * 26 + 2, true),
  }));
  const sectorAt = sectorFinder(map);
  const sprites = spriteTable(dir, { modified: wads.length > 1 });
  const playpal = dir[lastIndex(dir, "PLAYPAL")]?.bytes;
  if (!playpal || playpal.length < 768) throw new Error("no palette (PLAYPAL)");
  const palette = playpal.subarray(0, 768);
  const pictures = new Map();
  const images = new Map();

  /** Map units [x, y, z] as metres in the static part's frame. */
  const metres = ([x, y, z]) => [(x - ax) / k, (z - az) / k, -(y - ay) / k];
  /** Metres in the static part's frame as map units [x, y, z]. */
  const units = ([x, y, z]) => [x * k + ax, -z * k + ay, y * k + az];
  // the map's extent in the frame, metres: its vertexes across, its lowest floor to its highest ceiling
  const vx = view(map.VERTEXES);
  const xs = [], ys = [];
  for (let at = 0; at + 4 <= map.VERTEXES.length; at += 4) xs.push(vx.getInt16(at, true)), ys.push(vx.getInt16(at + 2, true));
  const zs = rest.flatMap((r) => [r.floor, r.ceiling]);
  const lo = [Math.min(...xs), Math.max(...ys), Math.min(...zs)];
  const hi = [Math.max(...xs), Math.min(...ys), Math.max(...zs)];
  const name = mapName.toUpperCase();
  const episodic = /^E(\d)M(\d)$/.exec(name);
  const numbered = /^MAP(\d\d)$/.exec(name);
  /** A lump's picture header, without decoding it. */
  const picture = (lump) => {
    if (!pictures.has(lump)) {
      const b = sprites.bytes(lump);
      if (!b) throw new Error(`no sprite lump ${lump}`);
      const v = view(b);
      pictures.set(lump, { width: v.getInt16(0, true), height: v.getInt16(2, true), left: v.getInt16(4, true), top: v.getInt16(6, true) });
    }
    return pictures.get(lump);
  };

  return {
    map: name,
    /** The frame's origin, in map units [x, y, z]: doom/'s static part's (its height 0) unless the frame said otherwise. */
    anchor,
    metres,
    units,
    sprites,

    /** The map's box in the frame (metres): its vertexes across, its lowest floor to its highest ceiling, as the map has them. */
    extent: { min: metres(lo), max: metres(hi) },

    /** Is the game (doom.js level()) playing this map? Not between levels, nor on another map. */
    playing(level) {
      if (level?.state !== "level") return false;
      if (episodic) return level.episode === +episodic[1] && level.map === +episodic[2];
      if (numbered) return level.map === +numbered[1];
      return false;
    },

    /**
     * The world at this tic, the same for every viewer: { things, sectors }.
     *
     * things: every thing Doom draws (not NOSECTOR), in the engine's order:
     * { id, type, player, translation, position (metres, its feet), units
     * (the same in map units), yaw
     * (radians about +Y, doom/'s convention), angle (BAM, its facing),
     * radius, height (metres), sprite, frame, fullbright, shadow, sector,
     * light (0-255: its sector's, or 255 fullbright) }.
     *
     * sectors: every sector, in the map's order: { floor, ceiling (metres),
     * light (0-255), gap (ceiling less floor, metres: a door of doom/'s
     * shuts to its floor, so this is its slide's position), rise: { floor,
     * ceiling } (metres from where the map has them, which is where doom/'s
     * static part draws lifts and floors) }.
     */
    read({ things, sectors }) {
      const sec = decodeSectors(sectors);
      return {
        sectors: sec.map((s, i) => ({
          floor: (s.floor - az) / k,
          ceiling: (s.ceiling - az) / k,
          light: s.light,
          gap: (s.ceiling - s.floor) / k,
          rise: { floor: (s.floor - rest[i].floor) / k, ceiling: (s.ceiling - rest[i].ceiling) / k },
        })),
        things: decodeThings(things)
          .filter((t) => !(t.flags & MF.NOSECTOR))
          .map((t) => {
            const sector = sectorAt(Math.round(t.x * FIXED), Math.round(t.y * FIXED));
            return {
              id: t.id,
              type: t.type,
              player: t.player,
              translation: t.translation,
              position: metres([t.x, t.y, t.z]),
              units: [t.x, t.y, t.z],
              yaw: t.angle - Math.PI / 2,
              angle: bam(t.angle),
              radius: t.radius / k,
              height: t.height / k,
              sprite: t.sprite,
              frame: t.frame,
              fullbright: t.fullbright,
              shadow: (t.flags & MF.SHADOW) !== 0,
              sector,
              light: t.fullbright ? 255 : sec[sector].light,
            };
          }),
      };
    },

    /**
     * What a viewer at `eye` (metres, the static part's frame) sees of each
     * thing of read()'s: one record per thing, in the same order: { id,
     * position, lump, flip, rotation (1-8, or 0 for a frame the same from
     * everywhere), width, height, left, top (metres: the billboard),
     * translation, light, shadow }. A thing whose sprite or frame the WADs
     * don't have has lump null (Doom would refuse to start).
     */
    look(state, eye) {
      const [vx, vy] = units(eye);
      return state.things.map((t) => {
        const frames = t.sprite ? sprites.get(t.sprite) : null;
        const f = frames?.[t.frame];
        const base = { id: t.id, position: t.position, translation: t.translation, light: t.light, shadow: t.shadow };
        if (!f) return { ...base, lump: null, flip: false, rotation: 0, width: 0, height: 0, left: 0, top: 0 };
        const r = f.rotate ? rotationIndex(t.angle, bearing(vx, vy, t.units[0], t.units[1])) : 0;
        const lump = f.lumps[r];
        const p = picture(lump);
        return { ...base, lump, flip: f.flips[r], rotation: f.rotate ? r + 1 : 0, width: p.width / k, height: p.height / k, left: p.left / k, top: p.top / k };
      });
    },

    /** A sprite lump as RGBA (decodePicture's), through palette 0, recoloured by translation; decoded once per lump and translation. */
    image(lump, translation = 0) {
      const key = `${lump}:${translation}`;
      if (!images.has(key)) {
        const b = sprites.bytes(lump);
        if (!b) throw new Error(`no sprite lump ${lump}`);
        images.set(key, decodePicture(b, palette, translation));
      }
      return images.get(key);
    },
  };
}
