// A table of cup dice, as a template and as parts.
//
// "Liar's dice" (scene:template `dice.liars-dice`) lays out the traditional
// South American cup-dice game (dudo, cacho) as its real components: a
// round table, six seats, and for each a cup and five standard six-sided
// dice in that set's own colour, the cup lifted beside its dice; and a pool
// in the middle for dice a player has lost. Nothing else: who bids what,
// whose turn it is, who loses a die and when is the players' business. The
// art is this package's own (cup-glb.js, die-glb.js).
//
// Parts (the editor's bin, under "Dice"): a dice cup with its five dice, and
// a pool.
//
// Every GLB is the scene's own file (ctx.file, STAGE.md "Parts"), shared by
// every object drawn from it, under a key that names what it's drawn from.
// A die here is a GLB carrying `extras.dice` (as the die source builds), not
// a die doc: a set's five dice are one kind of thing, and the table is laid
// out in one change. What each cup can do comes from its trait (`dice.cup`),
// which is also where its shakes' draws live (lots-ext.js): nothing more to
// write for fair rolls. Seats come from whoever owns them, found by its
// plugin's metadata (`roster: true`), never by package.

import { CUP, LIFT_BACK, ringOf } from "./cup.js";
import { TABLE_TOP, cupGLB, poolGLB, tableGLB } from "./cup-glb.js";
import { dieGLB } from "./die-glb.js";
import { presetDoc } from "./die.js";
import { DIE } from "./ids.js";
import { eulerMatrix } from "./m3.js";
import { squared } from "./parts.js";
import { scaleOf } from "./roll.js";

/** The six sets, by colour: cup and dice alike. */
export const SETS = Object.freeze([
  { name: "Red", body: "#b3362c", ink: "#f6f0e2" },
  { name: "Blue", body: "#2c5aa8", ink: "#f6f0e2" },
  { name: "Green", body: "#2f7d46", ink: "#f6f0e2" },
  { name: "Yellow", body: "#e2b33a", ink: "#1f2328" },
  { name: "Purple", body: "#6a3d9a", ink: "#f6f0e2" },
  { name: "Black", body: "#2a2b30", ink: "#f6f0e2" },
]);
/** Dice per player. */
export const DICE_EACH = 5;
/** How far from the table's middle a seat's dice lie (m). */
export const SPOT_RADIUS = 0.3;

const GLB = { extension: "glb", mimeType: "model/gltf-binary" };
const file = (name, { glb, bounds }) => ({ name: `${name}.glb`, bytes: glb, ...GLB, hint: { bounds } });
const hex = (c) => c.replace("#", "");

/** The scene's file for each thing, made once. */
export const files = {
  table: (ctx) => ctx.file("dice/table@1", () => file("Table", tableGLB())),
  pool: (ctx) => ctx.file("dice/pool@1", () => file("Pool", poolGLB())),
  cup: (ctx, set) => ctx.file(`dice/cup-${hex(set.body)}@1`, () => file(`${set.name} cup`, cupGLB(set.body))),
  die: (ctx, set) => ctx.file(`dice/d6-${hex(set.body)}-${hex(set.ink)}@1`, () => file(`${set.name} die`, dieGLB({ ...presetDoc("d6"), body: set.body, ink: set.ink }))),
};

const base = (name) => ({ name, parent: null, group: null, visible: true, color: null, opacity: 1, wireframe: false });
const copy = (v) => JSON.parse(JSON.stringify(v));
const tidy = (v) => +(+v).toFixed(6) + 0;

/** A passthrough object showing file `f`. */
export function objectOf(name, f, transform, more = {}) {
  return { ...base(name), sourceUrl: f.url, providerId: "file-glb", renderUrl: null, transform, ...(f.hint?.bounds ? { hint: { bounds: copy(f.hint.bounds) } } : {}), ...more };
}

/** A cup's trait as a table lays it out: lifted, nobody's yet, nothing shaken, no draw. */
export const freshCup = () => ({ [CUP]: { up: true, blind: false, holder: null, roll: null, round: null } });

/**
 * One player's things: a cup lifted beside its spot (its +Z toward the
 * player), and n dice in a ring on the spot. `at`: the spot, in the frame
 * the objects go in; `yaw`: toward the player; `k`: that frame's scale.
 * @returns {{ cup: object, dice: object[] }}
 */
export function setOut({ set, files: f, at, yaw, k = 1, n = DICE_EACH }) {
  // lifted: beside its dice, to the player's right (cup.js lifted)
  const back = [Math.cos(yaw) * (LIFT_BACK / k), 0, -Math.sin(yaw) * (LIFT_BACK / k)];
  const cup = objectOf(`${set.name} cup`, f.cup, { position: at.map((v, i) => tidy(v + back[i])), rotation: [0, tidy(yaw), 0], scale: 1 }, { traits: freshCup() });
  const dice = ringOf(n, yaw).map(({ at: d, yaw: y }, i) =>
    objectOf(`${set.name} die ${i + 1}`, f.die, { position: [tidy(at[0] + d[0] / k), tidy(at[1]), tidy(at[2] + d[2] / k)], rotation: [0, y, 0], scale: 1 }, { traits: { [DIE]: {} } }),
  );
  return { cup, dice };
}

