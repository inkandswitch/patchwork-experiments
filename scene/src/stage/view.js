// The view (STAGE.md, "Views, stages and links"): one per mounted tool, shared by every stage
// it opens. It holds what is the viewer's, not any doc's: the DOM and its
// edges, the viewport, the router, the camera and its saving, labels, the
// body stack and the hands, the view's atom (the body, the hands, the held
// tool, the pointer, the selection and hover, theme, the focus), the
// session every stage's channel names, and the stages themselves. A stage (./stage.js) is one per open doc and holds what is
// the doc's.
//
// Selection and hover are paths (./paths.js): the links from the outermost
// stage in, then the object. Each stage sees its own element of them
// (`project`), so an extension reads `view.selected` as an id of its own doc
// and never sees another doc's.
//
// The focus (STAGE.md, "The input chain") is the path of the links
// entered: [] the outermost, until Enter moves it into a link whose doc acts.
// It scopes the selection (../selection.js, H10: a selection is an element
// of the focus stage) and is where the view's plugins sit (STAGE.md, "View
// plugins": the editor edits the focus's doc); it cuts no segment, so verbs
// and carries outside it still work. Focus and selection change only through
// selectionStep.
//
// The view's plugins (`scene:view`, ./host.js) run once per view,
// for its whole life: each gets the view's api (makeApi below), and
// api.focus() is the focus stage's api for it (stage.js facetFor).

import * as THREE from "three";
import * as patchworkPlugins from "@inkandswitch/patchwork-plugins";
import { createAnnouncer } from "./announce.js";
import css from "./stage.css?inline";
import { Viewport } from "./viewport.js";
import { createAtom, assoc } from "./atom.js";
import { createRouter } from "./router.js";
import { offer } from "./chain.js";
import { looksFromEye } from "./pointer.js";
import { escapeHint, restLayer } from "./ladder.js";
import { KERNEL_KINDS, LOOK } from "./bodies.js";
import { collectFrom, createHost, updateAll } from "./host.js";
import { frozenJSON } from "./ambients.js";
import { providersFirst } from "./activation.js";
import { focusSteps, selectionStep } from "../selection.js";
import { realTime } from "./time.js";
import { comparePaths, elementOf, keyOf, parseKey, pathOf, samePath, viewKey } from "./paths.js";
import { viewAt } from "../build.js";
import { unionPackages } from "../packages.js";
import { multiplyMatrices } from "../transform.js";

/** How long after the orbit stops the camera is saved. */
const CAMERA_SAVE_MS = 500;
/** How long, once view.start's body is on offer, arriving waits for the content before entering it anyway (ms). */
export const ARRIVE_WAIT_MS = 20_000;
const EDGES = ["top", "right", "bottom", "left"];
const noop = () => {};

