// patchwork:tool "scene", rebuilt as a stage (STAGE.md): the doc, loading and
// building object content, rendering, picking, the camera rig, drawing
// layers, the input router, presence and lenses, and nothing else. It has no
// UI of its own and no opinion about what a click means: everything a person
// sees or does beyond a rendered scene and an orbiting camera comes from a
// `scene:extension`, which gets an api (makeApi below) and is started and
// stopped by the host (host.js).
//
// The parts, in the order they're wired:
//   - the mount: four edges around a port (a CSS grid; an empty edge takes no
//     room). The port holds the viewport's canvas and labels, and the
//     extensions' overlays. The root is focusable and hears the keys.
//   - local state (atom.js): one frozen value shared by the stage and every
//     extension; prefs are kept per scene in localStorage. What this viewer
//     is doing (local.activity) is not kept: joining starts where the doc says.
//   - the viewport, its theme, and the camera (this viewer's, in localStorage).
//   - content: the render manager (render-doc objects) and the GLB queue
//     (passthrough objects), their state → local.status.
//   - presence, and other views' pose holds shown on the viewport.
//   - the host, and the api each extension gets (everything it acquires is
//     its own and is given back when it stops, in the STAGE.md order).
//   - the router (router.js): DOM input → events, down the chain.
//   - the doc loop: derive, the running set, display and content; then the
//     update flush (once per UI pass): each instance's update(), scheduled
//     work, lenses, atmosphere.

import css from "./stage.css?inline";
import * as THREE from "three";
import { Counter } from "@automerge/automerge";
import { Viewport } from "./viewport.js";
import { createAtom, assoc } from "./atom.js";
import { createHost } from "./host.js";
import { createRouter } from "./router.js";
import { createPresence } from "./presence.js";
import { DEFAULT_ACTIVITY, traitKeys } from "./activation.js";
import { chainOrder, holdersFor } from "./chain.js";
import * as ops from "../ops.js";
import { createRenderManager } from "../render-manager.js";
import { createGLBQueue, isLoadingPhase } from "../glb-queue.js";
import { newRenderDoc } from "../datatype.js";
import { atKey, defaultParams } from "../staleness.js";
import { describeForHumans, describeSource, matchProviders } from "../providers.js";
import { parseAutomergeLink, parseAutomergeUrl } from "../dnd.js";
import { resolveParents, treeOrder, worldMatrix } from "../hierarchy.js";
import { groupChain, inheritedDisplay, isGroup, outlineParents, resolveGroups } from "../groups.js";
import { CONTEXT_CHANGED_EVENT, CONTEXT_EVENT, REBUILD_EVENT } from "../controls-tool.js";
import { fileBytes } from "../file-content.js";
import { applyMatrix, invertMatrix, normalizeTransform } from "../transform.js";

/** Load priority for anything an extension asked to see first (api.focus). */
const FOCUS_PRIORITY = 1e12;
/** How long after the orbit stops the camera is saved. */
const CAMERA_SAVE_MS = 500;
/** How long a notice stays in local.notices. */
const NOTICE_MS = 6_000;
// Doc and local changes reach the extensions at once while that has cost
// little this frame (UI_PASSES passes, UI_BUDGET_MS in all), so a click or a
// single remote edit answers immediately; past that, the rest of a burst is
// coalesced into one pass per frame. (tool.js did the same for its panels.)
const UI_BUDGET_MS = 4;
const UI_PASSES = 3;
const EDGES = ["top", "right", "bottom", "left"];

const noop = () => {};
const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
const now = () => globalThis.performance?.now?.() ?? Date.now();
const IDENTITY = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });

// ─── pure helpers (exported for tests) ──────────────────────────────────────

/** An infoUrl / sourceUrl that is really an automerge URL, else null. */
export function docUrl(v) {
  return typeof v === "string" && v.startsWith("automerge:") ? parseAutomergeUrl(v) : null;
}

/** Everything applyDisplay reads, as one string: an object is re-applied only when this changes. */
export function displayKey(o, parent, inh) {
  const t = o.transform ?? {};
  return `${o.kind === "group" ? "g" : "o"}|${o.visible !== false}|${o.color ?? ""}|${o.opacity ?? 1}|${!!o.wireframe}|${!!o.locked}|${o.tags ?? ""}|${t.position}|${t.rotation}|${t.scale}|${parent ?? ""}|${inh?.visible}|${inh?.opacity}`;
}

