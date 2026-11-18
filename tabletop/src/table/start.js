// Start game: a table's start steps (GAME-FORMAT.md §6, the recipe's
// `start`), run once every seat is taken; the `scene:extension`
// "tabletop.start", by the scene's trait of that name, which the table
// writer resolved to this table's objects when it laid the table out
// (setup.js startPlan):
//
//   { steps: [ { shuffle: [id…] }                  the deck's cards, mixed by their keeper
//            | { deal: n, moves: [[id, transform]…] }  n into each seat's hands, each card into a slot
//            | { draw: n, moves: [[id, transform]…] }  n face up onto a thing's snap points
//            | { first: true } ],                   who goes first: one of the seats, by lots
//     started: null | { by: viewer, first?: seatId },
//     round?: lots' round for who goes first (dice/lots-ext.js) }
//
// What a card is stays its keeper's: a deal moves objects, whatever they
// turn out to be, and the table's rule (visibility.js) shows each in a hand
// to that hand's seat alone. A shuffle goes through the card's keeper (the
// plain one permutes its slots: whoever presses Start deals, as at a real
// table; the joint one queues a shuffle every player takes part in).
// Everything Start writes to the scene is one change, with `started`, so
// pressing it twice, or on two peers at once, deals once: the second sees it
// started, and two at once move the same cards to the same places (the
// moves were fixed at layout), the merge keeping one `started`.
//
// Who goes first is drawn by lots (dice/lots.js), open to all, between the
// seated players' clients, so nobody chooses it, the one who pressed Start
// included: that client (`started.by`) asks the draw, over the seats in
// order (two at once: the merge keeps one round); once its seed is public,
// any client writes the seat it names into `started.first`, the same on
// every one. A draw that ends without a seed (someone left, a part spoiled)
// can be asked again ("Draw who goes first"). Where lots aren't running
// Start waits for them.
// Like the table's other verbs it isn't on the editor's undo (scene/EDITOR.md,
// "Undo").

import { seatsFrom } from "./visibility.js";
import { keptBy, speaker } from "./extension.js";
import { seed32 } from "../dice/lots.js";

/** The scene's trait (setup.js START). */
export const START = "tabletop.start";

/** A table's start, as its trait has it, or null where it has none. */
export function startOf(scene) {
  const s = scene?.traits?.[START];
  return s && Array.isArray(s.steps) ? s : null;
}

/** The id lots know the round for who goes first by (dice/lots-ext.js SCENE_ROUNDS). */
export const FIRST = "scene:tabletop.start";

/** The seats nobody has taken, by name. */
const open = (seats) => (seats ?? []).filter((s) => !s?.viewer).map((s) => s?.name || s?.id);
/** Does this start choose who goes first, and is that still to come? */
const choosesFirst = (s) => s.steps.some((x) => x.first);
const firstPending = (s) => !!s.started && choosesFirst(s) && !s.started.first;
/** Lots' round for who goes first, as this client reads it (lots.js derive), or null. */
const roundOf = (lots) => lots?.state?.(FIRST) ?? null;
/** A round that's over without a seed anyone may land by: it may be asked again. */
const over = (st) => st.phase === "ended" || st.phase === "spoiled" || !!st.fault || st.forged?.length > 0;

/**
 * The seat a round names, once its seed is everyone's: of the seats it was
 * drawn over (bound into every part), the seed's first 32 bits mod how many.
 * null while it isn't, or when it was drawn over other seats than these.
 * @param {object | null} st  lots' state  @param {string[]} ids  the seats now, in order
 */
export function firstOf(st, ids) {
  if (!st?.public || st.seed == null || over(st)) return null;
  if (!Array.isArray(st.of) || !ids.length || st.of.join("\n") !== ids.join("\n")) return null;
  const n = seed32(st.seed);
  return n == null ? null : ids[n % ids.length];
}

/**
 * Start game's state for the scene (the null target): null where the table
 * has no start; while a seat is empty, disabled, saying which; once
 * started, disabled, but for drawing who goes first again when its lots
 * ended without one; a start that chooses who goes first waits for lots.
 * @param {object} scene  @param {{ id, name?, viewer }[]} seats  the roster's
 * @param {{ draw, state } | null} lots  this client's lots (dice/lots-ext.js), or null where they aren't running
 */
export function startState(scene, seats, lots = null) {
  const s = startOf(scene);
  if (!s) return null;
  if (s.started) {
    if (!firstPending(s) || !lots) return { disabled: true, label: "Game started", title: "This game has started" };
    const st = roundOf(lots);
    if (st && !over(st)) return { disabled: true, label: "Drawing who goes first…", title: "Who goes first is being drawn by lots" };
    return { label: "Draw who goes first", title: "The game has started, and who goes first is still to draw: draw it by lots" };
  }
  const waiting = open(seats);
  if (waiting.length) return { disabled: true, title: `Every seat must be taken to start: waiting for ${waiting.join(", ")}` };
  if (choosesFirst(s) && !lots) return { disabled: true, title: "Who goes first is drawn by lots, which aren't running here yet" };
  return { title: startTitle(s.steps) };
}

