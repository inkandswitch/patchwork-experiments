// patchwork:tool "scene": a view (./view.js) and the stages it opens, one per
// open doc (STAGE.md, "Views, stages and links"). This file is the stage: the doc, loading and
// building object content, what extensions display instead (api.display),
// presence on its doc's channel, its extensions and the api each gets. It has no UI of its own and no opinion about what a click means:
// everything a person sees or does beyond a rendered scene and an orbiting
// camera comes from a `scene:extension`, which gets an api (makeApi below)
// and is started and stopped by the host (host.js). The view holds what is
// the viewer's: the mount, the viewport, the router, the body stack and the
// hands, the selection and the camera.
//
// A stage works in its own ids and its own root frame. Everything spatial
// goes through its scope of the viewport (./scope.js), the one choke point
// where its frame and its keys (./paths.js) meet the view's.
//
// A stage acts, or it is drawn (STAGE.md, "Views, stages and links"). One that acts is where
// its doc is played: its extensions hear input, offer bodies, tools and
// commands and speak on its channel. A pin (its doc at
// fixed heads) is drawn: its extensions run, so it looks as the doc does, and
// they draw into the world (layers, labels, display), but nothing
// more: no input, bodies, tools, commands or DOM chrome, no camera, no
// processes, and they hear their doc's channel without speaking on it (a
// pin has none). A stage is read-only when it doesn't act or its handle is,
// and is then given its doc and repo read-only (./readonly.js), so it writes
// nothing whatever it calls (invariant I6).
//
// The parts, in the order they're wired:
//   - local state (atom.js): the stage's own (running, status, packages,
//     and extensions' keys); the view's is `api.view`.
//   - content, routed at sync by the kind its provider makes (providers.js
//     routeOf): the render manager for "built", the GLB queue for "file";
//     their state → local.status.
//   - presence on its doc's channel (./presence.js), and display: each
//     extension's override of how an object is drawn, layered in running order.
//   - the host, and the api each extension gets (everything it acquires is
//     its own and is given back when it stops, in the STAGE.md order).
//   - the view's plugins' facets (api.focus() while it is the focus): this
//     api, made for the plugin; what it acquires through one goes when the
//     focus leaves, the plugin stops or the stage closes.
//   - what the view asks of it: its segment of the input chain, its inputs
//     (hearing events in its frame), its bodies and widgets.
//   - the doc loop: derive, the running set, display and content; then the
//     update flush (once per UI pass): each instance's update(), scheduled
//     work, ambients (./ambients.js).

import * as THREE from "three";
import * as patchworkPlugins from "@inkandswitch/patchwork-plugins";
import { createAtom, assoc } from "./atom.js";
import { createHost, updateAll } from "./host.js";
import { createPresence } from "./presence.js";
import { traitKeys } from "./activation.js";
import { createPackages } from "./packages.js";
import { chainOrder, holdersFor } from "./chain.js";
import { handleReadOnly, readOnlyHandle, stageRepo } from "./readonly.js";
import { LOOK } from "./bodies.js";
import { createView, projectView } from "./view.js";
import { EMPTY as NO_AMBIENTS, mergeAmbients } from "./ambients.js";
import { scopeViewport, hitIn, rayIn } from "./scope.js";
import { elementOf, keyOf, parseKey } from "./paths.js";
import { lookChain } from "../keymap.js";
import { commandState } from "../parts/toolbar-commands.js";
import * as ops from "../ops.js";
import { layersKey } from "../layers.js";
import { createRenderManager } from "../render-manager.js";
import { createGLBQueue, isLoadingPhase } from "../glb-queue.js";
import { newRenderDoc, seededRenderDoc } from "../datatype.js";
import { atKey, defaultParams } from "../staleness.js";
import { contentOf, describeForHumans, describeSource, matchProviders, routeOf, showsContent } from "../providers.js";
import { parseAutomergeLink, parseAutomergeUrl } from "../dnd.js";
import { resolveParents, treeOrder, worldMatrix } from "../hierarchy.js";
import { groupChain, inheritedDisplay, isGroup, outlineParents, resolveGroups } from "../groups.js";
import { CONTEXT_CHANGED_EVENT, CONTEXT_EVENT, REBUILD_EVENT } from "../controls-tool.js";
import { fileBytes } from "../file-content.js";
import { applyMatrix, composeMatrix, invertMatrix, multiplyMatrices, normalizeTransform } from "../transform.js";

