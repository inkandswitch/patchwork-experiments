// scene.use: the use prompt ("[F] Raise the anchor"), the first-person
// counterpart of the context menu, over the same commands (STAGE.md, "A
// command"). It takes part in play only, and only when something asks for
// it: a game lists it in `requires`.
//
// What you're looking at: while an arm holds pointer lock (first-person
// play), whatever lies along the middle of the view; otherwise what's under
// the pointer (local.hovered). Its verbs are the commands that apply to it,
// or to the nearest thing it's attached to that has any (looking at a spoke
// of the wheel offers the helm's), shown near the middle of the view, at
// most three. A verb is offered here unless its `show` leaves "use" out, and
// only if it has a key: the prompt is the keyboard's.
//
// state(target, ctx) gets two more fields here: `from`, the eye ([x, y, z],
// the camera), so a verb can apply only within arm's reach, and `hit`
// ({ id, point, distance }, what the look landed on, which may be below the
// target). The key map and the menu don't pass them, so a verb that needs
// reach is only ever used from here.
//
// Pressing a shown verb's key runs it on its target. A verb whose run()
// returns a session ({ end(), cancel(), update?(dt) }) is held: it lasts as
// long as the key is down (winding a capstan). update(dt) runs every frame,
// end() on the key's release, cancel() when the window or the view loses
// focus, the target goes, or this part stops. `hold: true` on a command only
// changes how it's shown ("hold F").
//
// Keys reach this before the key map only if it runs first: a game lists
// "scene.use" before "scene.keys" in `requires` (else the key map may run a
// verb that needs no reach on the hovered object, and drop its session).

import css from "./use.css?inline";
import { applicable, commandState, controlKind, flatCommands, keyLabel, keyMatches, keysOf } from "./toolbar-commands.js";

/** How many verbs the prompt shows. */
export const MAX_VERBS = 3;

/**
 * What a look reaches: the object, then what it's attached to, nearest first.
 * @param {string} id
 * @param {Map<string, string>} parents  scene().parents
 * @returns {string[]}
 */
export function lookChain(id, parents) {
  if (id == null) return [];
  const out = [id];
  for (let p = parents?.get?.(id); p != null && !out.includes(p); p = parents.get(p)) out.push(p);
  return out;
}

/**
 * The verbs for a look: the first target along the chain that has any
 * keyed command shown on "use", and up to `max` of them. Pure (given the
 * collected commands).
 * @param {{ id, value }[]} collected  api.collect("commands")
 * @param {string[]} chain  lookChain()
 * @param {{ scene, local, from, hit }} ctx
 * @returns {{ target: string, entries: { ext, command, state }[] } | null}
 */
export function useEntries(collected, chain, ctx, max = MAX_VERBS) {
  const flat = flatCommands(collected).filter(({ command }) => keysOf(command).length);
  if (!flat.length) return null;
  for (const target of chain) {
    if (!ctx.scene?.objects?.[target]) continue;
    const entries = applicable(flat, target, ctx, "use");
    if (entries.length) return { target, entries: entries.slice(0, max) };
  }
  return null;
}

/** Does this look like a session (something a held verb returns)? */
const isSession = (r) => !!r && typeof r === "object" && (typeof r.end === "function" || typeof r.cancel === "function");

/**
 * The held verbs, by key code: open, tick, and close with end or cancel.
 * Each session's failure is its own.
 */
