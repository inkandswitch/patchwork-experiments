// scene.telling (native, every doc): telling the others what the doc bears
// out, provided as "tell" (NATIVE.md, "Native services").
//
// An extension declares `messages: { [type]: { valid(data), says(data, who,
// scene) } }` and calls `api.use("tell").tell(type, data)`: said here as
// "You", and sent. A peer drops it unless its data is an object and `valid`,
// then asks `says` at once and on every update until it answers text or
// TELL_MS has passed: told once, or forgotten then. `says` keeps the
// package's evidence: null until the doc bears it out (a die moved lately to
// the face named), text once it does, which is the moment it is told.
//
// The speaker is their contact's name, else "Someone", asked once per viewer
// (`says` waits for it up to NAME_MS); `who.mine` is whether this view told it.
// createTelling knows no stage: the plugin at the end hands it time, the
// scene, notify, a way to find a contact's doc and whether an extension's
// messages still run. (Packages' fake stages copy createTelling whole.)

/** How long after it arrives a message may still be borne out and told (ms, the stage's time). */
export const TELL_MS = 3000;
/** How long `says` waits for a speaker's contact name before they're "Someone" (ms, the stage's time). */
export const NAME_MS = 1000;

/** What an extension's `messages` declare it tells of `type`: { valid, says }; null when they don't. */
export function declared(m, type) {
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
 *   alive: (ext: string, messages: object) => boolean,
 * }} o
 */
export function createTelling({ now, after, scene, notify, find, alive }) {
  let dead = false;
  const pending = new Set(); // { ext, messages, spec, data, viewer, mine, at, cancel }
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
    if (dead || !alive(p.ext, p.messages) || now() - p.at >= TELL_MS) return forget(p);
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
  function take(ext, messages, type, data, viewer, mine) {
    if (dead || data === null || typeof data !== "object") return false;
    const spec = declared(messages, type);
    if (typeof spec?.valid !== "function" || typeof spec.says !== "function") return false;
    let ok = false;
    try {
      ok = spec.valid(data) === true;
    } catch {
      ok = false;
    }
    if (!ok) return false;
    const p = { ext, messages, type, spec, data, viewer, mine, at: now(), cancel: null };
    // out of time, it is forgotten then, not when something next asks (a quiet doc asks nothing)
    p.cancel = after(TELL_MS, () => pending.has(p) && forget(p));
    cancels.add(p.cancel);
    pending.add(p);
    askOne(p);
    return true;
  }

  return Object.freeze({
    /** This view tells it: said here as "You"; false if it isn't valid (then it isn't sent either). */
    say: (ext, messages, type, data, viewer) => take(ext, messages, type, data, viewer, true),
    /** A peer told it (`from`: { session, viewer }). */
    hear: (ext, messages, type, data, from) => void take(ext, messages, type, data, from?.viewer ?? null, false),
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

// ─── the plugin ─────────────────────────────────────────────────────────────

/** What goes on the channel: { ext, type, data }. */
const TOLD = "told";

function create(api) {
  const messagesOf = (ext) => api.collect("messages").find((x) => x.id === ext)?.value ?? null;
  const telling = createTelling({
    now: api.now,
    after: api.after,
    scene: api.scene,
    notify: (text, ext) => api.use("notices")?.notify(text, "info", { from: ext }),
    find: (url) => api.repo?.find?.(url),
    alive: (ext, messages) => messagesOf(ext) === messages,
  });
  return {
    provides: {
      tell: (caller) =>
        Object.freeze({
          /** say it here as "You" and send it, after the change that bears it out (a view that can't write tells nothing) */
          tell(type, data) {
            if (caller.signal.aborted || !api.writable()) return;
            const m = messagesOf(caller.id);
            if (!declared(m, type)) return void console.warn(`[scene] extension “${caller.id}”: tell(“${type}”) isn't among its messages`);
            let copy;
            try {
              copy = structuredClone(data ?? null);
            } catch {
              return void console.warn(`[scene] extension “${caller.id}”: tell(“${type}”) data isn't plain`);
            }
            if (telling.say(caller.id, m, type, copy, api.channel.viewer)) api.channel.send(TOLD, { ext: caller.id, type, data: copy });
          },
        }),
    },
    receive(type, d, from) {
      if (type === TOLD && typeof d?.ext === "string") telling.hear(d.ext, messagesOf(d.ext), d.type, d.data, from);
    },
    // asked again once every extension has seen this flush (a package's evidence may be in its update)
    update: () => void (telling.waiting() && api.schedule(telling.ask)),
    /** for tests and probes: how many messages wait */
    waiting: () => telling.waiting(),
    dispose: () => telling.dispose(),
  };
}

export default { create };