// the view's pure parts, where they have always been imported from
export { ARRIVE_WAIT_MS, bestWidget, cleanCamera, initialCamera, startOf, widgetWins } from "./view.js";

/** Load priority for anything an extension asked to see first (api.focus). */
const FOCUS_PRIORITY = 1e12;
// Doc and local changes reach the extensions at once while that has cost
// little this frame (UI_PASSES passes, UI_BUDGET_MS in all), so a click or a
// single remote edit answers immediately; past that, the rest of a burst is
// coalesced into one pass per frame.
const UI_BUDGET_MS = 4;
const UI_PASSES = 3;
/** Is this one of the router's events (so a stage hands it on in its own frame)? */
const isEvent = (a) => !!a && typeof a === "object" && typeof a.type === "string" && "locked" in a;
const noop = () => {};

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
 * The hit chain (STAGE.md, "The input chain", step 3): the hit object, then what it's attached
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
 * content and what is displayed instead, its extensions, its channel,
 * packages, and its own atom (`api.local`). It sees only
 * its doc, in its own root frame; the view (./view.js) is everything it
 * shares with the others.
 * @param {{
 *   handle: object, view: object, n: number,
 *   path?: string[],                   // the links that lead to it ([]: the outermost)
 *   frame?: () => number[] | null,     // its root's world matrix now (null: the identity)
 *   under?: string | null,             // the viewport key its root hangs under (the link's)
 *   role?: "acting" | "pinned",       // does it act, or is it drawn (a pin: view.js openUnder)
 *   deps?: object | null,              // a pin's: the heads of the docs reached through it ({ url: heads })
 * }} o
 */
