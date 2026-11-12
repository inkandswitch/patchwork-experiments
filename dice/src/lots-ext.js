// `scene:extension` "dice.lots": every roll in a scene, drawn by lots
// (lots.js, run by lots-run.js) between the clients of those present, so
// that nobody chooses it: a die thrown in the open (nothing sealed), a cup
// shaken (its holder's part sealed), a cup shaken blind (every seated part
// sealed). Built only from the stage's contract (scene/STAGE.md): it reads
// the doc, presence, the `roster` convention and api.audience.
//
// It runs wherever there is a die or a cup (its `traits` are theirs; it
// describes none), in every activity: a member's client must commit and open
// whatever its viewer is doing.
//
// WHERE A ROUND LIVES: in the trait of the thing it's drawn for, under
// `round`: a cup's (`"dice.cup": { …, round }`), else a die's (`"dice.die":
// { round }`, on the first die of a throw). So there is no trait of its own
// to put on anything, and a round goes wherever the thing goes (a copy
// starts without one: both traits list `round` as runtime).
//
// WHO TAKES PART: the asker, and every seated viewer (with no seats,
// everyone) who is here and runs this extension: each client says so in
// its presence (`here`), so nobody is waited for whose client can't answer.
// Alone in a scene, a draw has one member and is drawn at once.
//
// What it contributes, for the dice and cup extensions of this package
// (api.collect("dice.lots"); a namespaced name: this is the package's own
// seam, not a convention between packages):
//
//   "dice.lots": {
//     draw(id, { sealers, draw, of }) → draw id | null   (lots-run.js)
//     state(id) → null | lots.js derive()
//   }
//
// and a HUD line for anything a round says that everyone should see
// (rerolls refused, a part forged in someone's name, a draw by one alone, a
// wait).

import { createRunner } from "./lots-run.js";

/** The traits a round lives in: a cup's if it is one, else a die's. */
export const CUP = "dice.cup";
export const DIE = "dice.die";
/** This extension's id: its presence key's namespace, and the name of what it contributes. */
export const ID = "dice.lots";

/** The map that holds a thing's round: its cup trait, else its die trait; null when it's neither. */
export function holderOf(o) {
  const t = o?.traits;
  if (!t || o.kind === "group") return null;
  const h = t[CUP] ?? t[DIE];
  return h && typeof h === "object" && !Array.isArray(h) ? h : null;
}

function create(api) {
  const viewer = api.viewer;
  let nudges = 0;
  function roster() {
    for (const { value } of api.collect?.("roster") ?? []) if (typeof value?.viewers === "function") return value;
    return null;
  }
  const runner = createRunner({
    viewer,
    ready: () => !!api.scene(),
    rounds() {
      const out = [];
      for (const [id, o] of Object.entries(api.scene()?.objects ?? {})) {
        const round = holderOf(o)?.round;
        if (round) out.push({ id, round });
      }
      return out;
    },
    write(id, fn) {
      api.change((d) => {
        const h = holderOf(d.objects?.[id]);
        if (h) fn(h);
      });
    },
    present() {
      const here = [viewer];
      for (const p of Object.values(api.presence?.get?.() ?? {})) if (typeof p?.viewer === "string" && p.keys?.[api.id]?.here) here.push(p.viewer);
      return here;
    },
    seated() {
      const r = roster();
      return r ? r.viewers(api.scene()) : null;
    },
    audience: (id) => api.audience?.(id) ?? null,
    // tell everything that reads lots to look again, when something was learned without a doc change (an envelope opened)
    nudge: () => api.local?.swap?.((m) => ({ ...m, "dice.lots.known": ++nudges })),
    name(v) {
      if (v === viewer) return "you";
      try {
        return roster()?.who?.(v) || "someone";
      } catch {
        return "someone";
      }
    },
    what: (id) => api.nameOf?.(id) || api.scene()?.objects?.[id]?.name || "this",
    storage: (() => {
      try {
        return globalThis.localStorage ?? null;
      } catch {
        return null;
      }
    })(),
  });
  // this client takes part in draws: say so to the others
  api.presence?.set?.("here", true);

  return {
    update(snapshot, local, prev) {
      // look again when the doc, what's running or what's installed changed (any of which can change an audience)
      if (prev && snapshot === prev.scene && local?.running === prev.local?.running && local?.packages === prev.local?.packages && local?.["dice.lots.known"] === prev.local?.["dice.lots.known"]) return;
      runner.act();
    },
    [ID]: Object.freeze({ draw: runner.draw, state: runner.state }),
    hud: runner.hud,
    dispose: runner.dispose,
  };
}

export default { create };
