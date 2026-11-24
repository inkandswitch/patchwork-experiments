// scene.keys: the key map, the only `input.key` implementer (STAGE.md, "Keys").
// A key the open gesture, the hands and the body don't reserve comes
// here (the router decides that first), and runs the command the resolver
// says (./keymap.js mapInvocation): the first whose `key` matches and that
// applies to attention's element (the selection, else the look's), then to
// the scene. Within one target, in running order then command order. Keys
// work whatever a command's `show` says. With ctrl or meta held a key is the
// browser's (copy, reload…), unless a command's `shortcut` names it
// (./shortcuts.js: ⌘G Groups), on attention's path in the same way. An auto-repeated key that matches is claimed
// but not run again, so holding M doesn't flicker the measure tool and
// holding Delete doesn't remove one thing after another. Escape is never a
// command's: it is the stage's ladder.
//
// Every command runs in the context every surface passes (its stage's
// reader's context: the eye, the body's reach, the look's hit), so a `reach: true` verb runs only
// within reach, from any surface. A tool command (it declares `tool`) goes
// through api.run, which holds it.
//
// Held verbs. A verb whose run() returns a session ({ end(), cancel(),
// update?(dt) }) is held: it lasts as long as its key is down (winding a
// capstan). update(dt) runs every frame, end() on the key's release,
// cancel() when the window or the view loses focus, the target goes (from
// its own doc, wherever that is), its extension stops there, or this part
// stops. `hold: true` on a command only changes how it's shown ("hold F"). A
// held verb keeps its target until its key comes up: while anything is held,
// attention is pinned to that target's path (the links from the outermost
// in, then its id: a target in a linked doc is pinned there, wherever the
// look goes), so a second key (ease while hauling) works the same thing, and
// the prompt (scene.use) stays on it. It reads the pin through `keymap`
// (api.collect).

import { controlKind } from "./toolbar-commands.js";
import { commandState, flatCommands, samePath } from "../stage/public.js";
import { attentionPath, mapInvocation, segmentsOf } from "./keymap.js";
import { onMac, shortcutInvocation } from "./shortcuts.js";
import { resolverState } from "./resolver.js";

/** Does this look like a session (something a held verb returns)? */
const isSession = (r) => !!r && typeof r === "object" && (typeof r.end === "function" || typeof r.cancel === "function");

/**
 * The held verbs, by key code: open, tick, and close with end or cancel.
 * Each session's failure is its own.
 */
export function heldSessions() {
  const open = new Map(); // code → { session, path, ext, command, entry }: path the target's (its stage's path, then its id)
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
    /** the path of the first held verb's target (what attention is pinned to), or undefined when nothing's held */
    get path() {
      return open.values().next().value?.path;
    },
    /** the prompt's entries of the verbs held on the target at `path`, as they were when pressed, first held first */
    entries: (path) => [...open.values()].filter((h) => samePath(h.path, path) && h.entry).map((h) => h.entry),
    open(code, session, { path = [null], ext = null, command = null, entry = null } = {}) {
      close(code, "end"); // a press whose release we never heard
      open.set(code, { session, path: Object.freeze([...path]), ext, command, entry });
    },
    tick(dt) {
      for (const h of [...open.values()]) call(h.session, "update", dt);
    },
    end: (code) => close(code, "end"),
    cancel: (code) => close(code, "cancel"),
    /** cancel those whose target this says is gone: gone(path, ext) */
    cancelWhere(gone) {
      for (const [code, h] of [...open]) if (gone(h.path, h.ext)) close(code, "cancel");
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

  /**
   * Is a held verb's target gone: its stage no longer on the view (its link
   * went), the target gone from that stage's doc, or its extension stopped
   * there? Read from the target's own stage, wherever the focus is.
   */
  function gone(path, ext) {
    const id = path.at(-1);
    const at = api.path({ at: path }).find((r) => samePath(r.path, path.slice(0, -1)));
    return !at || (id != null && !at.scene().objects?.[id]) || (ext != null && !at.runs(ext));
  }
  function sweep() {
    const before = held.size;
    held.cancelWhere(gone);
    if (held.size !== before) {
      wantLoop();
      changed();
    }
  }

  function wantLoop() {
    if (held.size && !offLoop)
      offLoop = api.loop((dt) => {
        // (a held verb goes with its target, checked every frame, since its doc needn't be the focus's)
        sweep();
        held.tick(dt);
      });
    else if (!held.size && offLoop) {
      offLoop();
      offLoop = null;
    }
  }

  // The code a key event is held under (its physical key, as the router keeps it).
  const codeOf = (ev) => ev.code || ev.key;

  /** Run what a resolved invocation names, in its segment, as the plain keys do. → whether it ran */
  function invoke(inv, seg) {
    const { collected, ctx } = seg;
    const entry = flatCommands(collected).find((e) => e.ext === inv.ext && e.command.id === inv.command);
    if (!entry) return false;
    const { command } = entry;
    if (command.tool) return api.run({ ...inv, ...(seg.stage !== undefined ? { stage: seg.stage } : {}), hit: ctx.hit });
    const state = commandState(command, inv.target, ctx);
    if (!state || state.disabled) return false;
    try {
      command.run(inv.target, controlKind(state) === "toggle" ? !state.checked : undefined, ctx);
    } catch (err) {
      console.warn(`[scene] extension “${inv.ext}”: command ${command.id} failed`, err);
    }
    return true;
  }

  /** A ⌘ key that a command's shortcut names (./shortcuts.js): its invocation on attention's path, innermost first. */
  function onShortcut(ev) {
    if (ev.repeat) return false;
    const mac = onMac();
    for (const seg of segmentsOf(resolverState(api, held.path ?? null))) {
      const parents = seg.ctx?.scene?.parents;
      const targets = [...attentionPath(seg.attention, parents).filter((t) => seg.attention?.selected != null || seg.ctx?.scene?.objects?.[t]), null];
      const inv = shortcutInvocation(flatCommands(seg.collected), ev, mac, (c, t) => commandState(c, t, seg.ctx), targets);
      if (inv) return invoke(inv, seg);
    }
    return false;
  }

  function onKey(ev) {
    if ((ev.ctrl || ev.meta) && typeof ev.key === "string") return onShortcut(ev);
    if (ev.ctrl || ev.meta || typeof ev.key !== "string" || ev.key === "Escape") return false;
    // the held key's own repeat: still the held verb's, on its target
    if (ev.repeat && held.has(codeOf(ev))) return true;
    // the state every hint is computed from (resolver.js), so a shown key does what it showed
    // attention's path, a stage at a time, innermost first (STAGE.md, "The input chain")
    let inv = null;
    let seg = null;
    for (const s of segmentsOf(resolverState(api, held.path ?? null))) {
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
      held.open(codeOf(ev), out, { path: [...(seg.reader?.path ?? []), inv.target], ext: inv.ext, command: command.id, entry: { ext: inv.ext, command, state } });
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
      /** the path of the target attention is pinned to while a verb is held (its stage's path, then its id), else undefined */
      pinned: () => held.path,
      holding: (ext, command) => held.holding(ext, command),
      /** the prompt's entries of the verbs held on the target at `path` */
      entries: (path) => held.entries(path),
      /** call fn when what's held changes. @returns off */
      watch(fn) {
        watchers.add(fn);
        return () => watchers.delete(fn);
      },
    }),
    update() {
      // a held verb goes with its target, and with the extension whose verb it is: looked at whenever
      // anything here changes, and every frame (wantLoop), since its doc needn't be the focus's
      if (held.size) sweep();
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
