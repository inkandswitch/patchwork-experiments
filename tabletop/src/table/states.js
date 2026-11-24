// A piece's states (GAME-FORMAT.md §4): the `scene:extension`
// "tabletop.states", by the trait of that name, which the table writer
// puts on every thing whose piece has other looks (setup.js):
//
//   { looks: [{ name, game, kind } | { name, sourceUrl }],   every look it has, its piece's own first
//     own: n,                                                the one it was laid out in: what the doc shows
//     shown?: n }                                            the one it shows now (runtime: a copy shows `own`)
//
// Turning it (PgDn to the next look, PgUp to the one before, a number key
// for that look, as in TTS) is one write of `shown`, for everyone: play,
// not an edit, so not on the editor's undo. Two people turning one piece at
// once each write `shown`; the merge keeps one, the same on every peer
// (last writer wins).
//
// What it shows is the stage's display (scene/API.md, "Display"): the
// object's own file is the look it was laid out in, and the look it's
// turned to is shown over it (keep/rule.js showLooks: a game's look is
// drawn the first time anyone is shown it, table/faces.js, and kept in the
// game's `drawn` under its ref, states.js). A state is a public look: the
// doc says which one each thing shows, as it says which piece it is, and a
// card (whose look is its keeper's) never has one. A piece lying in
// someone's hand follows the hand's rule (visibility.js): its seat sees it
// turned, everyone else sees the look it was laid out in.

import { STATES } from "../states.js";
import { showLooks } from "../keep/rule.js";
import { faces } from "./faces.js";
import { seatAt, seatOf, seatsFrom, zones } from "./visibility.js";

export { STATES };

/** The most looks a number key picks (1 to 9: TTS's). */
export const PICKS = 9;

/** A thing's states, as its trait has them, whole: { looks, own, now }, or null where it has none to turn to. */
export function statesOf(o) {
  const t = o?.traits?.[STATES];
  const looks = Array.isArray(t?.looks) ? t.looks : null;
  if (!looks || looks.length < 2) return null;
  const at = (n) => (Number.isInteger(n) && n >= 0 && n < looks.length ? n : null);
  const own = at(t.own) ?? 0;
  return { looks, own, now: at(t.shown) ?? own };
}

/** What a look is called: its name, else its number (1 first). */
const nameOf = (s, i) => (typeof s.looks[i]?.name === "string" && s.looks[i].name ? s.looks[i].name : `state ${i + 1}`);

/** Turn a thing to look `i`: one write of its `shown` (a function of the doc draft, for api.change). */
export const turnTo = (id, i) => (d) => {
  const t = d.objects?.[id]?.traits?.[STATES];
  if (t) t.shown = i;
};

/** The looks to show over each thing turned from the one it was laid out in: id → look, for this viewer. */
export function turnedLooks(scene, { mine = null } = {}) {
  const out = new Map();
  let regions = null;
  for (const [id, o] of Object.entries(scene?.objects ?? {})) {
    const s = statesOf(o);
    if (!s || s.now === s.own) continue;
    // in someone else's hand: theirs to see turned (the hand's rule); everyone else sees it as it was laid out
    regions ??= zones(scene);
    if (regions.length) {
      const m = scene.world(id);
      const seat = seatAt(scene, regions, [m[12], m[13], m[14]]);
      if (seat != null && seat !== mine) continue;
    }
    out.set(id, { ...s.looks[s.now], name: nameOf(s, s.now) });
  }
  return out;
}

export function create(api) {
  const { viewer } = api.channel;
  const shown = showLooks(api, api.use("audience"), { face: faces(api) });
  let scene = null;

  /** The look `step` from the one it shows (+1 the next, −1 the one before, round). */
  const stepped = (s, step) => (s.now + step + s.looks.length) % s.looks.length;
  /** Turn it to the look `pick(states)` names (an index), if that's another it has. */
  const turn = (pick) => (id) => {
    const s = statesOf(api.scene()?.objects?.[id]);
    const i = s ? pick(s) : null;
    if (Number.isInteger(i) && i !== s.now && i >= 0 && i < s.looks.length) api.change(turnTo(id, i));
  };
  const stepState = (step) => (id, ctx) => {
    const s = statesOf((ctx?.scene ?? scene)?.objects?.[id]);
    // (two looks: the next is the one before too, so PgUp says nothing PgDn doesn't)
    if (!s || (step < 0 && s.looks.length < 3)) return null;
    const to = stepped(s, step);
    return { label: `Turn to ${nameOf(s, to)}`, title: `Show its ${step > 0 ? "next" : "previous"} look (${to + 1} of ${s.looks.length}), for everyone` };
  };
  const pickState = (k) => (id, ctx) => {
    const s = statesOf((ctx?.scene ?? scene)?.objects?.[id]);
    // (two looks: PgDn turns it to the other)
    if (!s || s.looks.length < 3 || k >= s.looks.length || k === s.now) return null;
    return { label: `Turn to ${nameOf(s, k)}`, title: `Show look ${k + 1} of ${s.looks.length}, for everyone` };
  };

  return {
    update(snapshot, _local, prev) {
      if (snapshot === prev?.scene) return;
      scene = snapshot;
      shown.set(turnedLooks(snapshot, { mine: seatOf(seatsFrom(api, snapshot), viewer) }));
    },
    commands: [
      {
        id: "state-next",
        name: "Turn to its next state",
        key: "PageDown",
        show: ["use", "menu", "inspector"],
        state: stepState(+1),
        run: turn((s) => stepped(s, +1)),
      },
      {
        id: "state-previous",
        name: "Turn to its previous state",
        key: "PageUp",
        show: ["menu", "inspector"],
        state: stepState(-1),
        run: turn((s) => stepped(s, -1)),
      },
      ...Array.from({ length: PICKS }, (_, k) => ({
        id: `state-${k + 1}`,
        name: `Turn to state ${k + 1}`,
        key: String(k + 1),
        show: ["menu"],
        state: pickState(k),
        run: turn(() => k),
      })),
    ],
    dispose() {
      shown.set(new Map());
    },
  };
}

export default { create };
