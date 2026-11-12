// Lots for a die's own panel (tool.js), outside any scene: a roll there is
// drawn between the clients of everyone who has that die's panel open, by
// the same protocol and the same runner as in a scene (lots.js, lots-run.js).
// Only the place differs:
//
// - THE ROUND lives in the die doc itself, at `round` (one at a time: a new
//   roll replaces it), beside the panel's `rolls`. The die's build never
//   reads either (die.js dieKey), so a roll in the panel builds nothing.
// - WHO IS HERE comes from the die doc's own handle: each panel says it is
//   here by an ephemeral message (`{ type: "dice.lots/here", session,
//   viewer }`) every 2 s and on hearing anyone new, and goodbye when it
//   closes; a panel not heard from for 5 s is gone. That is the membership:
//   no seats, nobody sealed, every draw open to all.
// - NOTHING IS SEALED, so the stage's audience is never asked: every part is
//   opened in the clear (the asker's first), and the seed is everyone's once
//   the last is in.
//
// A panel docked beside a scene (extension.js) is the same panel on the
// same doc: it rolls among everyone who has that die's panel open, docked or
// not, and never among the scene's players as such. A die in a scene and its
// doc's panel draw separately: a roll in either touches nothing of the other.

import { createRunner } from "./lots-run.js";
import { freshId } from "./lots.js";

/** The ephemeral message a panel says it's here with. */
export const HERE = "dice.lots/here";
/** How often a panel says it's here (ms), and how long one unheard from counts as gone (ms). */
export const BEAT_MS = 2000;
export const GONE_MS = 5000;
/** The one thing a panel draws for: its die. */
export const PANEL = "die";

/**
 * @param {{ doc(): any, change(fn): void, on?(ev, fn): void, off?(ev, fn): void, broadcast?(msg): void }} handle  the die doc's
 * @param {{ viewer: string, onChange?: () => void, name?: (v: string) => string, storage?: Storage | null }} o
 */
export function panelLots(handle, { viewer, onChange = () => {}, name, storage = null }) {
  const session = freshId("s");
  const heard = new Map(); // session → { viewer, at }
  let dead = false;
  const say = (more = {}) => {
    if (dead && !more.bye) return;
    try {
      handle.broadcast?.({ type: HERE, session, viewer, ...more });
    } catch {
      // best effort: presence is never worth an error
    }
  };
  /** Who is here now: this viewer, and every panel heard from lately. */
  function present() {
    const now = Date.now();
    const out = [viewer];
    for (const [s, h] of heard) {
      if (now - h.at > GONE_MS) heard.delete(s);
      else out.push(h.viewer);
    }
    return out;
  }
  const runner = createRunner({
    viewer,
    ready: () => !!handle.doc(),
    rounds() {
      const round = handle.doc()?.round;
      return round && typeof round === "object" ? [{ id: PANEL, round }] : [];
    },
    // the doc itself holds `round`
    write: (id, fn) => handle.change((d) => fn(d)),
    present,
    seated: () => null,
    audience: () => "all",
    nudge: () => onChange(),
    name: name ?? ((v) => (v === viewer ? "you" : "someone")),
    what: () => handle.doc()?.title || "this die",
    storage,
  });
  function onMessage(e) {
    const m = e?.message;
    if (!m || m.type !== HERE || typeof m.session !== "string" || m.session === session || typeof m.viewer !== "string" || !m.viewer) return;
    if (m.bye) {
      heard.delete(m.session);
      return onChange();
    }
    const fresh = !heard.has(m.session);
    heard.set(m.session, { viewer: m.viewer, at: Date.now() });
    // someone new: answer at once, so they needn't wait a beat to know we're here
    if (fresh) {
      say();
      onChange();
    }
  }
  const onDoc = () => runner.act();
  handle.on?.("ephemeral-message", onMessage);
  handle.on?.("change", onDoc);
  const beat = setInterval(() => say(), BEAT_MS);
  say();
  runner.act();
  return {
    session,
    /** Roll: a new draw for the die, open to all, among everyone here. → its draw id */
    draw: () => runner.draw(PANEL, { sealers: [], of: [PANEL] }),
    state: () => runner.state(PANEL),
    hud: runner.hud,
    present,
    act: runner.act,
    dispose() {
      say({ bye: true });
      dead = true;
      clearInterval(beat);
      handle.off?.("ephemeral-message", onMessage);
      handle.off?.("change", onDoc);
      runner.dispose();
    },
  };
}