/** How big an object's hint says it is (bigger loads first). */
export function hintVolume(o) {
  const b = o?.hint?.bounds;
  if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return 0;
  const v = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * The hit chain (STAGE.md, step 4): the hit object, then what it's attached
 * to (nearest first), then its groups (nearest first).
 * @param {string} id  @param {Map} parents  resolveParents  @param {Map} groups  resolveGroups
 * @returns {string[]}
 */
export function hitChain(id, parents, groups, objects = null) {
  if (id == null) return [];
  const up = [];
  const seen = new Set([id]);
  for (let p = parents.get(id); p != null && !seen.has(p); p = parents.get(p)) {
    seen.add(p);
    up.push(p);
  }
  return [id, ...up, ...groupChain(groups, id).filter((g) => !objects || objects[g])];
}

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

/**
 * Lenses stacked in running order: per object, each lens's fields over the
 * earlier ones' (a field it leaves undefined is kept). References to objects
 * that aren't there are dropped.
 * @param {Iterable<Map<string, object> | Iterable<[string, object]>>} lenses
 * @param {object} objects
 * @returns {Map<string, { sourceUrl?, name? }>}
 */
export function mergeLooks(lenses, objects) {
  const out = new Map();
  for (const lens of lenses) {
    if (!lens) continue;
    for (const [id, look] of lens) {
      if (!objects?.[id] || !look || typeof look !== "object") continue;
      const next = { ...(out.get(id) ?? {}) };
      for (const [k, v] of Object.entries(look)) if (v !== undefined) next[k] = v;
      out.set(id, next);
    }
  }
  return out;
}

/**
 * Atmospheres stacked in running order, as lenses are: each one's fields
 * (sky, fog, sun, exposure) over the earlier ones', a field left undefined
 * kept, null clearing it. A field's value is taken whole (one sky, not a top
 * from here and a horizon from there). null when nothing is left.
 * @param {Iterable<object | null>} list
 * @returns {{ sky?, fog?, sun?, exposure? } | null}
 */
export function mergeAtmosphere(list) {
  const out = {};
  for (const a of list ?? []) {
    if (!a || typeof a !== "object") continue;
    for (const k of ["sky", "fog", "sun", "exposure"]) if (a[k] !== undefined) out[k] = a[k];
  }
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return Object.keys(out).length ? out : null;
}

/** A stable key for a lens map, to tell whether it changed. */
export function looksKey(looks) {
  return JSON.stringify([...looks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Are two transforms the same pose, number by number (within eps)? */
export function sameTransform(a, b, eps = 1e-6) {
  if (!a || !b) return false;
  const x = normalizeTransform(a);
  const y = normalizeTransform(b);
  const close = (p, q) => Math.abs(p - q) <= eps;
  return x.position.every((v, i) => close(v, y.position[i])) && x.rotation.every((v, i) => close(v, y.rotation[i])) && close(x.scale, y.scale);
}

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
 * Where the camera starts (STAGE.md, "Saving"): this viewer's saved camera,
 * else the doc's suggested home, else null
 * (a frame extension frames on first content).
 */
export function initialCamera({ stored = null, doc = null } = {}) {
  return cleanCamera(stored) ?? cleanCamera(doc?.view?.home) ?? null;
}

function contestedText(s) {
  return s.olderHost
    ? "A collaborator running an older version of the scene tool rebuilt this with their own provider, so it isn't what this version builds. Ask them to reload Patchwork; Rebuild to put this version's build back (their old version may rebuild over it again until they reload)."
    : "A collaborator built it differently (another provider version, or linked documents at other versions); Rebuild to use yours";
}

/**
 * An object's load and build state, for local.status: { state, reason?, text,
 * title }, or null when there's nothing to say (loaded, or not asked for
 * yet). `text` and `title` are for people; a stale state's `reason` ("deps",
 * "contested", "pinned", "out-of-date") is what code branches on.
 * @param {object} o  the object  @param {object} s  what the render manager or GLB queue last said
 */
export function statusOf(o, s) {
  if (!o || isGroup(o) || !s) return null;
  if (s.passthrough) {
    if (s.phase === "error") return { state: "error", text: "error", title: s.error };
    if (s.parseError) return { state: "error", text: "error", title: s.parseError };
    if (isLoadingPhase(s.phase)) return { state: "loading", text: "loading", title: "Loading…" };
    return null;
  }
  if (s.phase === "no-provider") return { state: "warn", text: "no provider", title: `Provider “${s.providerId}” is not installed` };
  if (s.phase === "error") return { state: "error", text: "error", title: s.error };
  if (s.building || s.status === "building") return { state: "building", text: "building", title: "Rebuilding…" };
  if (s.status === "error") return { state: "error", text: "error", title: s.retryAt ? `${s.error} · retrying automatically` : s.error };
  if (s.glbError || s.parseError) return { state: "error", text: "error", title: s.glbError || s.parseError };
  if (s.stale && s.depsUnavailable?.length) return { state: "stale", reason: "deps", text: "stale", title: "Built from a linked document that can't be loaded here; Rebuild to build without it" };
  if (s.stale && s.contested) return { state: "stale", reason: "contested", text: "stale", title: contestedText(s) };
  if (s.stale) return { state: "stale", reason: s.pinned ? "pinned" : "out-of-date", text: s.pinned ? "pinned" : "stale", title: s.pinned ? "Out of date; pinned, so it won't rebuild on its own" : "Out of date; rebuilding soon" };
  if (s.phase === "loading" || (!s.hasGLB && s.phase !== "ready")) return { state: "loading", text: "loading", title: "Loading…" };
  return null;
}

/** A small ring buffer of durations (ms), for __sceneDebug. */
function timings(size = 400) {
  const buf = [];
  let total = 0;
  return {
    add(v) {
      total++;
      buf.push(v);
      if (buf.length > size) buf.shift();
    },
    values: () => [...buf],
    get total() {
      return total;
    },
  };
}

/** This browser's own viewer id, kept in localStorage (a fresh one each time if that's unavailable). */
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

function readJSON(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // private window, or full: this viewer's choice lasts the session
  }
}

/** A viewer's prefs as stored: a plain object. */
export function cleanPrefs(v) {
  return Object.freeze(v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {});
}

// ─── the tool ───────────────────────────────────────────────────────────────

/**
 * The patchwork:tool render function: mount the stage for a scene doc.
 * @param {object} handle  the scene's DocHandle
 * @param {HTMLElement} element  where to mount (element.repo, element.viewerId optional)
 * @returns {() => void} cleanup
 */
export default function Stage(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const sceneUrl = handle.url ?? "scene";
  let dead = false;
  const cleanups = [];
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const perf = { sync: timings(), flush: timings() };

  // ─── the mount ────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = css;
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
  element.append(style, root);

  const doc = () => handle.doc() ?? {};
  // Who is looking (extensions' business: seats, say): the account's contact,
  // else this browser's own id. (element.viewerId lets a probe put two viewers on one page.)
  const viewer = element.viewerId ?? globalThis.accountDocHandle?.doc?.()?.contactUrl ?? localViewer();

  // ─── local state ──────────────────────────────────────────────────────────

  const prefsKey = `scene-prefs:${sceneUrl}`;
  const cameraKey = `scene-camera:${sceneUrl}`;
  const local = createAtom({
    hovered: null,
    armed: null,
    immersive: false,
    running: Object.freeze([]),
    status: Object.freeze({}),
    theme: null,
    notices: Object.freeze([]),
    // this viewer's activity: null until the host has the doc and starts them where it says
    activity: null,
    activities: Object.freeze({ current: DEFAULT_ACTIVITY, available: Object.freeze([DEFAULT_ACTIVITY]) }),
    prefs: cleanPrefs(readJSON(prefsKey)),
  });

  // Another tab of this viewer changed its prefs for this scene: take theirs,
  // so neither tab writes back a stale copy over the other's choice.
  const onStorage = (e) => {
    if (e.key !== prefsKey) return;
    const next = cleanPrefs(readJSON(prefsKey));
    local.swap((m) => (JSON.stringify(m.prefs) === JSON.stringify(next) ? m : { ...m, prefs: next }));
  };
  globalThis.addEventListener?.("storage", onStorage);
  cleanups.push(() => globalThis.removeEventListener?.("storage", onStorage));

  // ─── the viewport ─────────────────────────────────────────────────────────

  const viewport = new Viewport({ port, themeRoot: root });
  local.swap(assoc("theme", viewport.theme));
  cleanups.push(viewport.onTheme((t) => local.swap(assoc("theme", t))));
  // Without WebGL there's still a canvas-sized element for the router, so
  // keys, overlays and widgetAt keep working (and tests can press on it).
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

  // The camera is this viewer's: from localStorage, else the doc's home, else
  // left for a frame extension.
  let cameraRestored = false;
  {
    const cam = initialCamera({ stored: readJSON(cameraKey), doc: doc() });
    if (cam && viewport.ok) {
      viewport.setCamera(cam);
      cameraRestored = true;
    }
  }
  let cameraTimer = null;
  cleanups.push(
    viewport.onCameraEnd(() => {
      clearTimeout(cameraTimer);
      cameraTimer = setTimeout(() => {
        cameraTimer = null;
        if (dead || viewport.held) return;
        const cam = cleanCamera(viewport.getCamera());
        if (cam) writeJSON(cameraKey, cam);
      }, CAMERA_SAVE_MS);
    }),
  );

  // ─── the plugin registry ──────────────────────────────────────────────────

  let sourceRegistry = null;
  const plugins = import("@inkandswitch/patchwork-plugins")
    .then((m) => {
      if (dead) return m;
      sourceRegistry = m.getRegistry?.("scene:source") ?? null;
      const off = sourceRegistry?.on?.("changed", () => manager.providersChanged());
      if (typeof off === "function") cleanups.push(off);
      return m;
    })
    .catch((err) => {
      console.warn("[scene] plugin registry unavailable", err);
      return null;
    });
  const getRegistry = async (type) => (await plugins)?.getRegistry?.(type) ?? null;

  const listProviders = () => {
    try {
      return sourceRegistry?.filter?.(() => true) ?? [];
    } catch {
      return [];
    }
  };

  async function loadProvider(id) {
    await plugins;
    if (!sourceRegistry?.has?.(id)) return null;
    const p = await sourceRegistry.load(id);
    if (!p?.module) return null;
    return { id, name: p.name ?? id, params: p.params ?? [], cost: p.cost, version: p.version, module: p.module };
  }

  // ─── derived structure, once per doc snapshot ─────────────────────────────

  let model = null;
  function derive() {
    const d = doc();
    if (model && model.d === d) return model;
    const objects = d.objects ?? {};
    const ids = ops.orderedIds(d);
    // Merged cycles are broken here, for reading (resolveParents and
    // resolveGroups pick the same edge on every peer); the ops repair them in
    // the doc on the next structural write.
    const parents = resolveParents(objects);
    const groups = resolveGroups(objects);
    const outline = outlineParents(objects, parents, groups);
    // who is in each group (at any depth): the viewport boxes and frames them
    const members = new Map();
    for (const id of Object.keys(objects)) {
      if (isGroup(objects[id])) {
        if (!members.has(id)) members.set(id, []);
        continue;
      }
      for (const g of groupChain(groups, id)) {
        if (!members.has(g)) members.set(g, []);
        members.get(g).push(id);
      }
    }
    model = {
      d,
      objects,
      ids,
      parents,
      groups,
      inherited: inheritedDisplay(objects, outline),
      attachOrder: treeOrder(objects, ids, parents),
      members,
      snapshot: null,
    };
    return model;
  }

  /** The snapshot extensions read (STAGE.md, `scene()`), one per doc. */
  function scene() {
    const m = derive();
    if (!m.snapshot) {
      const worlds = new Map();
      const world = (id) => {
        let w = worlds.get(id);
        if (!w) worlds.set(id, (w = worldMatrix(m.objects, id, m.parents)));
        return w;
      };
      const inverses = new Map();
      const toLocal = (id, p) => {
        let inv = inverses.get(id);
        if (inv === undefined) inverses.set(id, (inv = invertMatrix(world(id))));
        return inv ? applyMatrix(inv, p) : null;
      };
      m.snapshot = Object.freeze({ d: m.d, objects: m.objects, ids: m.ids, parents: m.parents, groups: m.groups, members: m.members, traits: m.d.traits ?? {}, world, toLocal });
    }
    return m.snapshot;
  }

  // ─── content: render docs and passthrough GLBs ────────────────────────────

  const objState = new Map(); // id → what the manager or the queue last said
  const displayKeys = new Map(); // id → displayKey last applied
  const hintKeys = new Map(); // id → hint bounds last given to the viewport
  // render docs this scene made itself, this session: nothing to wait to sync before building
  const createdHere = new Set();
  const atKeys = new Map(); // render url → atKey of its object's `at`, for the embedded controls
  let statusDirty = false;
  let contentDirty = false;
  const focusBy = new Map(); // extension id → Set of object ids it wants first

  function statusChanged() {
    statusDirty = true;
    requestFlush();
  }

  function afterGLB() {
    contentDirty = true;
    requestFlush();
  }

  // What's shown changed without the doc or local state changing (a pose
  // held or let go, a lens): every extension's update runs again, with the
  // same scene and local, as after a GLB arrives.
  function displayChanged() {
    contentDirty = true;
    requestFlush();
  }

  const manager = createRenderManager({
    repo,
    loadProvider,
    onState: (id, s) => {
      const before = objState.get(id)?.bounds;
      objState.set(id, s);
      // a render doc's own bounds stand in until its GLB loads (unless the scene has a hint)
      if (String(before?.min) + String(before?.max) !== String(s.bounds?.min) + String(s.bounds?.max)) {
        const o = doc()?.objects?.[id];
        if (o && !isGroup(o) && !o.hint?.bounds) applyHint(id, s.bounds);
      }
      statusChanged();
    },
    onGLB: async (id, bytes) => {
      try {
        await viewport.setGLB(id, bytes);
        if (dead) return;
        objState.set(id, { ...(objState.get(id) ?? {}), parseError: null });
      } catch (err) {
        console.warn("[scene] GLB failed to parse", err);
        objState.set(id, { ...(objState.get(id) ?? {}), parseError: `GLB failed to load: ${err?.message ?? err}` });
      }
      statusChanged();
      afterGLB();
    },
  });

  const queue = createGLBQueue({
    find: (url) => repo.find(url),
    read: (h) => fileBytes(h.doc()),
    parse: async (id, bytes) => {
      try {
        await viewport.setGLB(id, bytes);
      } catch (err) {
        console.warn("[scene] GLB failed to parse", err);
        throw new Error(`GLB failed to load: ${err?.message ?? err}`);
      }
      if (!dead) afterGLB();
    },
    onState: (id, st) => {
      objState.set(id, { passthrough: true, phase: st.phase, error: st.error });
      statusChanged();
    },
  });

  const focused = (id) => {
    for (const s of focusBy.values()) if (s.has(id)) return true;
    return false;
  };
  const priorityOf = (id, o) => (focused(id) ? FOCUS_PRIORITY : hintVolume(o));

  // ─── lenses ───────────────────────────────────────────────────────────────

  let looks = new Map(); // id → { sourceUrl?, name? }: what this viewer sees instead
  let lastLooksKey = "[]";
  let atmosphere = null; // the running extensions' atmosphere, merged (mergeAtmosphere)
  let lastAtmosphereKey = "null";
  const nameOf = (id) => looks.get(id)?.name ?? derive().objects[id]?.name ?? null;

  // ─── the doc → the viewport ───────────────────────────────────────────────

  /** Give the viewport a placeholder box (only when it changed); true if there is one. */
  function applyHint(id, b) {
    const hk = b ? `${b.min}|${b.max}` : "";
    if (hintKeys.get(id) !== hk) {
      hintKeys.set(id, hk);
      viewport.setHint(id, b ?? null);
    }
    return !!hk;
  }

  // The embedded build controls (controls-tool.js) judge staleness themselves,
  // against the object's `at`, which they ask for with CONTEXT_EVENT (below).
  // When an object is fixed, refixed or let go, tell them to ask again.
  let contextQueued = false;
  function noteAt(o) {
    const key = atKey(o.at);
    const was = atKeys.get(o.renderUrl);
    atKeys.set(o.renderUrl, key);
    if (was === undefined || was === key || contextQueued) return;
    contextQueued = true;
    queueMicrotask(() => {
      contextQueued = false;
      if (dead) return;
      for (const c of root.querySelectorAll(".scene-render-controls")) c.dispatchEvent(new CustomEvent(CONTEXT_CHANGED_EVENT));
    });
  }

  /** What the manager tracks an object with: its docs, whether this scene made the render, and its fixed version. */
  const trackSpec = (o) => ({ sourceUrl: o.sourceUrl, renderUrl: o.renderUrl, createdHere: createdHere.has(o.renderUrl), at: o.at ?? null });

  // Display state, then hydration: only what is shown is loaded, and once
  // loaded it stays loaded. Parents before children (attachment order), so
  // each object's new parent is already in place when it's attached to it.
  function applyDoc(m) {
    const { d, objects, parents, attachOrder, inherited } = m;
    viewport.setMaterialRules(d.materialRules);
    viewport.setGroups(m.members);
    const tracked = new Set(manager.ids());
    for (const { id } of attachOrder) {
      const o = objects[id];
      const parent = parents.get(id) ?? null;
      const inh = inherited.get(id);
      if (isGroup(o)) {
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        continue;
      }
      // placed even without geometry, so whatever is attached to it sits right
      const key = displayKey(o, parent, inh);
      if (displayKeys.get(id) !== key) {
        displayKeys.set(id, key);
        viewport.applyDisplay(id, o, parent, inh);
      }
      const shown = o.visible !== false && inh.visible;
      if (o.renderUrl) {
        queue.remove(id);
        applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
        // hydrate only what is shown; once loaded it stays loaded
        if (o.sourceUrl && (shown || tracked.has(id))) manager.track(id, trackSpec(o));
        noteAt(o);
        continue;
      }
      // what this viewer sees: a lens's source, or the object's own
      const src = docUrl(looks.get(id)?.sourceUrl ?? o.sourceUrl);
      if (!src) continue;
      if (tracked.has(id)) manager.untrack(id);
      applyHint(id, o.hint?.bounds);
      if (shown) queue.ensure(id, src, priorityOf(id, o));
      else if (queue.cancel(id)) {
        // dropped before it loaded: "not asked for" again, not loading or failing
        objState.delete(id);
        statusDirty = true;
      }
    }
    for (const id of new Set([...tracked, ...viewport.objects.keys(), ...queue.ids(), ...displayKeys.keys()])) {
      if (objects[id]) continue;
      manager.untrack(id);
      queue.remove(id);
      viewport.removeObject(id);
      if (objState.delete(id)) statusDirty = true;
      displayKeys.delete(id);
      hintKeys.delete(id);
      remotePosed.delete(id);
    }
  }

  // ─── presence ─────────────────────────────────────────────────────────────

  const presence = createPresence({ handle, viewer });
  const localHolds = new Map(); // object id → the extension holding its pose here
  const remotePosed = new Set(); // object ids showing another view's pose

  // Another view's hold, shown here while its parent is the doc's parent; a
  // landed hold until the doc shows the same transform. Our own hold wins.
  function applyRemoteHold(id) {
    if (dead || localHolds.has(id)) return;
    const h = presence.remoteHolds().get(id);
    const m = derive();
    const o = m.objects[id];
    let t = null;
    if (h && o && (m.parents.get(id) ?? null) === (h.parent ?? null)) {
      if (h.landed) {
        if (sameTransform(o.transform, h.landed)) return void presence.settle(id); // its watcher puts the doc's back
        t = h.landed;
      } else t = h.transform;
    }
    if (t) {
      viewport.setPose(id, t);
      remotePosed.add(id);
    } else if (remotePosed.delete(id)) viewport.setPose(id, null);
    else return;
    displayChanged();
  }
  cleanups.push(presence.watchHolds((_holds, ids) => ids.forEach(applyRemoteHold)));
  cleanups.push(
    presence.onReceive((ext, kind, data, from) => {
      const x = host.instanceOf(ext);
      if (typeof x?.receive !== "function") return;
      try {
        x.receive(kind, data, from);
      } catch (err) {
        console.warn(`[scene] extension “${ext}”: receive failed`, err);
      }
    }),
  );

  function holdPose(extId, own, id, transform) {
    const m = derive();
    if (!m.objects[id] || isGroup(m.objects[id])) return;
    const t = normalizeTransform(transform);
    const was = localHolds.get(id);
    if (was && was !== extId) owned.get(was)?.holds.delete(id);
    localHolds.set(id, extId);
    own.holds.add(id);
    remotePosed.delete(id);
    presence.hold(extId, id, m.parents.get(id) ?? null, t);
    viewport.setPose(id, t);
    displayChanged();
  }

  function releasePose(extId, own, id, landed) {
    if (localHolds.get(id) !== extId) return;
    localHolds.delete(id);
    own.holds.delete(id);
    const t = landed ? doc().objects?.[id]?.transform : null;
    presence.release(extId, id, t ? JSON.parse(JSON.stringify(normalizeTransform(t))) : undefined);
    viewport.setPose(id, null);
    applyRemoteHold(id);
    displayChanged();
  }

  // ─── the update flush ─────────────────────────────────────────────────────

  const raf = globalThis.requestAnimationFrame ? (f) => globalThis.requestAnimationFrame(f) : (f) => setTimeout(f, 16);
  const caf = globalThis.cancelAnimationFrame ? (h) => globalThis.cancelAnimationFrame(h) : (h) => clearTimeout(h);
  let flushQueued = false;
  let flushFrame = null;
  let uiSpent = 0;
  let uiPasses = 0;
  let uiResetReq = null;
  const seen = new WeakMap(); // instance → { scene, local } it last updated with
  let scheduled = []; // [{ rec, fn }] (api.schedule)

  function spend(ms) {
    uiSpent += ms;
    uiPasses++;
    if (uiResetReq == null)
      uiResetReq = raf(() => {
        uiResetReq = null;
        uiSpent = 0;
        uiPasses = 0;
      });
  }
  const uiFree = () => uiSpent < UI_BUDGET_MS && uiPasses < UI_PASSES;

  function requestFlush() {
    if (dead || flushQueued) return;
    flushQueued = true;
    if (uiFree()) queueMicrotask(flush);
    else flushFrame = raf(flush);
  }

  function flush() {
    flushFrame = null;
    if (!flushQueued || dead) return;
    flushQueued = false;
    const t0 = now();
    if (statusDirty) {
      statusDirty = false;
      const objects = derive().objects;
      const next = {};
      for (const [id, s] of objState) {
        const st = statusOf(objects[id], s);
        if (st) next[id] = Object.freeze(st);
      }
      if (JSON.stringify(next) !== JSON.stringify(local.get().status)) local.swap(assoc("status", Object.freeze(next)));
    }
    const snap = scene();
    const loc = local.get();
    const content = contentDirty;
    contentDirty = false;
    const running = host.instances();
    for (const r of running) {
      const was = seen.get(r.instance);
      const changed = !was || was.scene !== snap || was.local !== loc;
      if (!changed && !content) continue;
      seen.set(r.instance, { scene: snap, local: loc });
      if (typeof r.instance.update !== "function") continue;
      try {
        r.instance.update(snap, loc, was ?? { scene: null, local: null });
        // What's shown changed in the same flush as the doc or local state
        // (a rebuilt GLB lands with its status going back to idle): say so
        // too, the one way the contract has (prev === this scene and local),
        // or a part that skips a status-only change never sees the new box.
        if (content && changed && was) r.instance.update(snap, loc, { scene: snap, local: loc });
      } catch (err) {
        console.warn(`[scene] extension “${r.id}”: update failed`, err);
      }
    }
    const work = scheduled;
    scheduled = [];
    for (const { rec, fn } of work) {
      if (rec.signal?.aborted) continue;
      try {
        fn();
      } catch (err) {
        console.warn(`[scene] extension “${rec.id}”: scheduled work failed`, err);
      }
    }
    // lenses, stacked in running order; a new source means loading again
    const m = derive();
    const next = mergeLooks(
      running.map((r) => {
        try {
          return r.instance.looks?.() ?? null;
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: looks failed`, err);
          return null;
        }
      }),
      m.objects,
    );
    const key = looksKey(next);
    if (key !== lastLooksKey) {
      lastLooksKey = key;
      looks = next;
      applyDoc(m);
      // names through a lens changed: let every extension read them again
      displayChanged();
    }
    // the atmosphere, stacked the same way; the viewport hears only a change
    const atm = mergeAtmosphere(
      running.map((r) => {
        try {
          return r.instance.atmosphere?.() ?? null;
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: atmosphere failed`, err);
          return null;
        }
      }),
    );
    const atmKey = JSON.stringify(atm);
    if (atmKey !== lastAtmosphereKey) {
      lastAtmosphereKey = atmKey;
      atmosphere = atm;
      viewport.setAtmosphere(atm);
    }
    const ms = now() - t0;
    spend(ms);
    perf.flush.add(ms);
  }

  // ─── ownership and the api ────────────────────────────────────────────────

  const owned = new Map(); // extension id → what it holds (see makeApi)
  let router = null; // made once the host is (below): extensions only start after both exist
  const extCursors = new Map(); // extension id → cursor (latest set last)
  let routerCursor = null;

  function applyCursor() {
    const mine = [...extCursors.values()].at(-1) ?? null;
    const c = mine ?? routerCursor ?? "";
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  }

  // A session an extension's press returned, counted while it's open (a
  // stopping extension lingers while it has one).
  function trackSession(own, s) {
    if (!s || typeof s !== "object") return s;
    own.sessions++;
    let open = true;
    const done = () => {
      if (!open) return;
      open = false;
      own.sessions--;
    };
    const props = {
      end: { value: (ev) => (done(), s.end?.call(s, ev)) },
      cancel: { value: () => (done(), s.cancel?.call(s)) },
    };
    if (typeof s.tap === "function")
      props.tap = {
        value: (ev) => {
          const r = s.tap.call(s, ev);
          if (r) done();
          return r;
        },
      };
    return Object.create(s, props);
  }

  // Input or arm handlers whose press sessions are counted.
  function withSessions(own, input, extra = {}) {
    return Object.create(input, {
      press: {
        get: () => (typeof input.press === "function" ? (ev) => trackSession(own, input.press.call(input, ev)) : undefined),
      },
      ...extra,
    });
  }
  const inputWrappers = new WeakMap(); // input → its wrapper
  function inputOf(id) {
    const input = host.inputOf(id);
    const own = owned.get(id);
    if (!input || typeof input !== "object" || !own) return undefined;
    let w = inputWrappers.get(input);
    if (!w) inputWrappers.set(input, (w = withSessions(own, input)));
    return w;
  }

  // Arms that asked for `immersive` (a first-person view): while any is on,
  // local.immersive says so, and decorations (grid, axes, bounds) stand aside.
  const immersiveArms = new Set();
  function setImmersive(token, on) {
    if (on) immersiveArms.add(token);
    else if (!immersiveArms.delete(token)) return;
    const now = immersiveArms.size > 0;
    if (!dead) local.swap((m) => (m.immersive === now ? m : { ...m, immersive: now }));
  }

  const busy = (id) => {
    const own = owned.get(id);
    return !!own && (own.arms.size > 0 || own.sessions > 0 || own.holds.size > 0);
  };

  function change(fn) {
    // null: nothing to do; a refusal (ops.js) writes nothing
    if (typeof fn !== "function" || fn.ok === false) return;
    handle.change(fn);
  }

  function setPref(key, value) {
    if (typeof key !== "string") return;
    local.swap((m) => {
      const prefs = m.prefs ?? {};
      if (value === undefined ? !(key in prefs) : prefs[key] === value) return m;
      const next = { ...prefs };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return { ...m, prefs: Object.freeze(next) };
    });
  }
  const pref = (key, fallback) => local.get().prefs?.[key] ?? doc().view?.[key] ?? fallback;

  let noticeSeq = 0;
  function notify(text, kind = "info", from = null) {
    if (dead) return null;
    const n = Object.freeze({ id: `n${++noticeSeq}`, text: String(text ?? ""), kind: kind ?? "info", at: Date.now(), from });
    local.swap((m) => ({ ...m, notices: Object.freeze([...(m.notices ?? []), n]) }));
    later(() => {
      if (!dead) local.swap((m) => (m.notices?.includes(n) ? { ...m, notices: Object.freeze(m.notices.filter((x) => x !== n)) } : m));
    }, NOTICE_MS);
    return n.id;
  }

  const boxOut = (b) => (b && !b.isEmpty() ? { min: b.min.toArray(), max: b.max.toArray() } : null);

  /** Remove in one change, after every running extension's beforeRemove tidy-up. */
  function remove(ids) {
    const plan = ops.removeObjects(scene(), ids);
    if (!plan || !plan.ok) return plan;
    const running = host.instances();
    handle.change((d) => {
      for (const r of running) {
        if (typeof r.instance.beforeRemove !== "function") continue;
        try {
          r.instance.beforeRemove(d, plan.ids);
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: beforeRemove failed`, err);
        }
      }
      plan(d);
    });
    return plan;
  }

  /**
   * Run a command as a value: { ext, command, target, value }. A command
   * whose state() says null (or disabled) for that target doesn't run; one
   * without state() only runs for the scene (target null).
   * @returns {boolean} whether it ran
   */
  function run(invocation) {
    const { ext, command, target = null, value } = invocation ?? {};
    const x = host.instanceOf(ext);
    let c = null;
    try {
      c = (x?.commands ?? []).find((k) => k?.id === command) ?? null;
    } catch {
      c = null;
    }
    if (!c || typeof c.run !== "function") return false;
    try {
      if (typeof c.state === "function") {
        const st = c.state(target, { scene: scene(), local: local.get() });
        if (!st || st.disabled) return false;
      } else if (target != null) return false;
      c.run(target, value);
      return true;
    } catch (err) {
      console.warn(`[scene] extension “${ext}”: command ${command} failed`, err);
      return false;
    }
  }

  async function providersFor(url, sourceDoc) {
    if (url && parseAutomergeUrl(url) === handle.url) return [];
    await plugins;
    return matchProviders(listProviders(), describeSource(sourceDoc));
  }

  async function titleOf(sourceDoc, datatype) {
    try {
      const reg = datatype ? await getRegistry("patchwork:datatype") : null;
      const dt = reg ? await reg.load(datatype) : null;
      const t = dt?.module?.getTitle?.(sourceDoc);
      if (t) return String(t);
    } catch {
      // fall back below
    }
    return String(sourceDoc?.title || sourceDoc?.name || datatype || "Object");
  }

  /**
   * Add a document to the scene as an object (tool.js addFromUrl without the
   * UI): through `providerId` (else the best match), as a render doc, or
   * straight through for a passthrough provider.
   * @param {string} input  an automerge URL (or anything parseAutomergeLink reads)
   * @param {{ providerId?, name?, group?, parent?, before?, transform?, heads? }} [opts]
   *   parent: attach to that object (and join its group, unless `group` says);
   *   group: file in that group; before: its place in the order; heads (or
   *   heads in the URL itself): add it fixed at that version of its source (`at`)
   * @returns {Promise<string>} the new object's id; rejects with a sentence to show
   */
  async function addObject(input, opts = {}) {
    const link = parseAutomergeLink(input);
    if (!link) throw new Error("That doesn't look like an automerge URL.");
    const url = link.url;
    const heads = opts.heads?.length ? opts.heads : link.heads;
    if (url === handle.url) throw new Error("A scene can't contain itself.");
    let source;
    try {
      source = await repo.find(url);
    } catch (err) {
      throw new Error(`Couldn't open that document: ${err?.message ?? err}`);
    }
    const sourceDoc = source.doc();
    const info = describeSource(sourceDoc);
    await plugins;
    if (dead) throw new Error("The scene was closed.");
    const providers = matchProviders(listProviders(), info);
    const provider = opts.providerId ? (providers.find((p) => p.id === opts.providerId) ?? null) : (providers[0] ?? null);
    if (!provider) {
      if (opts.providerId) throw new Error(`The provider “${opts.providerId}” can't show ${describeForHumans(info)}.`);
      throw new Error(`No scene provider is installed for ${describeForHumans(info)}.`);
    }
    const name = opts.name || (await titleOf(sourceDoc, info.datatype));
    // A passthrough provider's source already is a GLB: no render doc, no copy (v3 §6).
    const renderHandle = provider.passthrough ? null : await repo.create2(newRenderDoc({ title: name, parent: url, providerId: provider.id, params: defaultParams(provider.params) }));
    if (renderHandle) createdHere.add(renderHandle.url);
    if (dead) throw new Error("The scene was closed.");
    const id = newId("o");
    const transform = opts.transform ? normalizeTransform(opts.transform) : IDENTITY();
    handle.change((d) => {
      if (!d.objects) d.objects = {};
      if (!d.order) d.order = [];
      // only what is still there can be a place (someone may have removed it meanwhile)
      const parent = opts.parent && d.objects[opts.parent] && !isGroup(d.objects[opts.parent]) ? opts.parent : null;
      const groupWanted = opts.group !== undefined ? opts.group : parent ? resolveGroups(d.objects).get(parent) ?? null : null;
      const group = groupWanted && isGroup(d.objects[groupWanted]) ? groupWanted : null;
      d.objects[id] = {
        name,
        sourceUrl: url,
        providerId: provider.id,
        renderUrl: renderHandle?.url ?? null,
        parent,
        group,
        visible: true,
        color: null,
        opacity: 1,
        wireframe: false,
        transform: { position: [...transform.position], rotation: [...transform.rotation], scale: transform.scale },
      };
      // A URL with heads names a version: show that one. (A passthrough
      // object is shown straight from its file, so it has nothing to fix.)
      if (heads?.length && renderHandle) d.objects[id].at = { heads: [...heads] };
      const at = opts.before ? d.order.indexOf(opts.before) : -1;
      if (at >= 0) d.order.splice(at, 0, id);
      else d.order.push(id);
    });
    return id;
  }

  /** Build an object's render doc now (loading it first if it's hidden). @returns {boolean} whether there was one */
  function rebuild(id) {
    const o = doc().objects?.[id];
    if (!o?.renderUrl) return false;
    if (manager.ids().includes(id)) {
      manager.rebuild(id);
      return true;
    }
    // Hidden, so not hydrated yet (v3 §7): an explicit rebuild loads it first.
    // It then stays tracked, like anything that has loaded.
    if (!o.sourceUrl) return false;
    const url = o.renderUrl;
    Promise.resolve(manager.track(id, trackSpec(o)))
      .then(() => {
        if (!dead && doc().objects?.[id]?.renderUrl === url) manager.rebuild(id);
      })
      .catch((err) => console.warn("[scene] rebuild failed to start", err));
    return true;
  }

  // rebuild requests from embedded controls (controls-tool.js)
  const onRebuild = (e) => {
    const url = e.detail?.renderUrl;
    const entry = Object.entries(doc().objects ?? {}).find(([, o]) => o?.renderUrl === url);
    if (!entry) return;
    e.preventDefault();
    rebuild(entry[0]);
  };
  root.addEventListener(REBUILD_EVENT, onRebuild);
  cleanups.push(() => root.removeEventListener(REBUILD_EVENT, onRebuild));

  // embedded controls asking whether their render's object is fixed at a version
  const onContext = (e) => {
    const url = e.detail?.renderUrl;
    if (!url) return;
    const o = Object.values(doc().objects ?? {}).find((x) => x?.renderUrl === url);
    if (o) e.detail.at = o.at ?? null;
  };
  root.addEventListener(CONTEXT_EVENT, onContext);
  cleanups.push(() => root.removeEventListener(CONTEXT_EVENT, onContext));

  /**
   * The `at` that would fix an object at exactly what its render was last
   * built from, or null (not built here yet, not tracked, or passthrough).
   * Writing it is the caller's: `ops.setField(scene, id, "at", point)`.
   */
  function fixPoint(id) {
    const o = doc().objects?.[id];
    if (!o?.renderUrl || !manager.ids().includes(id)) return null;
    const point = manager.fixPoint(id);
    if (!point) return null;
    // fresh arrays: automerge won't take a value that is already in a document
    const out = { heads: [...point.heads] };
    const deps = Object.entries(point.deps ?? {});
    if (deps.length) out.deps = Object.fromEntries(deps.map(([u, h]) => [u, [...h]]));
    return out;
  }

  /** What a drop handler gets (STAGE.md, "Drops"): reads and writes, nothing to acquire. */
  function makeDropContext(id) {
    return Object.freeze({
      id,
      repo,
      handle,
      url: handle.url,
      viewer,
      doc,
      scene,
      change,
      newId,
      addObject,
      registry: getRegistry,
      local: Object.freeze({ get: local.get, swap: local.swap }),
      notify: (text, kind) => notify(text, kind, id),
    });
  }

  /**
   * Start the scene from a template (STAGE.md, "Templates"): load the
   * scene:template and run its create() with a drop context, which writes
   * whatever it needs into the doc. Then this viewer starts where the doc now
   * says, as joining does (an arena's template says "play", so its maker
   * lands in the game). True when it ran.
   * @param {string} templateId
   * @returns {Promise<boolean>}
   */
  async function applyTemplate(templateId) {
    const reg = await getRegistry("scene:template");
    if (dead || !reg) return false;
    let mod;
    try {
      const loaded = await reg.load(templateId);
      mod = loaded?.module?.default ?? loaded?.module;
    } catch (err) {
      notify(`Couldn't load that template: ${err?.message ?? err}`, "error");
      return false;
    }
    if (dead) return false;
    if (typeof mod?.create !== "function") return false;
    try {
      await mod.create(makeDropContext(templateId));
    } catch (err) {
      notify(`That template failed: ${err?.message ?? err}`, "error");
      return false;
    }
    if (dead) return false;
    const start = doc().view?.activity;
    if (typeof start === "string") local.swap((m) => (m.activity === start ? m : { ...m, activity: start }));
    return true;
  }

  /**
   * The api one extension gets, and release(): give back everything it
   * acquired, in the STAGE.md order (the host aborts its signal first and
   * calls dispose() after).
   */
  function makeApi(rec) {
    const id = rec.id;
    const signal = rec.signal;
    // What it holds. Each bag holds the "give it back" functions.
    const own = {
      arms: new Set(), // live arm tokens
      sessions: 0, // open press sessions
      holds: new Set(), // object ids whose pose it holds
      cameraHolds: new Set(),
      frame: new Set(), // loops and afterRender hooks
      offs: new Set(), // listeners, watchers, limits
      els: new Set(), // overlays, edges, styles
    };
    owned.set(id, own);
    const live = () => !signal.aborted && !dead;
    // Acquire something, unless stopped; the returned off gives it back once.
    const acquire = (bag, take) => {
      if (!live()) return noop;
      const give = take();
      if (typeof give !== "function") return noop;
      bag.add(give);
      return () => {
        if (bag.delete(give)) give();
      };
    };
    const ownEl = (el, parent) => {
      if (!live()) return el;
      own.els.add(el);
      parent.append(el);
      return el;
    };

    const api = {
      // doc and identity
      id,
      repo,
      handle,
      url: handle.url,
      viewer,
      signal,
      Counter,
      doc,
      change,
      newId,
      scene,
      ops,
      remove,
      registry: getRegistry,
      /** the element the canvas fills, and the stage's root (for DOM listeners: drops, paste) */
      port,
      root,
      /** what the manager or the queue last said about an object's content (notes, contested, providerId…) */
      loadState: (oid) => {
        const s = objState.get(oid);
        return s ? Object.freeze({ ...s }) : null;
      },

      // local, prefs, presence
      local: Object.freeze({
        get: local.get,
        swap: (fn) => local.swap(fn),
        watch: (fn, select) =>
          acquire(own.offs, () =>
            local.watch(
              typeof select === "function"
                ? (next, prev) => {
                    if (select(next) !== select(prev)) fn(next, prev);
                  }
                : fn,
            ),
          ),
      }),
      pref,
      setPref,
      presence: Object.freeze({
        set: (key, value) => {
          if (live()) presence.set(id, key, value);
        },
        get: () => presence.get(),
        watch: (fn) => acquire(own.offs, () => presence.watch(fn)),
        rate: (hz) => {
          if (live()) presence.rate(id, hz);
        },
      }),
      send: (type, data) => {
        if (live()) presence.send(id, type, data);
      },
      notify: (text, kind) => notify(text, kind, id),

      // content
      nameOf,
      content: (oid) => viewport.contentOf(oid),
      box: (oid, { hints = true } = {}) => boxOut(viewport.objectBox(oid, { hints })),
      groupBox: (gid, { hints = true } = {}) => boxOut(viewport.groupBox(gid, { hints })),
      sceneBox: () => boxOut(viewport.sceneBox()),
      worldOf: (oid) => viewport.worldOf(oid) ?? (derive().objects[oid] ? scene().world(oid) : null),
      focus: (ids) => {
        if (!live()) return;
        const list = ids == null ? [] : typeof ids === "string" ? [ids] : [...ids];
        if (list.length) focusBy.set(id, new Set(list));
        else focusBy.delete(id);
        applyDoc(derive());
      },
      providersFor,
      addObject,
      rebuild,
      fixPoint,
      drop: (info) => host.drop(info),
      template: (templateId) => applyTemplate(templateId),

      // picking and camera
      pick: (x, y, opts) => viewport.pick(x, y, opts),
      ray: (x, y) => viewport.ray(x, y),
      raycast: (origin, dir, opts) => viewport.raycast(origin, dir, opts),
      project: (p) => viewport.project(p),
      camera: Object.freeze({
        get object() {
          return viewport.camera ?? null;
        },
        get: () => viewport.getCamera(),
        set: (cam) => viewport.setCamera(cam),
        frame: (box) => viewport.frame(box),
        hold: () => acquire(own.cameraHolds, () => viewport.hold()),
        limit: (spec) => acquire(own.offs, () => viewport.limit(spec)),
        touched: () => viewport.touched() || cameraRestored,
        watch: (fn) => acquire(own.offs, () => viewport.watchCamera(fn)),
        /** someone finished moving the camera (an orbit, a zoom); never while it's held */
        onEnd: (fn) => acquire(own.offs, () => viewport.onCameraEnd(fn)),
      }),

      // drawing
      THREE,
      world: ({ onTop = false } = {}) => (live() ? viewport.worldLayer(id, { onTop }) : new THREE.Group()),
      // each call is its own set (an extension may keep several)
      labels: () => {
        const key = `${id}#${(own.labelSets = (own.labelSets ?? 0) + 1)}`;
        own.labelKeys = [...(own.labelKeys ?? []), key];
        return Object.freeze({
          set: (items) => {
            if (live()) viewport.labels.sync(key, items ?? []);
          },
        });
      },
      overlay: () => {
        const el = document.createElement("div");
        el.className = "stage-overlay";
        el.dataset.owner = id;
        return ownEl(el, port);
      },
      edge: (side) => {
        const el = document.createElement("div");
        el.className = "stage-edge-part";
        el.dataset.owner = id;
        return ownEl(el, edges[EDGES.includes(side) ? side : "right"]);
      },
      style: (text) => {
        const el = document.createElement("style");
        el.textContent = String(text ?? "");
        el.dataset.owner = id;
        return ownEl(el, root);
      },
      listen: (target, type, fn, opts) =>
        acquire(own.offs, () => {
          target.addEventListener(type, fn, opts);
          return () => target.removeEventListener(type, fn, opts);
        }),
      cursor: (name) => {
        if (!live()) return;
        extCursors.delete(id);
        if (name) extCursors.set(id, String(name));
        applyCursor();
      },
      pose: Object.freeze({
        hold: (oid, transform) => {
          if (live()) holdPose(id, own, oid, transform);
        },
        release: (oid, { landed = false } = {}) => releasePose(id, own, oid, landed),
      }),
      heldBy: (oid) => presence.heldBy(oid),
      extent: (box) => {
        if (live()) viewport.setExtent(id, box ?? null);
      },
      invalidate: () => viewport.invalidate(),
      loop: (fn) => acquire(own.frame, () => viewport.addLoop(fn)),
      afterRender: (fn) => acquire(own.frame, () => viewport.afterRender(fn)),
      schedule: (fn) => {
        if (!live() || typeof fn !== "function") return;
        scheduled.push({ rec, fn });
        requestFlush();
      },

      // input
      arm: (handlers, opts = {}) => {
        if (!live() || !router) return noop;
        const h = handlers ?? {};
        const token = {};
        // the router pops this extension's earlier arms itself (and says disarmed)
        if (opts.replace) own.arms.clear();
        own.arms.add(token);
        const wrapped = withSessions(own, h, {
          disarmed: {
            value: () => {
              own.arms.delete(token);
              setImmersive(token, false);
              return h.disarmed?.call(h);
            },
          },
        });
        const disarm = router.arm(id, wrapped, opts);
        if (opts.immersive) setImmersive(token, true);
        return () => {
          own.arms.delete(token);
          setImmersive(token, false);
          disarm();
        };
      },
      relock: () => (router ? router.relock(id) : Promise.resolve()),

      // the others
      collect: (name) => host.collect(name),
      run,
    };

    function release() {
      // 1–2: its open session and its arms (the router cancels, pops and
      // unlocks), then its camera holds
      router?.stopOwner(id);
      own.arms.clear();
      own.sessions = 0;
      for (const give of [...own.cameraHolds]) give();
      own.cameraHolds.clear();
      // 3: its pose holds, put back
      for (const oid of [...own.holds]) releasePose(id, own, oid, false);
      // 4: its presence keys (and its rate)
      presence.clear(id);
      // 5: loops, afterRender hooks, scheduled work
      for (const give of [...own.frame]) give();
      own.frame.clear();
      scheduled = scheduled.filter((s) => s.rec !== rec);
      // 6: its world groups
      viewport.removeLayers(id);
      // 7: labels, overlays, edges, styles, listeners and watchers, cursor, extent, focus
      for (const key of own.labelKeys ?? []) viewport.labels.clear(key);
      for (const el of own.els) el.remove();
      own.els.clear();
      for (const give of [...own.offs]) give();
      own.offs.clear();
      if (extCursors.delete(id)) applyCursor();
      viewport.setExtent(id, null);
      if (focusBy.delete(id) && !dead) applyDoc(derive());
      owned.delete(id);
    }

    return { api, release };
  }

  // ─── the host ─────────────────────────────────────────────────────────────

  // An extension started or stopped: the doc loop runs again (and the update
  // flush that first shows it the scene).
  let resyncQueued = false;
  function resync() {
    if (resyncQueued || dead) return;
    resyncQueued = true;
    queueMicrotask(() => {
      resyncQueued = false;
      sync();
    });
  }

  const host = createHost({
    registry: () => getRegistry("scene:extension"),
    local,
    makeApi,
    makeDropContext,
    busy,
    onChange: resync,
  });

  // ─── the router ───────────────────────────────────────────────────────────

  let picking = false;
  // The widget under the pointer: the viewport's (meshes in world groups) and
  // every running extension's widgetAt; onTop beats the rest, else nearest.
  function pickWidget(ev) {
    if (picking) return null; // a widgetAt that reads ev.widget
    picking = true;
    try {
      const out = [];
      if (ev?.x != null && ev?.y != null) {
        const w = viewport.pickWidget(ev.x, ev.y);
        if (w) out.push(w);
      }
      for (const r of host.running()) {
        const input = r.instance.input;
        if (typeof input?.widgetAt !== "function") continue;
        try {
          const w = input.widgetAt(ev);
          if (w && typeof w === "object") out.push({ ...w, owner: r.id, onTop: !!w.onTop });
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: widgetAt failed`, err);
        }
      }
      return bestWidget(out);
    } finally {
      picking = false;
    }
  }

  function chainFor(ev) {
    const running = host.running();
    const m = derive();
    const widget = ev.widget;
    const hit = ev.hit;
    const chain = hit?.id && m.objects[hit.id] ? hitChain(hit.id, m.parents, m.groups, m.objects) : [];
    const holders = holdersFor(running, chain, (oid) => traitKeys(m.objects[oid]));
    const order = chainOrder({ running, widgetOwner: widgetWins(widget, hit) ? widget.owner : null, holders });
    return { order, holderOf: (id) => holders.get(id) ?? null };
  }

  router = createRouter({
    port,
    canvas,
    keyRoot: root,
    pick: (x, y, opts) => viewport.pick(x, y, opts),
    pickWidget,
    ray: (x, y) => viewport.ray(x, y),
    centerRay: () => viewport.centerRay(),
    chainFor,
    inputOf,
    cameraHeld: () => viewport.held,
    onHover: (ev) => local.swap(assoc("hovered", ev?.hit?.id ?? null)),
    onCursor: (name) => {
      routerCursor = name;
      applyCursor();
    },
    onArmed: (owner) => local.swap(assoc("armed", owner ?? null)),
  });

  // ─── local → storage, the running set, the flush ──────────────────────────

  cleanups.push(
    local.watch((next, prev) => {
      // switching activity stops what the new one doesn't call for at once
      if (next.activity !== prev.activity) host.sync(doc());
      if (next.prefs !== prev.prefs) writeJSON(prefsKey, next.prefs);
      requestFlush();
    }),
  );

  // ─── focus ────────────────────────────────────────────────────────────────

  // Keys are heard on the root, so focus that left an element inside the
  // stage for nowhere (the clicked button was replaced, as a HUD's Play is
  // once pressed, or hidden, or moved: an outline row re-filed under its new
  // parent) comes back to the root, and keys keep working. Chrome blurs a
  // moved element with the element still connected and focus on <body>, just
  // as when someone clicks the page outside the stage; only the click tells
  // the two apart, so a press outside (or the window losing focus) means it
  // left for the page.
  let pressedOutside = -Infinity;
  const onPressAnywhere = (e) => {
    if (!root.contains(e.target)) pressedOutside = performance.now();
  };
  document.addEventListener("pointerdown", onPressAnywhere, true);
  const refocus = (e) => {
    // focus on its way to something (it gets there after this event's microtasks)
    if (e.type === "focusout" && e.relatedTarget) return;
    queueMicrotask(() => {
      if (dead || !root.isConnected) return;
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (e.type === "focusout") {
        if (performance.now() - pressedOutside < 1000) return; // left for the page
        if (typeof document.hasFocus === "function" && !document.hasFocus()) return; // the window went
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

  // Patchwork doesn't run the tool's cleanup when the tab closes, so peers
  // would keep this view (its avatar, its selection) until it times out. On
  // pagehide it says bye at once; restored from the back-forward cache, it
  // comes back as a new session.
  const onPageHide = () => presence.goodbye();
  const onPageShow = (e) => {
    if (e.persisted) presence.hello();
  };
  globalThis.addEventListener?.("pagehide", onPageHide);
  globalThis.addEventListener?.("pageshow", onPageShow);
  cleanups.push(() => {
    globalThis.removeEventListener?.("pagehide", onPageHide);
    globalThis.removeEventListener?.("pageshow", onPageShow);
  });

  // ─── the doc loop ─────────────────────────────────────────────────────────

  function sync() {
    if (dead) return;
    const d = doc();
    const t0 = now();
    const m = derive();
    host.sync(d);
    applyDoc(m);
    // other views' holds: a landed one the doc has caught up with goes, and a
    // hold whose parent the doc changed is shown (or not) again
    for (const id of [...presence.remoteHolds().keys()]) applyRemoteHold(id);
    requestFlush();
    perf.sync.add(now() - t0);
  }
  handle.on("change", sync);
  cleanups.push(() => handle.off("change", sync));
  sync();

  // ─── probes ───────────────────────────────────────────────────────────────

  const debug = {
    get renderer() {
      return viewport.renderer ?? null;
    },
    viewport,
    local,
    host,
    router,
    presence,
    perf,
    queue,
    manager,
    root,
    scene,
    looks: () => looks,
    atmosphere: () => atmosphere,
    /** does this extension hold an arm, an open session or a pose (so a doc-caused stop waits)? */
    busy,
    stats: () => ({
      render: { ...viewport.stats },
      queue: queue.stats(),
      subscriptions: queue.subscriptions(),
      pending: queue.pending(),
      loaded: [...viewport.objects.values()].filter((e) => e.content).length,
    }),
  };
  root.__sceneDebug = debug;
  globalThis.__sceneDebug = debug;

  return () => {
    if (dead) return;
    // the extensions first, while everything they hold is still there to give back
    host.dispose();
    dead = true;
    router.dispose();
    presence.dispose();
    if (flushFrame != null) caf(flushFrame);
    if (uiResetReq != null) caf(uiResetReq);
    clearTimeout(cameraTimer);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const c of cleanups) {
      try {
        c();
      } catch {
        // keep going
      }
    }
    queue.dispose();
    manager.dispose();
    viewport.dispose();
    if (globalThis.__sceneDebug === debug) delete globalThis.__sceneDebug;
    root.remove();
    style.remove();
  };
}