// The stage's own body, Look (./bodies.js, STAGE.md, "Bodies"): the orbit
// camera, always at the bottom of the stack. As view.body:
const LOOK_LOCAL = Object.freeze({ id: LOOK.id, label: LOOK.label, ext: null, depth: 0, lock: false, reach: Infinity, keys: Object.freeze([]) });

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
 * Where the doc starts people (STAGE.md, "Arriving"): the kernel's keys of
 * `view.start`, read on arrival. `body` is a body's id (none, or "look", is
 * Look), `place` what its enter is given (a spawn point's object id, a
 * seat's id), `home` the camera. Pure.
 * @returns {{ body: string | null, place: string | null, home: object | null }}
 */
export function startOf(doc) {
  const s = doc?.view?.start;
  if (!s || typeof s !== "object") return { body: null, place: null, home: null };
  const body = typeof s.body === "string" && s.body ? s.body : null;
  const place = typeof s.place === "string" && s.place ? s.place : null;
  return { body, place, home: cleanCamera(s.home) };
}

const NO_START = Object.freeze({});
/**
 * The doc's `view.start` whole, as written, a frozen plain copy ({} when it
 * has none): what `view.arrived` says, for each plugin to read its own keys
 * of (the kernel's are startOf's). Pure.
 */
export function wholeStart(doc) {
  const s = doc?.view?.start;
  if (!s || typeof s !== "object" || Array.isArray(s)) return NO_START;
  try {
    return frozenJSON(JSON.parse(JSON.stringify(s)));
  } catch {
    return NO_START;
  }
}

/**
 * Where a start leads (STAGE.md, "Arriving"): from stage `s`, its doc's start; while
 * its place holds a stage (a link), on through it, as that doc starts
 * people. `next(s, id)` → the stage under it (false: it holds none, so the
 * start is here; undefined: not yet; null: nobody arrives through it).
 * Each step is a stage deeper in the view's finite tree, so this ends. Pure.
 * @returns {{ stage, body: string | null, place: string | null, through: boolean } | null | undefined}
 */
export function startArrival(s, { doc, next }) {
  let stage = s;
  let through = false;
  for (;;) {
    if (!stage) return undefined;
    const d = doc(stage);
    const { body, place } = startOf(d);
    const n = place == null ? false : next(stage, place);
    if (n === false) return { stage, body, place, through };
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

const NO_ESCAPE = Object.freeze({ layer: null, hint: "" });
// What Escape does with the focus at the outermost, where it is leaving a link: the top hand (the Edit hand, whose
// escape leaves) put down, else nothing.
const outermostEscape = (hands) => {
  const top = hands?.at(-1);
  return top ? Object.freeze({ layer: "hand", hint: escapeHint("hand", { hand: top.name }) }) : NO_ESCAPE;
};

/**
 * The view's value as one stage sees it (STAGE.md, "Views, stages and links"): the selection
 * and hover as its element of their paths, the body's, the hands' and the held tools'
 * owners as its extension's id where they are its own (else the view's key,
 * which no id of a stage's equals), and not the focus: where the viewer has
 * entered is the view's, and a stage that read it could act differently
 * entered than not (I4). So Escape leaving an entered link is shown as
 * what it would do at the outermost (the hand under it put down, else
 * nothing). A view plugin reads the view's value whole. Pure.
 * @param {object} v  the view's value  @param {number} n  the stage's number  @param {string[]} prefix  its path
 */
export function projectView(v, n, prefix) {
  const own = (key) => {
    if (key == null) return null;
    const p = parseKey(key);
    return p && p.n === n ? p.id : key;
  };
  // (where the focus is is the view's: a stage never learns where the viewer has entered;
  // nor every open doc's packages or how it arrived: the view plugins')
  const { focus: _focus, packages: _packages, arrived: _arrived, ...rest } = v;
  return Object.freeze({
    ...rest,
    ...(v.escape?.layer === "focus" ? { escape: outermostEscape(v.hands) } : {}),
    selected: elementOf(v.selected, prefix),
    hovered: elementOf(v.hovered, prefix),
    body: v.body?.ext != null ? Object.freeze({ ...v.body, ext: own(v.body.ext) }) : v.body,
    hands: v.hands?.some((h) => h.ext != null) ? Object.freeze(v.hands.map((h) => (h.ext != null ? Object.freeze({ ...h, ext: own(h.ext) }) : h))) : v.hands,
    held: v.held?.some((h) => h.ext != null) ? Object.freeze(v.held.map((h) => (h.ext != null ? Object.freeze({ ...h, ext: own(h.ext) }) : h))) : v.held,
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
  // the docs this view shows live, told to the host (./announce.js): its
  // stages' here, their objects' through each stage's render manager
  const announcer = createAnnouncer(element);
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

  // ─── the view's atom ──────────────────────────────────────────────────────

  const cameraKey = `scene-camera:${url}`;
  const atom = createAtom({
    // paths (./paths.js), each stage seeing its own element
    hovered: null,
    selected: null,
    // the body on top of the stack (STAGE.md, "Bodies"); Look until arriving says otherwise
    body: LOOK_LOCAL,
    // what the viewer holds, top last (STAGE.md, "Hands"), and the held tools among them, top last
    hands: Object.freeze([]),
    held: Object.freeze([]),
    gesture: null,
    pointer: Object.freeze({ locked: false, lock: false, wanted: false, released: false, refused: false }),
    escape: Object.freeze({ layer: null, hint: "" }),
    theme: null,
    // the stage selection is scoped by (STAGE.md, "The input chain"): the outermost's ([]) until Enter moves it
    focus: Object.freeze([]),
    // every open doc's packages this viewer doesn't have (unionPackages): the packages prompt's
    packages: unionPackages([]),
    // how this viewer last arrived (arrive()): the outermost doc's start whole (wholeStart), and a count
    // (a template's arriving again says so even when the start is the same); null before the first
    arrived: null,
  });

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
  // opened (their saved camera, the doc's home)?
  let cameraPlaced = false;
  let cameraTimer = null;
  cleanups.push(
    // (only what the viewer's hand did: a Frame, the autoframe's too, isn't kept, so a scene opened again still frames what it has then)
    viewport.onCameraEnd((_, how) => {
      if (how !== "orbit") return;
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
  /** The stage selection is scoped by, and the view plugins sit at: the one at the focus (the outermost until Enter moves it). */
  const focusStage = () => stageAt(atom.get().focus) ?? outermost();
  /**
   * The stages that act, outermost first, then by path: a doc's structure,
   * not the order its links' docs arrived in. A pin is drawn and
   * never acts (STAGE.md, "Views, stages and links"), so it is never among them.
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
    return s;
  }
  // Who's here (STAGE.md, "Views, stages and links"): the viewer's body and hands are the
  // view's, so the view says them on every channel it acts on, not a part on
  // the focus doc's: whoever has a doc open sees what a person at any
  // placement of it is doing (a viewer of the game alone sees the boat's
  // sailor seated at it). A drawn stage's channel only listens. An open menu
  // is nobody else's business: the hands under it are said, every one, top last.
  const announced = () => {
    const v = atom.get();
    const held = (v.hands ?? []).filter((h) => h.kind !== "popover").map((h) => ({ name: h.name }));
    return { body: { id: v.body?.id ?? LOOK.id, label: v.body?.label ?? LOOK.label }, held };
  };
  function announce() {
    const a = announced();
    for (const s of stages.values()) s.announce(a);
  }
  function removeStage(s) {
    if (stages.get(s.n) === s) stages.delete(s.n);
    packagesChanged();
    ambientsChanged();
    if (s.path.length && s.acts) announcer.release(s.url);
    // (what it was opened under shows that object's hint again)
    if (s.path.length) stageUnder(s.path.slice(0, -1))?.childrenChanged();
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
  // ─── opening stages: the tree (STAGE.md, "Views, stages and links") ─────────────

  /** The open stage whose path is `p` exactly, acting or drawn, or null. */
  const stageUnder = (p) => [...stages.values()].find((s) => samePath(s.path, p)) ?? null;
  /**
   * Open `handle` as a stage under object `id` of the stage at `at`, in its
   * frame: acting, or drawn and read-only (`acting: false`); `heads`: the
   * doc at those heads (a pin, drawn), `deps` the heads its repo finds docs
   * at. → the stage, or null (no stage at `at`, one open under `id` already,
   * those heads aren't here yet, or it would act under a stage that doesn't
   * or for a doc that acts in this view already: one acting stage per doc, I3).
   */
  function openUnder(handle, { under: [at, id] = [], acting = true, heads = null, deps = null } = {}) {
    const parent = Array.isArray(at) ? stageUnder(at) : null;
    const h = heads?.length ? viewAt(handle, heads) : handle;
    const acts = acting && h === handle;
    if (dead || !parent || typeof id !== "string" || stageUnder([...at, id]) || !h || (acts && (!parent.acts || [...stages.values()].some((s) => s.acts && s.url === h.url)))) return null;
    const frame = () => {
      const m = parent.displayedWorld(id);
      const f = parent.frame();
      return m && f.matrix ? multiplyMatrices(f.matrix, m) : m;
    };
    const s = addStage((n) => openStage({ handle: h, view: api, n, path: [...at, id], frame, under: keyOf(parent.n, id), role: acts ? "acting" : "pinned", deps }));
    // a doc it plays is announced (./announce.js); a pin keeps its own version
    if (s.acts) announcer.hold(s.url);
    parent.childrenChanged();
    return s;
  }
  /** Close stage `s` and everything under it, innermost first; a focus in it leaves it. */
  function closeStage(s) {
    if (dead || stages.get(s.n) !== s) return;
    const within = (p) => p.length >= s.path.length && s.path.every((x, i) => x === p[i]);
    if (within(atom.get().focus)) focusOn(s.path.slice(0, -1));
    for (const x of [...stages.values()].filter((x) => within(x.path)).sort((a, b) => b.path.length - a.path.length)) x.dispose();
  }
  // While a view plugin is opening stages (api.opening()), arriving waits for them.
  const opening = new Set();
  const pending = () => plugins.starting() || opening.size > 0;
  /** Every stage's update flush. */
  const requestFlush = () => {
    for (const s of stages.values()) s.requestFlush();
  };

  // ─── selection ────────────────────────────────────────────────────────────

  // The focus and the selection change here only, a selectionStep at a time
  // (../selection.js), so the selection is always an element of the focus
  // stage (H10), whoever asks: an extension of any stage, the Edit hand, the
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
    if (focus !== m.focus) focusMoved();
    return true;
  }
  /** Apply one selection event. */
  const selectStep = (ev) => selectSteps([ev]);
  /** Select a path (null: none): the element of the focus stage it goes through; outside the focus, nothing (../selection.js). */
  const select = (path) => selectStep(path == null ? { type: "clear" } : { type: "select", path: [...path] });

  /** Move the focus to path `p`: out to where it and `p` part, then in a link at a time (as far as each acts), as one change. @returns did it get there */
  function focusOn(p) {
    selectSteps(focusSteps(atom.get().focus, p, (q) => !!stageAt(q)));
    return samePath(atom.get().focus, p);
  }
  /** Enter the acting stage at path `p`, wherever the focus is (a pin or a closed link has none). */
  const enter = (p) => (Array.isArray(p) && !!stageAt(p) && focusOn(p));
  /** Leave: the focus one link out. */
  const leave = () => selectStep({ type: "leave" });

  /** The view's plugins' facets are the focus stage's (STAGE.md, "View plugins"): every other stage lets its go. */
  function placeFocus() {
    const at = focusStage();
    for (const s of stages.values()) if (s !== at) s.dropFacets();
  }
  /**
   * The focus moved: each tool held from a stage it left behind is put down,
   * and the view's plugins' facets of the stages it left go (they are told the
   * new focus stage afresh).
   */
  function focusMoved() {
    if (dead) return;
    for (const held of router?.held() ?? []) {
      const p = parseKey(held.owner);
      const s = p ? stages.get(p.n) : null;
      // (a stage on the focus path is one whose path the focus starts with)
      if (s && !(s.path.length <= atom.get().focus.length && s.path.every((x, i) => x === atom.get().focus[i]))) router.putDown(held);
    }
    placeFocus();
    told = new WeakMap();
    router?.refresh();
    requestFlush();
  }

  // ─── packages: every open doc's, one prompt (STAGE.md, "Packages") ────────
  // Each stage keeps its doc's list and loads for it (./packages.js); what
  // this viewer is asked about is the view's: the union over every open
  // stage, acting or drawn (a pin's content needs its providers too), as
  // view.packages, which only the view's plugins see (projectView). A yes or
  // a not now goes to every stage that asked; a not now is kept here, for the
  // view's life, so a doc opened after it (a link added, a relink, a repeat
  // that comes to act) isn't asked about those packages either.
  const declinedPackages = new Set();
  const stagesInOrder = () => [...stages.values()].sort((a, b) => comparePaths(a.path, b.path) || a.n - b.n);
  function packagesChanged() {
    if (dead) return;
    const next = unionPackages(stagesInOrder().map((s) => s.reader.packages()));
    atom.swap((m) => (JSON.stringify(m.packages) === JSON.stringify(next) ? m : { ...m, packages: next }));
  }
  const packages = Object.freeze({
    load: (urls) => Promise.all(stagesInOrder().map((s) => s.packages.load(urls))).then(() => {}),
    dismiss: (urls) => {
      for (const s of stagesInOrder()) s.packages.dismiss(urls);
    },
  });

  // ─── bodies and hands (STAGE.md, "Bodies", "Hands") ──────────────────────

  // The bodies entered, bottom first, over Look: { stage, ext, owner, def, sitting, pop, place }.
  const sittings = [];
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

  // Escape's own last steps, with no hand over them (./ladder.js restLayer): the selection clears, then the focus leaves one link.
  const restNow = () => restLayer({ selection: atom.get().selected != null, focus: atom.get().focus.length });
  function escapeRest() {
    const l = restNow();
    if (l === "selection") selectStep({ type: "clear" });
    else if (l === "focus") leave();
    return l != null;
  }

  /**
   * Enter body `id` at `place` (STAGE.md, "Arriving"), from stage `caller`: the first
   * acting stage offering it (the caller's own first) runs its enter, in its
   * frame, and what it answers goes on top of the stack. "look" is the
   * stage's: every body leaves.
   */
  function enterBody(id, place = null, caller = null, only = false) {
    if (dead || !router) return false;
    if (id === LOOK.id) {
      arrival = null; // they went somewhere themselves
      router.leaveAll();
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

  /** Hold a tool for an extension of a stage: its declaration ({ command?, name, handKind?, keys, pointer }) and its input (already the stage's). → put, or null (no router, or a toggle that put it down) */
  function holdTool(owner, t, input) {
    if (!router) return null;
    return router.hold(owner, { command: t.command ?? null, name: String(t.name ?? t.command ?? owner), handKind: t.handKind ?? null, input, keys: Array.isArray(t.keys) ? t.keys : [], pointer: !!t.pointer });
  }

  // ─── arriving: view.start (STAGE.md, "Arriving") ───────────────────────────────────
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
  let arrival = null; // { offered }
  let arrivals = 0;
  function arrive() {
    if (!outermost()) return;
    // the start whole: its keys beyond a body, a place and a home are the plugins' to read
    atom.swap((m) => ({ ...m, arrived: Object.freeze({ start: wholeStart(outermost().doc()), n: ++arrivals }) }));
    arrival = { offered: null };
    tryArrive();
    requestFlush();
  }
  /**
   * Where the start leads (startArrival): `{ stage, body, place, through }`
   * (`through`: reached through a link), undefined while a link on the way
   * is still on its way, null when it can't be arrived through (a pin or a
   * closed link: nobody arrives in a value or a link with no stage).
   */
  function arrivalAt() {
    return startArrival(outermost(), {
      doc: (s) => s.doc(),
      // (an object whose content is a stage, `content: "scene"`, holds one; a drawn one, or none once nothing is opening, nobody arrives through)
      next: (s, id) => {
        const under = stageUnder([...s.path, id]);
        if (under) return under.acts ? under : null;
        return s.routeOf(id) !== "scene" ? false : pending() ? undefined : null;
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
      if (pending()) requestFlushSoon();
      return;
    }
    if (!at.body || at.body === LOOK.id) {
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
      if (((!only && pending()) || ahead.some(unsettled) || !all.every((s) => s.contentIn())) && waiting) return requestFlushSoon();
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
    const waits = pending();
    if (!waits && all.every((s) => s.packages.complete() && !s.starting())) arrival = null;
    else if (waits || all.some(unsettled)) requestFlushSoon();
  }

  // ─── the look and attention (STAGE.md, "The input chain") ─────────────────────────────────

  // Where the look is, in the world and in keys: under lock (or a lock body under touch: pointer.js
  // looksFromEye), the eye ray's hit; else the pointer's (the last hover).
  let hoverHit = null; // { id: key, point, distance }
  function look() {
    return looksFromEye(atom.get().pointer) ? eyeHit() : pointed();
  }
  // The eye ray's hit (where the middle of the view is), or null.
  function eyeHit() {
    let h = null;
    try {
      const r = viewport.centerRay();
      h = r ? viewport.raycast(r.origin, r.dir) : null;
    } catch {
      h = null;
    }
    return h?.id ? { id: h.id, point: h.point ?? null, distance: h.distance ?? null } : null;
  }
  // The pointer's hit: the last hover, which every press sets to what it pressed first (the router), so under
  // lock the crosshair's and under touch the finger's. A menu is of this, not the look: a finger's long press
  // in a lock body names what it pressed, not what the eye looks at.
  function pointed() {
    const hovered = atom.get().hovered;
    if (hovered == null) return null;
    if (hoverHit && samePath(pathOfKey(hoverHit.id), hovered)) return hoverHit;
    const key = keyOfPath(hovered);
    return key != null ? { id: key, point: null, distance: null } : null;
  }

  // ─── the router ───────────────────────────────────────────────────────────

  let picking = false;
  // The widget under the pointer: the viewport's (meshes in world groups) and
  // every stage's extensions' widgetAt (and the view's plugins', in the focus
  // stage's frame); onTop beats the rest, else nearest.
  function pickWidget(ev) {
    if (picking) return null;
    picking = true;
    try {
      const out = [];
      if (ev?.x != null && ev?.y != null) {
        const w = viewport.pickWidget(ev.x, ev.y);
        if (w) out.push(w);
      }
      for (const s of acting()) out.push(...s.widgetsAt(ev, pluginsAt(s)));
      return bestWidget(out);
    } finally {
      picking = false;
    }
  }

  /**
   * The chain for an event (STAGE.md, "The input chain"): the widget's owner, then one
   * segment per stage on the hit's path, innermost first (each its holders,
   * nearest first, then its root's), out to the outermost whatever the
   * focus, then the view's plugins (hearing it in the focus stage's frame).
   * Owners are keys (stage, extension; a plugin's is the focus stage's).
   */
  function chainFor(ev) {
    const widget = ev.widget;
    const hit = ev.hit;
    const path = hit?.id != null ? pathOfKey(hit.id) : null;
    const order = [];
    const holders = new Map();
    const steps = new Map(); // key → which step offers it ("widget", "holder", "plugin": the route's)
    const won = widgetWins(widget, hit);
    if (won) order.push(widget.owner), steps.set(widget.owner, "widget");
    const on = path ? onPath(path) : [];
    for (const s of on.length ? on : [outermost()].filter(Boolean)) {
      const seg = s.segment(elementOf(path, s.path));
      for (const ext of seg.order) {
        const k = keyOf(s.n, ext);
        if (order.includes(k)) continue;
        order.push(k);
        holders.set(k, seg.holderOf(ext));
        steps.set(k, "holder");
      }
    }
    // then the view's plugins, wherever the hit is, hearing the focus stage's element of the path (null off it)
    const at = focusStage();
    for (const p of pluginsAt(at)) if (!order.includes(keyOf(at.n, p.id))) order.push(keyOf(at.n, p.id)), steps.set(keyOf(at.n, p.id), "plugin");
    return { order, holderOf: (k) => holders.get(k) ?? null, stepOf: (k) => steps.get(k) ?? null, path };
  }
  /** Who a router key names: { stage, ext } (a stage's extension, or at the focus a view plugin's chain step), { view: true, ext } (a view plugin's hand), or null (the view's own). */
  function ownerOfKey(key) {
    if (key == null) return null;
    const p = parseKey(key);
    if (p) return { stage: p.n, ext: p.id };
    const pre = viewKey("");
    return String(key).startsWith(pre) ? { view: true, ext: String(key).slice(pre.length) } : null;
  }
  /** The router's last routes (STAGE.md, "The input chain"), each step's owner as ownerOfKey says: plain and frozen. */
  function routes() {
    return Object.freeze(
      router.routes().map((r) =>
        Object.freeze({
          ...r,
          path: pathOf(r.path),
          steps: Object.freeze(r.steps.map(({ owner, ...st }) => Object.freeze({ ...st, ...(ownerOfKey(owner) ?? { ext: null }) }))),
        }),
      ),
    );
  }
  /**
   * The input path (STAGE.md, "Views, stages and links"): the stages from attention's innermost
   * out to the outermost (the selection's path, else the look's; `pointer: true`
   * the pointer's, what a menu is of), then the focus stage if it isn't among them, each as its
   * reader (stage.js). Nothing under attention: the outermost, and the focus.
   * The focus is always on it, since the scene a surface speaks of (its
   * commands on nothing: Frame all, Measure, Undo) is the focus's.
   * `focus: true` is the focus path instead: the focus stage out to the
   * outermost, whatever attention is (the toolbar's: it doesn't follow the
   * pointer).
   */
  function inputPath({ pointer = false, focus: focusOnly = false, at = null } = {}) {
    if (focusOnly) {
      const f = atom.get().focus;
      const out = [];
      for (let i = f.length; i >= 0; i--) {
        const s = stageAt(f.slice(0, i));
        if (s) out.push(readerOf(s));
      }
      return out;
    }
    // (`at`: a full path attention is held to, a held verb's target, whatever the selection and the look)
    const sel = Array.isArray(at) && at.length ? at : atom.get().selected;
    const l = pointer ? pointed() : sel ? null : look();
    const path = !pointer && sel ? sel : l?.id != null ? pathOfKey(l.id) : null;
    const on = path ? onPath(path) : [];
    const out = on.length ? on : [outermost()].filter(Boolean);
    const f = focusStage();
    if (f && !out.includes(f)) out.push(f);
    return out.map(readerOf);
  }
  /**
   * A stage's reader; the focus stage's with the view's plugins' commands
   * and other contributions after its extensions', run in its context
   * (STAGE.md, "View plugins").
   */
  function readerOf(s) {
    const r = s.reader;
    if (s !== focusStage()) return r;
    const mine = (name) => collectFrom(plugins.running(), name).map((x) => ({ ...x, stage: s.n }));
    return Object.freeze({ ...r, runs: (ext) => r.runs(ext) || !!plugins.instanceOf(ext), collect: (name) => [...r.collect(name), ...mine(name)], run });
  }
  /** What every acting stage offers as `name`: the input path's stages first, innermost first; each item tagged with its stage. */
  function collect(name) {
    const first = inputPath().map((r) => r.stage);
    const order = [...first, ...acting().map((s) => s.n).filter((x) => !first.includes(x))];
    return order.flatMap((x) => (stages.has(x) ? readerOf(stages.get(x)).collect(name) : []));
  }
  /** The stages that act on a path, innermost first, out to the outermost (a pin on it is passed over: it is drawn, never acted on). */
  function onPath(path) {
    const out = [];
    for (const s of stages.values()) if (s.acts && path.length > s.path.length && s.path.every((x, i) => x === path[i])) out.push(s);
    return out.sort((a, b) => b.path.length - a.path.length);
  }
  const inputOf = (key) => {
    const p = parseKey(key);
    const s = p ? stages.get(p.n) : null;
    return s?.inputOf(p.id) ?? (s === focusStage() ? s.framedInput(plugins.instanceOf(p.id)?.input) : undefined);
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
    base: { id: LOOK.id, lock: false, keys: [], input: {} },
    // a coarse pointer is touch until a press says otherwise (STAGE.md, "Bodies")
    touch: !!globalThis.matchMedia?.("(pointer: coarse)")?.matches,
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
    pointerWanted: () => atom.get().selected != null || pointerWants.size > 0,
    restLayer: restNow,
    escapeRest,
  });

  // The router's state as the view's fields. A field that didn't change keeps its value.
  function viewOfRouter(st, m) {
    const s = topSitting();
    const body =
      s && s.def.id === st.body.id
        ? Object.freeze({ id: s.def.id, label: String(s.sitting.label ?? s.def.label ?? s.def.id), ext: s.owner, depth: st.body.depth, lock: !!s.def.lock, reach: reachOf(s.def), keys: Object.freeze([...(s.sitting.keys ?? s.def.keys ?? [])]), serial: st.body.serial })
        : LOOK_LOCAL;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const hands = Object.freeze(st.hands.map((h) => Object.freeze({ ...h, keys: Object.freeze([...h.keys]) })));
    const held = Object.freeze(st.held.map((t) => Object.freeze({ ...t, keys: Object.freeze([...t.keys]) })));
    const pointer = Object.freeze({ ...st.pointer });
    const escape = Object.freeze({ layer: st.escape, hint: escapeHint(st.escape, { hand: st.hands.at(-1)?.name ?? null }) });
    return {
      body: same(m.body, body) ? m.body : body,
      hands: same(m.hands, hands) ? m.hands : hands,
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
      if (next.body !== prev.body || next.hands !== prev.hands) announce();
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
  // every stage says "hide" (its services let go) and bye; restored from the
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
    // the view's plugins first (their facets go with them), then the stages, innermost first
    plugins.dispose();
    for (const s of [...stages.values()].sort((a, b) => b.n - a.n)) s.dispose();
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

  // ─── the view's plugins (STAGE.md, "View plugins") ─────────────────────────

  // An event of the router's as a view plugin's hand hears it: in the world,
  // its hit also naming the path it is at (null: nothing, or something its
  // doc no longer has).
  const isEvent = (a) => !!a && typeof a === "object" && typeof a.type === "string" && "locked" in a;
  function hitPath(h) {
    const p = h?.id != null ? parseKey(h.id) : null;
    return p && stages.get(p.n)?.doc().objects?.[p.id] ? pathOfKey(h.id) : null;
  }
  function viewEvent(ev) {
    let hit;
    return Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(ev),
      hit: { enumerable: true, configurable: true, get: () => (hit !== undefined ? hit : (hit = ev.hit ? Object.freeze({ ...ev.hit, path: hitPath(ev.hit) }) : null)) },
    });
  }
  const viewInput = (input) =>
    new Proxy(input, {
      get(target, k) {
        const v = Reflect.get(target, k, target);
        return typeof v === "function" ? (...args) => v.apply(target, args.map((a) => (isEvent(a) ? viewEvent(a) : a))) : v;
      },
    });
  const getRegistry = (type) => patchworkPlugins.getRegistry(type) ?? null;
  /** What wants the pointer free (api.wantPointer: an open drawer). */
  const pointerWants = new Set();
  /** Acquire something while `live()`: `take` gives a give-back, kept in `bag`; → off, giving it back once. */
  const acquirer = (live) => (bag, take) => {
    if (!live()) return noop;
    const give = take();
    if (typeof give !== "function") return noop;
    bag.add(give);
    return () => {
      if (bag.delete(give)) give();
    };
  };
  /**
   * What the view lends an extension or a view plugin (`id`, its router key
   * `key`): overlays, edge parts, styles, listeners, its
   * cursor, popovers, frame hooks and timers. What it acquires goes in
   * `own` (`els`, `offs`, `frame`), given back as it stops; `stage` marks its
   * elements with the stage it is of.
   */
  function viewParts({ id, key, own, live, stage = null }) {
    const acquire = acquirer(live);
    /** A one-shot callback set through `set` (time.after or time.frame), cancelled if it stops first. */
    const timed = (set, fn) => {
      if (!live() || typeof fn !== "function") return noop;
      let cancel = null;
      const off = () => {
        if (own.offs.delete(off)) cancel();
      };
      cancel = set((...args) => {
        if (!own.offs.delete(off) || !live()) return;
        fn(...args);
      });
      own.offs.add(off);
      return off;
    };
    const add = (el, parent) => {
      el.dataset.owner = id;
      if (stage != null) el.dataset.stage = String(stage);
      if (!live()) return el;
      own.els.add(el);
      parent.append(el);
      return el;
    };
    const div = (className) => Object.assign(document.createElement("div"), { className });
    return {
      overlay: () => add(div("stage-overlay"), port),
      edge: (side) => add(div("stage-edge-part"), edges[EDGES.includes(side) ? side : "right"]),
      style: (text) => add(Object.assign(document.createElement("style"), { textContent: String(text ?? "") }), root),
      listen: (target, type, fn, opts) =>
        acquire(own.offs, () => {
          target.addEventListener(type, fn, opts);
          return () => target.removeEventListener(type, fn, opts);
        }),
      cursor: (name) => {
        if (live()) cursor(key, name);
      },
      /** an open menu or dialog: it wants the pointer, and Escape closes it (close()). → release, for when it closes itself */
      popover: (close) => (live() && typeof close === "function" ? acquire(own.offs, () => router.popover(key, close)) : noop),
      invalidate: () => viewport.invalidate(),
      /** fn(dt, now) every frame; `first`: before the others (what moves what they read) */
      loop: (fn, { first = false } = {}) => acquire(own.frame, () => viewport.addLoop(fn, { first })),
      afterRender: (fn) => acquire(own.frame, () => viewport.afterRender(fn)),
      /** the view's one time (./time.js): now() (ms), after(ms, fn) → cancel, frame(fn) → cancel */
      now: () => time.now(),
      after: (ms, fn) => timed((cb) => time.after(ms, cb), fn),
      frame: (fn) => timed((cb) => time.frame(cb), fn),
    };
  }

  /**
   * The api a view plugin gets, and release(): give back everything it
   * acquired (./host.js aborts its signal first and calls dispose()
   * after). What it acquires through it is the view's and lasts its whole
   * life; api.focus() is the focus stage's api for it, whose acquisitions go
   * with the focus (stage.js facetFor).
   */
  function makeApi(rec) {
    const { id, signal } = rec;
    const key = viewKey(id);
    const own = { offs: new Set(), frame: new Set(), cameraHolds: new Set(), hands: new Set(), els: new Set() };
    const live = () => !signal.aborted && !dead;
    const acquire = acquirer(live);
    let watched = atom.get();
    const api = {
      id,
      viewer,
      signal,
      /** this view's presence session (it changes on coming back from the back-forward cache) */
      get session() {
        return session;
      },
      repo,
      THREE,
      registry: getRegistry,
      /** the element the canvas fills, and the view's root (for DOM listeners: drops, paste, keys) */
      port,
      root,
      /** the view's url: the outermost doc's */
      url,
      /** the viewer's value, whole (the selection, hover and focus as paths, and each view plugin's own at its id); step(ev): a selection step (../selection.js) but enter; set(value): this plugin's own, view[id] */
      view: Object.freeze({
        get: () => atom.get(),
        watch: (fn, select) =>
          acquire(own.offs, () =>
            atom.watch(() => {
              const next = atom.get();
              const prev = watched;
              watched = next;
              if (next === prev) return;
              if (typeof select === "function" ? select(next) !== select(prev) : true) fn(next, prev);
            }),
          ),
        step: (ev) => (live() && ev?.type !== "enter" ? selectStep(ev) : false),
        set: (value) => void (live() && atom.swap((m) => (m[id] === value ? m : { ...m, [id]: value }))),
      }),
      /** every open doc's missing packages (view.packages): load them (a yes), or don't ask again in this view */
      packages,
      ...viewParts({ id, key, own, live }),
      /** the pointer wanted free (no lock) until release(): an open drawer. → release */
      wantPointer: () => acquire(own.offs, (t = {}) => (pointerWants.add(t), router.refresh(), () => (pointerWants.delete(t), router.refresh()))),
      /** run fn after the focus stage's next update flush (through its facet) */
      schedule: (fn) => api.focus()?.schedule(fn),
      // the camera and picking, in the world (the outermost's frame); a hit's `path` is where it is
      camera: Object.freeze({
        get: () => viewport.getCamera(),
        set: (cam) => viewport.setCamera(cam),
        frame: (box) => viewport.frame(box ?? null),
        hold: () => acquire(own.cameraHolds, () => viewport.hold()),
        watch: (fn) => acquire(own.offs, () => viewport.watchCamera(fn)),
        onEnd: (fn) => acquire(own.offs, () => viewport.onCameraEnd(fn)),
        /** has the camera been placed for this viewer: moved by them or restored as they opened the view? */
        touched: () => viewport.touched() || cameraPlaced,
      }),
      pick: (x, y, opts) => {
        const h = viewport.pick(x, y, opts);
        return h ? Object.freeze({ ...h, path: hitPath(h) }) : null;
      },
      ray: (x, y) => viewport.ray(x, y),
      project: (p) => viewport.project(p),
      // bodies and hands (STAGE.md, "Bodies", "Hands")
      body: Object.freeze({
        /** the top body: { id, label, ext, depth, lock, reach, keys } */
        current: () => atom.get().body,
        /** enter body `id` (the focus stage's own first) at `place`: false if none offers it or it can't */
        enter: (bid, place) => (live() ? enterBody(bid, place, focusStage()) : false),
        leave: () => (live() ? leaveBody() : false),
        /** the eye, in the world: { position, direction }, or null */
        eye: () => bodyEye(),
        reach: () => bodyReach(),
      }),
      /**
       * Put a hand on the stack ({ kind?, name, input, keys?, pointer?,
       * escape?() → boolean, escaping?() → layer | null, put?() }), hearing
       * events in the world (each hit's `path` where it is). → release
       */
      hand: (spec) => {
        if (!live() || !spec || typeof spec.name !== "string") return noop;
        const kind = typeof spec.kind === "string" && !KERNEL_KINDS.includes(spec.kind) ? spec.kind : "hand";
        const { name, keys, pointer, escape, escaping, put } = spec;
        return acquire(own.hands, () => router.pushHand(key, { kind, name, keys, pointer, escape, escaping, put, input: viewInput(spec.input ?? {}) }));
      },
      /** put a held tool down, whoever's it is, from wherever it is in the stack: `which` one of view.held's, else the topmost */
      putDown: (which) => (live() ? router.putDown(which ? { serial: which.serial, owner: which.ext, command: which.command } : undefined) : false),
      /** offer an event to the widget under it, as the chain does first, if the widget is nearer than the hit: did its owner take it? */
      offerWidget: (type, ev) => (live() && widgetWins(ev?.widget, ev?.hit) ? !!offer([ev.widget.owner], inputOf, type, ev) : false),
      // the stages (STAGE.md, "Views, stages and links")
      /** what every acting stage offers as `name`, the input path's first, each item tagged with its `stage` */
      collect: (name) => collect(name),
      /** run a command in the stage it names (else the focus's): { stage?, ext, command, target, value?, hit? } */
      run: (inv) => live() && run(inv),
      /**
       * the input path's stages, innermost first: each its reader { stage, path, scene, collect, context, attention, look, pointed, run, nameOf, writable, use }
       * (pointer: true for the pointer's path, what a menu is of; focus: true for the focus path, the focus stage out to the outermost; at: a full path, a held verb's target's)
       */
      path: (o) => inputPath(o),
      /** open a doc as a stage under an object of another ({ under: [stagePath, id], acting?, heads?, deps? }: openUnder) → close, its `reached` the docs its repo found; or null */
      open: (handle, o) => {
        const s = live() ? openUnder(handle, o) : null;
        return s ? Object.assign(acquire(own.offs, () => () => closeStage(s)), { reached: s.reached }) : null;
      },
      /** stages are still being opened: arriving waits for them until release() */
      opening: () => acquire(own.offs, (t = {}) => (opening.add(t), () => opening.delete(t))),
      /** the focus stage's api for this plugin (stage.js facetFor): its doc, scene, content, world layers… or null */
      focus: () => (live() ? (focusStage()?.facetFor(rec) ?? null) : null),
      /** a service (NATIVE.md, "Native services"): a view plugin's, else the focus stage's provider's */
      use: (name) => (live() ? (plugins.use(name, { id, signal }) ?? api.focus()?.use(name)) : null),
      /** the last events' routes through the input chain, oldest first (STAGE.md, "The input chain") */
      routes: () => routes(),
      /** hear every message every stage's channel sends or receives (presence.js tap), read-only → off */
      tap: (fn) => (live() && typeof fn === "function" ? acquire(own.offs, () => (taps.add(fn), () => taps.delete(fn))) : noop),
    };

    function release() {
      router.stopOwner(key);
      for (const bag of [own.hands, own.cameraHolds, own.frame]) {
        for (const give of [...bag]) give();
        bag.clear();
      }
      atom.swap((m) => (id in m ? (({ [id]: _, ...rest }) => rest)(m) : m));
      for (const el of own.els) el.remove();
      own.els.clear();
      for (const give of [...own.offs]) give();
      own.offs.clear();
      cursor(key, null);
      for (const s of stages.values()) s.dropFacets(id);
      router.refresh();
    }
    return { api, release };
  }

  // ─── the channel tap ──────────────────────────────────────────────────────
  // What view plugins hear through api.tap: each stage's channel's messages,
  // as presence.js says them, with the stage's number and doc. Nothing is
  // made of a message while nobody listens.
  const taps = new Set();
  const tapping = () => taps.size > 0;
  function tapSay(stage, url, e) {
    const said = Object.freeze({ stage, url, ...e });
    for (const fn of [...taps]) {
      try {
        fn(said);
      } catch (err) {
        console.warn("[scene] a channel tap failed", err);
      }
    }
  }

  /** Run a command in the stage it names, else the focus's; a view plugin's runs in the focus stage's context, a tool it holds held through its facet there. */
  function run(inv) {
    const s = inv?.stage != null ? stages.get(inv.stage) : focusStage();
    if (dead || !s?.acts) return false;
    const p = s === focusStage() ? plugins.record(inv.ext) : null;
    let c = null;
    try {
      c = p?.instance ? ((p.instance.commands ?? []).find((k) => k?.id === inv.command) ?? null) : null;
    } catch {
      c = null;
    }
    if (!c) return s.reader.run(inv);
    s.facetFor(p);
    return s.runCommand(inv.ext, c, inv);
  }
  /** The view's plugins at stage `s`: all of them when it is the focus, else none. */
  const pluginsAt = (s) => (s && s === focusStage() ? plugins.running() : []);
  // What the view's plugins were last told (host.js updateAll), afresh as the focus moves.
  let told = new WeakMap();
  /** A stage flushed: the view's plugins hear it when it is the focus (STAGE.md, "View plugins"). */
  function flushed(s, now, content) {
    if (!dead && s === focusStage()) updateAll(plugins.running(), told, now, content);
  }

  // (every one registered runs: only the registry starts or stops one)
  const plugins = createHost({
    registry: () => getRegistry("scene:view"),
    makeApi,
    setTimer: (fn, ms) => time.after(ms, fn),
    clearTimer: (cancel) => cancel?.(),
    wanted: (metas) => providersFirst(metas.filter((m) => m?.id).map((meta) => ({ id: meta.id, meta, scope: "view" }))),
    onChange: () => {
      if (dead) return;
      router.refresh();
      requestFlush();
    },
  });
  plugins.sync({});

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
    canvas,
    viewport,
    atom,
    router,
    get cameraPlaced() {
      return cameraPlaced;
    },
    restoreCamera,
    packages,
    packagesChanged,
    /** "Not now"'s packages, the view's: every stage's packages module shares it */
    declinedPackages,
    /** the view's plugins (./host.js); those at a stage (the focus: all), the focus stage's flush told them, what the view lends an extension or one of them */
    plugins,
    pluginsAt,
    flushed,
    acquirer,
    viewParts,
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
    routes,
    tapping,
    tapSay,
    pickWidget,
    requestFlush,
    // the viewer's
    select,
    selectStep,
    enter,
    leave,
    focusOn,
    stageAt,
    look,
    pointed,
    bodyDefs,
    bodyEye,
    bodyReach,
    enterBody,
    leaveBody,
    leaveBodiesOf,
    holdTool,
    cursor,
    arrive,
    tryArrive,
    stageUnder,
    /** what arriving still waits to enter (where view.start leads: its stage's number, body and place), for probes and tests */
    arriving: () => {
      if (!arrival) return null;
      const at = arrivalAt();
      return at ? { stage: at.stage.n, body: at.body, place: at.place, offered: arrival.offered } : { pending: at === undefined };
    },
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