export function heldSessions() {
  const open = new Map(); // code → { session, target, ext, command }
  const call = (session, name, ...args) => {
    try {
      session?.[name]?.(...args);
    } catch (err) {
      console.warn(`[scene] scene.use: a held verb's ${name} failed`, err);
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
    open(code, session, { target = null, ext = null, command = null } = {}) {
      close(code, "end"); // a press whose release we never heard
      open.set(code, { session, target, ext, command });
    },
    tick(dt) {
      for (const h of [...open.values()]) call(h.session, "update", dt);
    },
    end: (code) => close(code, "end"),
    cancel: (code) => close(code, "cancel"),
    /** cancel those whose target this says is gone */
    cancelWhere(gone) {
      for (const [code, h] of [...open]) if (gone(h.target)) close(code, "cancel");
    },
    cancelAll() {
      for (const code of [...open.keys()]) close(code, "cancel");
    },
  };
}

const verbName = ({ command, state }) => String(state.label ?? command.name ?? command.id);

function create(api) {
  api.style(css);
  const overlay = api.overlay();
  overlay.classList.add("use-layer");
  const prompt = document.createElement("div");
  prompt.className = "use-prompt";
  prompt.setAttribute("role", "status");
  prompt.hidden = true;
  overlay.append(prompt);

  const held = heldSessions();
  let current = null; // { target, entries, ctx } | null
  let shownKey = "";
  let pointer = null; // port-local { x, y }, the last place the pointer was over the view
  let offLoop = null;

  const editing = (local) => (local.activities?.current ?? "edit") === "edit";

  const locked = (local) => {
    if (local.armed == null) return false;
    const el = document.pointerLockElement;
    return !!el && api.port.contains(el);
  };

  function eye() {
    const cam = api.camera.object;
    if (!cam?.getWorldPosition) return null;
    const p = cam.getWorldPosition(new api.THREE.Vector3());
    return [p.x, p.y, p.z];
  }

  // What the view is on: { hit: { id, point, distance }, from } or null.
  function look(local) {
    if (locked(local)) {
      const ray = api.ray((api.port.clientWidth || 0) / 2, (api.port.clientHeight || 0) / 2);
      const hit = ray ? api.raycast(ray.origin, ray.dir) : null;
      if (!hit?.id) return null;
      return { hit: { id: hit.id, point: hit.point ?? null, distance: hit.distance ?? null }, from: ray.origin ?? eye() };
    }
    const id = local.hovered;
    if (id == null) return null;
    const ray = pointer ? api.ray(pointer.x, pointer.y) : null;
    const at = pointer ? api.pick(pointer.x, pointer.y) : null;
    const on = at?.id === id ? at : null;
    return { hit: { id, point: on?.point ?? null, distance: on?.distance ?? null }, from: ray?.origin ?? eye() };
  }

  function refresh() {
    const local = api.local.get();
    const scene = api.scene();
    const seen = editing(local) ? null : look(local);
    if (seen) {
      const ctx = { scene, local, from: seen.from, hit: seen.hit };
      const found = useEntries(api.collect("commands"), lookChain(seen.hit.id, scene.parents), ctx);
      current = found ? { ...found, ctx } : null;
    } else current = null;
    render(locked(local));
  }

  function render(centred) {
    const entries = current?.entries ?? [];
    const key = JSON.stringify(entries.map((e) => [e.ext, e.command.id, verbName(e), keyLabel(e.command), !!e.command.hold, !!e.state.disabled, e.state.title ?? null, held.holding(e.ext, e.command.id)]));
    if (key !== shownKey) {
      shownKey = key;
      prompt.replaceChildren(...entries.map(row));
      prompt.hidden = !entries.length;
    }
    place(centred);
  }

  // One verb: the key in a keycap (after "hold" for a held one), then its name.
  function row(entry) {
    const { ext, command, state } = entry;
    const el = document.createElement("div");
    el.className = "use-verb";
    el.dataset.ext = ext;
    el.dataset.command = command.id;
    if (state.disabled) el.dataset.disabled = "";
    if (held.holding(ext, command.id)) el.dataset.held = "";
    if (state.title) el.title = String(state.title);
    if (command.hold) {
      const h = document.createElement("span");
      h.className = "use-hold";
      h.textContent = "hold";
      el.append(h);
    }
    const k = document.createElement("kbd");
    k.className = "use-key";
    k.textContent = keyLabel(command);
    const name = document.createElement("span");
    name.className = "use-name";
    name.textContent = verbName(entry);
    el.append(k, name);
    return el;
  }

  // Under the crosshair in first person; under the pointer otherwise.
  function place(centred) {
    if (prompt.hidden) return;
    const at = centred || !pointer ? null : pointer;
    prompt.style.setProperty("--use-x", at ? `${at.x}px` : "50%");
    prompt.style.setProperty("--use-y", at ? `${at.y}px` : "50%");
  }

  // A loop runs only while it's needed: looking in first person (the view
  // moves every frame), or while a verb is held (its update).
  function tick(dt) {
    held.tick(dt);
    if (locked(api.local.get())) refresh();
  }
  function wantLoop() {
    const need = held.size > 0 || locked(api.local.get());
    if (need && !offLoop) offLoop = api.loop(tick);
    else if (!need && offLoop) {
      offLoop();
      offLoop = null;
    }
  }

  // The code a key event is held under (its physical key, as the router keeps it).
  const codeOf = (ev) => ev.code || ev.key;

  function onKey(ev) {
    if (ev.ctrl || ev.meta || typeof ev.key !== "string") return false;
    refresh();
    if (!current) return false;
    const entry = current.entries.find(({ command }) => keyMatches(command, ev.key));
    if (!entry || entry.state.disabled) return false;
    if (ev.repeat) return true;
    // what api.run does, keeping what run returns: still applies, then run
    const ctx = { ...current.ctx, scene: api.scene(), local: api.local.get() };
    const state = commandState(entry.command, current.target, ctx);
    if (!state || state.disabled) return false;
    const value = controlKind(state) === "toggle" ? !state.checked : undefined;
    let out;
    try {
      out = entry.command.run(current.target, value);
    } catch (err) {
      console.warn(`[scene] extension “${entry.ext}”: command ${entry.command.id} failed`, err);
      return true;
    }
    if (isSession(out)) {
      held.open(codeOf(ev), out, { target: current.target, ext: entry.ext, command: entry.command.id });
      wantLoop();
      render(locked(api.local.get()));
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
    render(locked(api.local.get()));
    return true;
  }

  function cancelAll() {
    if (!held.size) return;
    held.cancelAll();
    wantLoop();
    render(locked(api.local.get()));
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
  api.listen(document, "pointerlockchange", () => {
    wantLoop();
    refresh();
  });
  api.listen(api.port, "pointermove", (e) => {
    const r = api.port.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    place(locked(api.local.get()));
  });
  api.listen(api.port, "pointerleave", () => {
    pointer = null;
  });
  // an orbit or zoom moves the eye, and so what's in reach
  api.camera.onEnd(() => refresh());

  return {
    input: {
      key: onKey,
      keyup: onKeyUp,
    },
    update(scene, _local, prev) {
      if (prev?.scene !== scene) held.cancelWhere((t) => !scene.objects?.[t]);
      wantLoop();
      refresh();
    },
    dispose() {
      held.cancelAll();
      offLoop?.();
      offLoop = null;
    },
  };
}

export default { create };
