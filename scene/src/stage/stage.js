// patchwork:tool "scene": a view (./view.js) and the stages it opens, one per
// open doc (STAGE.md, "Views, stages and links"). This file is the stage: the doc, loading and
// building object content, lenses and veils, the audience, presence and
// claims on its doc's channel, its clock, its extensions and the api each
// gets. It has no UI of its own and no opinion about what a click means:
// everything a person sees or does beyond a rendered scene and an orbiting
// camera comes from a `scene:extension`, which gets an api (makeApi below)
// and is started and stopped by the host (host.js). The view holds what is
// the viewer's: the mount, the viewport, the router, the body stack and the
// held tool, the selection and the camera.
//
// A stage works in its own ids and its own root frame. Everything spatial
// goes through its scope of the viewport (./scope.js), the one choke point
// where its frame and its keys (./paths.js) meet the view's.
//
// A stage acts, or it is drawn (STAGE.md, "Views, stages and links"). One that acts is where
// its doc is played: its extensions hear input, offer bodies, tools and
// commands, compute its clock and speak on its channel. A pin (its doc at
// fixed heads) and a mirror (a live doc acting at another placement in this
// view) are drawn: their extensions run, so they look as the doc does, and
// they draw into the world (layers, labels, looks, lenses), but nothing
// more: no input, bodies, tools, commands or DOM chrome, no camera, no
// processes, and they hear their doc's channel without speaking on it (a
// pin has none). A stage is read-only when it doesn't act or its handle is,
// and is then given its doc and repo read-only (./readonly.js), so it writes
// nothing whatever it calls (invariant I6).
//
// The parts, in the order they're wired:
//   - local state (atom.js): the stage's own (running, status, edits, clock,
//     packages, and extensions' keys); the view's is `api.view`.
//   - content, routed at sync by the kind its provider makes (providers.js
//     routeOf): the render manager for "built", the GLB queue for "file";
//     their state → local.status.
//   - presence on its doc's channel, and other views' pose holds shown on the
//     viewport, played back smoothly (smooth.js); this view's holds in the one
//     order (holds.js); claims, which are doc fields that count only while
//     their holder's session is in presence.
//   - the doc's world time (clock.js): the "clock" claim, processes,
//     checkpoints, following; what the chip shows → local.clock.
//   - the host, and the api each extension gets (everything it acquires is
//     its own and is given back when it stops, in the STAGE.md order).
//   - what the view asks of it: its segment of the input chain, its inputs
//     (hearing events in its frame), its bodies and widgets.
//   - the doc loop: derive, the running set, display and content; then the
//     update flush (once per UI pass): each instance's update(), scheduled
//     work, lenses, ambients (./ambients.js).

import * as THREE from "three";
import * as patchworkPlugins from "@inkandswitch/patchwork-plugins";
import { createAtom, assoc } from "./atom.js";
import { createHost } from "./host.js";
import { HEARTBEAT_MS, createPresence } from "./presence.js";
import { realTime } from "./time.js";
import { createHolds } from "./holds.js";
import { CLOCK, PRESENCE_KEY, PRESENCE_NS, createClock, eligibility } from "./clock.js";
import { aheadOf, playoutDelay, poseAt } from "./smooth.js";
import { traitKeys } from "./activation.js";
import { createPackages } from "./packages.js";
import { mergeAudience, mergeShown } from "./audience.js";
import { DEFAULT_BOUNDS, veilBounds, veilGLB, veilKey } from "./veil.js";
import { chainOrder, holdersFor } from "./chain.js";
import { createEdits } from "../undo.js";
import { isOwn } from "./own.js";
import { handleReadOnly, readOnlyHandle, stageRepo } from "./readonly.js";
import { isLink } from "./links.js";
import { isStageBody } from "./bodies.js";
import { createView, projectView } from "./view.js";
import { EMPTY as NO_AMBIENTS, mergeAmbients } from "./ambients.js";
import { scopeViewport, hitIn, rayIn } from "./scope.js";
import { elementOf, keyOf, parseKey, pathOf } from "./paths.js";
import { lookChain } from "../keymap.js";
import { commandState } from "../parts/toolbar-commands.js";
import * as ops from "../ops.js";
import { layersKey } from "../layers.js";
import { createRenderManager } from "../render-manager.js";
import { createGLBQueue, isLoadingPhase } from "../glb-queue.js";
import { newRenderDoc, seededRenderDoc } from "../datatype.js";
import { atKey, defaultParams, paramsBySpec } from "../staleness.js";
import { contentOf, describeForHumans, describeSource, matchProviders, routeOf, showsContent } from "../providers.js";
import { parseAutomergeLink, parseAutomergeUrl } from "../dnd.js";
import { resolveParents, treeOrder, worldMatrix } from "../hierarchy.js";
import { groupChain, inheritedDisplay, isGroup, outlineParents, resolveGroups } from "../groups.js";
import { CONTEXT_CHANGED_EVENT, CONTEXT_EVENT, REBUILD_EVENT } from "../controls-tool.js";
import { fileBytes } from "../file-content.js";
import { applyMatrix, composeMatrix, decomposeMatrix, invertMatrix, multiplyMatrices, normalizeTransform } from "../transform.js";
import { createTelling, declared } from "./telling.js";

// the view's pure parts, where they have always been imported from
export { ARRIVE_WAIT_MS, bestWidget, cleanCamera, cleanPrefs, initialCamera, startOf, widgetWins, withNotice } from "./view.js";

/** Load priority for anything an extension asked to see first (api.focus). */
const FOCUS_PRIORITY = 1e12;
/**
 * How long a claim whose holder isn't in presence still counts, from when
 * this view first read it so. A peer that has just joined writes its claim
 * as its hello goes out, and the doc may get here first; and a view that has
 * just opened hasn't heard anyone's hello yet. A heartbeat and a second
 * covers a hello that went missing.
 */
export const CLAIM_GRACE_MS = HEARTBEAT_MS + 1_000;
// Doc and local changes reach the extensions at once while that has cost
// little this frame (UI_PASSES passes, UI_BUDGET_MS in all), so a click or a
// single remote edit answers immediately; past that, the rest of a burst is
// coalesced into one pass per frame.
const UI_BUDGET_MS = 4;
const UI_PASSES = 3;
const EDGES = ["top", "right", "bottom", "left"];
/** Is this one of the router's events (so a stage hands it on in its own frame)? */
const isEvent = (a) => !!a && typeof a === "object" && typeof a.type === "string" && "locked" in a;
const noop = () => {};
/** A step of edits in a stage that may not write: it records and writes nothing. */
const NO_EDIT = Object.freeze({ change: noop, end: noop });

const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
/** CPU time (ms), for measuring what work costs (`perf`): never time in the scene, which is `time` (time.js). */
const cpuNow = () => globalThis.performance?.now?.() ?? Date.now();
const IDENTITY = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });

// ─── pure helpers (exported for tests) ──────────────────────────────────────

/** An infoUrl / sourceUrl that is really an automerge URL, else null. */
export function docUrl(v) {
  return typeof v === "string" && v.startsWith("automerge:") ? parseAutomergeUrl(v) : null;
}

