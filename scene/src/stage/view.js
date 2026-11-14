// The view (COMPOSITION.md §2): one per mounted tool, shared by every stage
// it opens. It holds what is the viewer's, not any doc's: the DOM and its
// edges, the viewport, the router, the camera and its saving, labels, the
// body stack and the held tool, the view's atom (the body, the held tool,
// the pointer, the selection and hover, theme, notices, prefs, the drawer,
// the focus), the session every stage's channel names, and the stages
// themselves. A stage (./stage.js) is one per open doc and holds what is
// the doc's.
//
// Selection and hover are paths (./paths.js): the links from the outermost
// stage in, then the object. Each stage sees its own element of them
// (`project`), so an extension reads `view.selected` as an id of its own doc
// and never sees another doc's.

import * as THREE from "three";
import css from "./stage.css?inline";
import { Viewport } from "./viewport.js";
import { createAtom, assoc } from "./atom.js";
import { createRouter } from "./router.js";
import { createDrawer } from "./dock.js";
import { escapeHint } from "./ladder.js";
import { EDIT, LOOK, isStageBody, stageBody, startBase } from "./bodies.js";
import { selectionStep } from "../selection.js";
import { realTime } from "./time.js";
import { comparePaths, elementOf, keyOf, parseKey, pathOf, samePath } from "./paths.js";
import { expand } from "./links.js";
import { multiplyMatrices } from "../transform.js";

/** How many stages a view opens at most, nearest first (COMPOSITION.md §7: the budget is the view's). */
export const LINK_BUDGET = 64;

/** How long after the orbit stops the camera is saved. */
const CAMERA_SAVE_MS = 500;
/** How long a notice stays in view.notices. */
const NOTICE_MS = 6_000;
/** How long, once view.start's body is on offer, arriving waits for the content before entering it anyway (ms). */
export const ARRIVE_WAIT_MS = 20_000;
const EDGES = ["top", "right", "bottom", "left"];
const noop = () => {};

// The stage's own bodies, Look and Edit (./bodies.js, TOOLS.md §4): the
// orbit camera, one of them always at the bottom of the stack. As view.body:
const baseLocal = (b) => Object.freeze({ id: b.id, label: b.label, ext: null, depth: 0, lock: false, reach: Infinity, keys: Object.freeze([]) });
const BASE_LOCAL = Object.freeze({ [LOOK.id]: baseLocal(LOOK), [EDIT.id]: baseLocal(EDIT) });

// ─── pure helpers (exported for tests) ──────────────────────────────────────

const isVec3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => Number.isFinite(Number(n)));

/** A camera as saved (position, target, fov?), checked; null if it isn't one. */
export function cleanCamera(c) {
  if (!c || typeof c !== "object" || !isVec3(c.position)) return null;
  const out = { position: c.position.slice(0, 3).map(Number) };
  if (isVec3(c.target)) out.target = c.target.slice(0, 3).map(Number);
  if (Number.isFinite(Number(c.fov)) && c.fov != null) out.fov = Number(c.fov);
  return out;
}

/**
 * Where the doc starts people (TOOLS.md §2): `view.start = { body, place,
 * home }`, read once on arrival. `body` is a body's id ("look" and "edit"
 * are the stage's, ./bodies.js; none is Look), `place` what its enter is
 * given (a spawn point's object id, a seat's id), `home` the camera. Pure.
 * @returns {{ body: string | null, place: string | null, home: object | null }}
 */
export function startOf(doc) {
  const s = doc?.view?.start;
  if (!s || typeof s !== "object") return { body: null, place: null, home: null };
  const body = typeof s.body === "string" && s.body ? s.body : null;
  const place = typeof s.place === "string" && s.place ? s.place : null;
  return { body, place, home: cleanCamera(s.home) };
}

/**
 * Where the camera starts (STAGE.md, "Saving"): this viewer's saved camera,
 * else the doc's suggested home (view.start.home), else null
 * (a frame extension frames on first content).
 */
export function initialCamera({ stored = null, doc = null } = {}) {
  return cleanCamera(stored) ?? startOf(doc).home ?? null;
}

/**
 * The notices after one more: a notice saying what one still showing says
 * (the same text and kind) replaces it, so it shows once (three tables laid
 * at once each saying "Pick a seat" is one prompt), timed from now. Pure.
 * @param {readonly object[] | undefined} list  @param {{ text: string, kind: string }} n
 */
export function withNotice(list, n) {
  return Object.freeze([...(list ?? []).filter((x) => x.text !== n.text || x.kind !== n.kind), n]);
}

/** A viewer's prefs as stored: a plain object. */
export function cleanPrefs(v) {
  return Object.freeze(v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {});
}

/**
 * The view's value as one stage sees it (COMPOSITION.md §3): the selection
 * and hover as its element of their paths, the body's and the held tool's
 * owner as its extension's id where they are its own (else the view's key,
 * which no id of a stage's equals). Pure.
 * @param {object} v  the view's value  @param {number} n  the stage's number  @param {string[]} prefix  its path
 */
