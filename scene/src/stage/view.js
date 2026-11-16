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
//
// The focus (COMPOSITION.md §5, TOOLS.md §3) is the path of the links
// entered: [] the outermost, until Enter moves it into a link whose doc acts.
// It scopes the selection (../selection.js, H10: a selection is an element
// of the focus stage) and is where the general parts run (§3: the editor
// edits the focus's doc); it cuts no segment, so verbs and carries outside
// it still work. Focus and selection change only through selectionStep.

import * as THREE from "three";
import { createAnnouncer } from "./announce.js";
import css from "./stage.css?inline";
import { Viewport } from "./viewport.js";
import { createAtom, assoc } from "./atom.js";
import { createRouter } from "./router.js";
import { createDrawer } from "./dock.js";
import { escapeHint } from "./ladder.js";
import { EDIT, LOOK, isStageBody, stageBody, startBase } from "./bodies.js";
import { atFocus, focusSteps, selectionStep } from "../selection.js";
import { realTime } from "./time.js";
import { comparePaths, elementOf, keyOf, parseKey, pathOf, samePath } from "./paths.js";
import { expand, identityOf, isLink } from "./links.js";
import { viewAt } from "../build.js";
import { unionPackages } from "../packages.js";
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
 * Where a start leads (TOOLS.md §2): from stage `s`, its doc's start; while
 * its place is one of that doc's links, on through it, as the linked doc
 * starts people. `next(s, linkId)` → the stage the link opens (undefined:
 * not yet; null: nobody arrives through it). Links can't repeat on a path
 * (links.js), so this ends. Pure.
 * @returns {{ stage, body: string | null, place: string | null, through: boolean } | null | undefined}
 */
