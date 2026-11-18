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
import { LOOK } from "./bodies.js";
import { collectFrom, createHost, updateAll } from "./host.js";
import { providersFirst } from "./activation.js";
import { focusSteps, selectionStep } from "../selection.js";
import { realTime } from "./time.js";
import { comparePaths, elementOf, keyOf, parseKey, pathOf, samePath, viewKey } from "./paths.js";
import { expand, identityOf, isLink } from "./links.js";
import { viewAt } from "../build.js";
import { unionPackages } from "../packages.js";
import { multiplyMatrices } from "../transform.js";

/** How many stages a view opens at most, nearest first (STAGE.md, "Views, stages and links": the budget is the view's). */
export const LINK_BUDGET = 64;

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
 * Where the doc starts people (STAGE.md, "Arriving"): `view.start = { body, place,
 * home, edit }`, read once on arrival. `body` is a body's id (none, or
 * "look", is Look), `place` what its enter is given (a spawn point's object
 * id, a seat's id), `home` the camera, `edit: true` that they start holding
 * the editor. Pure.
 * @returns {{ body: string | null, place: string | null, home: object | null, edit: boolean }}
 */
export function startOf(doc) {
  const s = doc?.view?.start;
  if (!s || typeof s !== "object") return { body: null, place: null, home: null, edit: false };
  const body = typeof s.body === "string" && s.body ? s.body : null;
  const place = typeof s.place === "string" && s.place ? s.place : null;
  return { body, place, home: cleanCamera(s.home), edit: s.edit === true };
}

/**
 * Where a start leads (STAGE.md, "Arriving"): from stage `s`, its doc's start; while
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

const NO_ESCAPE = Object.freeze({ layer: null, hint: "" });
// What Escape does with the focus at the outermost, where it is leaving a link: the top hand (the Edit hand, whose
// escape leaves) put down, else nothing.
const outermostEscape = (hands) => {
  const top = hands?.at(-1);
  return top ? Object.freeze({ layer: "hand", hint: escapeHint("hand", { hand: top.name }) }) : NO_ESCAPE;
};

/**
 * The view's value as one stage sees it (STAGE.md, "Views, stages and links"): the selection
 * and hover as its element of their paths, the body's and the held tool's
 * owner as its extension's id where they are its own (else the view's key,
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

  // ─── the view's atom ──────────────────────────────────────────────────────

  const cameraKey = `scene-camera:${url}`;
  const atom = createAtom({
    // paths (./paths.js), each stage seeing its own element
    hovered: null,
    selected: null,
    // the body on top of the stack (STAGE.md, "Bodies"); Look until arriving says otherwise
    body: LOOK_LOCAL,
    // what the viewer holds, top last (STAGE.md, "Hands"), and the held tool among them
    hands: Object.freeze([]),
    held: null,
    gesture: null,
    pointer: Object.freeze({ locked: false, lock: false, wanted: false, released: false, refused: false }),
    escape: Object.freeze({ layer: null, hint: "" }),
    theme: null,
    // the stage selection is scoped by (STAGE.md, "The input chain"): the outermost's ([]) until Enter moves it
    focus: Object.freeze([]),
    // every open doc's packages this viewer doesn't have (unionPackages): the packages prompt's
    packages: unionPackages([]),
    // how this viewer last arrived (arrive()): the outermost doc's start (startOf) as read, and a count
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
  // Who's here (STAGE.md, "Views, stages and links"): the viewer's body and top hand are the
  // view's, so the view says them on every channel it acts on, not a part on
  // the focus doc's: whoever has a doc open sees what a person at any
  // placement of it is doing (a viewer of the game alone sees the boat's
  // sailor seated at it). A drawn stage's channel only listens. An open menu
  // is nobody else's business: the hand under it is said.
  const announced = () => {
    const v = atom.get();
    const top = (v.hands ?? []).filter((h) => h.kind !== "popover").at(-1);
    return { body: { id: v.body?.id ?? LOOK.id, label: v.body?.label ?? LOOK.label }, held: top ? { name: top.name } : null };
  };
  function announce() {
    const a = announced();
    for (const s of stages.values()) s.announce(a);
  }
  function removeStage(s) {
    if (stages.get(s.n) === s) stages.delete(s.n);
    packagesChanged();
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
  // ─── links: the stages this view opens (STAGE.md, "Views, stages and links") ────────────────
  // The expansion (links.js) is a pure function of the link graph as the view
  // has it: worked out again whenever a stage's doc changes or a linked doc
  // arrives. Every occurrence that isn't closed gets a stage of its own, keyed
  // by its path: a live doc acts at the first of them (the rest are closed,
  // "repeat"); a pinned value is a read-only stage on its doc at those heads.
  // A stage whose occurrence changes role or identity closes, with
  // everything opened under it, and opens again. A closed link, or one whose
  // doc (or version) hasn't arrived, is drawn as its hint.
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
    // the linked docs shown live (a pin keeps its own version) are announced, and only those
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
    // the focus is a stage that acts: one whose link went, closed, or now pins its doc is left
    const focus = atom.get().focus;
    let keep = focus;
    while (keep.length && !stageAt(keep)) keep = keep.slice(0, -1);
    if (keep.length < focus.length) focusOn(keep);
    else placeFocus();
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
    return addStage((n) => openStage({ handle, view: api, n, path: o.path, frame, under: keyOf(parent.n, linkId), role: o.role, deps: o.deps }));
  }
  /** Is a linked doc still on its way: one being found, or acting with no stage open for it yet? */
  function linksPending() {
    for (const d of docs.values()) if (d.state === "loading") return true;
    return expansion.some((o) => o.role === "acting" && o.depth > 0 && !opened.has(pathKey(o.path)));
  }
  /** A link's state as the view has it ({ role: "acting" | "pinned" | "closed", open, reason? }: open, its doc is drawn, else its hint), by its path; null if it isn't one. */
  const linkState = (p) => linkStates.get(pathKey(p)) ?? null;
  /**
   * Where fixing the link at path `p` would fix it (STAGE.md, "Views, stages and links", "a pin
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

  /**
   * Where Enter on the link at path `p` goes: there, if its doc acts there;
   * else null (a pin is a value, a closed link has no stage).
   */
  function enterable(p) {
    const st = linkState(p);
    if (!st?.open || st.role !== "acting") return null;
    return stageAt(p) ? pathOf(p) : null;
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

  /** The view's plugins' facets are the focus stage's (STAGE.md, "View plugins"): every other stage lets its go. */
  function placeFocus() {
    const at = focusStage();
    for (const s of stages.values()) if (s !== at) s.dropFacets();
  }
  /**
   * The focus moved: a tool held from a stage it left behind is put down,
   * the view's plugins' facets of the stages it left go (they are told the
   * new focus stage afresh), and the trail shows where it is.
   */
  function focusMoved() {
    if (dead) return;
    const held = router?.held();
    const p = held ? parseKey(held.owner) : null;
    const s = p ? stages.get(p.n) : null;
    // (a stage on the focus path is one whose path the focus starts with)
    if (s && !(s.path.length <= atom.get().focus.length && s.path.every((x, i) => x === atom.get().focus[i]))) router.putDown();
    placeFocus();
    told = new WeakMap();
    showTrail();
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

  // ─── the trail: where the focus is (STAGE.md, "The interface"'s breadcrumb) ─────────────
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
    const focus = atom.get().focus;
    const names = [];
    for (let i = 0; i <= focus.length; i++) names.push(nameAt(focus.slice(0, i)));
    const key = focus.length ? JSON.stringify(names) : "";
    if (key === trailKey) return;
    trailKey = key;
    // (the view's plugins hear it: the clock chips name their docs as the trail does)
    told = new WeakMap();
    requestFlush();
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

  /** Hold a tool for an extension of a stage: its declaration ({ command?, name, keys, pointer }) and its input (already the stage's). */
  function holdTool(owner, t, input) {
    if (!router) return noop;
    return router.hold(owner, { command: t.command ?? null, name: String(t.name ?? t.command ?? owner), input, keys: Array.isArray(t.keys) ? t.keys : [], pointer: !!t.pointer });
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
    // what the start says beyond a body and a place (`edit`: the editor picks itself up) is the view plugins' to read
    atom.swap((m) => ({ ...m, arrived: Object.freeze({ start: Object.freeze(startOf(outermost().doc())), n: ++arrivals }) }));
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
    // then the view's plugins, wherever the hit is, hearing the focus stage's element of the path (null off it)
    const at = focusStage();
    for (const p of pluginsAt(at)) if (!order.includes(keyOf(at.n, p.id))) order.push(keyOf(at.n, p.id));
    return { order, holderOf: (k) => holders.get(k) ?? null };
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
    const hands = Object.freeze(st.hands.map((h) => Object.freeze({ ...h })));
    const held = st.held ? Object.freeze({ ...st.held }) : null;
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
        const kind = typeof spec.kind === "string" && !["tool", "popover"].includes(spec.kind) ? spec.kind : "hand";
        return acquire(own.hands, () => router.pushHand(key, { ...spec, kind, input: viewInput(spec.input ?? {}) }));
      },
      /** put the held tool down, whoever's it is */
      putDown: () => (live() ? router.putDown() : false),
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
      /** the focus stage's api for this plugin (stage.js facetFor): its doc, scene, content, world layers… or null */
      focus: () => (live() ? (focusStage()?.facetFor(rec) ?? null) : null),
      /** a service (STAGE.md, "Native services"): a view plugin's, else the focus stage's provider's */
      use: (name) => (live() ? (plugins.use(name, { id, signal }) ?? api.focus()?.use(name)) : null),
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
    pickWidget,
    requestFlush,
    // the viewer's
    select,
    selectStep,
    enter,
    leave,
    focusOn,
    enterable,
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