export function projectView(v, n, prefix) {
  const own = (key) => {
    if (key == null) return null;
    const p = parseKey(key);
    return p && p.n === n ? p.id : key;
  };
  return Object.freeze({
    ...v,
    selected: elementOf(v.selected, prefix),
    hovered: elementOf(v.hovered, prefix),
    body: v.body?.ext != null ? Object.freeze({ ...v.body, ext: own(v.body.ext) }) : v.body,
    held: v.held?.ext != null ? Object.freeze({ ...v.held, ext: own(v.held.ext) }) : v.held,
    gesture: v.gesture?.owner != null ? Object.freeze({ ...v.gesture, owner: own(v.gesture.owner) }) : v.gesture,
  });
}

function localViewer() {
  const fresh = `viewer:${Math.random().toString(36).slice(2, 12)}`;
  try {
    const ls = globalThis.localStorage;
    const v = ls?.getItem("scene-viewer");
    if (v) return v;
    ls?.setItem("scene-viewer", fresh);
  } catch {
    // private window: a viewer for this session only
  }
  return fresh;
}

export function readJSON(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key, value) {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // private window, or full: this viewer's choice lasts the session
  }
}

function newSession() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // fall through
  }
  return `s${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

// ─── the view ───────────────────────────────────────────────────────────────

/**
 * Mount a view in `element` (element.repo, element.viewerId and element.time
 * optional). Its stages come after, the outermost first (./stage.js).
 */
export function createView(element, { url = "scene", openStage = null } = {}) {
  const repo = element.repo ?? globalThis.repo;
  let dead = false;
  const cleanups = [];
  // the one source of time everything here moves with (time.js): the
  // browser's, unless the host element brings its own (a probe's manual clock)
  const time = element.time ?? realTime();
  const timers = new Set();
  const later = (fn, ms) => {
    const cancel = time.after(ms, () => {
      timers.delete(cancel);
      fn();
    });
    timers.add(cancel);
    return cancel;
  };
  // who is looking: the account's contact, else this browser's own id (element.viewerId lets a probe put two viewers on one page)
  const viewer = element.viewerId ?? globalThis.accountDocHandle?.doc?.()?.contactUrl ?? localViewer();
  // one session for every channel this view opens; a page back from the back-forward cache is a new one
  let session = newSession();

  // ─── the mount ────────────────────────────────────────────────────────────

  const root = document.createElement("div");
  root.className = "scene-tool scene-stage";
  root.tabIndex = 0;
  const edges = {};
  for (const side of EDGES) {
    const e = document.createElement("div");
    e.className = "stage-edge";
    e.dataset.edge = side;
    edges[side] = e;
  }
  const port = document.createElement("div");
  port.className = "viewport";
  root.append(edges.top, edges.left, port, edges.right, edges.bottom);
  const style = document.createElement("style");
  style.textContent = css;
  element.append(style, root);
  const drawer = createDrawer({
    parent: edges.right,
    onChange: (d) => {
      if (dead) return;
      atom.swap((m) => (JSON.stringify(m.drawer) === JSON.stringify(d) ? m : { ...m, drawer: Object.freeze({ tabs: Object.freeze([...d.tabs]), shown: d.shown }) }));
    },
  });

  // ─── the view's atom ──────────────────────────────────────────────────────

  const prefsKey = `scene-prefs:${url}`;
  const cameraKey = `scene-camera:${url}`;
  const atom = createAtom({
    // paths (./paths.js), each stage seeing its own element
    hovered: null,
    selected: null,
    // the body on top of the stack (TOOLS.md §4); Look until arriving says otherwise
    body: BASE_LOCAL.look,
    held: null,
    gesture: null,
    pointer: Object.freeze({ locked: false, lock: false, wanted: false, released: false, refused: false }),
    escape: Object.freeze({ layer: null, hint: "" }),
    theme: null,
    notices: Object.freeze([]),
    drawer: Object.freeze({ tabs: Object.freeze([]), shown: null }),
    prefs: cleanPrefs(readJSON(prefsKey)),
    // the stage selection is scoped by (COMPOSITION.md §5): the outermost's ([]) until Enter moves it
    focus: Object.freeze([]),
  });
  const onStorage = (e) => {
    if (e.key !== prefsKey) return;
    const next = cleanPrefs(readJSON(prefsKey));
    atom.swap((m) => (JSON.stringify(m.prefs) === JSON.stringify(next) ? m : { ...m, prefs: next }));
  };
  globalThis.addEventListener?.("storage", onStorage);
  cleanups.push(() => globalThis.removeEventListener?.("storage", onStorage));

  // ─── the viewport ─────────────────────────────────────────────────────────

  const viewport = new Viewport({ port, themeRoot: root, time });
  atom.swap(assoc("theme", viewport.theme));
  cleanups.push(viewport.onTheme((t) => atom.swap(assoc("theme", t))));
  let canvas = viewport.canvas;
  if (!viewport.ok) {
    canvas = document.createElement("canvas");
    canvas.className = "canvas";
    port.insertBefore(canvas, viewport.labels.el);
    const msg = document.createElement("div");
    msg.className = "no-webgl";
    msg.textContent = `3D view unavailable: ${viewport.error?.message ?? "WebGL could not start"}.`;
    port.append(msg);
  }
  let cameraRestored = false;
  let cameraTimer = null;
  cleanups.push(
    viewport.onCameraEnd(() => {
      cameraTimer?.();
      cameraTimer = later(() => {
        cameraTimer = null;
        if (dead || viewport.held) return;
        const cam = cleanCamera(viewport.getCamera());
        if (cam) writeJSON(cameraKey, cam);
      }, CAMERA_SAVE_MS);
    }),
  );

  // ─── the stages ───────────────────────────────────────────────────────────

  const stages = new Map(); // number → stage, the outermost 0
  let nextStage = 0;
  const outermost = () => stages.get(0) ?? null;
  /** The stage selection is scoped by: the outermost, until Enter moves it (COMPOSITION.md step 14). */
  const focusStage = () => outermost();
  /** The stages that act (every open stage, until mirrors and pins: step 13), outermost first. */
  // outermost first, then by path: a doc's structure, not the order its links' docs arrived in
  const acting = () => [...stages.values()].sort((a, b) => comparePaths(a.path, b.path) || a.n - b.n);
  /** Give a stage its number; the first is the outermost. */
  function addStage(make) {
    const n = nextStage++;
    const s = make(n);
    stages.set(n, s);
    s.start();
    return s;
  }
  function removeStage(s) {
    if (stages.get(s.n) === s) stages.delete(s.n);
    for (const [u, x] of linked) if (x === s) linked.delete(u);
    // what it held of the view goes with it: its bodies, its tool, its sessions
    for (const rec of [...sittings]) if (rec.stage === s) leftBody(rec);
  }
  /** The full path a viewport key names (the stage's path, then its id), or null. */
  function pathOfKey(key) {
    const p = parseKey(key);
    const s = p ? stages.get(p.n) : null;
    return s ? pathOf([...s.path, p.id]) : null;
  }
  /** The viewport key of a path (the stage whose path leads to its last entry), or null. */
  function keyOfPath(p) {
    if (!Array.isArray(p) || !p.length) return null;
    for (const s of stages.values()) if (s.path.length === p.length - 1 && s.path.every((x, i) => x === p[i])) return keyOf(s.n, p.at(-1));
    return null;
  }
  // ─── links: the stages this view opens (COMPOSITION.md §7) ────────────────
  // The expansion (links.js) is a pure function of the link graph as the view
  // has it: worked out again whenever a stage's doc changes or a linked doc
  // arrives. Each live doc acts at one occurrence and is opened there, its
  // stage keyed by URL. Mirrors and pins are drawn as their hints until step
  // 13 opens them; a closed link is drawn as its hint.
  const docs = new Map(); // url → { handle, state: "loading" | "ready" | "unavailable" }
  const linked = new Map(); // url → the stage opened for it
  let expansion = [];
  let linkStates = new Map(); // path (joined by keyOf's separator) → { state, reason? }
  const pathKey = (p) => p.join("\u001f");
  function docOf(u, heads) {
    if (heads) return undefined; // a pinned value opens with pins (step 13)
    const root = outermost();
    if (root && u === root.url) return root.doc();
    let d = docs.get(u);
    if (!d) {
      docs.set(u, (d = { handle: null, state: "loading" }));
      Promise.resolve()
        .then(() => repo.find(u))
        .then(
          (h) => {
            if (dead) return;
            d.handle = h;
            d.state = "ready";
            const on = () => relink();
            h.on?.("change", on);
            d.off = () => h.off?.("change", on);
            relink();
          },
          () => {
            if (dead) return;
            d.state = "unavailable";
            relink();
          },
        );
      return undefined;
    }
    if (d.state === "unavailable") return null;
    if (d.state !== "ready") return undefined;
    return d.handle.doc() ?? undefined;
  }
  let relinkQueued = false;
  /** Work out the expansion again (soon): stages open and close to match. */
  function relink() {
    if (relinkQueued || dead) return;
    relinkQueued = true;
    queueMicrotask(() => {
      relinkQueued = false;
      if (!dead) relinkNow();
    });
  }
  function relinkNow() {
    const root = outermost();
    if (!root) return;
    expansion = expand({ url: root.url }, docOf, { budget: LINK_BUDGET });
    const want = new Map();
    for (const o of expansion) if (o.role === "acting" && o.depth > 0) want.set(o.url, o);
    // a stage whose doc no longer acts here, or acts somewhere else, closes (its claims go with it)
    for (const [u, s] of [...linked]) {
      const o = want.get(u);
      if (o && samePath(o.path, s.path) && stages.get(s.n) === s) continue;
      linked.delete(u);
      s.dispose();
    }
    // open the rest, outermost first (each under its parent's stage)
    for (const [u, o] of want) {
      if (linked.has(u)) continue;
      const parentOcc = expansion[o.parent];
      const parent = parentOcc.depth === 0 ? root : linked.get(parentOcc.url);
      const d = docs.get(u);
      if (!parent || !d?.handle) continue;
      linked.set(u, openLinked(d.handle, parent, o));
    }
    const states = new Map();
    for (const o of expansion) {
      if (o.depth === 0) continue;
      const open = o.role === "acting" && linked.get(o.url)?.path && samePath(linked.get(o.url).path, o.path);
      states.set(pathKey(o.path), Object.freeze({ state: open ? "open" : o.role, ...(o.reason ? { reason: o.reason } : {}) }));
    }
    const was = linkStates;
    linkStates = states;
    if (JSON.stringify([...was]) !== JSON.stringify([...states])) for (const s of stages.values()) s.linksChanged();
  }
  /** Open a linked doc's stage, its root under the link's node, in the link's frame. */
  function openLinked(handle, parent, o) {
    const linkId = o.link;
    const frame = () => {
      const m = parent.displayedWorld(linkId);
      if (!m) return null;
      const f = parent.frame();
      return f.matrix ? multiplyMatrices(f.matrix, m) : m;
    };
    return addStage((n) => openStage({ handle, view: api, n, path: o.path, frame, under: keyOf(parent.n, linkId), general: false }));
  }
  /** Is a linked doc still on its way: one being found, or acting with no stage open for it yet? */
  function linksPending() {
    for (const d of docs.values()) if (d.state === "loading") return true;
    return expansion.some((o) => o.role === "acting" && o.depth > 0 && !linked.has(o.url));
  }
  /** A link's state as the view has it ({ state: "open" | "mirror" | "pinned" | "closed" | "acting", reason? }), by its path; null if it isn't one. */
  const linkState = (p) => linkStates.get(pathKey(p)) ?? null;

  /** Every stage's update flush. */
  const requestFlush = () => {
    for (const s of stages.values()) s.requestFlush();
  };

  // ─── notices and prefs ────────────────────────────────────────────────────

  let noticeSeq = 0;
  function notify(text, kind = "info", from = null) {
    if (dead) return null;
    const n = Object.freeze({ id: `n${++noticeSeq}`, text: String(text ?? ""), kind: kind ?? "info", at: time.now(), from });
    atom.swap((m) => ({ ...m, notices: withNotice(m.notices, n) }));
    later(() => {
      if (!dead) atom.swap((m) => (m.notices?.includes(n) ? { ...m, notices: Object.freeze(m.notices.filter((x) => x !== n)) } : m));
    }, NOTICE_MS);
    return n.id;
  }
  function setPref(key, value) {
    if (typeof key !== "string") return;
    atom.swap((m) => {
      const prefs = m.prefs ?? {};
      if (value === undefined ? !(key in prefs) : prefs[key] === value) return m;
      const next = { ...prefs };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return { ...m, prefs: Object.freeze(next) };
    });
  }

  // ─── selection ────────────────────────────────────────────────────────────

  /** Store a selection path (null: none). The selection scoped by the focus (COMPOSITION.md §5, ../selection.js). */
  function select(path) {
    const next = path == null ? null : pathOf(path);
    atom.swap((m) => (samePath(m.selected, next) ? m : { ...m, selected: next }));
  }
  /** Apply a selection event (../selection.js) with paths cut at the focus: a linked thing's part selects the link. */
  function selectStep(ev) {
    const focus = atom.get().focus;
    atom.swap((m) => {
      const was = { focus, selected: m.selected };
      const next = selectionStep(was, ev);
      if (next === was) return m;
      const sel = next.selected ? pathOf(next.selected.slice(0, focus.length + 1)) : null;
      return samePath(m.selected, sel) ? m : { ...m, selected: sel };
    });
  }

  // ─── bodies and the held tool (TOOLS.md §4) ───────────────────────────────

  // The bodies entered, bottom first, over the base: { stage, ext, owner, def, sitting, pop, place }.
  const sittings = [];
  let base = LOOK;
  const topSitting = () => sittings.at(-1) ?? null;
  const reachOf = (def) => (typeof def?.reach === "number" && def.reach >= 0 ? def.reach : Infinity);
  let router = null;

  /** Every body on offer: each acting stage's, the caller's first; the first to offer an id has it. */
  function bodyDefs(first = null) {
    const out = new Map();
    const order = first ? [first, ...acting().filter((s) => s !== first)] : acting();
    for (const s of order) {
      for (const [id, found] of s.bodyDefs()) {
        if (out.has(id)) continue;
        out.set(id, { ...found, stage: s });
      }
    }
    return out;
  }

  /** The eye: the top body's, else the camera's. { position, direction } in the world, or null. */
  function bodyEye() {
    const s = topSitting();
    if (s && typeof s.sitting.eye === "function") {
      try {
        const e = s.sitting.eye();
        if (Array.isArray(e?.position) && e.position.length === 3) {
          const f = s.stage.frame();
          return { position: f.pointOut(e.position), direction: Array.isArray(e.direction) ? f.dirOut(e.direction) : null };
        }
      } catch (err) {
        console.warn(`[scene] body “${s.def.id}”: eye failed`, err);
      }
    }
    if (!viewport.ok || !viewport.camera) return null;
    const p = viewport.camera.getWorldPosition(new THREE.Vector3());
    return { position: p.toArray(), direction: viewport.forward().toArray() };
  }
  /** The top body's reach, in the world (m). */
  const bodyReach = () => {
    const s = topSitting();
    return s ? s.stage.frame().lengthOut(reachOf(s.def)) : Infinity;
  };

  const lookInput = {};
  // Edit's click goes ahead of the chain: a plain click in Edit selects, before any package's click verb (TOOLS.md §3)
  const EDIT_AHEAD = Object.freeze(["click"]);
  const editInput = {
    click(ev) {
      // a hit on something its doc no longer has is a hit on nothing
      const p = ev?.hit?.id != null ? parseKey(ev.hit.id) : null;
      const path = p && stages.get(p.n)?.doc().objects?.[p.id] ? pathOfKey(ev.hit.id) : null;
      if (!path && atom.get().selected == null) return false;
      selectStep({ type: "press", path: path ?? [] });
      return true;
    },
  };

  /**
   * Make Look or Edit the base (./bodies.js): every body standing on it
   * leaves, and leaving Edit puts down a tool held through an editing
   * command (Measure), whose input is the editor's.
   */
  function setBase(b) {
    if (dead || !router) return;
    base = b;
    router.setBase({ id: b.id, input: b === EDIT ? editInput : lookInput, lock: false, keys: [], ahead: b === EDIT ? EDIT_AHEAD : [] });
    if (b !== EDIT) putDownEditTool();
  }
  function putDownEditTool() {
    const held = router?.held();
    if (!held?.command) return;
    const p = parseKey(held.owner);
    if (stages.get(p?.n)?.commandOf(p.id, held.command)?.edit === true) router.putDown();
  }

  /**
   * Enter body `id` at `place` (TOOLS.md §2), from stage `caller`: the first
   * acting stage offering it (the caller's own first) runs its enter, in its
   * frame, and what it answers goes on top of the stack, over Look. "look"
   * and "edit" are the stage's: every body leaves and that one is the base.
   */
  function enterBody(id, place = null, caller = null) {
    if (dead || !router) return false;
    const stageB = stageBody(id);
    if (stageB) {
      arrival = null; // they went somewhere themselves
      setBase(stageB);
      return true;
    }
    const found = bodyDefs(caller).get(id);
    if (!found) return false;
    const { stage, ext, def } = found;
    let sitting;
    try {
      sitting = def.enter(place ?? null);
    } catch (err) {
      console.warn(`[scene] body “${id}”: enter failed`, err);
      return false;
    }
    if (!sitting || typeof sitting !== "object") return false;
    const owner = keyOf(stage.n, ext);
    const rec = { stage, ext, owner, def, sitting, pop: null, place: place ?? null };
    if (base === EDIT) setBase(LOOK); // nothing stands on Edit
    const input = stage.bodyInput(ext, rec, sitting.input ?? {}, () => leftBody(rec));
    if (!input) return false;
    sittings.push(rec);
    rec.pop = router.pushBody(owner, { id, input, lock: !!def.lock, keys: sitting.keys ?? def.keys ?? [] });
    applyBodyRide();
    return true;
  }

  // A body went off the stack (left, popped with one under it, or its stage or extension stopped).
  function leftBody(rec) {
    const i = sittings.indexOf(rec);
    if (i < 0) return;
    sittings.splice(i, 1);
    rec.stage.bodyLeft(rec);
    try {
      rec.sitting.leave?.();
    } catch (err) {
      console.warn(`[scene] body “${rec.def.id}”: leave failed`, err);
    }
    applyBodyRide();
  }
  const leaveBody = () => (sittings.length ? !!router?.leave() : false);
  /** Leave every body an extension of a stage put on the stack (it stopped). */
  function leaveBodiesOf(stage, ext) {
    for (const rec of [...sittings]) if (rec.stage === stage && rec.ext === ext) leftBody(rec);
  }

  /** The camera rides the top body's ride, in the viewport's keys, if it has one; else the orbit's base rides apply. */
  function applyBodyRide() {
    const s = topSitting();
    const r = s?.sitting?.ride ?? null;
    viewport.bodyRide?.(s && r && typeof r === "object" ? s.stage.scope.rideSpec(r) : null);
  }

  /** Hold a tool for an extension of a stage: its declaration ({ command?, name, keys, pointer }) and its input (already the stage's). */
  function holdTool(owner, t, input) {
    if (!router) return noop;
    return router.hold(owner, { command: t.command ?? null, name: String(t.name ?? t.command ?? owner), input, keys: Array.isArray(t.keys) ? t.keys : [], pointer: !!t.pointer });
  }

  // ─── arriving: view.start (TOOLS.md §2) ───────────────────────────────────
  // The outermost doc's, read once: on arrival, and again after a template
  // has written one for its maker. Its body is entered once an acting stage
  // offers it and the content is in, or ARRIVE_WAIT_MS after it came on
  // offer. Until then it waits as long as the body may still come.
  let arrival = null; // { body, place, offered }
  function arrive() {
    const s = outermost();
    if (!s) return;
    const { body, place } = startOf(s.doc());
    setBase(startBase(body));
    arrival = body && !isStageBody(body) ? { body, place, offered: null } : null;
    requestFlush();
  }
  function restoreCamera(doc) {
    const cam = initialCamera({ stored: readJSON(cameraKey), doc });
    if (cam && viewport.ok) {
      viewport.setCamera(cam);
      cameraRestored = true;
    }
  }
  let arriveTimer = false;
  function requestFlushSoon() {
    if (arriveTimer) return;
    arriveTimer = true;
    later(() => {
      arriveTimer = false;
      requestFlush();
    }, 250);
  }
  function tryArrive() {
    const a = arrival;
    if (!a || dead || !router) return;
    if (sittings.length) {
      arrival = null;
      return;
    }
    const all = [...stages.values()];
    const unsettled = (s) => s.starting() || s.packages.coming();
    const offer = bodyDefs().get(a.body);
    if (offer) {
      a.offered ??= time.now();
      // a stage ahead of the offering one in acting order, or a link still on its way, may offer
      // it too, and its offer is the one arriving takes; and the content first
      const order = acting();
      const ahead = order.slice(0, order.indexOf(offer.stage));
      if ((linksPending() || ahead.some(unsettled) || !all.every((s) => s.contentIn())) && time.now() - a.offered < ARRIVE_WAIT_MS) return requestFlushSoon();
      arrival = null;
      enterBody(a.body, a.place);
      return;
    }
    // (a linked doc still on its way may bring it: a boat arrives in its linked game's seat body)
    const pending = linksPending();
    if (!pending && all.every((s) => s.packages.complete() && !s.starting())) arrival = null;
    else if (pending || all.some(unsettled)) requestFlushSoon();
  }

  // ─── the look and attention (TOOLS.md §3) ─────────────────────────────────

  // Where the look is, in the world and in keys: under lock, the eye ray's hit; else the pointer's (the last hover).
  let hoverHit = null; // { id: key, point, distance }
  function look() {
    if (atom.get().pointer?.locked) {
      let h = null;
      try {
        const r = viewport.centerRay();
        h = r ? viewport.raycast(r.origin, r.dir) : null;
      } catch {
        h = null;
      }
      return h?.id ? { id: h.id, point: h.point ?? null, distance: h.distance ?? null } : null;
    }
    const hovered = atom.get().hovered;
    if (hovered == null) return null;
    if (hoverHit && samePath(pathOfKey(hoverHit.id), hovered)) return hoverHit;
    const key = keyOfPath(hovered);
    return key != null ? { id: key, point: null, distance: null } : null;
  }

  // ─── the router ───────────────────────────────────────────────────────────

  let picking = false;
  // The widget under the pointer: the viewport's (meshes in world groups) and
  // every stage's extensions' widgetAt; onTop beats the rest, else nearest.
  function pickWidget(ev) {
    if (picking) return null;
    picking = true;
    try {
      const out = [];
      if (ev?.x != null && ev?.y != null) {
        const w = viewport.pickWidget(ev.x, ev.y);
        if (w) out.push(w);
      }
      for (const s of acting()) out.push(...s.widgetsAt(ev));
      return bestWidget(out);
    } finally {
      picking = false;
    }
  }

  /**
   * The chain for an event (COMPOSITION.md §5): the widget's owner, then one
   * segment per stage on the hit's path, innermost first (each its holders,
   * nearest first, then its root's), out to the outermost whatever the
   * focus. Owners are keys (stage, extension).
   */
  function chainFor(ev) {
    const widget = ev.widget;
    const hit = ev.hit;
    const path = hit?.id != null ? pathOfKey(hit.id) : null;
    const order = [];
    const holders = new Map();
    const won = widgetWins(widget, hit);
    if (won) order.push(widget.owner);
    const on = path ? onPath(path) : [];
    for (const s of on.length ? on : [outermost()].filter(Boolean)) {
      const seg = s.segment(elementOf(path, s.path));
      for (const ext of seg.order) {
        const k = keyOf(s.n, ext);
        if (order.includes(k)) continue;
        order.push(k);
        holders.set(k, seg.holderOf(ext));
      }
    }
    return { order, holderOf: (k) => holders.get(k) ?? null, widget: won ? widget.owner : null };
  }
  /**
   * The input path (COMPOSITION.md §3): the stages from attention's innermost
   * out to the outermost (the selection's path, else the look's; `look: true`
   * the look's), each as its reader (stage.js). Nothing under attention: the
   * outermost alone.
   */
  function inputPath({ look: lookOnly = false } = {}) {
    const sel = atom.get().selected;
    const l = !lookOnly && sel ? null : look();
    const path = !lookOnly && sel ? sel : l?.id != null ? pathOfKey(l.id) : null;
    const on = path ? onPath(path) : [];
    return (on.length ? on : [outermost()].filter(Boolean)).map((s) => s.reader);
  }
  /** What every acting stage offers as `name`: the input path's stages first, innermost first; each item tagged with its stage. */
  function collect(name) {
    const first = inputPath().map((r) => r.stage);
    const order = [...first, ...acting().map((s) => s.n).filter((x) => !first.includes(x))];
    return order.flatMap((x) => stages.get(x)?.reader.collect(name) ?? []);
  }
  /** The stages on a path, innermost first, out to the outermost. */
  function onPath(path) {
    const out = [];
    for (const s of stages.values()) if (path.length > s.path.length && s.path.every((x, i) => x === path[i])) out.push(s);
    return out.sort((a, b) => b.path.length - a.path.length);
  }
  const inputOf = (key) => {
    const p = parseKey(key);
    return p ? stages.get(p.n)?.inputOf(p.id) : undefined;
  };

  router = createRouter({
    time,
    port,
    canvas,
    keyRoot: root,
    pick: (x, y, opts) => viewport.pick(x, y, opts),
    pickWidget,
    ray: (x, y) => viewport.ray(x, y),
    centerRay: () => viewport.centerRay(),
    chainFor,
    inputOf,
    base: { id: base.id, lock: false, keys: [], input: lookInput },
    cameraHeld: () => viewport.held,
    onHover: (ev) => {
      const h = ev?.hit ?? null;
      hoverHit = h?.id ? { id: h.id, point: h.point ?? null, distance: h.distance ?? null } : null;
      const path = h?.id ? pathOfKey(h.id) : null;
      atom.swap((m) => (samePath(m.hovered, path) ? m : { ...m, hovered: path }));
    },
    onCursor: (name) => {
      routerCursor = name;
      applyCursor();
    },
    onState: (st) => {
      if (dead) return;
      atom.swap((m) => ({ ...m, ...viewOfRouter(st, m) }));
    },
    pointerWanted: () => atom.get().selected != null || drawer.state().order.length > 0,
    selection: () => atom.get().selected != null,
    deselect: () => selectStep({ type: "escape" }),
    // the focus is the outermost's (COMPOSITION.md build step 14 moves it)
    focusDepth: () => 0,
    leaveFocus: noop,
  });

  // The router's state as the view's fields. A field that didn't change keeps its value.
  function viewOfRouter(st, m) {
    const s = topSitting();
    const body =
      s && s.def.id === st.body.id
        ? Object.freeze({ id: s.def.id, label: String(s.sitting.label ?? s.def.label ?? s.def.id), ext: s.owner, depth: st.body.depth, lock: !!s.def.lock, reach: reachOf(s.def), keys: Object.freeze([...(s.sitting.keys ?? s.def.keys ?? [])]) })
        : BASE_LOCAL[base.id];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const held = st.held ? Object.freeze({ ...st.held }) : null;
    const pointer = Object.freeze({ ...st.pointer });
    const escape = Object.freeze({ layer: st.escape, hint: escapeHint(st.escape, { tool: st.held?.name ?? null }) });
    return {
      body: same(m.body, body) ? m.body : body,
      held: same(m.held, held) ? m.held : held,
      gesture: same(m.gesture, st.gesture) ? m.gesture : st.gesture ? Object.freeze(st.gesture) : null,
      pointer: same(m.pointer, pointer) ? m.pointer : pointer,
      escape: same(m.escape, escape) ? m.escape : escape,
    };
  }

  // ─── the cursor ───────────────────────────────────────────────────────────

  const extCursors = new Map(); // owner key → cursor (latest set last)
  let routerCursor = null;
  function applyCursor() {
    const mine = [...extCursors.values()].at(-1) ?? null;
    const c = mine ?? routerCursor ?? "";
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  }
  function cursor(owner, name) {
    extCursors.delete(owner);
    if (name) extCursors.set(owner, String(name));
    applyCursor();
  }

  // ─── the atom → storage, the stages ───────────────────────────────────────

  cleanups.push(
    atom.watch((next, prev) => {
      if (next.prefs !== prev.prefs) writeJSON(prefsKey, next.prefs);
      if (next.selected !== prev.selected) router?.refresh();
      requestFlush();
    }),
  );

  // ─── focus (the DOM's) ────────────────────────────────────────────────────

  let pressedOutside = -Infinity;
  const onPressAnywhere = (e) => {
    if (!root.contains(e.target)) pressedOutside = time.now();
  };
  document.addEventListener("pointerdown", onPressAnywhere, true);
  const refocus = (e) => {
    if (e.type === "focusout" && e.relatedTarget) return;
    queueMicrotask(() => {
      if (dead || !root.isConnected) return;
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (e.type === "focusout") {
        if (time.now() - pressedOutside < 1000) return;
        if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
      }
      root.focus({ preventScroll: true });
    });
  };
  root.addEventListener("click", refocus);
  root.addEventListener("focusout", refocus);
  cleanups.push(() => {
    document.removeEventListener("pointerdown", onPressAnywhere, true);
    root.removeEventListener("click", refocus);
    root.removeEventListener("focusout", refocus);
  });

  // ─── leaving the page ─────────────────────────────────────────────────────
  // Patchwork doesn't run the tool's cleanup when the tab closes. On pagehide
  // every stage lets go of its claims and says bye; restored from the
  // back-forward cache, the view is a new session and every stage comes back.
  let away = false;
  const onPageHide = () => {
    if (away) return;
    away = true;
    for (const s of stages.values()) s.pageHide();
  };
  const onPageShow = (e) => {
    if (!e.persisted || !away) return;
    away = false;
    session = newSession();
    for (const s of stages.values()) s.pageShow(session);
  };
  globalThis.addEventListener?.("pagehide", onPageHide);
  globalThis.addEventListener?.("pageshow", onPageShow);
  cleanups.push(() => {
    globalThis.removeEventListener?.("pagehide", onPageHide);
    globalThis.removeEventListener?.("pageshow", onPageShow);
  });

  function dispose() {
    if (dead) return;
    for (const s of [...stages.values()].sort((a, b) => b.n - a.n)) s.dispose();
    for (const d of docs.values()) d.off?.();
    dead = true;
    router.dispose();
    for (const cancel of timers) cancel();
    timers.clear();
    for (const c of cleanups) {
      try {
        c();
      } catch {
        // keep going
      }
    }
    viewport.dispose();
    root.remove();
    style.remove();
  }

  const api = {
    time,
    repo,
    viewer,
    // (lets a probe or a test not wait for the registry to go quiet)
    packageSettleMs: element.packageSettleMs ?? null,
    later,
    get session() {
      return session;
    },
    get away() {
      return away;
    },
    get dead() {
      return dead;
    },
    root,
    port,
    edges,
    drawer,
    canvas,
    viewport,
    atom,
    router,
    get cameraRestored() {
      return cameraRestored;
    },
    restoreCamera,
    // the stages
    addStage,
    removeStage,
    stages: () => [...stages.values()],
    stage: (n) => stages.get(n) ?? null,
    outermost,
    focusStage,
    acting,
    pathOfKey,
    onPath,
    inputPath,
    collect,
    requestFlush,
    // the viewer's
    notify,
    setPref,
    select,
    selectStep,
    look,
    bodyDefs,
    bodyEye,
    bodyReach,
    enterBody,
    leaveBody,
    leaveBodiesOf,
    holdTool,
    cursor,
    setBase,
    arrive,
    tryArrive,
    relink,
    linkState,
    /** what arriving still waits to enter (view.start's body), for probes and tests */
    arriving: () => (arrival ? { ...arrival } : null),
    linksPending: () => linksPending(),
    /** the expansion as it stands (links.js), for probes and tests */
    expansion: () => expansion,
    dispose,
  };
  return api;
}

// ─── widgets (pure) ─────────────────────────────────────────────────────────

/**
 * The widget under the pointer from several candidates: an onTop one beats
 * any other, else the nearest (a widget that gives no distance counts as
 * nearest of all: it says "I have something here").
 * @param {{ owner: string, onTop?: boolean, distance?: number }[]} candidates
 */
export function bestWidget(candidates) {
  let best = null;
  const dist = (w) => (Number.isFinite(w?.distance) ? w.distance : 0);
  for (const w of candidates) {
    if (!w || w.owner == null) continue;
    if (!best) best = w;
    else if (!!w.onTop !== !!best.onTop) best = w.onTop ? w : best;
    else if (dist(w) < dist(best)) best = w;
  }
  return best;
}

/** Does this widget come before the object hit (onTop, or no further away)? */
export function widgetWins(widget, hit) {
  if (!widget || widget.owner == null) return false;
  if (widget.onTop || !hit) return true;
  const d = Number.isFinite(widget.distance) ? widget.distance : 0;
  return d <= (hit.distance ?? Infinity);
}