export function startArrival(s, { doc, next }) {
  let stage = s;
  let through = false;
  for (;;) {
    if (!stage) return undefined;
    const d = doc(stage);
    const { body, place } = startOf(d);
    if (place == null || !isLink(d?.objects?.[place])) return { stage, body, place, through };
    const n = next(stage, place);
    if (n == null) return n;
    stage = n;
    through = true;
  }
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

const NO_ESCAPE = Object.freeze({ layer: null, hint: "" });

/** A viewer's prefs as stored: a plain object. */
export function cleanPrefs(v) {
  return Object.freeze(v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {});
}

/**
 * The view's value as one stage sees it (COMPOSITION.md §3): the selection
 * and hover as its element of their paths, the body's and the held tool's
 * owner as its extension's id where they are its own (else the view's key,
 * which no id of a stage's equals), and not the focus: where the viewer has
 * entered is the view's, and a stage that read it could act differently
 * entered than not (I4). So Escape's last rung (leave an entered link) is
 * shown as no rung, but to the general parts (`general`), the view's own,
 * whose chrome says what Escape does. Pure.
 * @param {object} v  the view's value  @param {number} n  the stage's number  @param {string[]} prefix  its path
 * @param {{ general?: boolean }} [o]
 */
export function projectView(v, n, prefix, { general = false } = {}) {
  const own = (key) => {
    if (key == null) return null;
    const p = parseKey(key);
    return p && p.n === n ? p.id : key;
  };
  // (where the focus is is the view's: a stage never learns where the viewer has entered)
  // (nor every open doc's packages: the union is the view's prompt, its general parts')
  // (nor the focus path's clocks: the clock chip's, a general part's)
  const { focus: _focus, packages: _packages, clocks: _clocks, ...rest } = v;
  return Object.freeze({
    ...rest,
    ...(general && v.packages ? { packages: v.packages } : {}),
    ...(general && v.clocks ? { clocks: v.clocks } : {}),
    ...(!general && v.escape?.layer === "focus" ? { escape: NO_ESCAPE } : {}),
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

/** A doc's URL without a path or heads (what `deps` is keyed by). */
const docUrl = (u) => String(u ?? "").split(/[/#]/)[0];
/** A pin's deps as a key: the same docs at the same heads give the same key, in any order. */
const depsKey = (deps) =>
  JSON.stringify(
    Object.keys(deps ?? {})
      .sort()
      .map((u) => [u, [...(deps[u] ?? [])].sort()]),
  );
/** Every doc URL a doc names, anywhere in it (bytes skipped), without paths or heads. */
function urlsIn(doc) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      if (v.startsWith("automerge:")) out.add(docUrl(v));
    } else if (v && typeof v === "object" && !ArrayBuffer.isView(v)) for (const x of Object.values(v)) walk(x);
  };
  walk(doc);
  return out;
}

/**
 * Mount a view in `element` (element.repo, element.viewerId and element.time
 * optional). Its stages come after, the outermost first (./stage.js).
 */
export function createView(element, { url = "scene", openStage = null } = {}) {
  const repo = element.repo ?? globalThis.repo;
  // the docs this view shows live, told to the host (./announce.js): the
  // linked stages' here, their objects' through each stage's render manager
  const announcer = createAnnouncer(element);
  let announcedLinks = new Set();
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
    // every open doc's packages this viewer doesn't have (unionPackages): the general parts' prompt
    packages: unionPackages([]),
    // the focus path's clocks, outermost first: the general parts' clock chip (clocksChanged)
    clocks: Object.freeze([]),
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
  // has the camera been placed for this viewer, other than by their own hand: restored as the view
  // opened (their saved camera, the doc's home)? And has it been carried across a focus move, which
  // only the general parts are told (they start again where the focus went: scene.autoframe there
  // leaves it be)?
  let cameraPlaced = false;
  let cameraCarried = false;
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
  /** The acting stage whose path is `p` exactly, or null. */
  function stageAt(p) {
    for (const s of stages.values()) if (s.acts && samePath(s.path, p)) return s;
    return null;
  }
  /** The stage selection is scoped by, and the general parts run in: the one at the focus (the outermost until Enter moves it). */
  const focusStage = () => stageAt(atom.get().focus) ?? outermost();
  /**
   * The stages that act, outermost first, then by path: a doc's structure,
   * not the order its links' docs arrived in. A pin or a mirror is drawn and
   * never acts (COMPOSITION.md §7), so it is never among them.
   */
  const acting = () => [...stages.values()].filter((s) => s.acts).sort((a, b) => comparePaths(a.path, b.path) || a.n - b.n);
  /** Give a stage its number; the first is the outermost. */
  function addStage(make) {
    const n = nextStage++;
    const s = make(n);
    stages.set(n, s);
    s.start();
    s.announce(announced());
    packagesChanged();
    clocksChanged();
    return s;
  }
  // Who's here (COMPOSITION.md §6): the viewer's body and held tool are the
  // view's, so the view says them on every channel it acts on, not a part on
  // the focus doc's: whoever has a doc open sees what a person at any
  // placement of it is doing (a viewer of the game alone sees the boat's
  // sailor seated at it). A drawn stage's channel only listens.
  const announced = () => {
    const v = atom.get();
    return { body: { id: v.body?.id ?? LOOK.id, label: v.body?.label ?? LOOK.label }, held: v.held ? { name: v.held.name } : null };
  };
  function announce() {
    const a = announced();
    for (const s of stages.values()) s.announce(a);
  }
  function removeStage(s) {
    if (stages.get(s.n) === s) stages.delete(s.n);
    packagesChanged();
    clocksChanged();
    ambientsChanged();
    for (const [k, rec] of opened) if (rec.stage === s) opened.delete(k);
    // what it held of the view goes with it: its bodies, its tool, its sessions
    for (const rec of [...sittings]) if (rec.stage === s) leftBody(rec);
  }
  // A world's ambients (STAGE.md, "Ambients") are its outermost stage's: the
  // one read path, which every stage's api.ambient and the viewport's
  // atmosphere both go through, so the viewport is a reader like any other.
  /** The world's ambient `name`: the outermost stage's frozen value, or undefined. */
  const ambient = (name) => outermost()?.ambients()[name];
  let atmosphereShown; // what the viewport was last told (undefined: nothing yet)
  /** A stage's ambients changed (it flushed new ones, or it went): the viewport shows the world's atmosphere. */
  function ambientsChanged() {
    if (dead) return;
    const atm = ambient("atmosphere") ?? null;
    if (atm === (atmosphereShown ?? null)) return;
    atmosphereShown = atm;
    viewport.setAtmosphere(atm);
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
  // arrives. Every occurrence that isn't closed gets a stage of its own, keyed
  // by its path: a live doc acts at one of them, and is a mirror (a read-only
  // stage on the same live handle) at the rest; a pinned value is a read-only
  // stage on its doc at those heads. A stage whose occurrence changes role or
  // identity closes, with everything opened under it, and opens again. A
  // closed link, or one whose doc (or version) hasn't arrived, is drawn as
  // its hint.
  const docs = new Map(); // url → { handle, state: "loading" | "ready" | "unavailable" }
  const pins = new Map(); // identity (links.js identityOf) → the doc's handle at those heads
  const opened = new Map(); // path key → { stage, key: role and identity }
  let expansion = [];
  let linkStates = new Map(); // path key → { role, open, reason? }
  const pathKey = (p) => p.join("\u001f");
  // (a pin's deps are part of what it is: the same heads held with other deps show other docs)
  const occKey = (o) => `${o.role}|${identityOf(o.url, o.heads)}|${o.heads ? depsKey(o.deps) : ""}`;
  /** A doc's live handle as the view has it: found once, watched for changes; null if it can't be opened, undefined while on its way. */
  function liveHandle(u) {
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
    return d.state === "ready" ? d.handle : undefined;
  }
  /** A doc at fixed heads: its handle there, once those heads are here (the live doc's changes bring them), else undefined; null if it can't be opened. */
  function pinHandle(u, heads) {
    const ident = identityOf(u, heads);
    if (pins.has(ident)) return pins.get(ident);
    const live = liveHandle(u);
    if (!live) return live;
    const v = viewAt(live, heads);
    if (!v) return undefined;
    pins.set(ident, v);
    return v;
  }
  function docOf(u, heads) {
    const root = outermost();
    if (!heads && root && u === root.url) return root.doc();
    const h = heads ? pinHandle(u, heads) : liveHandle(u);
    return h ? (h.doc() ?? undefined) : h;
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
    // the linked docs shown live (acting or mirrored; a pin keeps its own version) are announced, and only those
    const live = new Set();
    for (const o of expansion) if (o.depth > 0 && o.role !== "closed" && !o.heads) live.add(o.url);
    for (const u of live) if (!announcedLinks.has(u)) announcer.hold(u);
    for (const u of announcedLinks) if (!live.has(u)) announcer.release(u);
    announcedLinks = live;
    const want = new Map();
    for (const o of expansion) if (o.depth > 0 && o.role !== "closed") want.set(pathKey(o.path), o);
    // a stage whose occurrence is gone, or is now another role or identity, closes, and everything opened under it (its claims go with it)
    const closing = [];
    for (const [k, rec] of opened) {
      const o = want.get(k);
      if (!(o && rec.key === occKey(o) && stages.get(rec.stage.n) === rec.stage)) closing.push(rec.stage.path);
    }
    // the focus is an occurrence, not a path: one whose stage closes is left now, so a new one opened at
    // the same path (the link pointed at another doc) is the link going, not the focus staying (Decisions 8)
    const focusNow = atom.get().focus;
    const cut = closing.filter((p) => p.length <= focusNow.length && p.every((x, i) => x === focusNow[i])).reduce((a, p) => (a == null || p.length < a ? p.length : a), null);
    if (cut != null) focusOn(focusNow.slice(0, cut - 1));
    for (const p of closing)
      for (const [k, rec] of [...opened])
        if (rec.stage.path.length >= p.length && p.every((x, i) => x === rec.stage.path[i])) {
          opened.delete(k);
          rec.stage.dispose();
        }
    // open the rest, parents first (the expansion is in path order)
    for (const o of expansion) {
      const k = pathKey(o.path);
      if (o.depth === 0 || o.role === "closed" || opened.has(k)) continue;
      const parentOcc = expansion[o.parent];
      const parent = parentOcc.depth === 0 ? root : opened.get(pathKey(parentOcc.path))?.stage;
      const handle = o.heads ? pinHandle(o.url, o.heads) : liveHandle(o.url);
      if (!parent || !handle) continue;
      opened.set(k, { stage: openLinked(handle, parent, o), key: occKey(o) });
    }
    const states = new Map();
    for (const o of expansion) {
      if (o.depth === 0) continue;
      const open = opened.get(pathKey(o.path))?.key === occKey(o);
      states.set(pathKey(o.path), Object.freeze({ role: o.role, open: o.role !== "closed" && open, ...(o.reason ? { reason: o.reason } : {}) }));
    }
    const was = linkStates;
    linkStates = states;
    if (JSON.stringify([...was]) !== JSON.stringify([...states])) for (const s of stages.values()) s.linksChanged();
    // the focus is a stage that acts: one whose link went, closed, or now mirrors or pins its doc is left
    const focus = atom.get().focus;
    let keep = focus;
    while (keep.length && !stageAt(keep)) keep = keep.slice(0, -1);
    if (keep.length < focus.length) focusOn(keep);
    else placeGeneral();
    showTrail();
  }
  /** Open a linked doc's stage, its root under the link's node, in the link's frame, acting or drawn as its occurrence says. */
  function openLinked(handle, parent, o) {
    const linkId = o.link;
    const frame = () => {
      const m = parent.displayedWorld(linkId);
      if (!m) return null;
      const f = parent.frame();
      return f.matrix ? multiplyMatrices(f.matrix, m) : m;
    };
    return addStage((n) => openStage({ handle, view: api, n, path: o.path, frame, under: keyOf(parent.n, linkId), general: false, role: o.role, deps: o.deps }));
  }
  /** Is a linked doc still on its way: one being found, or acting with no stage open for it yet? */
  function linksPending() {
    for (const d of docs.values()) if (d.state === "loading") return true;
    return expansion.some((o) => o.role === "acting" && o.depth > 0 && !opened.has(pathKey(o.path)));
  }
  /** A link's state as the view has it ({ role: "acting" | "mirror" | "pinned" | "closed", open, reason? }: open, its doc is drawn, else its hint), by its path; null if it isn't one. */
  const linkState = (p) => linkStates.get(pathKey(p)) ?? null;
  /**
   * Where fixing the link at path `p` would fix it (COMPOSITION.md §7, "a pin
   * is whole"): `{ heads, deps? }`, the heads of its doc as this view has it,
   * and in `deps` the heads of every doc reached through it: of the docs the
   * stages opened under it hold or found through their repos (live linked
   * docs, render docs, files, a keeper's container), those its doc names by
   * URL, or a doc so named names, and so on. A doc an extension found that
   * nothing in the pin names is the viewer's, not the pin's (a player's
   * secret): never recorded. Null when no live stage is open there.
   */
  function fixPointAt(p) {
    const at = opened.get(pathKey(p))?.stage;
    if (!at || at.role === "pinned") return null;
    const heads = at.handle.heads?.();
    if (!Array.isArray(heads) || !heads.length) return null;
    // url → handle: what the stages under it hold or found; null: a find still on its way, so it
    // can't be fixed yet if its docs name that one (a pin missing it would show it live)
    const found = new Map();
    for (const { stage: s } of opened.values()) {
      // (a pin under it is fixed already, by its own `at`)
      if (s.role === "pinned" || s.path.length < p.length || !p.every((x, i) => x === s.path[i])) continue;
      if (s !== at) found.set(docUrl(s.url), s.handle);
      for (const [u, h] of s.reached) if (!found.get(docUrl(u))) found.set(docUrl(u), h);
    }
    const deps = {};
    const seen = new Set([docUrl(at.url)]);
    for (let next = [at.handle.doc()]; next.length; ) {
      const docs = next;
      next = [];
      for (const d of docs)
        for (const u of urlsIn(d)) {
          if (seen.has(u)) continue;
          const h = found.get(u);
          if (h === null) return null; // named, and still on its way: not yet
          const hs = h?.heads?.();
          if (seen.has(u) || !Array.isArray(hs) || !hs.length) continue;
          seen.add(u);
          deps[u] = [...hs];
          next.push(h.doc());
        }
    }
    return Object.keys(deps).length ? { heads: [...heads], deps } : { heads: [...heads] };
  }

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

  // The focus and the selection change here only, a selectionStep at a time
  // (../selection.js), so the selection is always an element of the focus
  // stage (H10), whoever asks: an extension of any stage, the Edit body, the
  // ladder, a link going.

  /** Apply selection events in turn, as one change; a move of the focus moves what follows it. @returns did anything change */
  function selectSteps(evs) {
    const m = atom.get();
    const was = { focus: m.focus, selected: m.selected };
    const next = evs.reduce((st, ev) => selectionStep(st, ev), was);
    if (next === was) return false;
    const focus = samePath(m.focus, next.focus) ? m.focus : pathOf(next.focus);
    const selected = next.selected == null ? null : samePath(m.selected, next.selected) ? m.selected : pathOf(next.selected);
    if (focus === m.focus && selected === m.selected) return false;
    atom.swap((v) => ({ ...v, focus, selected }));
    if (focus !== m.focus) focusMoved(m);
    return true;
  }
  /** Apply one selection event. */
  const selectStep = (ev) => selectSteps([ev]);
  /** Select a path (null: none): the element of the focus stage it goes through; outside the focus, nothing (../selection.js). */
  const select = (path) => selectStep(path == null ? { type: "clear" } : { type: "select", path: [...path] });

  /**
   * Where Enter on the link at path `p` goes: there, if its doc acts there;
   * if it's a mirror, where that doc acts (a mirror is the same live doc,
   * drawn again: it's edited where it's live); else null (a pin is a value,
   * a closed link has no stage).
   */
  function enterable(p) {
    const st = linkState(p);
    if (!st?.open) return null;
    if (st.role === "acting") return stageAt(p) ? pathOf(p) : null;
    if (st.role !== "mirror") return null;
    const url = expansion.find((o) => o.depth > 0 && samePath(o.path, p))?.url;
    const at = expansion.find((o) => o.role === "acting" && o.depth > 0 && o.url === url);
    return at && stageAt(at.path) ? pathOf(at.path) : null;
  }
  /** Move the focus to path `p`: out to where it and `p` part, then in a link at a time (as far as each acts), as one change. @returns did it get there */
  function focusOn(p) {
    selectSteps(focusSteps(atom.get().focus, p, (q) => !!stageAt(q)));
    return samePath(atom.get().focus, p);
  }
  /** Enter the link at path `p`, wherever the focus is: it moves to where that link's doc acts. */
  function enter(p) {
    const to = Array.isArray(p) ? enterable(p) : null;
    return to ? focusOn(to) : false;
  }
  /** Leave: the focus one link out. */
  const leave = () => selectStep({ type: "leave" });

  /** The general parts run in the focus stage and no other (COMPOSITION.md §3). */
  function placeGeneral() {
    const at = focusStage();
    for (const s of stages.values()) s.setGeneral(s === at);
  }
  // The drawer's tabs as the focus last moved, by title, for the general parts that start where it went
  // (parts/tab.js). The view's: only a general part is handed it, a title once (`reopened`).
  let reopening = null;
  /**
   * The focus moved (from the view's value `was`): a tool held from a stage
   * it left behind is put down, the general parts move to the stage it's in
   * (one still holding something finishes it where it was: host.setGeneral),
   * their drawer tabs open again there, and the trail shows where it is.
   */
  function focusMoved(was) {
    if (dead) return;
    const held = router?.held();
    const p = held ? parseKey(held.owner) : null;
    const s = p ? stages.get(p.n) : null;
    // (a stage on the focus path is one whose path the focus starts with)
    if (s && !(s.path.length <= atom.get().focus.length && s.path.every((x, i) => x === atom.get().focus[i]))) router.putDown();
    reopening = { tabs: new Set(was.drawer?.tabs ?? []), shown: was.drawer?.shown ?? null };
    cameraCarried = true;
    placeGeneral();
    showTrail();
    router?.refresh();
  }
  /** Was a tab titled `title` open as the focus last moved? Answered once per title per move: { show } or null. */
  function reopened(title) {
    if (!reopening?.tabs.has(title)) return null;
    reopening.tabs.delete(title);
    return { show: reopening.shown === title || !reopening.shown };
  }

  // ─── packages: every open doc's, one prompt (STAGE.md, "Packages") ────────
  // Each stage keeps its doc's list and loads for it (./packages.js); what
  // this viewer is asked about is the view's: the union over every open
  // stage, acting or drawn (a pin's content needs its providers too), as
  // view.packages, which only the general parts see (projectView). A yes or
  // a not now goes to every stage that asked; a not now is kept here, for the
  // view's life, so a doc opened after it (a link added, a relink, a mirror
  // that comes to act) isn't asked about those packages either.
  const declinedPackages = new Set();
  const stagesInOrder = () => [...stages.values()].sort((a, b) => comparePaths(a.path, b.path) || a.n - b.n);
  function packagesChanged() {
    if (dead) return;
    const next = unionPackages(stagesInOrder().map((s) => s.reader.packages()));
    atom.swap((m) => (JSON.stringify(m.packages) === JSON.stringify(next) ? m : { ...m, packages: next }));
  }
  // ─── clocks: the focus path's (TOOLS.md §6's clock chip) ───────────────────
  // Each stage computes its doc's world time and says what its chip would
  // show (local.clock: ./clock.js). The chip is one general part, the view's,
  // so the view puts the focus path's together, as view.clocks, which only
  // the general parts see (projectView): one entry per stage on the path
  // with a clock to show, outermost first, { stage, name, status }: a plain
  // value, so the chip hears a change on any of them; `name` is the trail's
  // for that doc. Pause and Resume are each stage's (its reader's `clock`).
  const NO_CLOCKS = Object.freeze([]);
  function clocksChanged() {
    if (dead) return;
    const f = atom.get().focus;
    const out = [];
    for (let i = 0; i <= f.length; i++) {
      const s = stageAt(f.slice(0, i)) ?? (i === 0 ? outermost() : null);
      const status = s?.reader.clock.status() ?? null;
      if (status) out.push(Object.freeze({ stage: s.n, name: nameAt(f.slice(0, i)), status }));
    }
    const next = out.length ? Object.freeze(out) : NO_CLOCKS;
    atom.swap((m) => (JSON.stringify(m.clocks) === JSON.stringify(next) ? m : { ...m, clocks: next }));
  }

  const packages = Object.freeze({
    load: (urls) => Promise.all(stagesInOrder().map((s) => s.packages.load(urls))).then(() => {}),
    dismiss: (urls) => {
      for (const s of stagesInOrder()) s.packages.dismiss(urls);
    },
  });

  // ─── the trail: where the focus is (TOOLS.md §6's breadcrumb) ─────────────
  // The view's own chrome, shown only while the focus is inside a link: the
  // outermost doc's title, then each link entered by its host's name for it,
  // each a way back out to there, and Leave.
  const trail = document.createElement("nav");
  trail.className = "stage-trail";
  trail.setAttribute("aria-label", "Where you are");
  let trailKey = "";
  /** What the trail calls the doc at path `p` on the focus path: the outermost's title, else its host's name for the link. */
  function nameAt(p) {
    if (!p.length) return String(outermost()?.doc()?.title || "Scene");
    return String(stageAt(p.slice(0, -1))?.reader.nameOf(p.at(-1)) || "Linked scene");
  }
  function showTrail() {
    // (the chips name their docs as the trail does: whenever the trail looks again, so do they)
    clocksChanged();
    const focus = atom.get().focus;
    const names = [];
    for (let i = 0; i <= focus.length; i++) names.push(nameAt(focus.slice(0, i)));
    const key = focus.length ? JSON.stringify(names) : "";
    if (key === trailKey) return;
    trailKey = key;
    if (!focus.length) {
      trail.remove();
      trail.replaceChildren();
      return;
    }
    const parts = names.flatMap((name, i) => {
      const last = i === names.length - 1;
      const crumb = document.createElement(last ? "span" : "button");
      crumb.className = last ? "trail-here" : "button link trail-crumb";
      crumb.textContent = name;
      if (last) crumb.setAttribute("aria-current", "location");
      else {
        crumb.type = "button";
        crumb.title = `Back out to ${name}`;
        crumb.addEventListener("click", () => focusOn(atom.get().focus.slice(0, i)));
      }
      return i ? [Object.assign(document.createElement("span"), { className: "trail-sep", textContent: "›" }), crumb] : [crumb];
    });
    const out = document.createElement("button");
    out.type = "button";
    out.className = "button trail-leave";
    out.textContent = "Leave";
    out.title = "Back out one level (Esc)";
    out.addEventListener("click", () => leave());
    trail.replaceChildren(...parts, out);
    if (!trail.isConnected) edges.top.prepend(trail);
  }

  // ─── bodies and the held tool (TOOLS.md §4) ───────────────────────────────

  // The bodies entered, bottom first, over the base: { stage, ext, owner, def, sitting, pop, place }.
  const sittings = [];
  let base = LOOK;
  const topSitting = () => sittings.at(-1) ?? null;
  const reachOf = (def) => (typeof def?.reach === "number" && def.reach >= 0 ? def.reach : Infinity);
  let router = null;

  /**
   * Every body on offer: each acting stage's, the caller's first; the first
   * to offer an id has it. `only`: the caller's alone (a start through a
   * link arrives in that doc's stage or nowhere: a place never crosses docs).
   */
  function bodyDefs(first = null, only = false) {
    const out = new Map();
    const order = only ? (first?.acts ? [first] : []) : first?.acts ? [first, ...acting().filter((s) => s !== first)] : acting();
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
      // outside the focus it can't select, so the click isn't Edit's: it goes down the chain (verbs out there still work)
      if (path && !atFocus(atom.get().focus, path)) return false;
      selectStep({ type: "press", path: path ?? [] });
      return true;
    },
  };

  /**
   * Make Look or Edit the base (./bodies.js): every body standing on it
   * leaves, and leaving Edit puts down what Edit holds: a tool held through
   * an editing command (Measure), whose input is the editor's, and the
   * selection (attention is the selection, so a selection kept from Edit
   * would aim F and the use prompt at what was last edited). The focus
   * stays: it is where the viewer is, as the camera is.
   */
  function setBase(b) {
    if (dead || !router) return;
    const leavingEdit = base === EDIT && b !== EDIT;
    base = b;
    router.setBase({ id: b.id, input: b === EDIT ? editInput : lookInput, lock: false, keys: [], ahead: b === EDIT ? EDIT_AHEAD : [] });
    if (b !== EDIT) putDownEditTool();
    if (leavingEdit) selectStep({ type: "clear" });
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
  function enterBody(id, place = null, caller = null, only = false) {
    if (dead || !router) return false;
    const stageB = stageBody(id);
    if (stageB) {
      arrival = null; // they went somewhere themselves
      setBase(stageB);
      return true;
    }
    const found = bodyDefs(caller, only).get(id);
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
  // has written one for its maker. A start whose place is one of the doc's
  // links arrives through it: as the linked doc starts people, in its stage
  // (and so on down, a place there being a link in turn), and only there:
  // that stage offers the body or nobody arrives, as a place is that doc's.
  // Otherwise the first acting stage to offer it does. Its body is entered
  // once offered and the content is in, or ARRIVE_WAIT_MS after it came on
  // offer. Until then it waits as long as the body may still come. A body
  // that refuses when entered is asked again until ARRIVE_WAIT_MS after the
  // offer.
  let arrival = null; // { offered, based }
  function arrive() {
    if (!outermost()) return;
    arrival = { offered: null, based: false };
    tryArrive();
    requestFlush();
  }
  /**
   * Where the start leads (startArrival): `{ stage, body, place, through }`
   * (`through`: reached through a link), undefined while a link on the way
   * is still on its way, null when it can't be arrived through (a pin, a
   * mirror or a closed link: nobody arrives in a value or a copy).
   */
  function arrivalAt() {
    return startArrival(outermost(), {
      doc: (s) => s.doc(),
      next: (s, id) => {
        const p = [...s.path, id];
        const st = linkState(p);
        if (!st) return undefined;
        if (st.role !== "acting") return null;
        return stageAt(p) ?? undefined;
      },
    });
  }
  function restoreCamera(doc) {
    const cam = initialCamera({ stored: readJSON(cameraKey), doc });
    if (cam && viewport.ok) {
      viewport.setCamera(cam);
      cameraPlaced = true;
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
    const at = arrivalAt();
    if (at === null) {
      arrival = null;
      return;
    }
    if (at === undefined) {
      // (each flush asks again; a doc arriving flushes)
      if (linksPending()) requestFlushSoon();
      return;
    }
    // the base at once (Look, or Edit for a scene made to be built)
    if (!a.based) {
      a.based = true;
      setBase(startBase(at.body));
    }
    if (!at.body || isStageBody(at.body)) {
      arrival = null;
      return;
    }
    const all = [...stages.values()];
    const unsettled = (s) => s.starting() || s.packages.coming();
    // through a link: that doc's stage alone offers it (its place is that doc's)
    const only = at.through;
    const caller = only ? at.stage : null;
    const offer = bodyDefs(caller, only).get(at.body);
    if (offer) {
      a.offered ??= time.now();
      // a stage ahead of the offering one in acting order, or a link still on its way, may offer
      // it too, and its offer is the one arriving takes (unless the start named the stage, through
      // a link); and the content first
      const order = acting();
      const ahead = only ? [] : order.slice(0, order.indexOf(offer.stage));
      const waiting = time.now() - a.offered < ARRIVE_WAIT_MS;
      if (((!only && linksPending()) || ahead.some(unsettled) || !all.every((s) => s.contentIn())) && waiting) return requestFlushSoon();
      // a body may refuse at the moment it's offered (its doc not yet in, a seat not yet
      // laid): the start stays pending and is offered again until ARRIVE_WAIT_MS after the offer
      if (enterBody(at.body, at.place, caller, only) || !waiting) arrival = null;
      else requestFlushSoon();
      return;
    }
    if (only) {
      // that stage may still bring it (starting, or its packages on their way); else nobody arrives
      if (unsettled(at.stage)) requestFlushSoon();
      else if (at.stage.packages.complete()) arrival = null;
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
   * focus, then the general parts (the focus stage's). Owners are keys
   * (stage, extension).
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
    // then the general parts, the view's, wherever the hit is: in the focus stage, its element of the path (null off it)
    const at = focusStage();
    for (const ext of at?.generals() ?? []) {
      const k = keyOf(at.n, ext);
      if (!order.includes(k)) order.push(k);
    }
    return { order, holderOf: (k) => holders.get(k) ?? null, widget: won ? widget.owner : null };
  }
  /**
   * The input path (COMPOSITION.md §3): the stages from attention's innermost
   * out to the outermost (the selection's path, else the look's; `look: true`
   * the look's), then the focus stage if it isn't among them, each as its
   * reader (stage.js). Nothing under attention: the outermost, and the focus.
   * The focus is always on it, since the scene a surface speaks of (its
   * commands on nothing: Frame all, Measure, Undo) is the focus's.
   * `focus: true` is the focus path instead: the focus stage out to the
   * outermost, whatever attention is (the toolbar's: it doesn't follow the
   * pointer).
   */
  function inputPath({ look: lookOnly = false, focus: focusOnly = false, at = null } = {}) {
    if (focusOnly) {
      const f = atom.get().focus;
      const out = [];
      for (let i = f.length; i >= 0; i--) {
        const s = stageAt(f.slice(0, i));
        if (s) out.push(s.reader);
      }
      return out;
    }
    // (`at`: a full path attention is held to, a held verb's target, whatever the selection and the look)
    const sel = Array.isArray(at) && at.length ? at : atom.get().selected;
    const l = !lookOnly && sel ? null : look();
    const path = !lookOnly && sel ? sel : l?.id != null ? pathOfKey(l.id) : null;
    const on = path ? onPath(path) : [];
    const out = on.length ? on : [outermost()].filter(Boolean);
    const f = focusStage();
    if (f && !out.includes(f)) out.push(f);
    return out.map((s) => s.reader);
  }
  /** What every acting stage offers as `name`: the input path's stages first, innermost first; each item tagged with its stage. */
  function collect(name) {
    const first = inputPath().map((r) => r.stage);
    const order = [...first, ...acting().map((s) => s.n).filter((x) => !first.includes(x))];
    return order.flatMap((x) => stages.get(x)?.reader.collect(name) ?? []);
  }
  /** The stages that act on a path, innermost first, out to the outermost (a pin or a mirror on it is passed over: it is drawn, never acted on). */
  function onPath(path) {
    const out = [];
    for (const s of stages.values()) if (s.acts && path.length > s.path.length && s.path.every((x, i) => x === path[i])) out.push(s);
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
    deselect: () => selectStep({ type: "clear" }),
    focusDepth: () => atom.get().focus.length,
    leaveFocus: () => leave(),
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
      if (next.body !== prev.body || next.held !== prev.held) announce();
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
    announcer.dispose();
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
    announcer,
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
    get cameraPlaced() {
      return cameraPlaced;
    },
    /** the camera has come along across a focus move (a general part's api.camera.touched) */
    get cameraCarried() {
      return cameraCarried;
    },
    restoreCamera,
    reopened,
    packages,
    packagesChanged,
    /** a stage's clock said something new (local.clock): the focus path's clocks again */
    clocksChanged,
    /** "Not now"'s packages, the view's: every stage's packages module shares it */
    declinedPackages,
    // the stages
    addStage,
    removeStage,
    stages: () => [...stages.values()],
    stage: (n) => stages.get(n) ?? null,
    outermost,
    ambient,
    ambientsChanged,
    focusStage,
    acting,
    pathOfKey,
    onPath,
    inputPath,
    collect,
    /** the chain for an event, and the widget under it (the router's; for probes and tests) */
    chainFor,
    pickWidget,
    requestFlush,
    // the viewer's
    notify,
    setPref,
    select,
    selectStep,
    enter,
    leave,
    focusOn,
    enterable,
    stageAt,
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
    fixPointAt,
    /** what arriving still waits to enter (where view.start leads: its stage's number, body and place), for probes and tests */
    arriving: () => {
      if (!arrival) return null;
      const at = arrivalAt();
      return at ? { stage: at.stage.n, body: at.body, place: at.place, offered: arrival.offered } : { pending: at === undefined };
    },
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
