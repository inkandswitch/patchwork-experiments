// scene.keys: the key map, the only `input.key` implementer (TOOLS.md §5).
// A key the open gesture, the held tool and the body don't reserve comes
// here (the router decides that first), and runs the command the resolver
// says (../keymap.js mapInvocation): the first whose `key` matches and that
// applies to attention's element (the selection, else the look's), then to
// the scene. Within one target, in running order then command order. Keys
// work whatever a command's `show` says. With ctrl or meta held a key is the
// browser's (copy, reload…). An auto-repeated key that matches is claimed
// but not run again, so holding M doesn't flicker the measure tool and
// holding Delete doesn't remove one thing after another. Escape is never a
// command's: it is the stage's ladder.
//
// Every command runs in the context every surface passes (api.context: the
// eye, the body's reach, the look's hit), so a `reach: true` verb runs only
// within reach, from any surface. A tool command (it declares `tool`) goes
// through api.run, which holds it.
//
// Held verbs. A verb whose run() returns a session ({ end(), cancel(),
// update?(dt) }) is held: it lasts as long as its key is down (winding a
// capstan). update(dt) runs every frame, end() on the key's release,
// cancel() when the window or the view loses focus, the target goes, or
// this part stops. `hold: true` on a command only changes how it's shown
// ("hold F"). A held verb keeps its target until its key comes up: while
// anything is held, attention is pinned to that target, so a second key
// (ease while hauling) works the same thing, and the prompt (scene.use)
// stays on it. It reads the pin through `keymap` (api.collect).

import { commandState, controlKind, flatCommands } from "./toolbar-commands.js";
import { mapInvocation, segmentsOf } from "../keymap.js";
import { resolverState } from "./resolver.js";

/** Does this look like a session (something a held verb returns)? */
const isSession = (r) => !!r && typeof r === "object" && (typeof r.end === "function" || typeof r.cancel === "function");

/**
 * The held verbs, by key code: open, tick, and close with end or cancel.
 * Each session's failure is its own.
 */
export function heldSessions() {
  const open = new Map(); // code → { session, target, ext, command, entry }
  const call = (session, name, ...args) => {
    try {
      session?.[name]?.(...args);
    } catch (err) {
      console.warn(`[scene] scene.keys: a held verb's ${name} failed`, err);
    }
  };
  const close = (code, how) => {
    const h = open.get(code);
    if (!h) return false;
    open.delete(code);
    call(h.session, how);
    return true;
  };
  return {
    get size() {
      return open.size;
    },
    has: (code) => open.has(code),
    /** is this extension's command held? */
    holding: (ext, command) => [...open.values()].some((h) => h.ext === ext && h.command === command),
    /** the target of the first held verb (what attention is pinned to), or undefined when nothing's held */
    get target() {
      return open.values().next().value?.target;
    },
    /** the prompt's entries of the verbs held on `target`, as they were when pressed, first held first */
    entries: (target) => [...open.values()].filter((h) => h.target === target && h.entry).map((h) => h.entry),
    open(code, session, { target = null, ext = null, command = null, entry = null } = {}) {
      close(code, "end"); // a press whose release we never heard
      open.set(code, { session, target, ext, command, entry });
    },
    tick(dt) {
      for (const h of [...open.values()]) call(h.session, "update", dt);
    },
    end: (code) => close(code, "end"),
    cancel: (code) => close(code, "cancel"),
    /** cancel those whose target this says is gone */
    cancelWhere(gone) {
      for (const [code, h] of [...open]) if (gone(h.target, h.ext)) close(code, "cancel");
    },
    cancelAll() {
      for (const code of [...open.keys()]) close(code, "cancel");
    },
  };
}