/** What Start will do, in words. */
function startTitle(steps) {
  const words = steps.flatMap((x) => (x.shuffle ? ["shuffle"] : x.deal ? [`deal ${x.deal} to each seat`] : x.draw ? [`lay out ${x.draw}`] : x.first ? ["choose who goes first"] : []));
  return words.length ? `Start the game: ${words.join(", ")}` : "Start the game";
}

/**
 * Run a table's start: each shuffle through its cards' keeper, then every
 * move and `started` (by whom) in one change. Nothing when it's started
 * already, or a seat is empty. Who goes first isn't chosen here: lots draw it
 * (the extension, below).
 * @param {{ scene: object, seats: object[], keeperOf: (id: string) => { shuffle(ids): number } | null,
 *   change: (fn: (d: object) => void) => unknown, setTransform: (scene: object, id: string, t: object) => ((d: object) => void) | null,
 *   by: string }} o  by: the viewer starting it
 * @returns {{ dealt: number, moved: number, first: boolean } | null}  first: who goes first is to be drawn; null when it didn't start
 */
export function runStart({ scene, seats, keeperOf, change, setTransform, by }) {
  const s = startOf(scene);
  if (!s || s.started || open(seats).length) return null;
  let dealt = 0;
  const writes = [];
  for (const step of s.steps) {
    if (step.shuffle) {
      const ids = step.shuffle.filter((id) => scene.objects?.[id]);
      if (ids.length > 1) keeperOf(ids[0])?.shuffle?.(ids);
    } else if (step.moves) {
      if (step.deal) dealt = Math.max(dealt, step.deal);
      for (const [id, t] of step.moves) {
        if (!scene.objects?.[id]) continue;
        const scale = Number(scene.objects[id].transform?.scale) || 1;
        const w = setTransform(scene, id, { position: [...t.position], rotation: [...(t.rotation ?? [0, 0, 0])], scale });
        if (w) writes.push(w);
      }
    }
  }
  change((d) => {
    const trait = d.traits?.[START];
    if (!trait || trait.started) return;
    for (const w of writes) w(d);
    trait.started = { by };
  });
  return { dealt, moved: writes.length, first: choosesFirst(s) };
}

/** The HUD's line once started with a first player: who goes first, by the seat's name. */
export function startLine(scene, seats) {
  const first = startOf(scene)?.started?.first;
  if (!first) return null;
  const seat = (seats ?? []).find((x) => x.id === first);
  return seat ? `${seat.name || seat.id} goes first.` : null;
}

function create(api) {
  const { viewer } = api.channel;
  const teller = api.use("tell");
  let scene = null;
  /** This client's lots (dice/lots-ext.js, this package's own seam), or null while they aren't running. */
  const lotsApi = () => {
    for (const { value } of api.collect?.("dice.lots") ?? []) if (typeof value?.draw === "function" && typeof value?.state === "function") return value;
    return null;
  };
  const seatIds = (snap) => seatsFrom(api, snap).map((x) => x.id);
  const drawFirst = (snap) => lotsApi()?.draw(FIRST, { sealers: [], of: seatIds(snap) });

  function start() {
    const snap = api.scene();
    const seats = seatsFrom(api, snap);
    const state = startState(snap, seats, lotsApi());
    if (!state || state.disabled) return;
    // started, and its lots for who goes first ended without one: draw it again
    if (startOf(snap).started) return void drawFirst(snap);
    const done = runStart({
      scene: snap,
      seats,
      keeperOf: (id) => keptBy(api, id)?.keeper ?? null,
      change: (fn) => api.change(fn),
      setTransform: (sc, id, t) => api.ops.setTransform(sc, id, t),
      by: viewer,
    });
    if (!done) return;
    teller.tell("started", done.dealt ? { n: done.dealt } : {});
    settle();
  }

  /** Who goes first: asked by whoever started (once the merge says it's them), landed by anyone once its seed is everyone's. */
  function settle() {
    const snap = api.scene();
    const s = startOf(snap);
    const lots = lotsApi();
    if (!s || !firstPending(s) || !lots || api.writable?.() === false) return;
    const st = roundOf(lots);
    if (!st) return void (s.started.by === viewer && drawFirst(snap));
    const first = firstOf(st, seatIds(snap));
    if (first)
      api.change((d) => {
        const t = d.traits?.[START];
        if (t?.started && !t.started.first) t.started.first = first;
      });
  }

  return {
    // (on every update: what lots know changes without the doc, api.local's "dice.lots.known")
    update(snapshot) {
      scene = snapshot;
      settle();
    },
    messages: {
      started: { valid: (d) => d.n === undefined || (Number.isInteger(d.n) && d.n > 0 && d.n <= 1000), says: (d, who) => `${speaker(api, who)} started the game${d.n ? `, dealing ${d.n} to each seat` : ""}` },
    },
    // who goes first, once the game has started and lots chose them
    hud() {
      const line = scene ? startLine(scene, seatsFrom(api, scene)) : null;
      return line ? [{ text: line, state: "info" }] : [];
    },
    commands: [
      {
        id: "start",
        name: "Start game",
        // the table's, not a piece's: on the bar of tools in every body, and the menu
        show: ["menu", "world"],
        state: (target, ctx) => (target == null ? startState(ctx?.scene ?? scene, seatsFrom(api, ctx?.scene ?? scene), lotsApi()) : null),
        run: (target) => target == null && start(),
      },
    ],
  };
}

export default { create };
