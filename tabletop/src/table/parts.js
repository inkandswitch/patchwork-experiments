// The tabletop's parts (scene:part, scene/STAGE.md "Parts"), for the editor's
// parts bin, under "Tabletop": a pawn, a token, a card spot and a die. Each
// is one object showing the scene's one GLB doc for its kind (ctx.file, under
// "tabletop/<kind>@1": ten pawns share one file), drawn from the same piece
// vocabulary the games use (shapes.js, pieces.js).
//
// - A card spot is a small mat with one card slot: a connector tagged "card"
//   (the one tag every card and card slot shares, slots.js), with a snap
//   radius, so a card carried over it or a deck dropped on it squares onto
//   it. Untagged pieces (a pawn, a die) don't snap there.
// - A die carries the trait `tabletop.die` (dice.js), which is what gives it
//   Roll (R) in play (extension.js).
//
// A part goes where the bin says, under what it was dropped on (filed in
// that one's group), and isn't locked: it's placed by hand, so the gizmo may
// move it. If what it was dropped on went while its file was made (a peer
// deleted it), it puts nothing. Parts never make or change seats: a table's
// seats are the template's, the game page's or the inspector's.

import { DEFAULT_FACES, DIE } from "./dice.js";
import { fileFor, glbFile } from "./files.js";

// ─── what each is drawn as ──────────────────────────────────────────────────

/** A d6's edge (m). */
export const D6_SIZE = 0.016;
const IVORY = "#f4efe2";
const INK = "#1f2328";

/** Where a d6 face's pips go, on a 3 × 3 grid ([across, along], each −1, 0 or 1). */
const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/** A d6 standing on y = 0: an ivory cube with dark pips just proud of each side, numbered as dice.js DEFAULT_FACES says. */
function d6Parts(s = D6_SIZE) {
  const p = s * 0.16; // a pip's width
  const g = s * 0.27; // from a side's middle to a pip's
  const t = 0.0003; // a pip's thickness
  const out = 0.0001; // how far it stands proud
  const h = s / 2;
  const n = h + out - t / 2; // a pip's middle, out along its side's axis
  const parts = [{ shape: "box", size: [s, s, s], color: IVORY, name: "die" }];
  for (const [side, value] of Object.entries(DEFAULT_FACES)) {
    const sign = side[0] === "+" ? 1 : -1;
    for (const [a, b] of PIPS[value]) {
      const u = a * g;
      const v = b * g;
      let pip;
      if (side[1] === "y") pip = { size: [p, t, p], at: [u, sign > 0 ? s + out - t : -out, v] };
      else if (side[1] === "x") pip = { size: [t, p, p], at: [sign * n, h + v - p / 2, u] };
      else pip = { size: [p, p, t], at: [u, h + v - p / 2, sign * n] };
      parts.push({ shape: "box", ...pip, color: INK, name: "pips" });
    }
  }
  return parts;
}

/** A pawn's turned outline: a foot, a waist and a round head ([r, y], m). */
function pawnProfile() {
  const profile = [[0, 0], [0.011, 0], [0.011, 0.003], [0.0085, 0.005], [0.0055, 0.019], [0.008, 0.0205], [0.008, 0.022]];
  // the head: a ball sitting on the collar, from its neck round to the top
  const c = 0.0275;
  const r = 0.0055;
  const a0 = -Math.acos(0.0035 / r);
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / 10;
    profile.push([+Math.max(0, r * Math.cos(a)).toFixed(5), +(c + r * Math.sin(a)).toFixed(5)]);
  }
  return profile;
}

/** A card spot's size: a little more than a card (lost-cities.js CARD). */
const SPOT = { w: 0.066, l: 0.097, t: 0.0015 };

/**
 * What each part is drawn as, in the games' piece vocabulary (pieces.js):
 * parts, and a card spot's one snap point.
 */
export const PIECES = Object.freeze({
  pawn: { name: "Pawn", parts: [{ shape: "lathe", profile: pawnProfile(), segments: 32, color: "#c0392b" }] },
  token: {
    name: "Token",
    parts: [
      { shape: "lathe", profile: [[0, 0], [0.013, 0], [0.013, 0.004], [0, 0.004]], segments: 40, color: "#c9a24a" },
      { shape: "lathe", profile: [[0.008, 0.004], [0.0095, 0.004], [0.0095, 0.0042], [0.008, 0.0042], [0.008, 0.004]], segments: 40, color: "#8a6a24" },
    ],
  },
  "card-spot": {
    name: "Card spot",
    parts: [
      { shape: "box", size: [SPOT.w, SPOT.t, SPOT.l], color: "#2f4a3a", name: "mat" },
      { shape: "box", size: [SPOT.w - 0.006, 0.0002, SPOT.l - 0.006], at: [0, SPOT.t, 0], color: "#3d6150", name: "inset" },
    ],
    // one slot for cards only: a card lies on it squared to the mat
    snapPoints: [{ position: [0, SPOT.t + 0.0002, 0], yaw: 0, tags: ["card"] }],
    snapRadius: 0.04,
  },
  d6: { name: "Die", parts: d6Parts() },
});

/** What each part brings: the die is a die. */
const TRAITS = { d6: { [DIE]: {} } };

// ─── files ──────────────────────────────────────────────────────────────────

/** The scene's assets key for a part's GLB. Bump its version when its drawing changes. (A game's: template.js gameFileKey.) */
export const partKey = (kind) => `tabletop/${kind}@1`;

/** A part's GLB, as ctx.file's make() wants it (files.js). */
export const makeFile = (kind) => glbFile(PIECES[kind]);

// ─── the parts ──────────────────────────────────────────────────────────────

const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** A scene object for a part: a passthrough GLB, not locked. */
export function partObject(kind, { url, hint }, { transform = IDENTITY, parent = null, group = null } = {}) {
  const t = { ...IDENTITY, ...transform };
  const traits = TRAITS[kind];
  return {
    name: PIECES[kind].name,
    sourceUrl: url,
    providerId: "file-glb",
    renderUrl: null,
    parent,
    group,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked: false,
    transform: { position: [...t.position].map(Number), rotation: [...t.rotation].map(Number), scale: Number(t.scale) || 1 },
    ...(hint?.bounds ? { hint: { bounds: { min: [...hint.bounds.min], max: [...hint.bounds.max] } } } : {}),
    ...(traits ? { traits: structuredClone(traits) } : {}),
  };
}

/**
 * The part that puts one piece of `kind` where the bin says, and returns its
 * id: its file first, then one change (in which it checks that what it was
 * put on is still there).
 */
export function part(kind) {
  return {
    async create(ctx, at) {
      const file = await fileFor(ctx, partKey(kind), () => makeFile(kind));
      const id = ctx.newId("o");
      const parent = at?.parent ?? null;
      let put = false;
      ctx.change((d) => {
        if (parent && !d.objects?.[parent]) return;
        if (!d.objects) d.objects = {};
        if (!d.order) d.order = [];
        // under what it was put on, in that one's group (as addObject files it)
        const group = parent ? (d.objects[parent].group ?? null) : null;
        d.objects[id] = partObject(kind, file, { transform: at?.transform ?? IDENTITY, parent, group });
        d.order.push(id);
        put = true;
      });
      if (!put) ctx.notify?.("What that was put on has gone.");
      return put ? id : null;
    },
  };
}

export const pawn = part("pawn");
export const token = part("token");
export const cardSpot = part("card-spot");
export const die = part("d6");