export function createStage({ handle: given, view, n, path = [], frame = () => null, under = null, role = "acting", deps = null }) {
  // does it act (STAGE.md, "Views, stages and links"): a pin is drawn, never acted on
  const acts = role === "acting";
  // read-only: its doc, and every doc it reaches, refuse writes (I6)
  const readOnly = !acts || handleReadOnly(given);
  const handle = readOnly ? readOnlyHandle(given) : given;
  // the docs found through its repo, url → handle: what fixing a link through it holds (fixPoint)
  const reached = new Map();
  const repo = stageRepo(view.repo, { readOnly, deps, reached });
  /** May this view write the doc (it acts, and its handle lets it)? */
  const writable = () => !handleReadOnly(handle);
  let dead = false;
  const cleanups = [];
  const time = view.time;
  const perf = { sync: timings(), flush: timings() };
  const raf = (f) => time.frame(f);
  const caf = (cancel) => cancel?.();
  const life = new AbortController(); // aborted as it closes: what the view asks of its services goes then
  const { root, port } = view;
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
    // the listed packages this viewer doesn't have (STAGE.md, "Packages")
    packages: Object.freeze({ ask: Object.freeze([]), loading: Object.freeze([]), failed: Object.freeze([]), missing: true }),
  });
  /** The view's value as this stage sees it (view.js projectView), the same value while the view's is. */
  const seenBy = { from: null, value: null };
  const viewValue = () => {
    const v = view.atom.get();
    if (v !== seenBy.from) {
      seenBy.from = v;
      seenBy.value = projectView(v, n, path);
    }
    return seenBy.value;
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
  const getRegistry = (type) => patchworkPlugins.getRegistry(type) ?? null;

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
  // here hasn't said yet (one shown, not standing in, may name any provider).
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

  // What's shown changed without the doc or local state changing (a
  // display override): every extension's update runs again, with the
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

  // ─── display (STAGE.md, "Display") ──────────────────────────────────────────
  // How this viewer sees an object instead of as the doc says, never written:
  // each extension's override { transform?, content?, hidden?, name? },
  // layered in running order, later winning per field. A transform is a pose
  // (the viewport's, so worldOf, boxes and picking follow it); content is a
  // file doc's URL or a stand-in's GLB bytes; hidden and name are as they say.

  const overrides = new Map(); // object id → Map extension id → its override
  const displayed = new Map(); // object id → the merged override
  const drawn = new Map(); // object id → the stand-in bytes drawn for it
  let redraw = false; // content, hidden or a name changed: applyDoc on the next flush
  let ambients = NO_AMBIENTS; // what its running extensions offer, stacked per name (./ambients.js): the view's when it's the outermost
  const nameOf = (id) => displayed.get(id)?.name ?? derive().objects[id]?.name ?? null;

  function display(ext, id, o) {
    if (typeof id !== "string") return noop;
    const mine = Object.freeze({ ...o });
    if (!overrides.has(id)) overrides.set(id, new Map());
    overrides.get(id).set(ext, mine);
    redisplay(id);
    return () => {
      const by = overrides.get(id);
      if (by?.get(ext) !== mine) return;
      by.delete(ext);
      if (!by.size) overrides.delete(id);
      redisplay(id);
    };
  }
  function redisplay(id) {
    const rank = new Map(host.running().map((r, i) => [r.id, i]));
    const next = {};
    for (const [, o] of [...(overrides.get(id) ?? [])].sort(([a], [b]) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)))
      for (const k of ["transform", "content", "hidden", "name"]) if (o[k] !== undefined) next[k] = o[k];
    const was = displayed.get(id) ?? {};
    if (Object.keys(next).length) displayed.set(id, next);
    else displayed.delete(id);
    if (next.transform !== was.transform) scope.setPose(id, next.transform ? normalizeTransform(next.transform) : null);
    // a pose moving isn't news (what moves reads worldOf in its loop); anything else wakes every update
    if (next.content === was.content && next.hidden === was.hidden && next.name === was.name && !next.transform === !was.transform) return;
    redraw ||= next.content !== was.content || next.hidden !== was.hidden;
    displayChanged();
  }

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
      // back (an undo): what extensions display for it applies again
      if (overrides.has(id) && !displayed.has(id)) redisplay(id);
      const route = typeof displayed.get(id)?.content === "string" ? "file" : routeOf(o, kindOf);
      // a route that moved (its provider arrived or went) is a change to what's shown
      if (routes.has(id) && routes.get(id) !== route) rerouted = true;
      routes.set(id, route);
      // what was said about content of another kind no longer applies
      if (objState.has(id) && objState.get(id).content !== route) {
        objState.delete(id);
        statusDirty = true;
      }
      // placed even without geometry, so whatever is attached to it sits right
      const over = displayed.get(id);
      const oo = over?.hidden ? { ...o, visible: false } : o;
      const key = displayKey(oo, parent, inh);
      if (displayKeys.get(id) !== key) {
        displayKeys.set(id, key);
        scope.applyDisplay(id, oo, parent, inh);
      }
      const shown = oo.visible !== false && inh.visible;
      // a stand-in (the veil) is drawn through the GLB path, so box and picking go by it; nothing of the object's own loads
      if (over?.content instanceof Uint8Array) {
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
        if (drawn.get(id) !== over.content) {
          drawn.set(id, over.content);
          if (objState.delete(id)) statusDirty = true;
          Promise.resolve(scope.setGLB(id, over.content))
            .catch((err) => console.warn("[scene] a stand-in failed to draw", err))
            .then(() => dead || afterGLB());
        }
        continue;
      }
      // (its own content loads again below, and the stand-in stays up until that has)
      drawn.delete(id);
      if (route === "built") {
        queue.remove(id);
        applyHint(id, o.hint?.bounds ?? objState.get(id)?.bounds);
        // hydrate only what is shown; once loaded it stays loaded
        if (o.sourceUrl && (shown || tracked.has(id))) manager.track(id, trackSpec(o));
        noteAt(o);
        continue;
      }
      if (route === "file") {
        // what this viewer sees: a displayed source, or the object's own
        const src = docUrl(over?.content ?? o.sourceUrl);
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
        // its content is a stage (a link's doc, opened by a view plugin): with
        // one open under it, that is what's drawn; else its hint, the room the host gives it
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        applyHint(id, view.stageUnder([...path, id]) ? null : o.hint?.bounds);
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
      drawn.delete(id);
      displayed.delete(id); // (its overrides stay until released: it may come back)
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

  // ─── presence ─────────────────────────────────────────────────────────────

  // its doc's channel: a read-only stage hears it and says nothing (its handle refuses to broadcast, too); a pin, a value, has none
  const channel = role !== "pinned";
  const presence = createPresence({ handle: channel ? handle : null, listen: readOnly, viewer, session: view.session, now: time.now, setTimer: (fn, ms) => time.after(ms, fn), clearTimer: (cancel) => cancel?.() });

  /**
   * An object's displayed world matrix: the viewport's, which displayed
   * transforms have moved; without WebGL, the doc's chain with each displayed
   * transform in place of its own.
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
  // what a peer sends an extension here is its `receive`'s
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

  // ─── the page (STAGE.md, "`api`") ──────────────────────────────────────
  // The view's pagehide or the stage closing ("hide": last-first, as extensions stop), pageshow and the tab's visibility, as api.page's events.
  const pageFns = { hide: new Set(), show: new Set(), visible: new Set() };
  const pageSay = (type) => [...pageFns[type]][type === "hide" ? "reverse" : "slice"]().forEach((fn) => fn());
  const onVisibility = () => pageSay("visible");
  globalThis.document?.addEventListener?.("visibilitychange", onVisibility);
  cleanups.push(() => globalThis.document?.removeEventListener?.("visibilitychange", onVisibility));
  let away = false; // said goodbye on pagehide

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
    if (redraw) {
      redraw = false;
      applyDoc(derive());
    }
    const snap = scene();
    const loc = local.get();
    const content = contentDirty;
    contentDirty = false;
    const running = host.instances();
    const now = { scene: snap, local: loc, view: viewValue() };
    updateAll(running, seen, now, content);
    // (the view's plugins are told what its focus stage shows: view.js)
    view.flushed?.(stage, now, content);
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
    const own = owned.get(id);
    return own ? framedInput(host.inputOf(id), own) : undefined;
  }
  function framedInput(input, own = { sessions: 0 }) {
    if (!input || typeof input !== "object") return undefined;
    let w = inputWrappers.get(input);
    if (!w) inputWrappers.set(input, (w = withSessions(own, input)));
    return w;
  }

  // (a body it put on the stack, the held tool, an open session, or a service busy on its behalf (a pose it holds): a doc-caused stop waits)
  const busy = (id) => {
    const own = owned.get(id);
    return !!own && (own.bodies.size > 0 || own.tool != null || own.sessions > 0 || host.instances().some((r) => r.instance.busy?.(id) === true));
  };

  /** Write fn, and say what it wrote: its patches ([] for nothing: null, a refusal (ops.js), or a stage that may not write). */
  function change(fn) {
    let patches = [];
    if (typeof fn === "function" && fn.ok !== false && writable()) handle.change(fn, { patchCallback: (p) => void (patches = p) });
    return patches;
  }

  /**
   * Removing `ids` as a change function (ops.removeObjects's plan) that
   * first runs every running extension's beforeRemove tidy-up (at the focus,
   * the view's plugins' too), for the caller to write: null when there's
   * nothing to remove or this view may not write.
   */
  function remove(ids) {
    const plan = writable() ? ops.removeObjects(scene(), ids) : null;
    if (!plan?.ok) return plan;
    const running = [...host.running(), ...(view.pluginsAt?.(stage) ?? [])];
    return Object.assign((d) => {
      for (const r of running) {
        if (typeof r.instance.beforeRemove !== "function") continue;
        try {
          r.instance.beforeRemove(d, plan.ids);
        } catch (err) {
          console.warn(`[scene] extension “${r.id}”: beforeRemove failed`, err);
        }
      }
      plan(d);
    }, plan);
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
    return runCommand(invocation?.ext, commandOf(invocation?.ext, invocation?.command), invocation);
  }
  /** Run command `c` of `ext` (one of its extensions', or a view plugin's with a facet here) as run() does. */
  function runCommand(ext, c, { command, target = null, value, hit = null } = {}) {
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
        if (!def || typeof def.id !== "string" || typeof def.enter !== "function" || def.id === LOOK.id) continue;
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
    // (a scene in itself is a link whose expansion closes it: a cycle, native/link-graph.js)
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
   * @returns {Promise<Function>} the write, a change function with the new
   *   object's `id`, for the caller to make (api.change); rejects with a
   *   sentence to show
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
    const add = (d) => {
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
    };
    return ops.planned(add, { id });
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
    if (!o?.renderUrl || !manager.ids().includes(id)) return null;
    const point = manager.fixPoint(id);
    if (!point) return null;
    // fresh arrays: automerge won't take a value that is already in a document
    const out = { heads: [...point.heads] };
    const deps = Object.entries(point.deps ?? {});
    if (deps.length) out.deps = Object.fromEntries(deps.map(([u, h]) => [u, [...h]]));
    return out;
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
      cameraHolds: new Set(),
      frame: new Set(), // loops and afterRender hooks
      offs: new Set(), // listeners, watchers, rides
      els: new Set(), // overlays, edges, styles
    };
    owned.set(id, own);
    const live = () => !signal.aborted && !dead;
    // Acquire something, unless stopped; the returned off gives it back once.
    const acquire = view.acquirer(live);
    // what the view lends it: chrome, frame hooks, timers (view.js viewParts),
    // its elements marked with this stage (several docs' extensions share one view's DOM)
    const lent = view.viewParts({ id, key: ownerKey(id), own, live, stage: n });
    const viewNow = () => viewValue();
    let watched = viewNow(); // what api.view.watch last told of

    const api = {
      // doc and identity
      id,
      repo,
      handle,
      url: handle.url,
      signal,
      doc,
      change,
      /** may this view write the doc? (not in a pin, nor where the handle refuses: Keyhive's to answer, in time) */
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

      // local, the channel
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
       * the hands and the held tool, the pointer, theme, and
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
        /** move the focus into the acting stage under this stage's `target` (a link's): false if there is none */
        enter: (target) => (live() && target != null ? view.enter([...path, target]) : false),
        /** arrive again where the outermost doc's view.start now says (a template's maker): only from the outermost */
        arrive: () => {
          if (live() && n === 0) view.arrive();
        },
        // (leaving is the view's: Escape's last rung, the trail; no stage learns whether there's anywhere to leave)
      }),
      /**
       * The doc's ephemeral side (STAGE.md, "`api`"): this view's
       * session (null in a pin: it has none), every peer, and this
       * extension's own keys and sends; cleared when it stops.
       */
      channel: Object.freeze({
        viewer,
        get session() {
          return channel ? presence.session : null;
        },
        peers: () => presence.get(),
        get: () => Object.fromEntries(Object.entries(presence.get()).flatMap(([s, p]) => (p.keys?.[id] ? [[s, p.keys[id]]] : []))),
        set: (key, value) => void (live() && presence.set(id, key, value)),
        watch: (fn) => acquire(own.offs, () => presence.watch(fn)),
        send: (type, data) => void (live() && presence.send(id, type, data)),
        rate: (hz) => void (live() && presence.rate(id, hz)),
      }),
      page: Object.freeze({
        visible: () => globalThis.document?.visibilityState !== "hidden",
        on: (type, fn) => (pageFns[type] && typeof fn === "function" ? acquire(own.offs, () => (pageFns[type].add(fn), () => pageFns[type].delete(fn))) : noop),
      }),
      /** a service (NATIVE.md, "Native services"): this stage's first running provider's facet, made for this extension, else (acting) a view plugin's, or null */
      use: (name) => (live() ? (host.use(name, { id, signal }) ?? (acts ? view.plugins.use(name, { id, signal, runs: (x) => !!host.instanceOf(x), doc, path }) : null)) : null),
      /** has everything the doc calls for started (or failed: `failed`), and is every listed package here (`missing`: those that aren't)? */
      settled: () => {
        const p = local.get().packages;
        const missing = Object.freeze([...p.ask, ...p.loading, ...p.failed].map((e) => e.url));
        return Object.freeze({ ready: !host.starting() && packages.complete(), missing, failed: Object.freeze(host.failed()) });
      },
      /** the listed packages this viewer doesn't have (local.packages): load them (a yes), or don't ask again in this view */
      packages: Object.freeze({ load: (urls) => packages.load(urls), dismiss: (urls) => packages.dismiss(urls) }),

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
      addObject,
      fixPoint,

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
        /** has the camera been placed for this viewer: moved by them or restored as they opened the view (nothing frames it on its own then)? */
        touched: () => viewport.touched() || view.cameraPlaced,
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
      ...lent,
      /** draw an object otherwise for this viewer (STAGE.md, "Display"): again from this extension replaces its override → release */
      display: (oid, o) => (live() ? display(id, oid, o ?? {}) : noop),
      extent: (box) => {
        if (live()) scope.setExtent(id, box ?? null);
      },
      /**
       * One of the world's ambients (STAGE.md, "Ambients"): the outermost
       * doc's value under `name` (frozen plain JSON, the same object until it
       * changes), with `mine` (this is the outermost stage), this stage's
       * frame (scope.js: the world is the outermost's root) and `use`: the
       * outermost's services (its world time); null when it offers none.
       */
      ambient: (name) => {
        const value = view.ambient(name);
        if (value === undefined) return null;
        const world = view.outermost();
        return Object.freeze({ value, mine: world === stage, frame: scope.frame(), use: (s) => (live() ? world.use(s, { id, signal }) : null) });
      },
      schedule: (fn) => {
        if (!live() || typeof fn !== "function") return;
        scheduled.push({ rec, fn });
        requestFlush();
      },

      // bodies, the held tool, attention (STAGE.md, "The input chain"–§5)
      body: Object.freeze({
        /** the top body: { id, label, ext, depth, lock, reach, keys } (as local.body) */
        current: () => viewNow().body,
        /** enter body `id` (any running extension's; the stage's "look" leaves every body) at `place`: false if none offers it or it can't */
        enter: (bid, place) => (live() ? enterBody(bid, place) : false),
        /** leave the top body (never Look) */
        leave: () => (live() ? view.leaveBody() : false),
        /** the eye: { position, direction } in this stage's frame, or null */
        eye: () => bodyEye(),
        /** the top body's reach (m; Look's is Infinity) */
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
      /** the context every surface passes to commands (scene, local, from, reach, hit, distance) */
      context: (hit) => context(hit),
      /** attention: { selected, hit } (the selection, else the look) */
      attention: () => attention(),
      /** the look: under lock the eye ray's hit, else the pointer's; { id, point, distance } or null */
      look: () => look(),

      // the others: what this stage's extensions offer, each item tagged with its `stage`; a command runs in the stage it names
      collect: (name) => reader.collect(name),
      // (in another stage only if it acts: a pin is never acted on)
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
      // 3: its display overrides, its presence keys (and its rate); what services gave it went as its signal aborted
      for (const [oid, by] of [...overrides]) if (by.delete(id)) (by.size || overrides.delete(oid), redisplay(oid));
      presence.clear(id);
      // 5: loops, afterRender hooks, scheduled work
      for (const give of [...own.frame]) give();
      own.frame.clear();
      scheduled = scheduled.filter((s) => s.rec !== rec);
      // 6: its world groups
      scope.removeLayers(id);
      // 7: labels, overlays, edges, styles, listeners and watchers, cursor, extent, focus
      for (const key of own.labelKeys ?? []) scope.labels.clear(key);
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
   * that acts, all in this one place. A pin's extensions run
   * and draw into the world (layers, labels, display, styles) and read all
   * they like; what would take input, put chrome in the view, move the
   * viewer's camera, select, use the view's services, enter a body, hold a tool,
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
      overlay: () => loose("stage-overlay"),
      edge: () => loose("stage-edge-part"),
      popover: () => noop,
      cursor: noop,
      camera: facet(api.camera, { set: noop, frame: noop, hold: () => noop, ride: () => noop }),
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
    busy,
    onChange: resync,
    setTimer: (fn, ms) => time.after(ms, fn),
    clearTimer: (cancel) => cancel?.(),
    // (none created before the view's providers: a create's use() finds the drawer, notices, prefs)
    first: () => view.plugins?.providersStarted(),
  });

  // ─── the view's plugins' facets (STAGE.md, "View plugins") ─────────────────
  // A view plugin's api.focus(), while this stage is the focus: this stage's
  // api, made for it on asking. What it acquires through one is given back
  // when the focus leaves (the view drops it), the plugin stops or this
  // stage closes; the plugin itself runs on.
  const facets = new Map(); // plugin id → { controller, api, release }
  function facetFor({ id, module }) {
    if (dead || !acts) return null;
    let f = facets.get(id);
    if (!f) {
      const controller = new AbortController();
      f = { controller, ...makeApi({ id, module, signal: controller.signal }) };
      facets.set(id, f);
    }
    return f.api;
  }
  /** Let a plugin's facet go (or, with no id, every one): what was acquired through it goes. */
  function dropFacets(id = null) {
    for (const [k, f] of [...facets]) {
      if (id != null && k !== id) continue;
      facets.delete(k);
      f.controller.abort();
      try {
        f.release();
      } catch (err) {
        console.warn(`[scene] view plugin “${k}”: releasing what it held here failed`, err);
      }
    }
  }

  // ─── what the view asks of this stage ──────────────────────────────────────

  // Its extensions' widgets under the pointer (and, at the focus, the view's
  // plugins': `more`), each hearing the event in this stage's frame, owners
  // as the view's keys, distances in the world.
  function widgetsAt(ev, more = []) {
    const out = [];
    const f = scope.frame();
    for (const r of [...host.running(), ...more]) {
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
  // the hit's path: its holders, nearest first, then its root's. (The view
  // offers its plugins after every segment.)
  function segment(element) {
    const running = host.running();
    const m = derive();
    const chain = element != null && m.objects[element] ? hitChain(element, m.parents, m.groups, m.objects) : [];
    const holders = holdersFor(running, chain, (oid) => traitKeys(oid == null ? m.d : m.objects[oid]));
    const order = chainOrder({ running, holders });
    return { order, holderOf: (ext) => holders.get(ext)?.id ?? null };
  }
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
  // It says bye at once (api.page's "hide" first, so services let go of what they hold);
  // restored from the back-forward cache, it comes back as the view's new session.
  function pageHide() {
    if (away) return;
    pageSay("hide");
    away = true;
    presence.goodbye();
  }
  function pageShow(session) {
    if (!away) return;
    away = false;
    presence.hello(session);
    pageSay("show");
  }

  // ─── the doc loop ─────────────────────────────────────────────────────────

  function sync() {
    if (dead) return;
    const d = doc();
    const t0 = cpuNow();
    const m = derive();
    host.sync(d);
    applyDoc(m);
    packages.check();
    requestFlush();
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
    perf,
    queue,
    manager,
    packages,
    root,
    scene,
    /** what this viewer sees instead of the doc (api.display), merged: id → { transform?, content?, hidden?, name? } */
    displayed: () => displayed,
    /** its ambients (./ambients.js), the atmosphere among them */
    ambients: () => ambients,
    /** does this extension hold a body, the held tool or an open session, or is a service busy for it (so a doc-caused stop waits)? */
    busy,
    /** does it act ("acting"), or is it drawn ("pinned")? */
    role,
    /** the view plugins with a facet here (api.focus()) */
    facets: () => [...facets.keys()],
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
    // "hide" (services let go at once), then the view's plugins' facets and the extensions, while everything they hold is still there to give back
    if (!away) pageSay("hide");
    dropFacets();
    host.dispose();
    life.abort();
    dead = true;
    presence.dispose();
    if (flushFrame != null) caf(flushFrame);
    if (uiResetReq != null) caf(uiResetReq);
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

  // what the view's plugins read of this stage, and run in it
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
    /** a service of its (NATIVE.md, "Native services"), for the view's plugins: what it gives lasts while the stage is open */
    use: (name) => host.use(name, { id: "scene:view", signal: life.signal }),
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
    /** a service of its, for `caller` ({ id, signal }): what api.ambient's `use` asks the outermost */
    use: (name, caller) => host.use(name, caller),
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
    facetFor,
    dropFacets,
    /** a view plugin's input, hearing events in this stage's frame (the view offers it while this is the focus) */
    framedInput: (input) => framedInput(input),
    runCommand,
    /** what the view says of the viewer on this doc's channel: its body and held tool (presence.announce) */
    announce: (state) => presence.announce(state),
    displayedWorld,
    pageHide,
    pageShow,
    /** where an object's content was routed ("built", "file", "scene": a stage) */
    routeOf: (id) => routes.get(id) ?? null,
    /** a stage opened or closed under one of its objects: draw it again (that stage, or its hint) */
    childrenChanged: () => {
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
