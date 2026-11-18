// Copied whole from scene/src/stage/telling.js at commit c4db8b57 (packages stand alone: never
// import another package's source). The fake stages here tell with it exactly as the stage does;
// `git diff c4db8b57 -- scene/src/stage/telling.js` shows whether scene's has moved on since.
//
// Telling the others what the doc bears out (STAGE.md, "Native services").
//
// An extension declares what it tells, `messages: { [type]: { valid(data),
// says(data, who, scene) } }`, and calls `api.tell(type, data)`. The stage
// says it here as "You" and sends it; every peer's stage, on receipt, drops
// it unless its data is an object and `valid`, then asks `says` at once and
// again on every update of that stage until it answers text or TELL_MS of the
// stage's time has passed since it arrived: told once, or forgotten when that
// time runs out, whether or not anything updates. One's own goes the same
// way (sends are never echoed back, so it is told once, here).
//
// `says` is where a package keeps its evidence: it answers null until the
// doc bears the message out (a die moved lately to the face named), and text
// once it does. Answering text is the moment the stage tells it, so a
// package may spend what bore it out there.
//
// The speaker is named by the stage, the same way for every package: their
// contact's name, else "Someone", asked once per viewer; `who.mine` is
// whether this view told it (another tab of the same viewer is a peer). `says` is not asked
// until their name has come or NAME_MS has passed, so the first word from
// someone is told by name.
//
// Nothing here knows a stage: it is handed time, the scene, notify, a way to
// find a contact's doc and whether an extension's instance still runs.
// (Packages' fake stages copy this file whole: they stand alone.)

/** How long after it arrives a message may still be borne out and told (ms, the stage's time). */
export const TELL_MS = 3000;
/** How long `says` waits for a speaker's contact name before they're "Someone" (ms, the stage's time). */
export const NAME_MS = 1000;

/** What an instance declares it tells of `type`: { valid, says }; null when it doesn't (then it's `receive`'s). */
export function declared(instance, type) {
  const m = instance?.messages;
  if (!m || typeof m !== "object" || typeof type !== "string" || !Object.hasOwn(m, type)) return null;
  return m[type] ?? {};
}

/**
 * @param {{
 *   now: () => number,
 *   after: (ms: number, fn: () => void) => () => void,
 *   scene: () => any,
 *   notify: (text: string, ext: string) => void,
 *   find?: (url: string) => any,
 *   alive: (ext: string, instance: object) => boolean,
 * }} o
 */
export function createTelling({ now, after, scene, notify, find, alive }) {
  let dead = false;
  const pending = new Set(); // { ext, instance, spec, data, viewer, mine, at, cancel }
  const names = new Map(); // viewer → { name: string | null, settled: boolean }
  const cancels = new Set();

  /** A speaker's name: their contact's, else "Someone"; undefined while it's still being asked. */
  function nameOf(viewer) {
    let n = names.get(viewer);
    if (!n) {
      const asks = typeof viewer === "string" && viewer.startsWith("automerge:") && typeof find === "function";
      names.set(viewer, (n = { name: null, settled: !asks }));
      if (asks) {
        const settle = () => {
          if (n.settled) return;
          n.settled = true;
          cancels.delete(cancel);
          cancel();
          ask();
        };
        const cancel = after(NAME_MS, settle);
        cancels.add(cancel);
        Promise.resolve()
          .then(() => find(viewer))
          .then((h) => {
            const name = h?.doc?.()?.name;
            // (one that comes late still names them next time)
            if (typeof name === "string" && name.trim()) n.name = name.trim();
          })
          .catch(() => {})
          .finally(() => !dead && settle());
      }
    }
    return n.settled ? (n.name ?? "Someone") : undefined;
  }

  /** Forget a message: told, dropped or out of time. */
  function forget(p) {
    pending.delete(p);
    cancels.delete(p.cancel);
    p.cancel();
  }
  /** Ask one waiting message whether the doc bears it out yet: told and forgotten, or kept. */
  function askOne(p) {
    if (dead || !alive(p.ext, p.instance) || now() - p.at >= TELL_MS) return forget(p);
    const name = p.mine ? "You" : nameOf(p.viewer);
    if (name === undefined) return;
    let text;
    try {
      text = p.spec.says(p.data, Object.freeze({ viewer: p.viewer, name, mine: p.mine }), scene());
    } catch (err) {
      console.warn(`[scene] extension “${p.ext}”: says(“${p.type}”) failed`, err);
      return forget(p);
    }
    if (typeof text !== "string" || !text) return;
    forget(p);
    notify(text, p.ext);
  }
  /** Ask every waiting message (each update of the stage, and as a name comes). */
  function ask() {
    for (const p of [...pending]) askOne(p);
  }

  /** Take a message in: dropped unless declared, an object and valid (false), else asked now and kept until told or out of time. */
  function take(ext, instance, type, data, viewer, mine) {
    if (dead || data === null || typeof data !== "object") return false;
    const spec = declared(instance, type);
    if (typeof spec?.valid !== "function" || typeof spec.says !== "function") return false;
    let ok = false;
    try {
      ok = spec.valid(data) === true;
    } catch {
      ok = false;
    }
    if (!ok) return false;
    const p = { ext, instance, type, spec, data, viewer, mine, at: now(), cancel: null };
    // out of time, it is forgotten then, not when something next asks (a quiet doc asks nothing)
    p.cancel = after(TELL_MS, () => pending.has(p) && forget(p));
    cancels.add(p.cancel);
    pending.add(p);
    askOne(p);
    return true;
  }

  return Object.freeze({
    /** This view tells it: said here as "You"; false if it isn't valid (then it isn't sent either). */
    say: (ext, instance, type, data, viewer) => take(ext, instance, type, data, viewer, true),
    /** A peer told it (`from`: { session, viewer }). */
    hear: (ext, instance, type, data, from) => void take(ext, instance, type, data, from?.viewer ?? null, false),
    ask,
    /** for tests and probes: how many messages wait */
    waiting: () => pending.size,
    dispose() {
      dead = true;
      pending.clear();
      for (const c of cancels) c();
      cancels.clear();
    },
  });
}