function create(api) {
  const held = heldSessions();
  const watchers = new Set(); // the prompt, told when what's held changes
  let offLoop = null;
  const changed = () => {
    for (const fn of watchers) fn();
  };

  /** Attention, pinned to the held verbs' target while any is held. */
  function attentionNow() {
    const pinned = held.target;
    return pinned !== undefined ? Object.freeze({ selected: pinned, hit: null }) : api.attention();
  }

  function wantLoop() {
    if (held.size && !offLoop) offLoop = api.loop((dt) => held.tick(dt));
    else if (!held.size && offLoop) {
      offLoop();
      offLoop = null;
    }
  }

  // The code a key event is held under (its physical key, as the router keeps it).
  const codeOf = (ev) => ev.code || ev.key;

  function onKey(ev) {
    if (ev.ctrl || ev.meta || typeof ev.key !== "string" || ev.key === "Escape") return false;
    // the held key's own repeat: still the held verb's, on its target
    if (ev.repeat && held.has(codeOf(ev))) return true;
    // the state every hint is computed from (resolver.js), so a shown key does what it showed
    // attention's path, a stage at a time, innermost first (COMPOSITION.md §5)
    let inv = null;
    let seg = null;
    for (const s of segmentsOf(resolverState(api, attentionNow()))) {
      inv = mapInvocation(s.collected, ev.key, s.ctx, s.attention);
      if (inv) {
        seg = s;
        break;
      }
    }
    if (!inv) return false;
    const { collected, ctx } = seg;
    if (ev.repeat) return true;
    const entry = flatCommands(collected).find((e) => e.ext === inv.ext && e.command.id === inv.command);
    if (!entry) return false;
    const { command } = entry;
    // a tool: the stage holds it (or puts it down)
    if (command.tool) return api.run({ ...inv, ...(seg.stage !== undefined ? { stage: seg.stage } : {}), hit: ctx.hit });
    // what api.run does, keeping what run returns: still applies, then run
    const state = commandState(command, inv.target, ctx);
    if (!state || state.disabled) return false;
    const value = controlKind(state) === "toggle" ? !state.checked : undefined;
    let out;
    try {
      out = command.run(inv.target, value, ctx);
    } catch (err) {
      console.warn(`[scene] extension “${inv.ext}”: command ${command.id} failed`, err);
      return true;
    }
    if (isSession(out)) {
      held.open(codeOf(ev), out, { target: inv.target, ext: inv.ext, command: command.id, entry: { ext: inv.ext, command, state } });
      wantLoop();
      changed();
    }
    return true;
  }

  // A release ends a held verb; one that comes because the window or page
  // went away (the stage lets go of every key then) cancels it.
  function onKeyUp(ev) {
    const code = codeOf(ev);
    if (!held.has(code)) return false;
    const away = document.visibilityState === "hidden" || (typeof document.hasFocus === "function" && !document.hasFocus());
    if (away) held.cancel(code);
    else held.end(code);
    wantLoop();
    changed();
    return true;
  }

  function cancelAll() {
    if (!held.size) return;
    held.cancelAll();
    wantLoop();
    changed();
  }

  api.listen(globalThis, "blur", cancelAll);
  api.listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") cancelAll();
  });
  // focus left the view (for the page, or a field elsewhere): its keys'
  // releases won't come here. Focus that only passes through nowhere comes
  // back to the root (the stage sees to that), so look once it has settled.
  api.listen(api.root, "focusout", (e) => {
    if (e.relatedTarget && api.root.contains(e.relatedTarget)) return;
    queueMicrotask(() => {
      const a = document.activeElement;
      if (!a || !api.root.contains(a)) cancelAll();
    });
  });

  return {
    input: {
      key: onKey,
      keyup: onKeyUp,
    },
    // the held verbs, for the prompt (scene.use)
    keymap: Object.freeze({
      /** the target attention is pinned to while a verb is held, else undefined */
      pinned: () => held.target,
      holding: (ext, command) => held.holding(ext, command),
      entries: (target) => held.entries(target),
      /** call fn when what's held changes. @returns off */
      watch(fn) {
        watchers.add(fn);
        return () => watchers.delete(fn);
      },
    }),
    update(scene, local, prev) {
      // a held verb goes with its target, and with the extension whose verb it is
      if (held.size && (prev?.scene !== scene || prev?.local?.running !== local.running)) {
        const running = new Set((local.running ?? []).map((r) => r.id));
        const before = held.size;
        held.cancelWhere((t, ext) => (t != null && !scene.objects?.[t]) || (ext != null && !running.has(ext)));
        if (held.size !== before) {
          wantLoop();
          changed();
        }
      }
    },
    dispose() {
      held.cancelAll();
      offLoop?.();
      offLoop = null;
      watchers.clear();
    },
  };
}

export default { create };