// ── what a table is made with, found by metadata (never by package) ──
const listOf = (reg) => {
  try {
    return reg?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
};
async function moduleWith(registry, test) {
  const reg = typeof registry === "function" ? await Promise.resolve(registry("scene:extension")).catch(() => null) : null;
  for (const p of listOf(reg)) {
    if (!test(p) || typeof p.id !== "string") continue;
    try {
      const loaded = await reg.load(p.id);
      const mod = loaded?.module?.default ?? loaded?.module ?? null;
      if (mod) return mod;
    } catch (err) {
      console.warn(`[dice] couldn't load “${p.id}”`, err);
    }
  }
  return null;
}
/** How to write seats into a scene doc (the seats owner's `lay`), or null. */
export async function findSeats(registry) {
  const mod = await moduleWith(registry, (p) => p?.roster === true);
  return typeof mod?.lay === "function" ? mod.lay : null;
}

/**
 * The whole table, written in one change: objects, seats, the view.
 * @returns {Promise<{ seats: object, ids: object } | null>}
 */
export async function layOutTable(ctx, { players = SETS.length } = {}) {
  const sets = SETS.slice(0, players);
  const f = { table: await files.table(ctx), pool: await files.pool(ctx) };
  const per = [];
  for (const set of sets) per.push({ set, f: { cup: await files.cup(ctx, set), die: await files.die(ctx, set) } });
  const lay = await findSeats(ctx.registry);

  const objects = {};
  const order = [];
  const put = (o) => {
    const id = ctx.newId("o");
    objects[id] = o;
    order.push(id);
    return id;
  };
  const ids = { table: put(objectOf("Table", f.table, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, { locked: true })), pool: put(objectOf("Pool", f.pool, { position: [0, TABLE_TOP, 0], rotation: [0, 0, 0], scale: 1 }, { locked: true })), seats: [] };
  const seats = {};
  per.forEach(({ set, f: sf }, i) => {
    const yaw = (2 * Math.PI * i) / sets.length;
    const dir = [Math.sin(yaw), 0, Math.cos(yaw)];
    const at = [tidy(dir[0] * SPOT_RADIUS), TABLE_TOP, tidy(dir[2] * SPOT_RADIUS)];
    const { cup, dice } = setOut({ set, files: sf, at, yaw });
    const seat = `seat${i + 1}`;
    ids.seats.push({ seat, cup: put(cup), dice: dice.map(put) });
    seats[seat] = {
      name: `${set.name} (Player ${i + 1})`,
      camera: { position: [tidy(dir[0] * 0.95), tidy(TABLE_TOP + 0.45), tidy(dir[2] * 0.95)], target: [tidy(dir[0] * 0.12), TABLE_TOP, tidy(dir[2] * 0.12)] },
    };
  });

  const title = ctx.doc?.()?.title;
  ctx.change((d) => {
    for (const id of order) {
      d.objects[id] = objects[id];
      d.order.push(id);
    }
    if (lay) lay(d, seats);
    d.view.activity = "play";
    d.view.tool = "hand";
    d.view.grid = false;
    d.view.axes = false;
    d.view.home = { position: [0, TABLE_TOP + 0.9, 1.1], target: [0, TABLE_TOP, 0] };
    if (!title || title === "Untitled scene") d.title = "Liar's dice";
  });
  if (!lay) ctx.notify?.("Nothing installed here owns seats, so this table has none.", "warn");
  else ctx.notify?.("Pick a seat (top right). Hover your cup: S shakes it, hold P to peek, L lifts it.", "info");
  return { seats, ids };
}

export const liarsDice = { create: (ctx) => layOutTable(ctx) };

/** Where a part goes: its parent, a transform squared to it, and that frame's scale. */
function placeOf(ctx, at) {
  const parent = at?.parent ?? null;
  const t = parent ? squared(at?.transform) : { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, ...(at?.transform ?? {}) };
  const m = eulerMatrix(t.rotation);
  const yaw = Math.atan2(m[0][2], m[2][2]);
  return { parent, position: t.position.map(Number), yaw, k: scaleOf(parent ? ctx.worldOf?.(parent) : null) };
}

/** The parts bin's "Dice cup": a cup and its five dice in front of it, the cup's back toward where it faces. */
export const cupPart = {
  async create(ctx, at) {
    const p = placeOf(ctx, at);
    const set = SETS[0];
    const f = { cup: await files.cup(ctx, set), die: await files.die(ctx, set) };
    const { cup, dice } = setOut({ set, files: f, at: p.position, yaw: p.yaw, k: p.k });
    let cupId = null;
    ctx.change((d) => {
      if (p.parent && !d.objects?.[p.parent]) return;
      cupId = ctx.newId("o");
      for (const [id, o] of [[cupId, cup], ...dice.map((o) => [ctx.newId("o"), o])]) {
        d.objects[id] = { ...o, parent: p.parent };
        d.order.push(id);
      }
    });
    if (!cupId) ctx.notify?.("What that was put on has gone.");
    return cupId;
  },
};

/** The parts bin's "Dice pool": somewhere for lost dice. */
export const poolPart = {
  async create(ctx, at) {
    const p = placeOf(ctx, at);
    const f = await files.pool(ctx);
    let id = null;
    ctx.change((d) => {
      if (p.parent && !d.objects?.[p.parent]) return;
      id = ctx.newId("o");
      d.objects[id] = { ...objectOf("Pool", f, { position: p.position, rotation: [0, tidy(p.yaw), 0], scale: 1 }), parent: p.parent };
      d.order.push(id);
    });
    return id;
  },
};