/** Everything applyDisplay reads, as one string: an object is re-applied only when this changes. */
export function displayKey(o, parent, inh) {
  const t = o.transform ?? {};
  return `${o.kind === "group" ? "g" : "o"}|${o.visible !== false}|${o.color ?? ""}|${o.opacity ?? 1}|${!!o.wireframe}|${!!o.locked}|${o.tags ?? ""}|${t.position}|${t.rotation}|${t.scale}|${parent ?? ""}|${inh?.visible}|${inh?.opacity}|${layersKey(o.layers)}`;
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
 * Lenses stacked in running order: per object, each lens's fields over the
 * earlier ones' (a field it leaves undefined is kept). References to objects
 * that aren't there are dropped.
 * @param {Iterable<Map<string, object> | Iterable<[string, object]>>} lenses
 * @param {object} objects
 * @returns {Map<string, { sourceUrl?, name?, veil? }>}
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

const CONTESTED_TEXT = "A collaborator built it differently (another provider version, or linked documents at other versions); Rebuild to use yours";

/**
 * An object's load and build state, for local.status: { state, reason?, text,
 * title }, or null when there's nothing to say (loaded, or not asked for
 * yet). `text` and `title` are for people; a stale state's `reason` ("deps",
 * "contested", "pinned", "out-of-date") is what code branches on.
 * @param {object} o  the object  @param {object} s  what the render manager or GLB queue last said
 */
/** What addObject settles itself, which its `fields` never override. */
const ADD_OWNS = new Set(["kind", "name", "sourceUrl", "providerId", "renderUrl", "parent", "group", "transform", "claims", "saved"]);

export function statusOf(o, s) {
  if (!o || isGroup(o) || !s) return null;
  if (s.content === "file") {
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
  if (s.stale && s.contested) return { state: "stale", reason: "contested", text: "stale", title: CONTESTED_TEXT };
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

// ─── the tool ───────────────────────────────────────────────────────────────

/**
 * The patchwork:tool render function: mount a view (./view.js) for a scene
 * doc, and the doc's stage in it, the outermost.
 * @param {object} handle  the scene's DocHandle
 * @param {HTMLElement} element  where to mount (element.repo, element.viewerId, element.time optional)
 * @returns {() => void} cleanup
 */
export default function Stage(handle, element) {
  const view = createView(element, { url: handle.url ?? "scene", openStage: createStage });
  view.addStage((n) => createStage({ handle, view, n }));
  return () => view.dispose();
}

/**
 * One open doc's stage (STAGE.md, "Views, stages and links"): its handle, derive and snapshot,
 * content, lenses and veils, the audience, its extensions, claims, its
 * channel, packages and clock, and its own atom (`api.local`). It sees only
 * its doc, in its own root frame; the view (./view.js) is everything it
 * shares with the others.
 * @param {{
 *   handle: object, view: object, n: number,
 *   path?: string[],                   // the links that lead to it ([]: the outermost)
 *   frame?: () => number[] | null,     // its root's world matrix now (null: the identity)
 *   under?: string | null,             // the viewport key its root hangs under (the link's)
 *   general?: boolean,                 // does it start out running the general extensions (the focus does; the view moves them)
 *   role?: "acting" | "mirror" | "pinned",  // does it act, or is it drawn (links.js expand)
 *   deps?: object | null,              // a pin's: the heads of the docs reached through it ({ url: heads })
 * }} o
 */
export function createStage({ handle: given, view, n, path = [], frame = () => null, under = null, general = true, role = "acting", deps = null }) {
  // does it act (STAGE.md, "Views, stages and links"): a pin or a mirror is drawn, never acted on
  const acts = role === "acting";
  // read-only: its doc, and every doc it reaches, refuse writes (I6)
  const readOnly = !acts || handleReadOnly(given);
  const handle = readOnly ? readOnlyHandle(given) : given;
  // the docs found through its repo, url → handle: what fixing a link through it holds (fixPoint)
  const reached = new Map();
  const repo = stageRepo(view.repo, { readOnly, deps, reached });
  /** May this view write the doc (it acts, and its handle lets it)? */
  const writable = () => !handleReadOnly(handle);
  const sceneUrl = handle.url ?? "scene";
  let dead = false;
  const cleanups = [];
  const time = view.time;
  const timers = new Set(); // cancels of what later() set
  const later = (fn, ms) => {
    const cancel = time.after(ms, () => {
      timers.delete(cancel);
      fn();
    });
    timers.add(cancel);
    return cancel;
  };
  const perf = { sync: timings(), flush: timings() };
  const raf = (f) => time.frame(f);
  const caf = (cancel) => cancel?.();
  const { root, port, edges, drawer } = view;
  const vp = view.viewport;
  /** An extension of this stage, as the view and the router name it. */
  const ownerKey = (ext) => keyOf(n, ext);
  /** This stage's element of the path a viewport key names (null: not its own, nor inside one of its links). */
  const elementOfKey = (key) => elementOf(view.pathOfKey(key), path);
  // the viewport as this stage sees it: its ids, its frame (./scope.js, the one choke point)
  const scope = scopeViewport(vp, { n, root: under, frame, elementOf: elementOfKey });
  const doc = () => handle.doc() ?? {};
  const viewer = view.viewer;
  let stage = null; // what the view knows this stage by (made at the end)

  // ─── local state: the stage's own (STAGE.md, "Views, stages and links") ─────────────────────
  const local = createAtom({
    running: Object.freeze([]),
    status: Object.freeze({}),
    // the labels of the steps undo and redo would take, in this doc (src/undo.js)
    edits: Object.freeze({ undo: null, redo: null }),
    // the doc's clock as the chip shows it (clock.js status), once known
    clock: null,
    // the listed packages this viewer doesn't have (STAGE.md, "Packages")
    packages: Object.freeze({ ask: Object.freeze([]), loading: Object.freeze([]), failed: Object.freeze([]), missing: true }),
  });
  /** The view's value as this stage sees it (view.js projectView), the same value while the view's is; `general`: as its general parts, the view's own, see it. */
  const seenBy = [null, null].map((_, g) => ({ general: g === 1, from: null, value: null }));
  const viewValue = (general = false) => {
    const v = view.atom.get();
    const c = seenBy[general ? 1 : 0];
    if (v !== c.from) {
      c.from = v;
      c.value = projectView(v, n, path, { general: c.general });
    }
    return c.value;
  };
  const viewport = vp; // (the raw viewport, for what isn't spatial: frames, loops, invalidation)
  if (n === 0) view.restoreCamera(doc());

  // ─── the plugin registry ──────────────────────────────────────────────────

  // The host's registry is there from the start, so the first sync already
  // routes each object's content by the kind its provider makes.
  const sourceRegistry = patchworkPlugins.getRegistry("scene:source");
  const offSources = sourceRegistry.on?.("changed", () => {
    manager.providersChanged();
    sourcesChanged();
  });
  if (typeof offSources === "function") cleanups.push(offSources);
  const getRegistry = async (type) => patchworkPlugins.getRegistry(type) ?? null;

  const listProviders = () => {
    try {
      return sourceRegistry?.filter?.(() => true) ?? [];
    } catch {
      return [];
    }
  };

  /** The kind of content a registered provider makes (providers.js contentOf), else null. */
  const kindOf = (providerId) => contentOf(sourceRegistry.get(providerId));
  const unusable = new Set(); // sources already warned about: they declare no content kind

  /** Say once of each registered source that declares no content kind: it is never used. */
  function warnUnusable() {
    for (const p of listProviders()) {
      if (!p?.id || contentOf(p) || unusable.has(p.id)) continue;
      unusable.add(p.id);
      console.warn(`[scene] source “${p.id}” declares no content kind ("file" or "built"), so it isn't used`);
    }
  }

  // The sources changed: what each object's content routes to may have too.
  function sourcesChanged() {
    if (dead) return;
    warnUnusable();
    applyDoc(derive());
    statusChanged();
  }

  async function loadProvider(id) {
    if (!sourceRegistry.has(id)) return null;
    const p = await sourceRegistry.load(id);
    if (!p?.module) return null;
    return { id, name: p.name ?? id, params: p.params ?? [], cost: p.cost, version: p.version, module: p.module };
  }

  // ─── the scene's packages ─────────────────────────────────────────────────

  // The doc lists the packages its contents come from, and the ones this
  // viewer doesn't have are offered (STAGE.md, "Packages"). The render
  // manager reports the provider each render doc names (objState), so one a
  // render doc asks for is listed even when the object's own field differs,
  // and no source package is taken off the list while a render doc built
  // here hasn't said yet (one shown, not veiled, may name any provider).
  // (through the view's repo, not the stage's: a package is the viewer's to load, at its live heads,
  // never a doc this one reaches, so fixing a link never records one)
  const packages = createPackages({
    repo: view.repo,
    handle,
    plugins: patchworkPlugins,
    local,
    providerIds: () => [...objState.values()].map((s) => s?.providerId),
    // (an object with a source is built through a render doc, which says its provider once it has loaded: hidden or veiled, never)
    rendersKnown: () => {
      const objects = doc()?.objects ?? {};
      for (const [id, route] of routes) if (route === "built" && objects[id]?.sourceUrl && !said(objState.get(id))) return false;
      return true;
    },
    // ("Not now" is the view's: a doc opened after it isn't asked again either)
    declined: view.declinedPackages,
    // (element.packageSettleMs lets a probe or a test not wait for the registry to go quiet)
    ...(view.packageSettleMs != null ? { settleMs: view.packageSettleMs } : {}),
  });
  cleanups.push(() => packages.dispose());
  // the view asks every open doc's together (view.packages): tell it when this one's change
  let packagesSeen = local.get().packages;
  cleanups.push(
    local.watch(() => {
      const p = local.get().packages;
      if (p === packagesSeen) return;
      packagesSeen = p;
      view.packagesChanged?.();
    }),
  );

  // ─── derived structure, once per doc snapshot ─────────────────────────────

  let model = null;
  function derive() {
    const d = doc();
    if (model && model.d === d) return model;
    return (model = modelOf(d));
  }
  /** The derived structure of any snapshot of the doc (derive's, for the doc as it is now). */
  function modelOf(d) {
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
    return {
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
  }

  /** The snapshot extensions read (STAGE.md, `scene()`), one per doc. */
  function scene() {
    return snapshotOf(derive());
  }
  /** The snapshot of a model: its doc, structure, world(id) and toLocal(id, point). */
  function snapshotOf(m) {
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

  // ─── content: built (render docs) and files (GLBs shown as they are) ──────

  const routes = new Map(); // id → where its content was routed at the last sync: "built", "file" or null (providers.js routeOf)
  const objState = new Map(); // id → what the manager or the queue last said (its `content` says which)
  // has the manager said which provider this object's render doc names? (its first word, before the doc has loaded, hasn't)
  const said = (st) => st?.content === "built" && "providerId" in st;
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
    readOnly,
    // what it shows live is announced (./announce.js); a pin's docs keep their own version
    announce: role === "pinned" ? null : view.announcer,
    loadProvider,
    onState: (id, s) => {
      const was = objState.get(id);
      const before = was?.bounds;
      // the provider its render doc names is one the scene calls for (packages)
      if (said(was) !== said({ ...s, content: "built" }) || was?.providerId !== s.providerId) packages.check();
      objState.set(id, { ...s, content: "built" });
      // a render doc's own bounds stand in until its GLB loads (unless the scene has a hint)
      if (String(before?.min) + String(before?.max) !== String(s.bounds?.min) + String(s.bounds?.max)) {
        const o = doc()?.objects?.[id];
        if (o && !isGroup(o) && !o.hint?.bounds) applyHint(id, s.bounds);
      }
      statusChanged();
    },
    onGLB: async (id, bytes) => {
      try {
        await scope.setGLB(id, bytes);
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
        await scope.setGLB(id, bytes);
      } catch (err) {
        console.warn("[scene] GLB failed to parse", err);
        throw new Error(`GLB failed to load: ${err?.message ?? err}`);
      }
      if (!dead) afterGLB();
    },
    onState: (id, st) => {
      objState.set(id, { content: "file", phase: st.phase, error: st.error });
      statusChanged();
    },
  });

  const focused = (id) => {
    for (const s of focusBy.values()) if (s.has(id)) return true;
    return false;
  };
  const priorityOf = (id, o) => (focused(id) ? FOCUS_PRIORITY : hintVolume(o));

  // ─── lenses ───────────────────────────────────────────────────────────────

  let looks = new Map(); // id → { sourceUrl?, name?, veil? }: what this viewer sees instead
  const veils = new Map(); // id → veilKey of the veil it is shown as (a look with `veil: true`)
  const veilBytes = new Map(); // veilKey → its GLB
  let lastLooksKey = "[]";
  let ambients = NO_AMBIENTS; // what its running extensions offer, stacked per name (./ambients.js): the view's when it's the outermost
  const nameOf = (id) => looks.get(id)?.name ?? derive().objects[id]?.name ?? null;

  // ─── the doc → the viewport ───────────────────────────────────────────────

  /** Give the viewport a placeholder box (only when it changed); true if there is one. */
  function applyHint(id, b) {
    const hk = b ? `${b.min}|${b.max}` : "";
    if (hintKeys.get(id) !== hk) {
      hintKeys.set(id, hk);
      scope.setHint(id, b ?? null);
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
    scope.setGroups(m.members);
    const tracked = new Set(manager.ids());
    let rerouted = false;
    for (const { id } of attachOrder) {
      const o = objects[id];
      const parent = parents.get(id) ?? null;
      const inh = inherited.get(id);
      if (isGroup(o)) {
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        routes.delete(id);
        continue;
      }
      const route = routeOf(o, kindOf);
      // a route that moved (its provider arrived or went) is a change to what's shown
      if (routes.has(id) && routes.get(id) !== route) rerouted = true;
      routes.set(id, route);
      // what was said about content of another kind no longer applies
      if (objState.has(id) && objState.get(id).content !== route) {
        objState.delete(id);
        statusDirty = true;
      }
      // placed even without geometry, so whatever is attached to it sits right
      const key = displayKey(o, parent, inh);
      if (displayKeys.get(id) !== key) {
        displayKeys.set(id, key);
        scope.applyDisplay(id, o, parent, inh);
      }
      const shown = o.visible !== false && inh.visible;
      // a veil stands in for it, whatever it is made of: nothing of its own is loaded while it's veiled
      if (looks.get(id)?.veil === true) {
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
        const b = veilBounds(o.hint?.bounds) ?? veilBounds(objState.get(id)?.bounds) ?? veilBounds(scope.contentOf(id)?.box) ?? DEFAULT_BOUNDS;
        const vk = veilKey(b);
        if (veils.get(id) !== vk) {
          veils.set(id, vk);
          if (objState.delete(id)) statusDirty = true;
          showVeil(id, vk, b);
        }
        continue;
      }
      // (unveiled: its own content loads again below, and the veil stays up until that has)
      veils.delete(id);
      if (route === "built") {
        queue.remove(id);
        applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
        // hydrate only what is shown; once loaded it stays loaded
        if (o.sourceUrl && (shown || tracked.has(id))) manager.track(id, trackSpec(o));
        noteAt(o);
        continue;
      }
      if (route === "file") {
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
        continue;
      }
      if (route === "scene") {
        // a link: the view opens a stage for its doc (links.js), acting or
        // drawn; open, its doc is what's drawn; otherwise it is drawn as its
        // hint, the room the host gives it
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        applyHint(id, view.linkState([...path, id])?.open ? null : o.hint?.bounds);
        if (objState.delete(id)) statusDirty = true;
        continue;
      }
      // Nothing to load (no provider here says what it is): drawn as its
      // hint, as anything is while its content hasn't arrived.
      if (tracked.has(id)) manager.untrack(id);
      queue.remove(id);
      applyHint(id, o.hint?.bounds);
      noteMissing(id, o);
    }
    for (const id of new Set([...tracked, ...scope.ids(), ...queue.ids(), ...displayKeys.keys()])) {
      if (objects[id]) continue;
      manager.untrack(id);
      queue.remove(id);
      routes.delete(id);
      scope.removeObject(id);
      if (objState.delete(id)) statusDirty = true;
      displayKeys.delete(id);
      hintKeys.delete(id);
      veils.delete(id);
      remotePosed.delete(id);
      playing.delete(id);
    }
    if (rerouted) displayChanged();
  }

  /**
   * An object routed nowhere: "no provider" while the registry lacks the one
   * it names (the doc names it, so the packages prompt can offer it), else no
   * state at all.
   */
  function noteMissing(id, o) {
    const want = typeof o.providerId === "string" && o.providerId && !sourceRegistry.has(o.providerId) ? o.providerId : null;
    const was = objState.get(id);
    if (want) {
      if (was?.phase === "no-provider" && was.providerId === want) return;
      objState.set(id, { content: null, phase: "no-provider", providerId: want });
      statusDirty = true;
    } else if (objState.delete(id)) statusDirty = true;
  }

  /** Draw the veil for these bounds in place of an object's content (veil.js): through the GLB path, so box and picking go by it. */
  function showVeil(id, vk, bounds) {
    let bytes = veilBytes.get(vk);
    if (!bytes) veilBytes.set(vk, (bytes = veilGLB(bounds)));
    Promise.resolve(scope.setGLB(id, bytes))
      .catch((err) => console.warn("[scene] the veil failed to draw", err))
      .then(() => {
        if (!dead) afterGLB();
      });
  }

  // ─── the audience ─────────────────────────────────────────────────────────

  // Who may see what an object is (STAGE.md, "Audience"): every running
  // extension's `audience(scene)` answer for it, merged (audience.js). Each
  // policy is asked once per snapshot. One that throws is read as "nobody"
  // (an `only` of no one): a broken screen hides, it never reveals.
  const policies = new WeakMap(); // instance → { scene, fn }
  const CLOSED = Object.freeze({ only: Object.freeze([]) });
  function audienceAnswers(id) {
    // a listed package isn't here, or an extension the doc calls for hasn't started (or failed to): one of
    // its policies may be missing, and a missing `only` would enlarge the audience
    if (!packages.complete() || !host.settled()) return null;
    const snap = scene();
    if (!snap.objects[id]) return [];
    const out = [];
    for (const r of host.instances()) {
      if (typeof r.instance.audience !== "function") continue;
      let p = policies.get(r.instance);
      if (!p || p.scene !== snap) {
        let fn = null;
        try {
          fn = r.instance.audience(snap);
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: audience failed`, err);
          fn = () => CLOSED;
        }
        policies.set(r.instance, (p = { scene: snap, fn: typeof fn === "function" ? fn : null }));
      }
      if (!p.fn) continue;
      try {
        out.push(p.fn(id) ?? null);
      } catch (err) {
        console.warn(`[scene] extension “${r.id}”: audience failed for ${id}`, err);
        out.push(CLOSED);
      }
    }
    return out;
  }
  /** "all" | viewer[] | null (unknown): who may see what `id` is. */
  const audienceOf = (id) => {
    const answers = audienceAnswers(id);
    return answers ? mergeAudience(answers) : null;
  };
  /** "all" | viewer[] | null (unknown): who `id` is turned toward, before anything screens it. */
  const shownTo = (id) => {
    const answers = audienceAnswers(id);
    return answers ? mergeShown(answers) : null;
  };

  // ─── what an edit did, for undo (HISTORY.md, TOOLS Decisions 2; src/undo.js) ──────
  // Judged when a step of the stage's own editing is recorded, from the doc
  // before its first change and after its last: `kept`, the names of the
  // objects it removed whose contents a keeper holds (bound by the trait of
  // an extension whose plugin says `keeper`: STAGE.md, "Keepers").

  /** The traits a keeper binds objects by: those of every registered extension whose plugin says `keeper`. */
  function keeperTraits() {
    const out = new Set();
    let list = [];
    try {
      list = patchworkPlugins.getRegistry("scene:extension")?.filter?.((p) => !!p?.keeper) ?? [];
    } catch {
      list = [];
    }
    for (const p of list) for (const t of Array.isArray(p.traits) ? p.traits : []) if (typeof t === "string") out.add(t);
    return out;
  }
  /** What a step did to one doc: the scene's, judged; another (a render doc) keeps nothing. */
  function judgeEdit({ handle: h, before, after }) {
    if (h !== handle || !before || !after) return null;
    const was = before.objects ?? {};
    const now = after.objects ?? {};
    const kept = [];
    const gone = Object.keys(was).filter((id) => !now[id]);
    if (gone.length) {
      const traits = keeperTraits();
      for (const id of gone) {
        const t = was[id]?.traits;
        if (t && typeof t === "object" && [...traits].some((k) => t[k] != null)) kept.push(String(was[id].name ?? id));
      }
    }
    return { kept };
  }

  // ─── presence ─────────────────────────────────────────────────────────────

  // its doc's channel: a read-only stage hears it and says nothing (its handle refuses to broadcast, too); a pin, a value, has none
  const channel = role !== "pinned";
  const presence = createPresence({ handle: channel ? handle : null, listen: readOnly, viewer, session: view.session, now: time.now, setTimer: (fn, ms) => time.after(ms, fn), clearTimer: (cancel) => cancel?.() });
  const remotePosed = new Set(); // object ids showing another view's pose
  const playing = new Set(); // of those, the ones still playing back (smooth.js)
  let poseLoopOff = null;

  /** Where another view's live hold is shown at `t` (our clock): its stream, played back a little late. */
  function playback(h, t) {
    if (!h.samples?.length) return { transform: h.transform, settled: true };
    return poseAt(h.samples, t - h.offset - playoutDelay(h.every), { ahead: aheadOf(h.every) }) ?? { transform: h.transform, settled: true };
  }

  // Another view's hold, shown here while its parent is the doc's parent; a
  // landed hold until the doc shows the same transform. Our own hold wins.
  // A live hold is played back between its samples, every frame, until it
  // has caught up with the last one (tickPoses).
  function applyRemoteHold(id) {
    if (dead || holds.has(id)) return;
    const h = presence.remoteHolds().get(id);
    const m = derive();
    const o = m.objects[id];
    let t = null;
    let settled = true;
    if (h && o && (m.parents.get(id) ?? null) === (h.parent ?? null)) {
      if (h.landed) {
        playing.delete(id);
        if (sameTransform(o.transform, h.landed)) return void presence.settle(id); // its watcher puts the doc's back
        t = h.landed;
      } else ({ transform: t, settled } = playback(h, time.now()));
    }
    if (t) {
      scope.setPose(id, t);
      remotePosed.add(id);
      if (settled) playing.delete(id);
      else {
        playing.add(id);
        startPoseLoop();
      }
    } else if (remotePosed.delete(id)) {
      playing.delete(id);
      scope.setPose(id, null);
    } else return;
    displayChanged();
  }

  /**
   * One frame of playback: every remote hold still playing moves to where its
   * stream is now. It runs before any extension's loop, so what they read
   * that frame (worldOf, raycast: a walker on a moving deck) is what's
   * drawn. It doesn't wake every extension's update: a pose moving between
   * samples isn't news, its samples were (applyRemoteHold).
   */
  function tickPoses(t = time.now()) {
    if (dead) return;
    const remote = presence.remoteHolds();
    for (const id of [...playing]) {
      const h = remote.get(id);
      if (!h || h.landed || holds.has(id) || !remotePosed.has(id)) {
        playing.delete(id);
        continue;
      }
      const p = playback(h, t);
      scope.setPose(id, p.transform);
      if (p.settled) playing.delete(id);
    }
    if (!playing.size) stopPoseLoop();
  }

  // The playback loop runs only while something is playing, so a still
  // scene isn't redrawn every frame. Without WebGL there are no frames to
  // join, so it keeps its own (what's shown still moves for worldOf).
  function startPoseLoop() {
    if (poseLoopOff || dead) return;
    if (viewport.ok) {
      poseLoopOff = viewport.addLoop(() => tickPoses(), { first: true });
      return;
    }
    let frame = null;
    const off = () => caf(frame);
    const step = () => {
      tickPoses();
      if (poseLoopOff === off) frame = raf(step);
    };
    frame = raf(step);
    poseLoopOff = off;
  }
  function stopPoseLoop() {
    const off = poseLoopOff;
    poseLoopOff = null;
    off?.();
  }

  /**
   * An object's displayed world matrix: the viewport's, which held and
   * played-back poses have moved; without WebGL, the doc's chain with each
   * shown pose in place of its transform.
   */
  function displayedWorld(oid) {
    const w = scope.worldOf(oid);
    if (w) return w;
    const m = derive();
    if (!m.objects[oid]) return null;
    if (!scope.posed) return scene().world(oid);
    let out = null;
    const seen = new Set();
    for (let id = oid; id != null && m.objects[id] && !seen.has(id); id = m.parents.get(id) ?? null) {
      seen.add(id);
      const local = composeMatrix(scope.poseOf(id) ?? m.objects[id].transform);
      out = out ? multiplyMatrices(local, out) : local;
    }
    return out;
  }
  cleanups.push(
    presence.watchHolds((_holds, ids) => {
      // a peer's hold that now ranks ahead of one here takes it (holds.js), then each is shown as it stands
      holds.reconcile(ids);
      ids.forEach(applyRemoteHold);
    }),
  );
  // What extensions tell (telling.js): a declared message is the stage's to hold to the doc and
  // say, by the speaker's name; anything else a peer sends is the extension's own `receive`.
  const telling = createTelling({
    now: time.now,
    after: (ms, fn) => time.after(ms, fn),
    scene: () => scene(),
    notify: (text, ext) => notify(text, "info", ext),
    find: (url) => view.repo?.find?.(url),
    alive: (ext, instance) => !dead && host.instanceOf(ext) === instance,
  });
  cleanups.push(() => telling.dispose());
  cleanups.push(
    presence.onReceive((ext, kind, data, from) => {
      const x = host.instanceOf(ext);
      if (declared(x, kind)) return telling.hear(ext, x, kind, data, from);
      if (typeof x?.receive !== "function") return;
      try {
        x.receive(kind, data, from);
      } catch (err) {
        console.warn(`[scene] extension “${ext}”: receive failed`, err);
      }
    }),
  );

  // This view's pose holds, in the one order (holds.js): a person's before a
  // yielding one, then the first; a peer's that ranks ahead takes it.
  const holds = createHolds({
    presence,
    exists: (id) => {
      const o = derive().objects[id];
      return !!o && !isGroup(o);
    },
    parentOf: (id) => derive().parents.get(id) ?? null,
    shown: (id, t) => {
      remotePosed.delete(id);
      playing.delete(id);
      scope.setPose(id, t);
      displayChanged();
    },
    unshown: (id) => {
      scope.setPose(id, null);
      applyRemoteHold(id);
      displayChanged();
    },
    lost: (ext, id) => owned.get(ext)?.holds.delete(id),
  });

  /** Hold an object's pose for an extension: true when the hold stands. */
  function holdPose(extId, own, id, transform, yields) {
    if (!writable()) return false;
    if (!holds.hold(extId, id, normalizeTransform(transform), { yields })) return false;
    own.holds.add(id);
    return true;
  }

  function releasePose(extId, own, id, landed) {
    const t = landed ? doc().objects?.[id]?.transform : null;
    if (holds.release(extId, id, t ? JSON.parse(JSON.stringify(normalizeTransform(t))) : undefined)) own.holds.delete(id);
  }

  // ─── claims ───────────────────────────────────────────────────────────────
  //
  // A claim is a fact about the shared world (who is at the helm, who
  // simulates the ship, whose hands a bucket is in), so it's a doc field on
  // what's claimed: objects[id].claims[kind] = { viewer, session }, or
  // doc.claims[kind] for the scene. Taking one writes it, letting go deletes
  // it. Concurrent takers are Automerge's to settle: both writes succeed
  // here, the merge keeps one on every peer, and the view whose claim isn't
  // there any more is told (onLost). A claim counts only while its session
  // is in presence (or is this view's), so a tab that died holding one
  // doesn't hold it forever and nothing has to clean up after it: the next
  // taker writes over it.

  const claims = new Map(); // claimKey → { id, kind, ext, onLost, release }: the claims this view holds
  const claimSeen = new Map(); // claimKey + session → when this view first read that claim with its holder absent
  const CLAIM_SEEN_MAX = 512;
  // Sessions this view has heard in presence. One that has gone (a bye, or
  // silent past the TTL) lapses at once; only one never heard gets the grace.
  const metSessions = new Set();
  const MET_MAX = 1024;
  cleanups.push(
    presence.watch((peers) => {
      for (const s of Object.keys(peers)) {
        if (metSessions.has(s)) continue;
        metSessions.add(s);
        if (metSessions.size > MET_MAX) metSessions.delete(metSessions.values().next().value);
      }
    }),
  );
  let away = false; // said goodbye on pagehide: claims are let go, and taken back on return
  const claimKey = (oid, kind) => `${oid ?? ""}\u0000${kind}`;
  const isKind = (kind) => typeof kind === "string" && kind.length > 0;

  /** The doc's claim of this kind on an object (null: the scene), as stored, or null. */
  function claimField(d, oid, kind) {
    const holder = oid == null ? d : d.objects?.[oid];
    const c = holder?.claims?.[kind];
    return c && typeof c === "object" && typeof c.session === "string" ? c : null;
  }

  /**
   * Who holds a claim: { viewer, session, mine }, or null when nobody does or
   * the holder's session has left presence. A claim by a session this view
   * has never heard from still counts for CLAIM_GRACE_MS from when it first
   * read it: its holder may have just joined, or this view may have.
   */
  function claimedBy(oid, kind) {
    // a claim counts only while its holder is on the doc's channel, and a pin has none
    if (!isKind(kind) || !channel) return null;
    const c = claimField(doc(), oid, kind);
    if (!c) return null;
    const viewerOf = typeof c.viewer === "string" ? c.viewer : null;
    if (c.session === presence.session) return Object.freeze({ viewer: viewerOf, session: c.session, mine: true });
    if (!Object.hasOwn(presence.get(), c.session)) {
      if (metSessions.has(c.session)) return null; // it was here, and has gone
      const key = `${claimKey(oid, kind)}\u0000${c.session}`;
      let first = claimSeen.get(key);
      if (first == null) {
        claimSeen.set(key, (first = time.now()));
        if (claimSeen.size > CLAIM_SEEN_MAX) claimSeen.delete(claimSeen.values().next().value);
      }
      if (time.now() - first >= CLAIM_GRACE_MS) return null; // lapsed
    }
    return Object.freeze({ viewer: viewerOf, session: c.session, mine: false });
  }

  /** Write this view's claims (a fresh map per object only when it has none). */
  function writeClaims(list) {
    if (!list.length) return;
    try {
      handle.change((d) => {
        for (const { id: oid, kind } of list) {
          const holder = oid == null ? d : d.objects?.[oid];
          if (!holder) continue;
          if (!holder.claims) holder.claims = {};
          holder.claims[kind] = { viewer, session: presence.session };
        }
      });
    } catch (err) {
      console.warn("[scene] couldn't write a claim", err);
    }
  }

  /** Delete these claims from the doc where they're still this view's. */
  function eraseClaims(list) {
    const d = doc();
    const mine = list.filter((e) => claimField(d, e.id, e.kind)?.session === presence.session);
    if (!mine.length) return;
    try {
      handle.change((draft) => {
        for (const { id: oid, kind } of mine) {
          const holder = oid == null ? draft : draft.objects?.[oid];
          if (holder?.claims?.[kind]?.session === presence.session) delete holder.claims[kind];
        }
      });
    } catch (err) {
      console.warn("[scene] couldn't let go of a claim", err);
    }
  }

  /**
   * Take a claim for an extension. Its release function, or null when
   * someone else (another view, or another extension here) holds it.
   * Taking it again from the same extension gives the same release.
   */
  function takeClaim(extId, own, oid, kind, onLost) {
    if (!isKind(kind) || dead || !writable()) return null;
    if (oid != null && !doc().objects?.[oid]) return null;
    const key = claimKey(oid, kind);
    const held = claims.get(key);
    if (held) {
      if (held.ext !== extId) return null;
      if (typeof onLost === "function") held.onLost = onLost;
      return held.release;
    }
    const now = claimedBy(oid, kind);
    if (now && !now.mine) return null;
    const entry = { id: oid, kind, ext: extId, onLost: typeof onLost === "function" ? onLost : null, release: null };
    entry.release = () => releaseClaim(entry);
    claims.set(key, entry);
    own.claims.add(entry);
    if (!away) writeClaims([entry]);
    return entry.release;
  }

  function releaseClaim(entry) {
    const key = claimKey(entry.id, entry.kind);
    if (claims.get(key) !== entry) return;
    claims.delete(key);
    owned.get(entry.ext)?.claims.delete(entry);
    eraseClaims([entry]);
  }

  // After a doc change (or coming back from the back-forward cache), look
  // at the claims this view holds. One whose field names someone else lost
  // the merge (or lapsed here and was taken): it's let go, and its taker is
  // told once. One whose field is missing lost no contest: two views each
  // giving an object its first claims map at once keep only one map, and
  // it may not be ours; that, or the goodbye on pagehide, is the only way a
  // field we hold goes missing, so it's written again. One whose object has
  // gone is lost. Done in a microtask, out of the doc's change event.
  let recheckQueued = false;
  function recheckClaims() {
    if (recheckQueued || dead || !claims.size) return;
    recheckQueued = true;
    queueMicrotask(() => {
      recheckQueued = false;
      if (dead || away) return;
      const d = doc();
      const lost = [];
      const rewrite = [];
      for (const e of claims.values()) {
        if (e.id != null && !d.objects?.[e.id]) lost.push(e);
        else {
          const c = claimField(d, e.id, e.kind);
          if (!c) rewrite.push(e);
          else if (c.session !== presence.session) lost.push(e);
        }
      }
      writeClaims(rewrite);
      for (const e of lost) {
        claims.delete(claimKey(e.id, e.kind));
        owned.get(e.ext)?.claims.delete(e);
        try {
          e.onLost?.();
        } catch (err) {
          console.warn(`[scene] extension “${e.ext}”: onLost failed`, err);
        }
      }
    });
  }

  // ─── the clock ────────────────────────────────────────────────────────────
  //
  // World time for this doc (clock.js; STAGE.md, "World time"): one "clock" claim, held
  // by the view that computes it and steps every process; the others
  // follow. The stage holds the claim itself, under the usual rules. What
  // the chip shows is local.clock.

  const clockOwn = { claims: new Set() };
  let hostMade = false; // (the host is made below, once makeApi exists)
  const visible = () => globalThis.document?.visibilityState !== "hidden";
  const clock = createClock({
    doc,
    change: (fn) => handle.change(fn),
    claim: {
      take: (onLost) => (away || dead ? null : takeClaim("scene:clock", clockOwn, null, CLOCK, onLost)),
      holder: () => claimedBy(null, CLOCK),
    },
    presence: {
      set: (sample) => presence.set(PRESENCE_NS, PRESENCE_KEY, sample),
      sample: (s) => presence.get()[s]?.keys?.[PRESENCE_NS]?.[PRESENCE_KEY] ?? null,
      shownAt: (s) => presence.shownAt(s),
      rate: (hz) => presence.rate(PRESENCE_NS, hz),
    },
    eligible: () => eligibility({ acts, writable: writable(), visible: visible(), settled: hostMade && host.settled(), complete: packages.complete() }),
    writable,
    viewer,
    now: time.now,
    onStatus: (status) => {
      if (dead) return;
      local.swap(assoc("clock", status));
      // (the view puts the focus path's together for the clock chip: view.clocks)
      view.clocksChanged();
    },
  });

  // Frames while anything moves: this view has a process, or someone computes.
  let clockLoopOff = null;
  function clockFrames() {
    if (dead) return;
    const want = clock.live();
    if (want && !clockLoopOff) {
      if (viewport.ok) clockLoopOff = viewport.addLoop(() => clock.tick(time.now()), { first: true });
      else {
        let frame = null;
        const off = () => caf(frame);
        const step = () => {
          clock.tick(time.now());
          if (clockLoopOff === off) frame = raf(step);
        };
        frame = raf(step);
        clockLoopOff = off;
      }
    } else if (!want && clockLoopOff) {
      const off = clockLoopOff;
      clockLoopOff = null;
      off();
    }
  }
  /** Something the clock depends on changed: take, keep or let go now, and run frames if wanted. */
  function clockCheck() {
    if (dead) return;
    clock.check();
    clockFrames();
  }
  cleanups.push(presence.watch(() => clockCheck()));
  const onVisibility = () => clockCheck();
  globalThis.document?.addEventListener?.("visibilitychange", onVisibility);
  cleanups.push(() => globalThis.document?.removeEventListener?.("visibilitychange", onVisibility));

  // ─── the update flush ─────────────────────────────────────────────────────

  let flushQueued = false;
  let flushFrame = null;
  let uiSpent = 0;
  let uiPasses = 0;
  let uiResetReq = null;
  const seen = new WeakMap(); // instance → { scene, local } it last updated with
  let scheduled = []; // [{ rec, fn }] (api.schedule)

  function spend(ms) {
    // (a manual clock's frames have no budget: what a pass cost on this CPU
    // mustn't decide which frame the next one runs in, or a probe's run
    // would depend on the machine; the pass count still spreads them)
    uiSpent += time.manual ? 0 : ms;
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
    const t0 = cpuNow();
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
      const vw = viewValue(r.scope === "general");
      const was = seen.get(r.instance);
      const changed = !was || was.scene !== snap || was.local !== loc || was.view !== vw;
      if (!changed && !content) continue;
      const now = { scene: snap, local: loc, view: vw };
      seen.set(r.instance, now);
      if (typeof r.instance.update !== "function") continue;
      try {
        r.instance.update(snap, loc, was ?? { scene: null, local: null, view: null }, vw);
        // What's shown changed in the same flush as the doc or local state
        // (a rebuilt GLB lands with its status going back to idle): say so
        // too, the one way the contract has (prev === this scene, local and view),
        // or a part that skips a status-only change never sees the new box.
        if (content && changed && was) r.instance.update(snap, loc, now, vw);
      } catch (err) {
        console.warn(`[scene] extension “${r.id}”: update failed`, err);
      }
    }
    // what was told and waits for the doc to bear it out: asked again now everyone has seen this flush
    telling.ask();
    view.tryArrive();
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
    // its ambients, stacked per name the same way, as frozen plain JSON (./ambients.js);
    // the outermost doc's are the world's (STAGE.md, "Views, stages and links"), which the view reads (view.ambient)
    const offered = mergeAmbients(
      running.map((r) => {
        try {
          return { id: r.id, offer: r.instance.ambient?.() ?? null };
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: ambient failed`, err);
          return { id: r.id, offer: null };
        }
      }),
      ambients,
      (ext, name, err) => console.warn(`[scene] extension “${ext}”: ambient “${name}” refused: ${err.message}`),
    );
    if (offered !== ambients) {
      ambients = offered;
      view.ambientsChanged?.();
    }
    const ms = cpuNow() - t0;
    spend(ms);
    perf.flush.add(ms);
  }

  // ─── ownership and the api ────────────────────────────────────────────────

  const owned = new Map(); // extension id → what it holds (see makeApi)
  const router = view.router;

  // An event of the router's (world, keys) in this stage's frame (./scope.js):
  // its hit is this stage's element of the hit's path ("not mine": id null),
  // its point, normal and distance, its ray and its widget's point, in this
  // stage's frame; a widget's owner is this stage's extension id when it is one.
  function eventIn(ev) {
    const f = scope.frame();
    const d = Object.getOwnPropertyDescriptors(ev);
    const memo = {};
    const lazy = (k, fn) => ({ enumerable: true, configurable: true, get: () => (k in memo ? memo[k] : (memo[k] = fn())) });
    return Object.defineProperties({}, {
      ...d,
      hit: lazy("hit", () => {
        const h = ev.hit;
        return h ? hitIn(f, h, h.id == null ? null : elementOfKey(h.id)) : null;
      }),
      ray: lazy("ray", () => rayIn(f, ev.ray)),
      widget: lazy("widget", () => {
        const w = ev.widget;
        if (!w) return w;
        const p = parseKey(w.owner);
        return { ...w, owner: p && p.n === n ? p.id : w.owner, ...(Array.isArray(w.point) ? { point: f.pointIn(w.point) } : {}), ...(Number.isFinite(w.distance) ? { distance: f.lengthIn(w.distance) } : {}) };
      }),
    });
  }
  // An input or a session whose every method hears the router's events in this stage's frame.
  const framedOf = new WeakMap();
  function framed(obj) {
    if (!obj || typeof obj !== "object") return obj;
    let f = framedOf.get(obj);
    if (!f)
      framedOf.set(
        obj,
        (f = new Proxy(obj, {
          get(target, k) {
            const v = Reflect.get(target, k, target);
            return typeof v === "function" ? (...args) => v.apply(target, args.map((a) => (isEvent(a) ? eventIn(a) : a))) : v;
          },
        })),
      );
    return f;
  }

  // A session an extension's press returned, counted while it's open (a
  // stopping extension lingers while it has one), hearing events in this stage's frame.
  function trackSession(own, raw) {
    if (!raw || typeof raw !== "object") return raw;
    const s = framed(raw);
    own.sessions++;
    let open = true;
    const done = () => {
      if (!open) return;
      open = false;
      own.sessions--;
    };
    const props = {
      end: { value: (ev) => (done(), s.end?.(ev)) },
      cancel: { value: () => (done(), s.cancel?.()) },
    };
    if (typeof raw.tap === "function")
      props.tap = {
        value: (ev) => {
          const r = s.tap(ev);
          if (r) done();
          return r;
        },
      };
    return Object.create(s, props);
  }

  // Input (an extension's, a body's or the held tool's) whose press sessions are counted, in this stage's frame.
  function withSessions(own, input, extra = {}) {
    const f = framed(input);
    return Object.create(f, {
      press: {
        get: () => (typeof input.press === "function" ? (ev) => trackSession(own, f.press(ev)) : undefined),
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

  // (a body it put on the stack, the held tool, an open session or a pose: a doc-caused stop waits)
  const busy = (id) => {
    const own = owned.get(id);
    return !!own && (own.bodies.size > 0 || own.tool != null || own.sessions > 0 || own.holds.size > 0);
  };

  function change(fn) {
    // null: nothing to do; a refusal (ops.js) writes nothing; a read-only stage writes nothing
    if (typeof fn !== "function" || fn.ok === false || !writable()) return;
    handle.change(fn);
  }

  // ─── edits: the stage's own, undone and redone (src/undo.js) ──────────────
  // This viewer's stacks, per focus doc (the one stage's, until links). A
  // step's writes are recorded from their own patches as they're made, so
  // nothing else written meanwhile (a process's save, a peer's merge) is
  // ever in it.
  const edits = createEdits({
    handle,
    judge: (part) => judgeEdit(part),
    writable: () => !dead && writable(),
    notify: (text) => notify(text),
    changed: (next) => {
      if (!dead) local.swap((m) => (m.edits && m.edits.undo === next.undo && m.edits.redo === next.redo ? m : { ...m, edits: Object.freeze(next) }));
    },
  });
  cleanups.push(() => edits.dispose());
  /** Write fn: as part of an edit when one is given, else plainly. */
  function write(edit, fn) {
    if (edit && typeof edit.change === "function") edit.change(fn);
    else change(fn);
  }

  const setPref = (key, value) => view.setPref(key, value);
  /** A pref: the viewer's, else this doc's suggestion (STAGE.md, "Views, stages and links"), else the fallback. */
  const pref = (key, fallback) => view.atom.get().prefs?.[key] ?? doc().view?.[key] ?? fallback;
  const notify = (text, kind = "info", from = null) => (dead ? null : view.notify(text, kind, from));

  /**
   * Remove in one change, after every running extension's beforeRemove
   * tidy-up. With `{ edit }` (an api.edits group), the change is that
   * edit's, and undo puts it all back.
   */
  function remove(ids, { edit = null } = {}) {
    if (!writable()) return null;
    const plan = ops.removeObjects(scene(), ids);
    if (!plan || !plan.ok) return plan;
    const running = host.instances();
    write(edit, (d) => {
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
   * Run a command as a value: { ext, command, target, value, hit? }. A
   * command whose state() says null (or disabled) for that target, in the
   * context every surface passes (`from` and `reach` from the body: a
   * `reach: true` command out of reach is disabled), doesn't run; one
   * without state() only runs for the scene (target null). It runs as
   * run(target, value, ctx), in the same context its state was asked in. A command that
   * declares `tool` is held: its run returns the tool's input, which goes in
   * the slot (running it again while held puts it down).
   * @returns {boolean} whether it ran
   */
  function run(invocation) {
    const { ext, command, target = null, value, hit = null } = invocation ?? {};
    const x = host.instanceOf(ext);
    let c = null;
    try {
      c = (x?.commands ?? []).find((k) => k?.id === command) ?? null;
    } catch {
      c = null;
    }
    if (!c || typeof c.run !== "function") return false;
    try {
      const ctx = context(hit);
      const st = commandState(c, target, ctx);
      if (!st || st.disabled) return false;
      if (c.tool) {
        const held = router?.held();
        if (held && held.owner === ownerKey(ext) && held.command === c.id) {
          if (value !== true) router.putDown();
          return true;
        }
        if (value === false) return true;
        const input = c.run(target, value, ctx);
        if (input && typeof input === "object") holdTool(ext, { command: c.id, name: c.name ?? c.id, ...(typeof c.tool === "object" ? c.tool : {}) }, input);
        return true;
      }
      c.run(target, value, ctx);
      return true;
    } catch (err) {
      console.warn(`[scene] extension “${ext}”: command ${command} failed`, err);
      return false;
    }
  }

  // ─── bodies, attention and the command context (STAGE.md, "The input chain") ──────────
  // The stack and the slot are the view's; a body or a tool an extension of
  // this stage puts there hears events in this stage's frame, and is its own
  // (a stopping extension's go with it).

  /** Every running extension's bodies, by id (the first to offer an id has it); the view asks only a stage that acts. */
  function bodyDefs() {
    const out = new Map();
    for (const { id: ext, value } of host.collect("bodies")) {
      for (const def of Array.isArray(value) ? value : []) {
        if (!def || typeof def.id !== "string" || typeof def.enter !== "function" || isStageBody(def.id)) continue;
        if (out.has(def.id)) {
          console.warn(`[scene] body “${def.id}” is offered by both ${out.get(def.id).ext} and ${ext}; ${out.get(def.id).ext}'s is used`);
          continue;
        }
        out.set(def.id, { ext, def });
      }
    }
    return out;
  }
  /** A body of this stage's going on the stack: its input, the extension's (null if it has stopped). */
  function bodyInput(ext, rec, input, left) {
    const own = owned.get(ext);
    if (!own) return null;
    own.bodies.add(rec);
    return withSessions(own, input, { left: { value: left } });
  }
  const bodyLeft = (rec) => owned.get(rec.ext)?.bodies.delete(rec);
  /** The eye, in this stage's frame: { position, direction } or null. */
  function bodyEye() {
    const e = view.bodyEye();
    if (!e) return null;
    const f = scope.frame();
    return { position: f.pointIn(e.position), direction: Array.isArray(e.direction) ? f.dirIn(e.direction) : null };
  }
  /** The top body's reach, in this stage's frame (m). */
  const bodyReach = () => scope.frame().lengthIn(view.bodyReach());
  const enterBody = (id, place = null) => view.enterBody(id, place, stage);

  /** Has the content shown loaded (or failed)? Without WebGL nothing loads: yes. */
  function contentIn() {
    if (!viewport.ok) return true;
    const status = local.get().status ?? {};
    for (const [oid, o] of Object.entries(doc().objects ?? {})) {
      // (an object with nothing to load, its shape its traits' data, is in)
      if (!showsContent(o) || o.visible === false) continue;
      // a link's content is its doc's, whose stage answers for it
      if (routes.get(oid) === "scene") continue;
      if (scope.contentOf(oid)?.loaded) continue;
      const st = status[oid]?.state;
      if (st === "error" || st === "warn") continue;
      return false;
    }
    return true;
  }

  /**
   * Hold a tool: its declaration ({ command?, name, keys, pointer }: the
   * command it was picked up through, if any) and the given input.
   */
  function holdTool(ext, t, input) {
    const own = owned.get(ext);
    if (!own) return noop;
    let put = null;
    const wrapped = withSessions(own, input, {
      put: {
        value: () => {
          if (own.tool === put) own.tool = null;
          return input.put?.call(input);
        },
      },
    });
    put = view.holdTool(ownerKey(ext), t, wrapped);
    own.tool = put;
    return put;
  }

  /** Where the look is, in this stage's frame, when it is on something of this stage's (or in one of its links): { id, point, distance }, else null. */
  function look() {
    return viewHitIn(view.look());
  }
  /** A hit of the view's (keys), in this stage's frame, when it is on something of this stage's (or in one of its links), else null. */
  function viewHitIn(h) {
    if (!h) return null;
    const el = elementOfKey(h.id);
    if (el == null) return null;
    const f = scope.frame();
    return { id: el, point: Array.isArray(h.point) ? f.pointIn(h.point) : null, distance: Number.isFinite(h.distance) ? f.lengthIn(h.distance) : null };
  }

  /** Attention (STAGE.md, "The input chain"): the selection if any, else the look; this stage's elements of them. */
  function attention() {
    const selected = viewValue().selected ?? null;
    return Object.freeze({ selected, hit: view.atom.get().selected != null ? null : look() });
  }

  /** How far a target is from the eye: to the hit when it's on the target (or under it), else to its box. */
  function distanceFrom(from, hit, target) {
    if (!Array.isArray(from) || target == null) return Infinity;
    if (hit?.id != null && lookChain(hit.id, derive().parents).includes(target)) {
      if (Number.isFinite(hit.distance)) return hit.distance;
      if (Array.isArray(hit.point)) return Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]);
    }
    const b = viewport.ok ? scope.objectBox(target, { hints: true }) : null;
    if (b) {
      const q = [0, 1, 2].map((i) => Math.max(b.min[i], Math.min(from[i], b.max[i])));
      return Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2]);
    }
    const m = displayedWorld(target);
    return m ? Math.hypot(m[12] - from[0], m[13] - from[1], m[14] - from[2]) : Infinity;
  }

  /**
   * The context every surface passes to a command's state and run: the
   * scene, local, the view, the eye (`from`), the body's `reach`, the look's
   * `hit` (when it's the surface's) and `distance(target)`; all in this stage's frame.
   */
  function context(hit = null) {
    const eye = bodyEye();
    const from = eye?.position ?? null;
    return { scene: scene(), local: local.get(), view: viewValue(), from, reach: bodyReach(), hit: hit ?? null, distance: (target) => distanceFrom(from, hit, target) };
  }

  async function providersFor(url, sourceDoc) {
    // (a scene in itself is a link whose expansion closes it: a cycle, links.js)
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
   * Add a document to the scene as an object: through `providerId` (else the
   * best match), with a render doc of its own when the provider's content is
   * "built", and none when it is "file".
   * @param {string} input  an automerge URL (or anything parseAutomergeLink reads)
   * @param {{ id?, providerId?, name?, group?, parent?, before?, transform?, heads?, hint?, fields?, render? }} [opts]
   *   id: the new object's id, made with newId beforehand (a copy maps every
   *   id before it writes anything, so its references are written once);
   *   refused when the scene has it;
   *   parent: attach to that object (and join its group, unless `group` says);
   *   group: file in that group; before: its place in the order; heads (or
   *   heads in the URL itself): add it fixed at that version of its source (`at`);
   *   fields: more of the object, written in the same change (a copy's traits,
   *   tags, colour…; never the fields above, nor `claims` or `saved`); render: a render
   *   doc to start the new one from (a copy's: its params, and its build when
   *   it was of this source by this provider; transfer.js renderSeed)
   * @returns {Promise<string>} the new object's id; rejects with a sentence to show
   */
  async function addObject(input, opts = {}) {
    if (!writable()) throw new Error("This scene is read-only here.");
    const link = parseAutomergeLink(input);
    if (!link) throw new Error("That doesn't look like an automerge URL.");
    const url = link.url;
    const heads = opts.heads?.length ? opts.heads : link.heads;
    let source;
    try {
      source = await repo.find(url);
    } catch (err) {
      throw new Error(`Couldn't open that document: ${err?.message ?? err}`);
    }
    const sourceDoc = source.doc();
    const info = describeSource(sourceDoc);
    if (dead) throw new Error("The scene was closed.");
    const providers = matchProviders(listProviders(), info);
    const provider = opts.providerId ? (providers.find((p) => p.id === opts.providerId) ?? null) : (providers[0] ?? null);
    if (!provider) {
      if (opts.providerId) throw new Error(`The provider “${opts.providerId}” can't show ${describeForHumans(info)}.`);
      throw new Error(`No scene provider is installed for ${describeForHumans(info)}.`);
    }
    const name = opts.name || (await titleOf(sourceDoc, info.datatype));
    // A "file" provider's source already is a GLB: no render doc, no copy (README.md, "`scene` — the composition").
    const renderHandle = contentOf(provider) !== "built" ? null : await repo.create2(seededRenderDoc(newRenderDoc({ title: name, parent: url, providerId: provider.id, params: defaultParams(provider.params) }), opts.render));
    if (renderHandle) createdHere.add(renderHandle.url);
    if (dead) throw new Error("The scene was closed.");
    const id = typeof opts.id === "string" && opts.id ? opts.id : newId("o");
    if (doc().objects?.[id]) throw new Error(`This scene already has an object “${id}”.`);
    const transform = opts.transform ? normalizeTransform(opts.transform) : IDENTITY();
    const hint = opts.hint && typeof opts.hint === "object" ? JSON.parse(JSON.stringify(opts.hint)) : null;
    // fresh copies: automerge won't take a value that is already in a document
    const fields = opts.fields && typeof opts.fields === "object" ? JSON.parse(JSON.stringify(opts.fields)) : null;
    write(opts.edit, (d) => {
      // only what is still there can be a place (someone may have removed it meanwhile)
      const parent = opts.parent && d.objects[opts.parent] && !isGroup(d.objects[opts.parent]) ? opts.parent : null;
      const groupWanted = opts.group !== undefined ? opts.group : parent ? resolveGroups(d.objects).get(parent) ?? null : null;
      const group = groupWanted && isGroup(d.objects[groupWanted]) ? groupWanted : null;
      d.objects[id] = ops.newObjectRecord({ name, sourceUrl: url, providerId: provider.id, renderUrl: renderHandle?.url ?? null, parent, group, transform });
      // the rest of a copied object: its traits, tags, colour… (never what's settled above)
      if (fields) for (const [k, v] of Object.entries(fields)) if (!ADD_OWNS.has(k) && v !== undefined) d.objects[id][k] = v;
      // what the file's maker said about it (ctx.file's hint): a placeholder box until it loads
      if (hint) d.objects[id].hint = hint;
      // A URL with heads names a version: show that one. (A file object is
      // shown straight from its file, so it has nothing to fix.)
      // A link with heads is a pinned value of that scene (links.js).
      if (heads?.length && (renderHandle || contentOf(provider) === "scene")) d.objects[id].at = { heads: [...heads] };
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
    // Hidden, so not loaded yet (README.md, "Using it": only what is shown
    // loads): an explicit rebuild loads it first.
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
   * built from, or null (not built here yet, not tracked, or not built content).
   * Writing it is the caller's: `ops.setField(scene, id, "at", point)`.
   */
  function fixPoint(id) {
    const o = doc().objects?.[id];
    // a link: its doc's heads, and every doc reached through it (the view's to say, from the stages it opened there)
    if (isLink(o)) return o.at ? null : view.fixPointAt([...path, id]);
    if (!o?.renderUrl || !manager.ids().includes(id)) return null;
    const point = manager.fixPoint(id);
    if (!point) return null;
    // fresh arrays: automerge won't take a value that is already in a document
    const out = { heads: [...point.heads] };
    const deps = Object.entries(point.deps ?? {});
    if (deps.length) out.deps = Object.fromEntries(deps.map(([u, h]) => [u, [...h]]));
    return out;
  }

  // ctx.file: the files being made here now, by key, so two drops at once
  // make one
  const filesMaking = new Map();

  /**
   * The scene's own file doc for `key` (STAGE.md, "Parts"): the one
   * doc.assets[key] names, else one made now from make() and remembered
   * there. Ten buoys share one GLB. Two peers making the same key at once
   * each write theirs if the key is still empty; the merge keeps one in
   * `assets`, and what each made keeps the file it made (two docs for one
   * key, both shown alike; later drops all use the one `assets` kept).
   * @param {string} key  namespaced and versioned: "sailing/mast@1"
   * @param {() => { name, bytes, extension, mimeType, hint? } | Promise<…>} make
   * @returns {Promise<{ url: string, hint: object | null }>}
   */
  async function sceneFile(key, make) {
    if (typeof key !== "string" || !key) throw new Error("A file needs a key.");
    const known = () => {
      const a = doc().assets?.[key];
      // fresh copies: automerge won't take a value that is already in a document
      return typeof a?.url === "string" ? { url: a.url, hint: a.hint ? JSON.parse(JSON.stringify(a.hint)) : null } : null;
    };
    const have = known();
    if (have) return have;
    if (!writable()) throw new Error("This scene is read-only here.");
    if (filesMaking.has(key)) return filesMaking.get(key);
    const making = (async () => {
      const f = await make();
      if (!f?.bytes) throw new Error(`Nothing to make “${key}” from.`);
      const file = await repo.create2({
        "@patchwork": { type: "file" },
        name: String(f.name ?? key),
        extension: String(f.extension ?? ""),
        mimeType: String(f.mimeType ?? "application/octet-stream"),
        content: f.bytes,
      });
      if (dead) throw new Error("The scene was closed.");
      const hint = f.hint ? JSON.parse(JSON.stringify(f.hint)) : null;
      handle.change((d) => {
        if (!d.assets[key]?.url) d.assets[key] = hint ? { url: file.url, hint } : { url: file.url };
      });
      return known() ?? { url: file.url, hint };
    })();
    filesMaking.set(key, making);
    try {
      return await making;
    } finally {
      filesMaking.delete(key);
    }
  }

  /**
   * What a drop handler, a template or a part gets (STAGE.md, "Drops"):
   * reads and writes, nothing to acquire. With `edit` (the stage's own add:
   * the add part, the outline, the parts bin), its change and addObject are
   * that edit's, so undo takes the whole layout out again.
   */
  function makeDropContext(id, { edit = null } = {}) {
    return Object.freeze({
      id,
      repo,
      handle,
      url: handle.url,
      viewer,
      doc,
      scene,
      change: edit ? (fn) => write(edit, fn) : change,
      newId,
      addObject: edit ? (input, opts = {}) => addObject(input, { ...opts, edit }) : addObject,
      file: sceneFile,
      // read-only: a part squaring itself to what it's dropped on reads that
      // object's GLB extras (a hull's stated bow)
      content: (oid) => scope.contentOf(oid),
      // read-only: an object's displayed world matrix (as api.worldOf), so a
      // drop on something moving lands where it's seen
      worldOf: displayedWorld,
      registry: getRegistry,
      local: Object.freeze({ get: local.get, swap: local.swap }),
      /** select one of this doc's objects (the view keeps the selection) */
      select: (oid) => view.select(oid == null ? null : [...path, oid]),
      notify: (text, kind) => notify(text, kind, id),
    });
  }

  /**
   * Put a part into the scene (STAGE.md, "Parts"): load the scene:part and
   * run its create(ctx, at) with a drop context. `at` is { parent, transform },
   * the transform in the parent's frame (world when parent is null); a parent
   * that isn't there (or is a group) means the scene root, transform as given.
   * The part gets `world` beside them, the same place in the world, for a
   * part that would rather not ride along with what it was put on.
   * What create returns is selected. Its id, or null.
   * @param {string} partId
   * @param {{ parent?: string | null, transform?: object } | null} [at]
   * @returns {Promise<string | null>}
   */
  async function applyPart(partId, at = null, { edit = null } = {}) {
    if (!writable()) return null;
    const reg = await getRegistry("scene:part");
    if (dead || !reg) return null;
    let mod;
    try {
      const loaded = await reg.load(partId);
      mod = loaded?.module?.default ?? loaded?.module;
    } catch (err) {
      notify(`Couldn't load that part: ${err?.message ?? err}`, "error");
      return null;
    }
    if (dead || typeof mod?.create !== "function") return null;
    const objects = doc().objects ?? {};
    const parent = typeof at?.parent === "string" && objects[at.parent] && !isGroup(objects[at.parent]) ? at.parent : null;
    const transform = normalizeTransform(at?.transform);
    const parentWorld = parent ? displayedWorld(parent) : null;
    const world = parentWorld ? normalizeTransform(decomposeMatrix(multiplyMatrices(parentWorld, composeMatrix(transform)))) : transform;
    const place = Object.freeze({ parent, transform, world });
    let made;
    try {
      made = await mod.create(makeDropContext(partId, { edit }), place);
    } catch (err) {
      notify(`That part failed: ${err?.message ?? err}`, "error");
      return null;
    }
    if (dead) return null;
    const id = typeof made === "string" && doc().objects?.[made] ? made : null;
    if (id) view.select([...path, id]);
    return id;
  }

  /**
   * Start the scene from a template (STAGE.md, "Templates"): load the
   * scene:template and run its create() with a drop context, which writes
   * whatever it needs into the doc. Then this viewer starts where the doc now
   * says, as arriving does (an arena's template starts people walking at a
   * spawn point, so its maker lands in the game). create gets exactly the
   * params its metadata declares (`params`: ParamSpecs), coerced, defaults
   * filled and every other key dropped: `{}` for a template that declares
   * none. True when it ran.
   * @param {string} templateId
   * @param {object} [params]
   * @returns {Promise<boolean>}
   */
  async function applyTemplate(templateId, params) {
    if (!writable()) return false;
    const reg = await getRegistry("scene:template");
    if (dead || !reg) return false;
    let mod, specs;
    try {
      const loaded = await reg.load(templateId);
      mod = loaded?.module?.default ?? loaded?.module;
      specs = Array.isArray(loaded?.params) ? loaded.params : [];
    } catch (err) {
      notify(`Couldn't load that template: ${err?.message ?? err}`, "error");
      return false;
    }
    if (dead) return false;
    if (typeof mod?.create !== "function") return false;
    try {
      await mod.create(makeDropContext(templateId), paramsBySpec(specs, params));
    } catch (err) {
      notify(`That template failed: ${err?.message ?? err}`, "error");
      return false;
    }
    if (dead) return false;
    if (n === 0) view.arrive();
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
      bodies: new Set(), // the bodies it put on the stack (sittings)
      tool: null, // put(): the held tool is its
      sessions: 0, // open press sessions
      holds: new Set(), // object ids whose pose it holds
      processes: new Set(), // its processes' removals (api.clock.process)
      claims: new Set(), // the claims it holds (entries in `claims`)
      cameraHolds: new Set(),
      frame: new Set(), // loops and afterRender hooks
      offs: new Set(), // listeners, watchers, rides
      els: new Set(), // overlays, edges, styles
    };
    owned.set(id, own);
    const live = () => !signal.aborted && !dead;
    // Acquire something, unless stopped; the returned off gives it back once.
    /** A one-shot callback set through `set` (time.after or time.frame), cancelled if the extension stops first. */
    const timed = (o, set, fn) => {
      if (!live() || typeof fn !== "function") return noop;
      let cancel = null;
      const off = () => {
        if (o.offs.delete(off)) cancel();
      };
      cancel = set((...args) => {
        if (!o.offs.delete(off) || !live()) return;
        fn(...args);
      });
      o.offs.add(off);
      return off;
    };
    const acquire = (bag, take) => {
      if (!live()) return noop;
      const give = take();
      if (typeof give !== "function") return noop;
      bag.add(give);
      return () => {
        if (bag.delete(give)) give();
      };
    };
    const general = rec.scope === "general";
    const viewNow = () => viewValue(general);
    let watched = viewNow(); // what api.view.watch last told of
    const ownEl = (el, parent) => {
      if (!live()) return el;
      own.els.add(el);
      // (which stage it is: several docs' extensions share one view's DOM)
      el.dataset.stage = String(n);
      // (the drawer stays outermost: an edge part started while it's open goes inside it)
      if (drawer.el.parentNode === parent) parent.insertBefore(el, drawer.el);
      else parent.append(el);
      return el;
    };

    const api = {
      // doc and identity
      id,
      repo,
      handle,
      url: handle.url,
      viewer,
      /** this view's presence session: what its claims and holds name (it changes on coming back from the back-forward cache) */
      get session() {
        return presence.session;
      },
      signal,
      doc,
      change,
      /** may this view write the doc? (not in a pin or a mirror, nor where the handle refuses: Keyhive's to answer, in time) */
      writable,
      newId,
      scene,
      ops,
      remove,
      registry: getRegistry,
      /** the element the canvas fills, and the stage's root (for DOM listeners: drops, paste) */
      port,
      root,
      /** where an object's content was routed (`content`: "built", "file" or null) and what the manager or the queue last said about it (notes, contested, providerId…) */
      loadState: (oid) => {
        const s = objState.get(oid);
        if (!s && !routes.has(oid)) return null;
        return Object.freeze({ ...s, content: routes.get(oid) ?? null });
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
      /**
       * The viewer's (STAGE.md, "Views, stages and links"), as this stage sees it: the body,
       * the held tool, the pointer, theme, notices, prefs, the drawer, and
       * the selection and hover as this stage's elements of their paths.
       * select(target) selects this stage's target (null: nothing).
       */
      view: Object.freeze({
        get: viewNow,
        watch: (fn, select) =>
          acquire(own.offs, () =>
            view.atom.watch(() => {
              const next = viewNow();
              const prev = watched;
              watched = next;
              if (next === prev) return;
              if (typeof select === "function" ? select(next) !== select(prev) : true) fn(next, prev);
            }),
          ),
        select: (target) => {
          if (live()) view.select(target == null ? null : [...path, target]);
        },
        /** move the focus into this stage's link `target` (where its doc acts: a mirror's, where it's live): false if it can't be entered */
        enter: (target) => (live() && target != null ? view.enter([...path, target]) : false),
        /**
         * dock a document in the drawer ({ url, toolId?, title }): the view's, not this extension's, so it
         * stays until its × or close(); docking one url and tool again shows its tab (dock.js). → close
         */
        dock: (doc) => (live() ? view.dockDocument(doc) : noop),
        // (leaving is the view's: Escape's last rung, the trail; no stage learns whether there's anywhere to leave)
        // a general part, the view's own, is told what moving the focus closed of its: was a tab
        // titled `title` open as the focus last moved here? Once per title per move ({ show } | null)
        ...(general ? { reopened: (title) => (live() ? view.reopened(String(title)) : null) } : {}),
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
      // say it here as "You" and send it; each peer's stage tells it once its doc bears it out (instance.messages)
      // (a view that can't write the doc has done nothing it could bear out: it tells nothing)
      tell: (type, data) => {
        if (!live() || !writable()) return;
        const x = host.instanceOf(id);
        if (!declared(x, type)) return void console.warn(`[scene] extension “${id}”: tell(“${type}”) isn't among its messages`);
        let copy;
        try {
          copy = structuredClone(data ?? null);
        } catch {
          return void console.warn(`[scene] extension “${id}”: tell(“${type}”) data isn't plain`);
        }
        if (telling.say(id, x, type, copy, viewer)) presence.send(id, type, copy);
      },
      notify: (text, kind) => notify(text, kind, id),
      /**
       * the listed packages this viewer doesn't have (local.packages): load them (a yes), or don't ask
       * again in this view. A general part's, the view's own: every open doc's (view.packages)
       */
      packages: general ? view.packages : Object.freeze({ load: (urls) => packages.load(urls), dismiss: (urls) => packages.dismiss(urls) }),

      // content
      nameOf,
      content: (oid) => scope.contentOf(oid),
      box: (oid, { hints = true, in: frameId = null } = {}) => scope.objectBox(oid, { hints, in: frameId }),
      groupBox: (gid, { hints = true } = {}) => scope.groupBox(gid, { hints }),
      sceneBox: () => scope.sceneBox(),
      worldOf: displayedWorld,
      focus: (ids) => {
        if (!live()) return;
        const list = ids == null ? [] : typeof ids === "string" ? [ids] : [...ids];
        if (list.length) focusBy.set(id, new Set(list));
        else focusBy.delete(id);
        applyDoc(derive());
      },
      providersFor,
      /** a link of this doc's, as the view has it: { role: "acting" | "mirror" | "pinned" | "closed", open, reason? } (open: its doc is drawn, else its hint), or null (not a link, or not expanded yet) */
      link: (oid) => view.linkState([...path, oid]),
      addObject,
      fixPoint,
      drop: (info, opts) => (writable() ? host.drop(info, opts) : Promise.resolve(false)),
      template: (templateId, params) => applyTemplate(templateId, params),
      part: (partId, at, opts) => applyPart(partId, at, opts),
      /**
       * The stage's own editing (HISTORY.md, TOOLS Decisions 2), on the stage's own
       * parts' api only (own.js): edit(fn, { label, handle? }) writes fn as
       * one undoable step (on the scene, or on `handle`: an object's render
       * doc); edits(label) opens a step of several writes, passed as
       * `{ edit }` to addObject, remove, drop and part or made with its
       * change(fn, handle?), closed by end(). A package's api has none of
       * these, so verbs, clock acts and process saves can't be on a stack.
       */
      ...(isOwn(rec.module)
        ? {
            edit: (fn, { label, handle: h } = {}) => {
              if (!writable()) return;
              const g = edits.begin(label);
              g.change(fn, h);
              g.end();
            },
            edits: (label) => (writable() ? edits.begin(label) : NO_EDIT),
            /** undo or redo this viewer's last edit in the focus doc: false when there's none or it has been changed since */
            undo: () => edits.take("undo"),
            redo: () => edits.take("redo"),
          }
        : {}),

      // picking and camera
      pick: (x, y, opts) => scope.pick(x, y, opts),
      ray: (x, y) => scope.ray(x, y),
      raycast: (origin, dir, opts) => scope.raycast(origin, dir, opts),
      project: (p) => scope.project(p),
      camera: Object.freeze({
        // in this stage's frame (./scope.js): { position, target, fov, up }; the three.js camera is the view's, never an extension's
        get: () => scope.camera.get(),
        set: (cam) => scope.camera.set(cam),
        frame: (box) => scope.camera.frame(box),
        hold: () => acquire(own.cameraHolds, () => viewport.hold()),
        /** carry the orbit camera with a moving object (STAGE.md): a base ride, the latest applying while the current body has no ride of its own; null rides this stage's root */
        ride: (oid, opts) => acquire(own.offs, () => scope.camera.ride(oid ?? null, opts)),
        /** has the camera been placed for this viewer: moved by them or restored as they opened the view (nothing frames it on its own then)? To a general part, the view's own, also: carried across a focus move */
        touched: () => viewport.touched() || view.cameraPlaced || (general && view.cameraCarried),
        watch: (fn) => acquire(own.offs, () => scope.camera.watch(fn)),
        /** someone finished moving the camera (an orbit, a zoom, a Frame); never while it's held */
        onEnd: (fn) => acquire(own.offs, () => viewport.onCameraEnd(fn)),
      }),

      // drawing
      THREE,
      world: ({ onTop = false } = {}) => (live() ? scope.worldLayer(id, { onTop }) : new THREE.Group()),
      // each call is its own set (an extension may keep several)
      labels: () => {
        const key = `${id}#${(own.labelSets = (own.labelSets ?? 0) + 1)}`;
        own.labelKeys = [...(own.labelKeys ?? []), key];
        return Object.freeze({
          set: (items) => {
            if (live()) scope.labels.sync(key, items ?? []);
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
      /** dock an element of this extension's in the drawer, under a tab: closed by close(), its × (which calls onClose), or the extension stopping */
      dock: (el, { title, onClose, embed = true, show = true } = {}) => {
        if (!live() || !el) return noop;
        // an open drawer wants the pointer (stage/pointer.js)
        const close = acquire(own.offs, () => {
          const off = drawer.dock(ownerKey(id), el, { title, embed, show, onClose: () => (onClose?.(), queueMicrotask(() => router?.refresh())) });
          return () => (off?.(), router?.refresh());
        });
        router?.refresh();
        return close;
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
        if (live()) view.cursor(ownerKey(id), name);
      },
      pose: Object.freeze({
        /** true when the hold stands: false while another's ranks ahead (a person's before a yielding one, then the first) */
        hold: (oid, transform, { yields = false } = {}) => live() && holdPose(id, own, oid, transform, yields),
        release: (oid, { landed = false } = {}) => releasePose(id, own, oid, landed),
      }),
      heldBy: (oid, opts) => presence.heldBy(oid, opts),
      claim: (oid, kind, { onLost } = {}) => (live() ? takeClaim(id, own, oid ?? null, kind, onLost) : null),
      claimedBy: (oid, kind) => claimedBy(oid ?? null, kind),
      extent: (box) => {
        if (live()) scope.setExtent(id, box ?? null);
      },
      /**
       * One of the world's ambients (STAGE.md, "Ambients"): the outermost
       * doc's value under `name` (frozen plain JSON, the same object until it
       * changes), with `mine` (this is the outermost stage), this stage's
       * frame (scope.js: the world is the outermost's root) and the
       * outermost's world time as of now; null when it offers none.
       */
      ambient: (name) => {
        const value = view.ambient(name);
        if (value === undefined) return null;
        const world = view.outermost();
        return Object.freeze({ value, mine: world === stage, frame: scope.frame(), clock: Object.freeze(world.worldTime()) });
      },
      invalidate: () => viewport.invalidate(),
      loop: (fn) => acquire(own.frame, () => viewport.addLoop(fn)),
      afterRender: (fn) => acquire(own.frame, () => viewport.afterRender(fn)),
      /**
       * World time (STAGE.md, "World time"): this view's t (s), running, pause and
       * resume (anyone who may write), and process({ start?, step, save?,
       * stop?, replicated? }) → remove. And the stage's own time (time.js),
       * which acts and liveness run on: now() (ms), after(ms, fn) → cancel,
       * frame(fn) → cancel (fn(now) once, at the next frame); what they set
       * is cancelled when the extension stops.
       */
      clock: Object.freeze({
        now: () => time.now(),
        after: (ms, fn) => timed(own, (cb) => time.after(ms, cb), fn),
        frame: (fn) => timed(own, (cb) => time.frame(cb), fn),
        t: () => clock.t(),
        running: () => clock.running(),
        /** who computes this doc's world time: { viewer, session, mine }, or null (nobody: no time passes) */
        computer: () => claimedBy(null, CLOCK),
        pause: () => clock.pause(),
        resume: () => clock.resume(),
        process: (spec) => {
          const off = acquire(own.processes, () => clock.process(spec));
          clockFrames();
          return off;
        },
      }),
      schedule: (fn) => {
        if (!live() || typeof fn !== "function") return;
        scheduled.push({ rec, fn });
        requestFlush();
      },

      // bodies, the held tool, attention (STAGE.md, "The input chain"–§5)
      body: Object.freeze({
        /** the top body: { id, label, ext, depth, lock, reach, keys } (as local.body) */
        current: () => viewNow().body,
        /** enter body `id` (any running extension's, or the stage's "look" or "edit") at `place`: false if none offers it or it can't */
        enter: (bid, place) => (live() ? enterBody(bid, place) : false),
        /** leave the top body (never the base: Look or Edit) */
        leave: () => (live() ? view.leaveBody() : false),
        /** the eye: { position, direction } in this stage's frame, or null */
        eye: () => bodyEye(),
        /** the top body's reach (m; Look's and Edit's are Infinity) */
        reach: () => bodyReach(),
      }),
      /**
       * Hold a tool not picked up through a command (bag's drawn piece in
       * hand): its declaration { name, keys?: [{ code, label }], pointer? }
       * and its input. Whatever was held is put down. @returns put
       */
      hold: (tool, input) => {
        if (!live() || !input || !tool || typeof tool.name !== "string") return noop;
        return holdTool(id, { command: null, name: tool.name, keys: tool.keys, pointer: tool.pointer }, input);
      },
      /** an open menu or dialog: it wants the pointer, and Escape closes it (close()). @returns release, for when it closes itself */
      popover: (close) => (live() && typeof close === "function" ? acquire(own.offs, () => router.popover(ownerKey(id), close)) : noop),
      /** the context every surface passes to commands (scene, local, from, reach, hit, distance) */
      context: (hit) => context(hit),
      /** attention: { selected, hit } (the selection, else the look) */
      attention: () => attention(),
      /** the look: under lock the eye ray's hit, else the pointer's; { id, point, distance } or null */
      look: () => look(),

      // the others (STAGE.md, "Views, stages and links"): a stage's extension collects from its own
      // stage; a general one, the view's, from every acting stage (the input
      // path's first, innermost first), each item tagged with its `stage`, and
      // runs a command in the stage it names
      collect: (name) => (rec.scope === "general" ? view.collect(name) : reader.collect(name)),
      /**
       * the input path's stages, innermost first: each { stage, scene, collect, context, attention, look, pointed, run, nameOf } (pointer: true for the pointer's path, what a menu is of, not the selection's or the eye's; focus: true for the focus path, the focus stage out to the outermost; at: a full path, a held verb's target's).
       * A general part's only: the other stages' readers are other docs (their packages, their scenes, what they run), which a stage's extension reading would make it depend on its placement (I4)
       */
      path: general ? (o) => view.inputPath(o) : undefined,
      audience: audienceOf,
      shown: shownTo,
      // (in another stage only if it acts: a pin or a mirror is never acted on)
      run: (inv) => (inv?.stage != null && inv.stage !== n ? (view.acting().find((s) => s.n === inv.stage)?.reader.run(inv) ?? false) : run(inv)),
    };

    function release() {
      // 1–2: its open session, its bodies and its held tool (the router
      // cancels, pops, puts down and unlocks), then its camera holds
      router.stopOwner(ownerKey(id));
      view.leaveBodiesOf(stage, id);
      own.tool = null;
      own.sessions = 0;
      for (const give of [...own.cameraHolds]) give();
      own.cameraHolds.clear();
      // 3: its processes (saved first, where this view computes them), its
      // pose holds, put back, and its claims, let go
      for (const give of [...own.processes]) give();
      own.processes.clear();
      clockFrames();
      for (const oid of [...own.holds]) releasePose(id, own, oid, false);
      for (const e of [...own.claims]) releaseClaim(e);
      // 4: its presence keys (and its rate)
      presence.clear(id);
      // 5: loops, afterRender hooks, scheduled work
      for (const give of [...own.frame]) give();
      own.frame.clear();
      scheduled = scheduled.filter((s) => s.rec !== rec);
      // 6: its world groups
      scope.removeLayers(id);
      // 7: labels, overlays, edges, docked panes, styles, listeners and watchers, cursor, extent, focus
      for (const key of own.labelKeys ?? []) scope.labels.clear(key);
      drawer.closeOwner(ownerKey(id));
      router.refresh();
      for (const el of own.els) el.remove();
      own.els.clear();
      for (const give of [...own.offs]) give();
      own.offs.clear();
      view.cursor(ownerKey(id), null);
      scope.setExtent(id, null);
      if (focusBy.delete(id) && !dead) applyDoc(derive());
      owned.delete(id);
    }

    return { api: acts ? api : drawnApi(api), release };
  }

  /**
   * A drawn stage's api (STAGE.md, "Views, stages and links"): the acting api less everything
   * that acts, all in this one place. A pin's or a mirror's extensions run
   * and draw into the world (layers, labels, looks, styles) and read all
   * they like; what would take input, put chrome in the view, move the
   * viewer's camera, select, notify, set a pref, enter a body, hold a tool,
   * compute or run a command is inert here: a noop, an element kept out of
   * the DOM, or the answer the acting api gives when it can't. Writes need
   * nothing here: a drawn stage is read-only, so writable() is false and
   * each write refuses on that, the handle and repo it holds refuse too
   * (./readonly.js), and the view never asks it for a segment, a body or a
   * widget (view.acting()).
   */
  function drawnApi(api) {
    const facet = (base, over) => Object.freeze(Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(base), ...Object.getOwnPropertyDescriptors(over) }));
    const loose = (className) => Object.assign(document.createElement("div"), { className });
    return facet(api, {
      view: facet(api.view, { select: noop, enter: () => false }),
      setPref: noop,
      notify: () => null,
      overlay: () => loose("stage-overlay"),
      edge: () => loose("stage-edge-part"),
      dock: () => noop,
      popover: () => noop,
      cursor: noop,
      camera: facet(api.camera, { set: noop, frame: noop, hold: () => noop, ride: () => noop }),
      clock: facet(api.clock, { process: () => noop }),
      body: facet(api.body, { enter: () => false, leave: () => false }),
      hold: () => noop,
      run: () => false,
    });
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
    setTimer: (fn, ms) => time.after(ms, fn),
    clearTimer: (cancel) => cancel?.(),
    general,
  });
  hostMade = true;

  // ─── what the view asks of this stage ──────────────────────────────────────

  // Its extensions' widgets under the pointer (each hearing the event in this
  // stage's frame), owners as the view's keys, distances in the world.
  function widgetsAt(ev) {
    const out = [];
    const f = scope.frame();
    for (const r of host.offering()) {
      const input = r.instance.input;
      if (typeof input?.widgetAt !== "function") continue;
      try {
        const w = input.widgetAt(eventIn(ev));
        if (w && typeof w === "object") out.push({ ...w, owner: ownerKey(r.id), onTop: !!w.onTop, ...(Number.isFinite(w.distance) ? { distance: f.lengthOut(w.distance) } : {}) });
      } catch (err) {
        console.warn(`[scene] extension “${r.id}”: widgetAt failed`, err);
      }
    }
    return out;
  }

  // This stage's segment of the chain (STAGE.md, "The input chain") for its element of
  // the hit's path: its holders, nearest first, then its root's. The general
  // ones (it runs them while it is the focus) are the view's, offered after
  // every segment: generals().
  function segment(element) {
    const running = host.running().filter((r) => r.scope !== "general");
    const m = derive();
    const chain = element != null && m.objects[element] ? hitChain(element, m.parents, m.groups, m.objects) : [];
    const holders = holdersFor(running, chain, (oid) => traitKeys(oid == null ? m.d : m.objects[oid]));
    const order = chainOrder({ running, holders });
    return { order, holderOf: (ext) => holders.get(ext)?.id ?? null };
  }
  /** The general extensions it runs (while it is the focus), in running order: not one the view moved away that still finishes what it holds. */
  const generals = () => host.offering().filter((r) => r.scope === "general").map((r) => r.id);

  /** One of this stage's extensions' commands, or null. */
  function commandOf(ext, command) {
    try {
      return (host.instanceOf(ext)?.commands ?? []).find((k) => k?.id === command) ?? null;
    } catch {
      return null;
    }
  }

  // ─── the stage's atom, the flush ──────────────────────────────────────────

  cleanups.push(local.watch(() => requestFlush()));

  // ─── leaving the page (the view's pagehide and pageshow) ──────────────────
  // It lets go of its claims and says bye at once; restored from the
  // back-forward cache, it comes back as the view's new session and takes its
  // claims back (unless someone else has taken one meanwhile: then that
  // extension is told it lost it).
  function pageHide() {
    if (away) return;
    // world time stops here first: a checkpoint, and the clock let go
    clock.letGo();
    eraseClaims([...claims.values()]);
    away = true;
    presence.goodbye();
  }
  function pageShow(session) {
    if (!away) return;
    away = false;
    presence.hello(session);
    recheckClaims();
    clockCheck();
  }

  // ─── the doc loop ─────────────────────────────────────────────────────────

  function sync() {
    if (dead) return;
    const d = doc();
    const t0 = cpuNow();
    const m = derive();
    host.sync(d);
    applyDoc(m);
    // other views' holds: a landed one the doc has caught up with goes, and a
    // hold whose parent the doc changed is shown (or not) again
    for (const id of [...presence.remoteHolds().keys()]) applyRemoteHold(id);
    recheckClaims();
    packages.check();
    clockCheck();
    requestFlush();
    // its links may have changed: the view works out what it opens again
    view.relink();
    perf.sync.add(cpuNow() - t0);
  }
  handle.on("change", sync);
  cleanups.push(() => handle.off("change", sync));

  // ─── probes ───────────────────────────────────────────────────────────────

  const debug = {
    get renderer() {
      return viewport.renderer ?? null;
    },
    viewport,
    /** what a probe reads as "local": this stage's atom and the view's as it sees it, in one value */
    local: Object.freeze({ get: () => ({ ...viewValue(), ...local.get() }), swap: (fn) => local.swap(fn) }),
    stageLocal: local,
    view,
    host,
    router,
    presence,
    telling,
    perf,
    queue,
    manager,
    packages,
    root,
    scene,
    looks: () => looks,
    /** the objects shown as a veil: id → the key of its drawing */
    veils: () => new Map(veils),
    audience: audienceOf,
    shown: shownTo,
    /** its ambients (./ambients.js), the atmosphere among them */
    ambients: () => ambients,
    /** the drawer: the docked elements in tab order, and the one shown */
    drawer: () => drawer.state(),
    /** does this extension hold a body, the held tool, an open session or a pose (so a doc-caused stop waits)? */
    busy,
    /** one frame of remote pose playback at `t` (ms, this stage's time.now()), for tests */
    tickPoses,
    /** the doc's clock here (clock.js): t, status, tick(at), check() */
    clock,
    /** does it act ("acting"), or is it drawn ("mirror", "pinned")? */
    role,
    /** the claims this view holds: [{ id, kind, ext }] */
    claims: () => [...claims.values()].map(({ id, kind, ext }) => ({ id, kind, ext })),
    stats: () => ({
      render: { ...viewport.stats },
      queue: queue.stats(),
      subscriptions: queue.subscriptions(),
      pending: queue.pending(),
      loaded: [...viewport.objects.values()].filter((e) => e.content).length,
    }),
  };

  function dispose() {
    if (dead) return;
    // world time stops first (one checkpoint, with every process's save), then
    // the extensions, while everything they hold is still there to give back
    clock.dispose();
    host.dispose();
    clockLoopOff?.();
    clockLoopOff = null;
    stopPoseLoop();
    dead = true;
    presence.dispose();
    if (flushFrame != null) caf(flushFrame);
    if (uiResetReq != null) caf(uiResetReq);
    for (const cancel of timers) cancel();
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
    for (const id of scope.ids()) scope.removeObject(id);
    view.removeStage(stage);
    if (root.__sceneDebug === debug) delete root.__sceneDebug;
    if (globalThis.__sceneDebug === debug) delete globalThis.__sceneDebug;
  }

  // what the view's general parts read of this stage, and run in it
  const reader = Object.freeze({
    stage: n,
    /** its path in the view (the links from the outermost in): a full path's prefix names the stage its last id is in */
    path: Object.freeze([...path]),
    scene,
    /** does it run this extension now? */
    runs: (extId) => host.running().some((r) => r.id === extId),
    collect: (name) => host.collect(name).map((x) => ({ ...x, stage: n })),
    context: (hit) => context(hit),
    attention: () => attention(),
    look: () => look(),
    /** the pointer's hit (the last hover, which a press sets to what it pressed), in this stage's frame: what a menu is of */
    pointed: () => viewHitIn(view.pointed()),
    run: (inv) => run(inv),
    nameOf: (oid) => nameOf(oid),
    /** its doc's packages this viewer doesn't have (local.packages; the view asks every open doc's together) */
    packages: () => local.get().packages,
    /** may this view write its doc? */
    writable: () => writable(),
    /** its doc's world time: what its chip shows (local.clock: ./clock.js status, null with no process), and pause or resume it by name (anyone who may write) */
    clock: Object.freeze({ status: () => local.get().clock, pause: () => clock.pause(), resume: () => clock.resume() }),
  });

  stage = Object.freeze({
    n,
    reader,
    role,
    acts,
    /** the docs found through its repo, url → handle (a link's fixPoint holds their heads) */
    reached,
    path: Object.freeze([...path]),
    url: handle.url ?? null,
    /** what its extensions offer as ambients (./ambients.js): the world's, read through api.ambient, when it's the outermost */
    ambients: () => ambients,
    /** its doc's world time now: { t, running } (what api.ambient's clock says of the outermost) */
    worldTime: () => ({ t: clock.t(), running: clock.running() }),
    handle,
    doc,
    scene,
    scope,
    frame: () => scope.frame(),
    packages,
    debug,
    requestFlush,
    starting: () => host.starting(),
    contentIn,
    bodyDefs,
    bodyInput,
    bodyLeft,
    commandOf,
    inputOf,
    widgetsAt,
    segment,
    generals,
    /** what the view says of the viewer on this doc's channel: its body and held tool (presence.announce) */
    announce: (state) => presence.announce(state),
    /** run the general extensions here (it is the focus), or not: the view's to say (view.js) */
    setGeneral: (on) => host.setGeneral(on),
    displayedWorld,
    pageHide,
    pageShow,
    /** the view's links changed state: draw them again (open, or as their hints) */
    linksChanged: () => {
      if (!dead) {
        applyDoc(derive());
        displayChanged();
      }
    },
    /** the first sync, once the view knows this stage (and, for the outermost, arriving: once, now) */
    start() {
      if (n === 0) {
        root.__sceneDebug = debug;
        globalThis.__sceneDebug = debug;
      }
      warnUnusable();
      sync();
      if (n === 0) view.arrive();
    },
    dispose,
  });
  return stage;
}
