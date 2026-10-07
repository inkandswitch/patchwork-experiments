// patchwork:tool "scene" — the scene host.
//
// The scene doc holds objects, their display state, persistent dimensions and
// view settings. An object is shown one of three ways:
//   - a render-doc object (renderUrl set): the render manager keeps its
//     scene-render doc built and hands over the GLB;
//   - a passthrough object (renderUrl null, SCENE-CONTRACT v3 §6): its source
//     IS a GLB file doc, loaded straight through the GLB queue;
//   - a group (kind "group", §7): no geometry; visibility and opacity cascade.
// Only effectively visible objects are loaded (hydrated). This file wires the
// doc to the three.js Viewport, those loaders and the sidebar UI. Selection
// and hover go over broadcast only. Per-object UI work (outline, HUD, legends,
// dimensions) triggered by loads is coalesced to one pass per animation frame.

import css from "./styles.css?inline";
import { Viewport } from "./viewport.js";
import { createRenderManager } from "./render-manager.js";
import { createGLBQueue, isLoadingPhase } from "./glb-queue.js";
import { newRenderDoc, DEFAULT_VIEW } from "./datatype.js";
import { defaultParams } from "./staleness.js";
import { describeForHumans, describeSource, extensionOf, matchProviders } from "./providers.js";
import { hasPatchworkDrop, parseAutomergeUrl, parsePatchworkDrop } from "./dnd.js";
import { canMove, dropIntent, isMove, placementFor, spliceOrder } from "./tree-drop.js";
import { detachAnchor, distance, makeAnchor, normalizeTransform, resolveAnchor } from "./anchors.js";
import { attachTargets, brokenParents, orphanTransforms, planAttach, resolveParents, treeOrder, worldMatrix } from "./hierarchy.js";
import { childrenMap, defaultExpanded, groupsWithHidden, inheritedDisplay, isGroup, removalSet, searchOutline, ungroupPlan, visibleRows } from "./groups.js";
import { UNIT_OPTIONS, formatLength, fromUnits, roundForDisplay, toUnits } from "./units.js";
import { REBUILD_EVENT } from "./controls-tool.js";
import { legendModel } from "./legend.js";
import { fileBytes } from "./file-content.js";

const PRESENCE = "scene:presence";
const PEER_TTL_MS = 15_000;
const HEARTBEAT_MS = 5_000;
const DEG = 180 / Math.PI;
const SELECTED_PRIORITY = 1e12;
// the outline's filter field appears once there are this many objects
const SEARCH_FROM = 8;
const OPEN_EVENT = "patchwork:open-document";

// Our own drag payload, so a row being moved inside the tree is told apart
// from a document arriving from the sidebar. Only `types` is readable during
// dragover — getData is empty until the drop — which is why the kind of drag
// has to be legible from the mime alone. The data is `{ scene, id }`: the
// scene's url too, because two scenes open side by side share one drag
// session and ids are only unique within a scene.
const ROW_MIME = "application/x-scene-object";

/** A row-drag payload, or null if there is none (or it isn't ours). */
function readRowDrag(dt) {
  const raw = dt?.getData?.(ROW_MIME);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v.id === "string" ? { scene: typeof v.scene === "string" ? v.scene : null, id: v.id } : null;
  } catch {
    return null;
  }
}

const TEMPLATE = `
  <header class="toolbar">
    <div class="cluster tools">
      <button type="button" class="button" data-action="frame" title="Frame all (F)">Frame all</button>
      <button type="button" class="button" data-action="measure" title="Measure point to point (M)" aria-pressed="false">Measure</button>
      <button type="button" class="button" data-action="panel" title="Show or hide the side panel (P)" aria-pressed="true">Panel</button>
      <label class="toggle" title="Grid"><input type="checkbox" data-view="grid"> Grid</label>
      <label class="toggle" title="Axes"><input type="checkbox" data-view="axes"> Axes</label>
      <label class="toggle" title="Bounding-box dimensions"><input type="checkbox" data-view="bounds"> Bounds</label>
      <select class="gizmo" title="Transform gizmo (G / R)" aria-label="Transform gizmo">
        <option value="translate">Move</option>
        <option value="rotate">Rotate</option>
        <option value="">No gizmo</option>
      </select>
      <select class="units" title="Display units" aria-label="Display units">
        ${UNIT_OPTIONS.map((u) => `<option value="${u.value}">${u.label}</option>`).join("")}
      </select>
    </div>
  </header>
  <div class="body">
    <div class="viewport" tabindex="0">
      <div class="empty" hidden>
        <p>Drop a document here, or paste its URL.</p>
        <p class="hint">Anything with a scene provider works — STL and GLB files out of the box.</p>
      </div>
      <div class="hud"></div>
      <div class="legends"></div>
      <div class="measure-hint" hidden></div>
      <div class="toast" hidden></div>
      <div class="chooser" hidden></div>
      <div class="drop-hint" hidden>Drop to add to the scene</div>
      <div class="no-webgl" hidden></div>
    </div>
    <aside class="sidebar">
      <section class="panel outline">
        <div class="panel-head">
          <h3 class="panel-title">Objects</h3>
          <button type="button" class="button link new-group" title="New group (inside the selected group, if one is selected)">New group</button>
        </div>
        <div class="outline-search" hidden>
          <input type="search" class="outline-filter" spellcheck="false" autocomplete="off"
                 placeholder="Filter by name or path…" aria-label="Filter objects by name or group path">
          <span class="match-count" aria-live="polite"></span>
        </div>
        <ul class="object-list" role="tree" aria-label="Objects"></ul>
      </section>
      <section class="panel inspector" hidden></section>
      <section class="panel dimensions">
        <h3 class="panel-title">Dimensions</h3>
        <ul class="dimension-list"></ul>
      </section>
    </aside>
  </div>`;

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

const newId = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
const now = () => globalThis.performance?.now?.() ?? Date.now();
const IDENTITY = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });

function orderedIds(doc) {
  const objects = doc?.objects ?? {};
  const seen = new Set();
  const out = [];
  for (const id of doc?.order ?? []) if (objects[id] && !seen.has(id)) seen.add(id), out.push(id);
  for (const id of Object.keys(objects)) if (!seen.has(id)) out.push(id);
  return out;
}

/** An infoUrl / sourceUrl that is really an automerge URL, else null. */
function docUrl(v) {
  return typeof v === "string" && v.startsWith("automerge:") ? parseAutomergeUrl(v) : null;
}

/** Everything applyDisplay reads, as one string: an object is re-applied only when this changes. */
function displayKey(o, parent, inh) {
  const t = o.transform ?? {};
  return `${o.kind === "group" ? "g" : "o"}|${o.visible !== false}|${o.color ?? ""}|${o.opacity ?? 1}|${!!o.wireframe}|${t.position}|${t.rotation}|${t.scale}|${parent ?? ""}|${inh.visible}|${inh.opacity}`;
}

function hintVolume(o) {
  const b = o?.hint?.bounds;
  if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) return 0;
  const v = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  return Number.isFinite(v) && v > 0 ? v : 0;
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
    /** calls so far (the buffer keeps the last `size`) */
    get total() {
      return total;
    },
  };
}

export default function SceneTool(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "scene-tool";
  root.innerHTML = TEMPLATE;
  element.append(style, root);
  const $ = (sel) => root.querySelector(sel);
  const viewportEl = $(".viewport");

  // ─── local (non-doc) state ────────────────────────────────────────────────
  let selected = null;
  let selectedDim = null;
  let hoverId = null;
  let measure = null; // { a: Anchor | null, hover: {world, snapped} | null }
  let gizmoMode = "translate";
  let dead = false;
  let autoFrame = !handle.doc()?.camera;
  let registry = null;
  let filterQuery = "";
  const objState = new Map();
  const outlineRows = new Map(); // objectId → the outline row's elements
  const displayKeys = new Map(); // objectId → displayKey last applied
  const hintKeys = new Map(); // objectId → hint bounds last given to the viewport
  let emptyRow = null;
  const peers = new Map(); // senderId → { selected, hover, at }
  const cleanups = [];
  const perf = { sync: timings(), outline: timings(), flush: timings() };

  const doc = () => handle.doc() ?? {};
  const view = () => ({ ...DEFAULT_VIEW, ...(doc().view ?? {}) });

  // ─── derived structure, once per doc snapshot ─────────────────────────────
  let model = null;
  function derive() {
    const d = doc();
    if (model && model.d === d) return model;
    const objects = d.objects ?? {};
    const ids = orderedIds(d);
    const parents = resolveParents(objects);
    model = {
      d,
      objects,
      ids,
      parents,
      tree: treeOrder(objects, ids, parents),
      kids: childrenMap(parents, ids),
      inherited: inheritedDisplay(objects, parents),
      mixed: null,
      search: null,
    };
    return model;
  }
  const mixedOf = (m) => (m.mixed ??= groupsWithHidden(m.objects, m.parents));
  const shownIn = (m, id) => {
    const o = m.objects[id];
    return !!o && o.visible !== false && (m.inherited.get(id)?.visible ?? true);
  };
  const isPassthrough = (o) => !!o && !isGroup(o) && !o.renderUrl && !!o.sourceUrl;

  // ─── per-frame coalescing ─────────────────────────────────────────────────
  const raf = globalThis.requestAnimationFrame ? (f) => globalThis.requestAnimationFrame(f) : (f) => setTimeout(f, 16);
  const caf = globalThis.cancelAnimationFrame ? (h) => globalThis.cancelAnimationFrame(h) : (h) => clearTimeout(h);
  const pending = new Set();
  let frameReq = null;
  function schedule(...parts) {
    if (dead) return;
    for (const p of parts) pending.add(p);
    if (frameReq == null) frameReq = raf(flushScheduled);
  }
  function flushScheduled() {
    frameReq = null;
    flushParts();
  }
  // Doc changes redraw the UI at once while that has cost little this frame
  // (a few passes, UI_BUDGET_MS in all), so a click or a single remote edit
  // answers immediately; past that, the rest of a burst (a peer's catch-up, a
  // script editing objects one by one) is coalesced into one pass per frame.
  const UI_BUDGET_MS = 4;
  const UI_PASSES = 3;
  let uiSpent = 0;
  let uiPasses = 0;
  let uiResetReq = null;
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
  function flushParts() {
    if (dead || !pending.size) return;
    const t0 = now();
    const parts = new Set(pending);
    pending.clear();
    if (parts.has("frame")) viewport.frameAll();
    if (parts.has("dims")) {
      updateDimensions();
      renderDimensionList();
    }
    if (parts.has("legends")) renderLegends();
    if (parts.has("outline")) renderOutline();
    if (parts.has("hud")) renderHud();
    if (parts.has("inspector")) updateInspector();
    const ms = now() - t0;
    spend(ms);
    perf.flush.add(ms);
  }

  // ─── plugin registry ──────────────────────────────────────────────────────
  const registryReady = import("@inkandswitch/patchwork-plugins")
    .then((m) => {
      registry = m.getRegistry("scene:source");
      const off = registry.on?.("changed", () => {
        manager.providersChanged();
        schedule("outline");
      });
      if (typeof off === "function") cleanups.push(off);
      return m;
    })
    .catch((err) => {
      console.warn("[scene] plugin registry unavailable", err);
      return null;
    });

  const listProviders = () => {
    try {
      return registry?.filter?.(() => true) ?? [];
    } catch {
      return [];
    }
  };

  async function loadProvider(id) {
    await registryReady;
    if (!registry?.has?.(id)) return null;
    const p = await registry.load(id);
    if (!p?.module) return null;
    return { id, name: p.name ?? id, params: p.params ?? [], cost: p.cost, module: p.module };
  }

  // ─── viewport ─────────────────────────────────────────────────────────────
  const viewport = new Viewport({
    host: viewportEl,
    themeRoot: root,
    onClick: (e) => onViewportClick(e),
    onHover: (e) => onViewportHover(e),
    onTransformEnd: (id, t) =>
      updateObject(id, (o) => {
        o.transform = { position: t.position, rotation: t.rotation, scale: t.scale };
      }),
    onCameraEnd: (cam) => saveCamera(cam),
  });
  if (!viewport.ok) {
    const msg = $(".no-webgl");
    msg.hidden = false;
    msg.textContent = `3D view unavailable: ${viewport.error?.message ?? "WebGL could not start"}. The object list still works.`;
  }
  if (doc().camera) viewport.setCamera(doc().camera);

  function afterGLB(id) {
    if (autoFrame) schedule("frame");
    schedule("dims", "legends", "outline");
    if (id === selected) schedule("inspector");
  }

  // ─── render manager (render-doc objects) ──────────────────────────────────
  const manager = createRenderManager({
    repo,
    loadProvider,
    onState: (id, s) => {
      objState.set(id, s);
      schedule("outline", "hud");
      if (id === selected) updateInspector();
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
      afterGLB(id);
    },
  });

  // ─── GLB queue (passthrough objects: the source doc IS the GLB) ────────────
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
      if (!dead) afterGLB(id);
    },
    onState: (id, st) => {
      objState.set(id, { passthrough: true, phase: st.phase, error: st.error });
      schedule("outline", "hud");
      if (id === selected) schedule("inspector");
    },
  });

  function priorityOf(id, o) {
    return id === selected ? SELECTED_PRIORITY : hintVolume(o);
  }

  // ─── doc writes ───────────────────────────────────────────────────────────
  function updateObject(id, fn) {
    handle.change((d) => {
      const o = d.objects?.[id];
      if (o) fn(o);
    });
  }

  function setView(key, value) {
    handle.change((d) => {
      if (!d.view) d.view = { ...DEFAULT_VIEW };
      d.view[key] = value;
    });
  }

  let cameraTimer = null;
  function saveCamera(cam) {
    autoFrame = false;
    clearTimeout(cameraTimer);
    cameraTimer = setTimeout(() => {
      if (dead) return;
      const prev = doc().camera;
      const same =
        prev &&
        distance(prev.position, cam.position) < 1e-6 &&
        distance(prev.target, cam.target) < 1e-6;
      if (!same) {
        handle.change((d) => {
          d.camera = { position: cam.position, target: cam.target };
        });
      }
    }, 1500);
  }

  /**
   * Inside a change: clear the parent edges a merged cycle left behind (see
   * brokenParents), so the tree the doc says is the tree everyone sees.
   */
  function repairCycles(d, broken) {
    for (const bid of broken) {
      const o = d.objects?.[bid];
      if (o) o.parent = null;
    }
  }

  function removeFromOrder(d, gone) {
    if (!d.order) return;
    for (let i = d.order.length - 1; i >= 0; i--) if (gone.has(d.order[i])) d.order.splice(i, 1);
  }

  function confirmRemove(message) {
    try {
      return typeof globalThis.confirm === "function" ? globalThis.confirm(message) !== false : true;
    } catch {
      return true;
    }
  }

  /** Remove an object; a group goes with everything in it (after a confirm). */
  function removeObject(id) {
    const snapshot = doc().objects ?? {};
    if (!snapshot[id]) return;
    const parents = resolveParents(snapshot);
    const gone = new Set(removalSet(snapshot, id, parents));
    if (gone.size > 1) {
      const n = gone.size - 1;
      if (!confirmRemove(`Remove “${snapshot[id].name || "Group"}” and the ${n} object${n === 1 ? "" : "s"} in it?`)) return;
    }
    // anything attached to what's removed (and not removed itself) stays where it is, now at the scene root
    const orphans = {};
    for (const g of gone) for (const [c, t] of Object.entries(orphanTransforms(snapshot, g, parents))) if (!gone.has(c)) orphans[c] = t;
    const broken = brokenParents(snapshot, parents);
    handle.change((d) => {
      repairCycles(d, broken);
      for (const [child, transform] of Object.entries(orphans)) {
        const o = d.objects?.[child];
        if (!o) continue;
        o.parent = null;
        o.transform = transform;
      }
      for (const [dimId, dim] of Object.entries(d.dimensions ?? {})) {
        for (const end of ["a", "b"]) {
          if (gone.has(dim[end]?.objectId)) d.dimensions[dimId][end] = detachAnchor(JSON.parse(JSON.stringify(dim[end])), snapshot);
        }
      }
      if (d.objects) for (const g of gone) delete d.objects[g];
      removeFromOrder(d, gone);
    });
    if (gone.has(selected)) select(null);
  }

  /** Ungroup: the group's children move up to its parent, keeping their world pose; the group goes. */
  function ungroup(id) {
    const snapshot = doc().objects ?? {};
    if (!isGroup(snapshot[id])) return;
    const parents = resolveParents(snapshot);
    const plan = ungroupPlan(snapshot, id, parents);
    const broken = brokenParents(snapshot, parents);
    handle.change((d) => {
      repairCycles(d, broken);
      for (const [child, transform] of Object.entries(plan.children)) {
        const o = d.objects?.[child];
        if (!o) continue;
        o.parent = plan.parent;
        o.transform = transform;
        const look = plan.display[child];
        if (look?.visible === false) o.visible = false;
        if (look?.opacity !== undefined) o.opacity = look.opacity;
      }
      if (d.objects) delete d.objects[id];
      removeFromOrder(d, new Set([id]));
    });
    if (selected === id) select(null);
  }

  /**
   * A new, empty group: inside `into` (a group id), or — with `around` — in
   * place of that object, which moves into it (the group is at identity, so
   * nothing moves in the world).
   */
  function newGroup({ into = null, around = null } = {}) {
    const snapshot = doc().objects ?? {};
    const parents = resolveParents(snapshot);
    const id = newId("g");
    const parent = around && snapshot[around] ? parents.get(around) ?? null : into && isGroup(snapshot[into]) ? into : null;
    const broken = brokenParents(snapshot, parents);
    handle.change((d) => {
      repairCycles(d, broken);
      if (!d.objects) d.objects = {};
      if (!d.order) d.order = [];
      d.objects[id] = {
        kind: "group",
        name: "Group",
        sourceUrl: null,
        providerId: null,
        renderUrl: null,
        parent,
        visible: true,
        color: null,
        opacity: 1,
        wireframe: false,
        transform: IDENTITY(),
      };
      const at = around ? d.order.indexOf(around) : -1;
      if (at >= 0) d.order.splice(at, 0, id);
      else d.order.push(id);
      if (around && d.objects[around]) d.objects[around].parent = id;
    });
    setExpanded(id, true);
    select(id);
    return id;
  }

  function deleteDimension(id) {
    handle.change((d) => {
      if (d.dimensions) delete d.dimensions[id];
    });
    if (selectedDim === id) selectedDim = null;
  }

  // ─── adding objects ───────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message, kind = "info") {
    const t = $(".toast");
    t.textContent = message;
    t.dataset.kind = kind;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 5000);
  }

  function choose(providers, what) {
    const box = $(".chooser");
    return new Promise((resolve) => {
      box.replaceChildren(
        el("p", { class: "chooser-title" }, `Show ${what} as…`),
        ...providers.map((p) => el("button", { type: "button", class: "button", onclick: () => done(p) }, p.name ?? p.id)),
        el("button", { type: "button", class: "button link", onclick: () => done(null) }, "Cancel"),
      );
      box.hidden = false;
      const done = (p) => {
        box.hidden = true;
        box.replaceChildren();
        resolve(p);
      };
    });
  }

  async function titleOf(sourceDoc, datatype) {
    try {
      const { getRegistry } = (await registryReady) ?? {};
      const dt = datatype && getRegistry ? await getRegistry("patchwork:datatype").load(datatype) : null;
      const t = dt?.module?.getTitle?.(sourceDoc);
      if (t) return String(t);
    } catch {
      // fall back below
    }
    return String(sourceDoc?.title || sourceDoc?.name || datatype || "Object");
  }

  /**
   * @param hint {{ name?: string, parent?: string | null, before?: string | null }}
   *   `parent` and `before` are where a drop onto the tree asked for it to go;
   *   without them it lands at the top level, which is what the viewport and a
   *   paste still do.
   */
  async function addFromUrl(input, hint = {}) {
    const url = parseAutomergeUrl(input);
    if (!url) return toast("That doesn't look like an automerge URL.", "error");
    if (url === handle.url) return toast("A scene can't contain itself.", "error");
    let source;
    try {
      source = await repo.find(url);
    } catch (err) {
      return toast(`Couldn't open that document: ${err?.message ?? err}`, "error");
    }
    const sourceDoc = source.doc();
    const info = describeSource(sourceDoc);
    await registryReady;
    const providers = matchProviders(listProviders(), info);
    if (!providers.length) return toast(`No scene provider is installed for ${describeForHumans(info)}.`, "error");
    const name = hint.name || (await titleOf(sourceDoc, info.datatype));
    const provider = providers.length === 1 ? providers[0] : await choose(providers, name);
    if (!provider || dead) return;
    // A passthrough provider's source already is a GLB: no render doc, no copy (v3 §6).
    const renderHandle = provider.passthrough
      ? null
      : await repo.create2(newRenderDoc({ title: name, parent: url, providerId: provider.id, params: defaultParams(provider.params) }));
    const id = newId("o");
    // Only an object that is still there can be a parent: the drag may have
    // started before someone else deleted it. A non-group parent is an
    // attachment (v3 §5) — the line was drawn among its children, so that is
    // where it goes, just as a row moved to the same line would.
    const into = hint.parent && doc().objects?.[hint.parent] ? hint.parent : null;
    if (!orderedIds(doc()).length) autoFrame = true;
    handle.change((d) => {
      if (!d.objects) d.objects = {};
      if (!d.order) d.order = [];
      d.objects[id] = {
        name,
        sourceUrl: url,
        providerId: provider.id,
        renderUrl: renderHandle?.url ?? null,
        parent: into,
        visible: true,
        color: null,
        opacity: 1,
        wireframe: false,
        transform: IDENTITY(),
      };
      const at = hint.before ? d.order.indexOf(hint.before) : -1;
      if (at >= 0) d.order.splice(at, 0, id);
      else d.order.push(id);
    });
    // Dropped into a folded group, it would otherwise arrive out of sight.
    select(id, { reveal: !!into });
    return id;
  }

  /** Files dropped from the desktop become file docs, then objects. */
  async function addFiles(files) {
    for (const file of files) {
      const extension = extensionOf(file.name);
      const content = new Uint8Array(await file.arrayBuffer());
      const h = await repo.create2({
        "@patchwork": { type: "file" },
        name: file.name,
        extension,
        mimeType: file.type || (extension === "glb" ? "model/gltf-binary" : extension === "stl" ? "model/stl" : "application/octet-stream"),
        content,
      });
      await addFromUrl(h.url, { name: file.name.replace(/\.[^.]+$/, "") });
    }
  }

  // ─── selection, hover, presence ───────────────────────────────────────────
  function select(id, { reveal = false } = {}) {
    if (selected === id) return;
    const prev = selected;
    selected = id;
    const objects = doc().objects ?? {};
    if (prev && objects[prev]) queue.setPriority(prev, priorityOf(prev, objects[prev]));
    if (id) queue.setPriority(id, SELECTED_PRIORITY);
    if (reveal && id) revealInOutline(id);
    viewport.setSelection(id);
    buildInspector();
    renderOutline();
    broadcastPresence();
  }

  function selectDim(id) {
    selectedDim = id;
    updateDimensions();
    renderDimensionList();
  }

  let lastHoverSent = 0;
  let hoverSendTimer = null;
  function setHover(id) {
    if (hoverId === id) return;
    hoverId = id;
    schedule("outline");
    const wait = 200 - (Date.now() - lastHoverSent);
    clearTimeout(hoverSendTimer);
    if (wait <= 0) broadcastPresence();
    else hoverSendTimer = setTimeout(broadcastPresence, wait);
  }

  function broadcastPresence() {
    if (dead) return;
    lastHoverSent = Date.now();
    try {
      handle.broadcast?.({ type: PRESENCE, selected, hover: hoverId });
    } catch {
      // best effort
    }
  }

  const onEphemeral = (payload) => {
    const msg = payload?.message;
    if (msg?.type !== PRESENCE) return;
    const sender = payload.senderId ?? "peer";
    peers.set(sender, { selected: msg.selected ?? null, hover: msg.hover ?? null, at: Date.now() });
    applyPeers();
  };
  handle.on("ephemeral-message", onEphemeral);
  cleanups.push(() => handle.off("ephemeral-message", onEphemeral));

  function applyPeers() {
    const t = Date.now();
    for (const [k, p] of peers) if (t - p.at > PEER_TTL_MS) peers.delete(k);
    viewport.setRemoteSelections([...peers.values()].map((p) => p.selected));
    schedule("outline");
  }
  const heartbeat = setInterval(() => {
    if (selected || hoverId) broadcastPresence();
    applyPeers();
  }, HEARTBEAT_MS);
  cleanups.push(() => clearInterval(heartbeat));

  // ─── viewport interaction ─────────────────────────────────────────────────
  function onViewportClick(e) {
    if (measure) {
      const hit = viewport.pick(e.clientX, e.clientY, { ground: true });
      if (!hit) return;
      const objects = doc().objects ?? {};
      const obj = hit.objectId ? objects[hit.objectId] : null;
      // local to the object's world matrix, so the anchor follows its parents too
      const anchor = makeAnchor(hit.world, obj ? hit.objectId : null, obj ? worldMatrix(objects, hit.objectId) : null);
      if (!measure.a) {
        measure = { a: anchor, hover: null };
      } else {
        const dimId = newId("d");
        const a = measure.a;
        handle.change((d) => {
          if (!d.dimensions) d.dimensions = {};
          d.dimensions[dimId] = { a, b: anchor, label: null };
        });
        measure = { a: null, hover: null };
        selectedDim = dimId;
      }
      updateMeasure();
      renderDimensionList();
      return;
    }
    const hit = viewport.pick(e.clientX, e.clientY, { snapPx: 0 });
    if (selectedDim) selectDim(null);
    select(hit?.objectId ?? null, { reveal: true });
  }

  function onViewportHover(e) {
    if (!e) {
      setHover(null);
      if (measure) {
        measure.hover = null;
        updateMeasure();
      }
      return;
    }
    const hit = viewport.pick(e.clientX, e.clientY, { ground: !!measure, snapPx: measure ? 10 : 0 });
    setHover(hit?.objectId ?? null);
    if (measure) {
      measure.hover = hit ? { world: hit.world, snapped: hit.snapped } : null;
      updateMeasure();
    }
    viewportEl.toggleAttribute("data-hovering", !!hit?.objectId);
  }

  function setMeasuring(on) {
    measure = on ? { a: null, hover: null } : null;
    $('[data-action="measure"]').setAttribute("aria-pressed", String(on));
    if (on) viewportEl.dataset.measuring = "";
    else delete viewportEl.dataset.measuring;
    updateMeasure();
  }

  function updateMeasure() {
    const hint = $(".measure-hint");
    if (!measure) {
      viewport.setMeasure(null);
      hint.hidden = true;
      return;
    }
    const objects = doc().objects ?? {};
    const a = measure.a ? resolveAnchor(measure.a, objects).world : null;
    const hover = measure.hover?.world ?? null;
    viewport.setMeasure({
      a,
      hover,
      snapped: !!measure.hover?.snapped,
      text: a && hover ? formatLength(distance(a, hover), view().units) : "",
    });
    hint.hidden = false;
    hint.textContent = measure.a ? "Click the second point · Esc to cancel" : "Click the first point · Esc to stop measuring";
  }

  // ─── dimensions ───────────────────────────────────────────────────────────
  function dimensionList() {
    const m = derive();
    const d = m.d;
    const objects = m.objects;
    const parents = m.parents;
    const units = view().units;
    return Object.entries(d.dimensions ?? {}).map(([id, dim]) => {
      const a = resolveAnchor(dim.a, objects, parents);
      const b = resolveAnchor(dim.b, objects, parents);
      const len = distance(a.world, b.world);
      // an end that no longer lies on its object: the object was rebuilt with
      // other geometry, and the anchor stayed where the old surface was
      const offSurface = ["a", "b"].filter((end) => {
        const an = dim[end];
        if (!an?.objectId || !objects[an.objectId] || !Array.isArray(an.local)) return false;
        const g = viewport.ok ? viewport.anchorGap?.(an.objectId, [...an.local]) : null;
        return !!g && g.distance > g.tolerance;
      });
      return {
        id,
        a: a.world,
        b: b.world,
        length: len,
        text: (dim.label ? `${dim.label}: ${formatLength(len, units)}` : formatLength(len, units)) + (offSurface.length ? " · off surface" : ""),
        selected: id === selectedDim,
        detached: !a.attached || !b.attached,
        offSurface: offSurface.length > 0,
        onPointerDown: () => {
          selectDim(id);
          viewportEl.focus({ preventScroll: true });
        },
      };
    });
  }

  function updateDimensions() {
    viewport.setDimensions(dimensionList());
  }

  function renderDimensionList() {
    const list = $(".dimension-list");
    const dims = dimensionList();
    list.replaceChildren(
      ...dims.map((d) =>
        el(
          "li",
          { class: "dimension-row", dataset: { id: d.id }, ...(d.selected ? { "data-selected": true } : {}) },
          el("button", { type: "button", class: "row-main", onclick: () => selectDim(d.id) }, d.text, d.detached ? el("span", { class: "tag", title: "One end is no longer attached to an object" }, "fixed") : null, d.offSurface ? el("span", { class: "tag", "data-tone": "warn", title: "Its object was rebuilt with different geometry and an anchor no longer lies on it, so this measures the old shape. Delete it and measure again." }, "off surface") : null),
          el("button", { type: "button", class: "icon-button", title: "Delete dimension", "aria-label": "Delete dimension", onclick: () => deleteDimension(d.id) }, "×"),
        ),
      ),
    );
    if (!dims.length) list.append(el("li", { class: "empty-row" }, "Use Measure to add one."));
  }

  // ─── outline ──────────────────────────────────────────────────────────────
  // Collapsed / expanded is yours alone: localStorage, never the doc.
  const outlineKey = `scene-outline:${handle.url ?? "scene"}`;
  const expandedOverrides = new Map();
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(outlineKey) ?? "null");
    if (saved && typeof saved === "object") for (const [k, v] of Object.entries(saved)) if (typeof v === "boolean") expandedOverrides.set(k, v);
  } catch {
    // no storage (private window, sandbox): defaults only
  }
  function saveOutlineState() {
    try {
      globalThis.localStorage?.setItem(outlineKey, JSON.stringify(Object.fromEntries(expandedOverrides)));
    } catch {
      // best effort
    }
  }
  // A row's default is taken the first time it's drawn, so hiding a root group
  // later doesn't fold it away under the pointer.
  const firstDefaults = new Map();
  const isExpanded = (m, id, depth) => {
    if (expandedOverrides.has(id)) return expandedOverrides.get(id);
    let v = firstDefaults.get(id);
    if (v === undefined) firstDefaults.set(id, (v = defaultExpanded(m.objects, id, depth)));
    return v;
  };
  function setExpanded(id, value) {
    expandedOverrides.set(id, value);
    saveOutlineState();
  }
  function toggleExpanded(id, value = null) {
    const m = derive();
    const depth = m.tree.find((r) => r.id === id)?.depth ?? 0;
    setExpanded(id, value ?? !isExpanded(m, id, depth));
    renderOutline();
  }
  function revealInOutline(id) {
    const m = derive();
    let changed = false;
    const depthOf = new Map(m.tree.map((r) => [r.id, r.depth]));
    for (let p = m.parents.get(id); p != null; p = m.parents.get(p)) {
      if (!isExpanded(m, p, depthOf.get(p) ?? 0)) {
        expandedOverrides.set(p, true);
        changed = true;
      }
    }
    if (changed) saveOutlineState();
    raf(() => outlineRows.get(id)?.li?.scrollIntoView?.({ block: "nearest" }));
  }

  /** Why a render is contested, for the outline's tooltip and the inspector. */
  function contestedText(s) {
    return s.olderHost
      ? "A collaborator running an older version of the scene tool rebuilt this with their own provider, so it isn't what this version builds. Ask them to reload Patchwork; Rebuild to put this version's build back (their old version may rebuild over it again until they reload)."
      : "A collaborator built it differently (another provider version, or linked documents at other versions); Rebuild to use yours";
  }

  function statusOf(id) {
    const o = derive().objects[id];
    if (!o || isGroup(o)) return null; // a group has nothing to load
    const s = objState.get(id);
    if (!s) return null; // not asked for yet (hidden): nothing to say
    if (s.passthrough) {
      if (s.phase === "error") return { state: "error", text: "error", title: s.error };
      if (isLoadingPhase(s.phase)) return { state: "loading", text: "loading", title: "Loading…" };
      return null;
    }
    if (s.phase === "no-provider") return { state: "warn", text: "no provider", title: `Provider “${s.providerId}” is not installed` };
    if (s.phase === "error") return { state: "error", text: "error", title: s.error };
    if (s.building || s.status === "building") return { state: "building", text: "building", title: "Rebuilding…" };
    if (s.status === "error") return { state: "error", text: "error", title: s.error };
    if (s.glbError || s.parseError) return { state: "error", text: "error", title: s.glbError || s.parseError };
    if (s.stale && s.depsUnavailable?.length) return { state: "stale", text: "stale", title: "Built from a linked document that can't be loaded here; Rebuild to build without it" };
    if (s.stale && s.contested) return { state: "stale", text: "stale", title: contestedText(s) };
    if (s.stale) return { state: "stale", text: s.pinned ? "pinned" : "stale", title: s.pinned ? "Out of date; pinned, so it won't rebuild on its own" : "Out of date; rebuilding soon" };
    if (s.phase === "loading" || (!s.hasGLB && s.phase !== "ready")) return { state: "loading", text: "loading", title: "Loading…" };
    return null;
  }

  // Rows are kept per object id and updated in place: rebuilding them on every
  // doc change would destroy the colour input mid-drag (its picker closes).
  function outlineRow(id, group) {
    let row = outlineRows.get(id);
    if (row && row.group === group) return row;
    const twisty = el("button", { type: "button", class: "twisty", tabindex: "-1", "aria-label": "Expand", onclick: () => toggleExpanded(id) });
    const vis = el("input", { type: "checkbox", title: "Visible", "aria-label": "Visible", onchange: (e) => updateObject(id, (x) => (x.visible = e.target.checked)) });
    const sw = group
      ? el("span", { class: "swatch-spacer", "aria-hidden": "true" })
      : el("input", { type: "color", class: "swatch", title: "Colour", "aria-label": "Colour", oninput: (e) => updateObject(id, (x) => (x.color = e.target.value)) });
    const name = el("span", { class: "name" });
    const count = group ? el("span", { class: "count" }) : null;
    const pill = el("span", { class: "pill" });
    const remove = el("button", { type: "button", class: "icon-button", title: group ? "Remove group and everything in it" : "Remove from scene", "aria-label": "Remove from scene", onclick: () => removeObject(id) }, "×");
    const main = el("button", { type: "button", class: "row-main", onclick: () => select(id), ondblclick: () => viewport.frameObject(id) }, name, count);
    // The name is the grab handle. Making the whole row draggable would fight
    // the colour input and the visibility checkbox inside it.
    main.draggable = true;
    main.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(ROW_MIME, JSON.stringify({ scene: handle.url, id }));
      e.dataTransfer.effectAllowed = "move";
    });
    const li = el("li", { class: "object-row", role: "treeitem", dataset: { id, ...(group ? { kind: "group" } : {}) } }, twisty, vis, sw, main, remove);
    row = { li, twisty, vis, sw, name, count, pill, remove, main, group };
    outlineRows.set(id, row);
    return row;
  }

  function renderOutline() {
    if (dead) return;
    const t0 = now();
    const m = derive();
    const { objects, ids, tree, kids, parents } = m;
    const searchBox = $(".outline-search");
    searchBox.hidden = ids.length < SEARCH_FROM && !filterQuery;
    let search = null;
    if (filterQuery) {
      if (m.search?.q !== filterQuery) m.search = { q: filterQuery, ...searchOutline(objects, filterQuery, parents, ids) };
      search = m.search;
    }
    const rows = visibleRows(tree, {
      isExpanded: (id, depth) => isExpanded(m, id, depth),
      hasChildren: (id) => (kids.get(id)?.length ?? 0) > 0,
      shown: search?.shown ?? null,
    });
    const peerSel = new Set([...peers.values()].map((p) => p.selected));
    const peerHover = new Set([...peers.values()].map((p) => p.hover));
    const list = $(".object-list");
    for (const id of [...outlineRows.keys()]) if (!objects[id]) outlineRows.delete(id);
    const mixed = mixedOf(m);
    const els = rows.map(({ id, depth, expanded, hasChildren }) => {
      const o = objects[id];
      const group = isGroup(o);
      const st = statusOf(id);
      const { li, twisty, vis, sw, name, count, pill, remove } = outlineRow(id, group);
      if (li.dataset.depth !== String(depth)) {
        li.dataset.depth = String(depth);
        li.style.setProperty("--depth", String(depth));
      }
      li.toggleAttribute("data-selected", id === selected);
      li.toggleAttribute("data-hover", id === hoverId);
      li.toggleAttribute("data-remote-selected", peerSel.has(id));
      li.toggleAttribute("data-remote-hover", !peerSel.has(id) && peerHover.has(id));
      li.toggleAttribute("data-hidden", !shownIn(m, id));
      li.toggleAttribute("data-context", !!search && !search.matches.has(id));
      const p = parents.get(id);
      li.toggleAttribute("data-attached", p != null && !isGroup(objects[p]));
      li.toggleAttribute("data-leaf", !hasChildren);
      if (hasChildren) {
        li.setAttribute("aria-expanded", String(expanded));
        twisty.setAttribute("aria-expanded", String(expanded));
        twisty.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
      } else li.removeAttribute("aria-expanded");
      vis.checked = o.visible !== false;
      vis.indeterminate = group && o.visible !== false && mixed.has(id);
      if (!group) {
        const colour = o.color || "#9aa3b5";
        if (sw.value !== colour) sw.value = colour;
        sw.toggleAttribute("data-auto", !o.color);
      }
      const label = o.name || (group ? "Group" : "Object");
      if (name.textContent !== label) name.textContent = label;
      if (count) {
        const n = String(kids.get(id)?.length ?? 0);
        if (count.textContent !== n) count.textContent = n;
      }
      if (st) {
        pill.dataset.state = st.state;
        pill.title = st.title ?? "";
        if (pill.textContent !== st.text) pill.textContent = st.text;
        if (pill.parentNode !== li) li.insertBefore(pill, remove);
      } else {
        pill.remove();
      }
      return li;
    });
    if (!ids.length) els.push((emptyRow ??= el("li", { class: "empty-row" }, "Nothing here yet.")));
    else if (search && !search.matches.size) els.push(el("li", { class: "empty-row" }, "No matches."));
    const current = [...list.children];
    // Only touch the list's structure when the order or membership changed.
    if (current.length !== els.length || current.some((c, i) => c !== els[i])) list.replaceChildren(...els);
    const countEl = $(".match-count");
    const countText = search ? `${search.matches.size} of ${ids.length}` : "";
    if (countEl.textContent !== countText) countEl.textContent = countText;
    $(".empty").hidden = ids.length > 0;
    perf.outline.add(now() - t0);
  }

  function renderHud() {
    const states = [...objState.values()];
    const building = states.filter((s) => s.building || s.status === "building").length;
    const errors = states.filter((s) => s.phase === "error" || s.status === "error" || s.glbError || s.parseError).length;
    const loading = queue.pending();
    const bits = [];
    if (loading) {
      const total = queue.ids().length;
      bits.push(el("span", { class: "pill", dataset: { state: "loading" } }, `Loading ${total - loading} of ${total}…`));
    }
    if (building) bits.push(el("span", { class: "pill", dataset: { state: "building" } }, `Building ${building}…`));
    if (errors) bits.push(el("span", { class: "pill", dataset: { state: "error" } }, `${errors} error${errors > 1 ? "s" : ""}`));
    $(".hud").replaceChildren(...bits);
  }

  // colour legends for visible objects whose GLB carries one (extras.legend)
  let legendsKey = "";
  function renderLegends() {
    const m = derive();
    const cards = [];
    const keyParts = [];
    for (const { id } of m.tree) {
      const o = m.objects[id];
      if (!o || isGroup(o) || !shownIn(m, id)) continue;
      const legend = viewport.ok ? viewport.legendOf(id) : null;
      if (!legend) continue;
      const lm = legendModel(legend, o.name ?? "", o.color ?? null);
      keyParts.push(`${id}|${lm.label}|${lm.gradient}|${lm.tinted}|${lm.ticks.map((t) => t.text).join(",")}`);
      const bar = el("div", { class: "legend-bar" });
      bar.style.background = lm.gradient;
      cards.push(
        el(
          "div",
          { class: "legend", dataset: { objectId: id, ...(lm.tinted ? { tinted: "" } : {}) } },
          el(
            "div",
            { class: "legend-label" },
            lm.label,
            lm.tinted ? el("span", { class: "legend-tint", title: `Tinted by this object's colour (${o.color}); set Colour to Auto for the true colours` }, " · tinted") : null,
          ),
          bar,
          el("div", { class: "legend-ticks" }, ...lm.ticks.map((t) => el("span", {}, t.text))),
        ),
      );
    }
    const key = keyParts.join("\n");
    if (key === legendsKey) return;
    legendsKey = key;
    $(".legends").replaceChildren(...cards);
  }

  // ─── inspector ────────────────────────────────────────────────────────────
  let inspector = null; // { id, fields…, unmountControls, unmountAbout, aboutKey }

  function numberField(label, onCommit) {
    const input = el("input", { type: "number", step: "any", "aria-label": label });
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onCommit(v);
    });
    return { input, row: el("label", { class: "num" }, el("span", {}, label), input) };
  }

  function mountControls(container, renderUrl) {
    // Prefer the real embed so the controls tool is resolved through the registry.
    if (globalThis.customElements?.get?.("patchwork-view")) {
      const v = document.createElement("patchwork-view");
      v.setAttribute("doc-url", renderUrl);
      v.setAttribute("tool-id", "scene-render-controls");
      container.append(v);
      return () => v.remove();
    }
    let cleanup = null;
    let gone = false;
    Promise.all([repo.find(renderUrl), import("./controls-tool.js")])
      .then(([h, m]) => {
        if (!gone) cleanup = m.default(h, container);
      })
      .catch((err) => container.append(el("p", { class: "error" }, `Controls unavailable: ${err?.message ?? err}`)));
    return () => {
      gone = true;
      cleanup?.();
      container.replaceChildren();
    };
  }

  function openDocument(from, url, toolId = null) {
    from.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, ...(toolId ? { toolId } : {}) }, bubbles: true, composed: true }));
  }

  /**
   * What the "About" section shows (v3 §8): the object's own infoUrl, else the
   * nearest ancestor group's, labelled with that group's name.
   */
  function aboutFor(id) {
    const m = derive();
    const o = m.objects[id];
    const own = docUrl(o?.infoUrl);
    if (own) return { url: own, toolId: o.infoToolId || null, label: "About", from: id };
    for (let p = m.parents.get(id); p != null; p = m.parents.get(p)) {
      const g = m.objects[p];
      if (!isGroup(g)) continue;
      const u = docUrl(g.infoUrl);
      if (u) return { url: u, toolId: g.infoToolId || null, label: `About ${g.name || "group"}`, from: p };
    }
    return null;
  }

  function updateAbout() {
    if (!inspector) return;
    const about = aboutFor(inspector.id);
    const canEmbed = !!globalThis.customElements?.get?.("patchwork-view");
    const key = about && canEmbed ? `${about.url}|${about.toolId ?? ""}|${about.label}` : "";
    if (key === inspector.aboutKey) return;
    inspector.aboutKey = key;
    inspector.unmountAbout?.();
    inspector.unmountAbout = null;
    const section = inspector.about;
    if (!key) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    const embed = el("div", { class: "about-embed" });
    const v = document.createElement("patchwork-view");
    v.setAttribute("doc-url", about.url);
    if (about.toolId) v.setAttribute("tool-id", about.toolId);
    embed.append(v);
    const open = el("button", { type: "button", class: "button link open-about", title: "Open this document", onclick: () => openDocument(section, about.url, about.toolId) }, "Open");
    section.replaceChildren(el("div", { class: "panel-head" }, el("h3", { class: "panel-title about-title" }, about.label), open), embed);
    section.hidden = false;
    inspector.unmountAbout = () => v.remove();
  }

  function buildInspector() {
    inspector?.unmountControls?.();
    inspector?.unmountAbout?.();
    const panel = $(".inspector");
    const o = selected ? doc().objects?.[selected] : null;
    if (!o) {
      inspector = null;
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    const id = selected;
    const group = isGroup(o);
    const passthrough = isPassthrough(o);
    panel.hidden = false;
    const name = el("input", { type: "text", class: "name-input", "aria-label": "Name" });
    name.addEventListener("change", () => updateObject(id, (x) => (x.name = name.value)));
    const visible = el("input", { type: "checkbox" });
    visible.addEventListener("change", () => updateObject(id, (x) => (x.visible = visible.checked)));
    const wire = group ? null : el("input", { type: "checkbox" });
    wire?.addEventListener("change", () => updateObject(id, (x) => (x.wireframe = wire.checked)));
    const colorIn = group ? null : el("input", { type: "color" });
    colorIn?.addEventListener("input", () => updateObject(id, (x) => (x.color = colorIn.value)));
    const resetColor = group ? null : el("button", { type: "button", class: "button link", onclick: () => updateObject(id, (x) => (x.color = null)) }, "Auto");
    const opacity = el("input", { type: "range", min: "0", max: "1", step: "0.01", "aria-label": "Opacity" });
    opacity.addEventListener("input", () => updateObject(id, (x) => (x.opacity = Number(opacity.value))));
    const attach = el("select", { class: "attach", "aria-label": "Attached to" });
    attach.addEventListener("change", () => attachTo(id, attach.value || null));

    const setT = (kind, i, v) =>
      updateObject(id, (x) => {
        if (!x.transform) x.transform = IDENTITY();
        if (kind === "scale") x.transform.scale = v > 0 ? v : 1;
        else {
          if (!Array.isArray(x.transform[kind])) x.transform[kind] = [0, 0, 0];
          x.transform[kind][i] = kind === "rotation" ? v / DEG : fromUnits(v, view().units);
        }
      });
    const pos = ["X", "Y", "Z"].map((a, i) => numberField(a, (v) => setT("position", i, v)));
    const rot = ["X", "Y", "Z"].map((a, i) => numberField(a, (v) => setT("rotation", i, v)));
    const scale = numberField("×", (v) => setT("scale", 0, v));
    const posUnit = el("span", { class: "unit" });

    const status = el("div", { class: "status-line" });
    const controls = o.renderUrl ? el("div", { class: "controls-embed" }) : null;
    const about = el("section", { class: "about", hidden: true });

    const parts = [
      el("h3", { class: "panel-title" }, group ? "Group" : "Object"),
      name,
      el("div", { class: "cluster" }, el("label", { class: "toggle" }, visible, " Visible"), wire ? el("label", { class: "toggle" }, wire, " Wireframe") : null),
      group ? null : el("div", { class: "cluster" }, el("label", { class: "toggle" }, "Colour ", colorIn), resetColor),
      el("label", { class: "field" }, el("span", {}, "Opacity"), opacity),
      el("label", { class: "field", title: "Attached objects move with the object or group they're attached to; their position is relative to it" }, el("span", {}, group ? "Inside" : "Attached to"), attach),
      el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Position ", posUnit), el("div", { class: "triple" }, ...pos.map((f) => f.row))),
      el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Rotation °"), el("div", { class: "triple" }, ...rot.map((f) => f.row))),
      el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Scale"), el("div", { class: "triple" }, scale.row)),
      // Status, "Open source" and "Rebuild now" live in the embedded controls
      // below; only what they can't know (build notes, GLB load errors) is here.
      el(
        "div",
        { class: "cluster" },
        el("button", { type: "button", class: "button", onclick: () => viewport.frameObject(id) }, "Frame"),
        group
          ? el("button", { type: "button", class: "button", title: "Move what's in this group up a level, where it is, and remove the group", onclick: () => ungroup(id) }, "Ungroup")
          : el("button", { type: "button", class: "button", title: "Put this object in a new group", onclick: () => newGroup({ around: id }) }, "Group"),
        el("button", { type: "button", class: "button danger", onclick: () => removeObject(id) }, "Remove"),
        passthrough ? el("button", { type: "button", class: "button link", title: "Open the GLB file", onclick: (e) => openDocument(e.currentTarget, o.sourceUrl) }, "Open file") : null,
      ),
      about,
      controls ? el("h3", { class: "panel-title" }, "Build") : null,
      controls,
      status,
    ];
    panel.replaceChildren(...parts.filter((p) => p != null));
    inspector = {
      id,
      group,
      name,
      visible,
      wire,
      colorIn,
      opacity,
      attach,
      attachKey: null,
      pos,
      rot,
      scale,
      posUnit,
      status,
      about,
      aboutKey: null,
      unmountAbout: null,
      unmountControls: controls ? mountControls(controls, o.renderUrl) : null,
    };
    updateInspector();
  }

  function formatCount(n) {
    return n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : String(n);
  }

  function updateInspector() {
    if (!inspector) return;
    const m = derive();
    const objects = m.objects;
    const o = objects[inspector.id];
    if (!o) return;
    if (isGroup(o) !== inspector.group || !!o.renderUrl !== !!inspector.unmountControls) return buildInspector();
    const setVal = (input, v) => {
      if (input && document.activeElement !== input) input.value = v;
    };
    setVal(inspector.name, o.name ?? "");
    inspector.visible.checked = o.visible !== false;
    if (inspector.wire) inspector.wire.checked = !!o.wireframe;
    setVal(inspector.colorIn, o.color || "#9aa3b5");
    setVal(inspector.opacity, String(o.opacity ?? 1));
    const t = normalizeTransform(o.transform);
    const units = view().units;
    const parents = m.parents;
    const parent = parents.get(inspector.id) ?? null;
    // "None", then every group (as a tree), then every object this one could
    // be attached to (not itself, nothing below it)
    const allowed = new Set(attachTargets(objects, inspector.id, parents));
    const groupOpts = [];
    const objectOpts = [];
    for (const { id: tid, depth } of m.tree) {
      if (!allowed.has(tid)) continue;
      const x = objects[tid];
      if (isGroup(x)) groupOpts.push([tid, `${" ".repeat(Math.min(depth, 8))}${x.name || "Group"}`]);
      else objectOpts.push([tid, x?.name || "Object"]);
    }
    const targets = [...groupOpts, ...objectOpts];
    const attachKey = JSON.stringify(targets);
    if (inspector.attachKey !== attachKey && document.activeElement !== inspector.attach) {
      inspector.attachKey = attachKey;
      const opt = ([tid, label]) => el("option", { value: tid }, label);
      const children = [el("option", { value: "" }, "None")];
      if (groupOpts.length && objectOpts.length) {
        children.push(el("optgroup", { label: "Groups" }, ...groupOpts.map(opt)), el("optgroup", { label: "Objects" }, ...objectOpts.map(opt)));
      } else children.push(...targets.map(opt));
      inspector.attach.replaceChildren(...children);
    }
    setVal(inspector.attach, parent ?? "");
    inspector.posUnit.textContent = parent ? `(${units}, relative to ${objects[parent]?.name || "parent"})` : `(${units})`;
    inspector.pos.forEach((f, i) => setVal(f.input, String(roundForDisplay(toUnits(t.position[i], units), 6))));
    inspector.rot.forEach((f, i) => setVal(f.input, String(roundForDisplay(t.rotation[i] * DEG, 6))));
    setVal(inspector.scale.input, String(t.scale));
    updateAbout();
    const s = objState.get(inspector.id) ?? {};
    // replaceChildren() turns a null argument into the text "null": pass only nodes.
    const parts = [];
    if (isPassthrough(o)) {
      const cs = viewport.ok ? viewport.contentStats(inspector.id) : null;
      const tris = cs?.triangles ?? o.hint?.triangles;
      const bits = [];
      if (Number.isFinite(tris)) bits.push(`${formatCount(tris)} triangles`);
      if (cs) bits.push(`${cs.drawCalls} draw call${cs.drawCalls === 1 ? "" : "s"}${cs.instanced ? ` (${cs.nodes} parts)` : ""}`);
      if (Number.isFinite(o.hint?.bytes)) bits.push(`${(o.hint.bytes / 1024).toFixed(o.hint.bytes < 10240 ? 1 : 0)} KB`);
      if (isLoadingPhase(s.phase)) bits.push("loading…");
      else if (!s.phase && !shownIn(m, inspector.id)) bits.push("not loaded (hidden)");
      if (bits.length) parts.push(el("span", { class: "notes" }, bits.join(" · ")));
      if (s.phase === "error" && s.error) parts.push(el("p", { class: "error" }, s.error));
    } else {
      if (s.notes) parts.push(el("span", { class: "notes" }, s.notes));
      if (s.phase === "no-provider") parts.push(el("p", { class: "error" }, `Provider “${s.providerId}” is not installed, so this object can't be rebuilt here.`));
      // left alone rather than fought over (see isContested): say so where it can be read, not only in a tooltip
      if (s.stale && s.contested && !s.building) parts.push(el("p", { class: "warn" }, contestedText(s)));
      // Render-doc build errors are shown by the controls; these are the scene's own.
      const err = s.glbError || s.parseError || (s.phase === "error" ? s.error : null);
      if (err) parts.push(el("p", { class: "error" }, err));
    }
    inspector.status.replaceChildren(...parts);
    inspector.status.hidden = !parts.length;
  }

  /** Attach `id` to `parent` (null = detach), keeping it where it is in the world. */
  function attachTo(id, parent) {
    const objects = doc().objects ?? {};
    const plan = planAttach(objects, id, parent);
    if (!plan) {
      toast("Can't attach an object to something attached to it.", "error");
      updateInspector();
      return;
    }
    // planAttach works on the resolved tree; make the doc say that tree first
    const broken = brokenParents(objects);
    handle.change((d) => {
      repairCycles(d, broken);
      const o = d.objects?.[id];
      if (!o) return;
      o.parent = plan.parent;
      o.transform = plan.transform;
    });
  }

  // ─── toolbar ──────────────────────────────────────────────────────────────
  function updateToolbar() {
    const v = view();
    for (const input of root.querySelectorAll("[data-view]")) input.checked = !!v[input.dataset.view];
    $(".units").value = v.units;
    $(".gizmo").value = gizmoMode ?? "";
  }

  for (const input of root.querySelectorAll("[data-view]")) {
    input.addEventListener("change", () => setView(input.dataset.view, input.checked));
  }
  $(".units").addEventListener("change", (e) => setView("units", e.target.value));
  $(".gizmo").addEventListener("change", (e) => {
    gizmoMode = e.target.value || null;
    viewport.setGizmoMode(gizmoMode);
  });
  $('[data-action="frame"]').addEventListener("click", () => viewport.frameAll());
  $('[data-action="measure"]').addEventListener("click", () => setMeasuring(!measure));
  $(".new-group").addEventListener("click", () => newGroup({ into: isGroup(doc().objects?.[selected]) ? selected : null }));
  // the side panel is yours alone (not in the doc): hide it for a full-width view
  const setPanel = (shown) => {
    root.toggleAttribute("data-panel-hidden", !shown);
    $('[data-action="panel"]').setAttribute("aria-pressed", String(shown));
  };
  $('[data-action="panel"]').addEventListener("click", () => setPanel(root.hasAttribute("data-panel-hidden")));

  // outline filter: view-only, never written to the doc
  const filterInput = $(".outline-filter");
  filterInput.addEventListener("input", () => {
    filterQuery = filterInput.value.trim();
    renderOutline();
  });
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // keydown, not click: nothing delegates it
      filterInput.value = "";
      filterQuery = "";
      renderOutline();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const first = derive().search?.first;
      if (first) {
        select(first, { reveal: true });
        viewport.frameObject(first);
      }
    }
  });

  // outline keyboard: ↑/↓ move, → expands (or steps in), ← collapses (or steps out)
  const outlineList = $(".object-list");
  outlineList.addEventListener("keydown", (e) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const li = e.target?.closest?.(".object-row");
    if (!li || e.target.tagName === "INPUT") return;
    const rows = [...outlineList.querySelectorAll(":scope > .object-row")];
    const i = rows.indexOf(li);
    const id = li.dataset.id;
    const focusRow = (r) => r?.querySelector(".row-main")?.focus();
    const hasKids = !li.hasAttribute("data-leaf");
    const open = li.getAttribute("aria-expanded") === "true";
    e.preventDefault();
    if (e.key === "ArrowDown") focusRow(rows[i + 1]);
    else if (e.key === "ArrowUp") focusRow(rows[i - 1]);
    else if (e.key === "ArrowRight") {
      if (hasKids && !open) {
        toggleExpanded(id, true);
        focusRow(outlineRows.get(id)?.li);
      } else if (hasKids) focusRow(rows[i + 1]);
    } else if (e.key === "ArrowLeft") {
      if (hasKids && open) {
        toggleExpanded(id, false);
        focusRow(outlineRows.get(id)?.li);
      } else {
        const p = derive().parents.get(id);
        if (p) focusRow(outlineRows.get(p)?.li);
      }
    }
  });

  // An embedded document (the About section) is another tool: its keys,
  // pastes and drops are its own, never scene shortcuts or scene additions.
  const fromEmbed = (e) => {
    const path = e.composedPath?.() ?? [];
    for (const n of path.length ? path : [e.target]) {
      if (n === root) return false;
      if (n?.classList?.contains?.("about-embed")) return true;
    }
    return !!e.target?.closest?.(".about-embed");
  };

  // keyboard: only when focus is in the tool and not in a field
  const onKey = (e) => {
    if (fromEmbed(e)) return;
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
    if (e.key === "Escape") {
      if (typing) return t.blur();
      if (measure?.a) {
        measure.a = null;
        updateMeasure();
      } else if (measure) setMeasuring(false);
      else if (selectedDim) selectDim(null);
      else select(null);
      e.preventDefault();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedDim) {
      deleteDimension(selectedDim);
      e.preventDefault();
    } else if (e.key === "m" || e.key === "M") setMeasuring(!measure);
    else if (e.key === "f" || e.key === "F") viewport.frameAll();
    else if (e.key === "p" || e.key === "P") setPanel(root.hasAttribute("data-panel-hidden"));
    else if (e.key === "g" || e.key === "r") {
      gizmoMode = e.key === "g" ? "translate" : "rotate";
      viewport.setGizmoMode(gizmoMode);
      updateToolbar();
    }
  };
  root.addEventListener("keydown", onKey);
  viewportEl.addEventListener("pointerdown", () => viewportEl.focus({ preventScroll: true }));

  // drag & drop, paste
  let dragDepth = 0;
  const hint = $(".drop-hint");
  const accepts = (dt) => hasPatchworkDrop(dt) || [...(dt?.types ?? [])].includes("Files");
  root.addEventListener("dragenter", (e) => {
    if (fromEmbed(e)) return;
    if (!accepts(e.dataTransfer)) return;
    dragDepth++;
    hint.hidden = false;
  });
  root.addEventListener("dragover", (e) => {
    if (fromEmbed(e)) return;
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  root.addEventListener("dragleave", (e) => {
    if (fromEmbed(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hint.hidden = true;
  });
  root.addEventListener("drop", (e) => {
    if (fromEmbed(e)) return;
    dragDepth = 0;
    hint.hidden = true;
    const dt = e.dataTransfer;
    if (!accepts(dt)) return;
    e.preventDefault();
    const files = [...(dt.files ?? [])];
    if (files.length) return void addFiles(files);
    const items = parsePatchworkDrop(dt);
    if (!items.length) return toast("Nothing droppable there.", "error");
    (async () => {
      for (const item of items) await addFromUrl(item.url, { name: item.name });
    })();
  });
  root.addEventListener("paste", (e) => {
    if (fromEmbed(e)) return;
    const t = e.target;
    if (t instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    const text = e.clipboardData?.getData("text/plain");
    if (parseAutomergeUrl(text)) {
      e.preventDefault();
      addFromUrl(text);
    }
  });

  // ── the object tree as a drop target ─────────────────────────────────────
  // Two drags end here and they are told apart by mime: a row being moved
  // inside the tree carries ROW_MIME, a document from the sidebar carries the
  // patchwork payloads. Both ask tree-drop.js the same question — which parent,
  // and in front of which sibling — and the answer is applied differently: one
  // moves an object, the other adds one.
  const objectList = $(".object-list");
  let mark = null;

  const rowUnder = (e) => {
    const li = e.target instanceof Element ? e.target.closest(".object-row") : null;
    if (!li || !objectList.contains(li)) return null;
    const box = li.getBoundingClientRect();
    return { id: li.dataset.id, li, fraction: (e.clientY - box.top) / (box.height || 1) };
  };

  const showMark = (next) => {
    if (mark?.li && mark.li !== next?.li) delete mark.li.dataset.drop;
    if (next?.li) next.li.dataset.drop = next.intent;
    mark = next;
  };

  /** What the pointer is over, or null when it is not over a row. */
  const targetUnder = (e) => {
    const under = rowUnder(e);
    if (!under) return null;
    const objects = doc().objects ?? {};
    if (!objects[under.id]) return null;
    const expanded = under.li.getAttribute("aria-expanded") === "true";
    return { ...under, expanded, intent: dropIntent(isGroup(objects[under.id]), under.fraction) };
  };

  objectList.addEventListener("dragover", (e) => {
    const types = [...(e.dataTransfer?.types ?? [])];
    const moving = types.includes(ROW_MIME);
    if (!moving && !hasPatchworkDrop(e.dataTransfer)) return;
    const target = targetUnder(e);
    if (!target) return showMark(null);
    e.preventDefault();
    // Keep it off the root handler, which would add at the top level and show
    // the whole-tool hint over a drag that already has a precise target.
    e.stopPropagation();
    e.dataTransfer.dropEffect = moving ? "move" : "copy";
    hint.hidden = true;
    showMark(target);
  });

  objectList.addEventListener("dragleave", (e) => {
    if (e.relatedTarget instanceof Node && objectList.contains(e.relatedTarget)) return;
    showMark(null);
  });

  objectList.addEventListener("drop", (e) => {
    // The root's drag counter is only ever reset by a drop, and this one stops
    // before it gets there: reset it here, or the next drag that crosses the
    // tool without dropping leaves the whole-tool hint up.
    dragDepth = 0;
    hint.hidden = true;
    const target = targetUnder(e);
    showMark(null);
    if (!target) return;
    const dt = e.dataTransfer;
    const snapshot = doc();
    const objects = snapshot.objects ?? {};
    const parents = resolveParents(objects);
    const order = orderedIds(snapshot);
    const place = placementFor(objects, order, target.id, target.intent, parents, { expanded: target.expanded });

    const isRow = [...(dt?.types ?? [])].includes(ROW_MIME);
    if (isRow) {
      e.preventDefault();
      e.stopPropagation();
      const drag = readRowDrag(dt);
      if (!drag) return;
      if (drag.scene !== handle.url) return toast("That row belongs to another scene.", "error");
      if (!objects[drag.id]) return toast("That object is no longer in this scene.", "error");
      // Released on its own row: a click that wobbled, whichever band it hit.
      if (drag.id === target.id) return select(drag.id);
      return moveRow(drag.id, place, objects, parents, order);
    }
    if (!hasPatchworkDrop(dt)) return;
    const items = parsePatchworkDrop(dt);
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      for (const item of items) await addFromUrl(item.url, { name: item.name, parent: place.parent, before: place.before });
    })();
  });

  /**
   * Move `id` to where a drop asked for, keeping its world pose.
   *
   * hierarchy.js owns both halves of that: whether the move is legal, and what
   * the local transform has to become so nothing visibly shifts.
   */
  function moveRow(id, place, objects, parents, order) {
    // A row released on itself, or on the line it already sits at, is a
    // click that wobbled: nothing to write.
    if (!isMove(objects, order, id, place, parents)) return select(id);
    if (!canMove(objects, id, place.parent, parents)) {
      return toast("A group can't go inside itself.", "error");
    }
    const plan = planAttach(objects, id, place.parent, parents);
    if (!plan) return toast("A group can't go inside itself.", "error");
    const reparent = plan.parent !== (parents.get(id) ?? null);
    const t = plan.transform;
    // planAttach works on the resolved tree; make the doc say that tree first,
    // or an edge a merged cycle left behind comes back once this move makes it
    // acyclic, and moves an object nobody touched (see brokenParents).
    const broken = brokenParents(objects, parents);
    handle.change((d) => {
      repairCycles(d, broken);
      const o = d.objects?.[id];
      if (!o) return;
      // A reorder within the same parent leaves parent and transform alone,
      // so it can't win last-writer-wins over a peer's gizmo move.
      if (reparent) {
        o.parent = plan.parent;
        // Fresh arrays and a fresh object: automerge refuses a value that is
        // already inside the document.
        o.transform = { position: [...t.position], rotation: [...t.rotation], scale: t.scale };
      }
      if (!d.order) d.order = [];
      spliceOrder(d.order, id, place.before);
    });
    if (plan.parent) setExpanded(plan.parent, true);
    select(id);
  }

  // rebuild requests from embedded controls
  root.addEventListener(REBUILD_EVENT, (e) => {
    const url = e.detail?.renderUrl;
    const entry = Object.entries(doc().objects ?? {}).find(([, o]) => o.renderUrl === url);
    if (!entry) return;
    const [id, o] = entry;
    e.preventDefault();
    if (manager.ids().includes(id)) return void manager.rebuild(id);
    // Hidden, so not hydrated yet (v3 §7): an explicit Rebuild loads it first.
    // It then stays tracked, like anything that has loaded.
    if (!o.sourceUrl) return;
    Promise.resolve(manager.track(id, { sourceUrl: o.sourceUrl, renderUrl: o.renderUrl }))
      .then(() => {
        if (!dead && doc().objects?.[id]?.renderUrl === url) manager.rebuild(id);
      })
      .catch((err) => console.warn("[scene] rebuild failed to start", err));
  });

  // ─── doc → everything ─────────────────────────────────────────────────────
  let framedFromHints = false;
  function sync() {
    if (dead) return;
    const t0 = now();
    const m = derive();
    const { d, objects, parents, tree, inherited } = m;
    viewport.setMaterialRules(d.materialRules);
    const tracked = new Set(manager.ids());
    let hinted = false;
    // Parents before children (hierarchy order, roots first), so each group's
    // new parent is already where it belongs when the group is attached to it.
    // In plain `order`, a change that inverts an edge (A under B becomes B
    // under A) would briefly look like a loop to the viewport, which then
    // leaves the object at the root.
    for (const { id } of tree) {
      const o = objects[id];
      const parent = parents.get(id) ?? null;
      const inh = inherited.get(id);
      // placed even without geometry, so whatever is attached to it sits right
      const key = displayKey(o, parent, inh);
      if (displayKeys.get(id) !== key) {
        displayKeys.set(id, key);
        viewport.applyDisplay(id, o, parent, inh);
      }
      if (isGroup(o)) {
        if (tracked.has(id)) manager.untrack(id);
        queue.remove(id);
        continue;
      }
      const shown = o.visible !== false && inh.visible;
      if (o.renderUrl) {
        queue.remove(id);
        // hydrate only what is shown; once loaded it stays loaded
        if (o.sourceUrl && (shown || tracked.has(id))) manager.track(id, { sourceUrl: o.sourceUrl, renderUrl: o.renderUrl });
        continue;
      }
      const src = docUrl(o.sourceUrl);
      if (!src) continue;
      if (tracked.has(id)) manager.untrack(id);
      const b = o.hint?.bounds;
      const hk = b ? `${b.min}|${b.max}` : "";
      if (hintKeys.get(id) !== hk) {
        hintKeys.set(id, hk);
        viewport.setHint(id, b ?? null);
      }
      if (hk && shown) hinted = true;
      if (shown) queue.ensure(id, src, priorityOf(id, o));
      else if (queue.cancel(id)) {
        // dropped before it loaded: it's "not loaded (hidden)" again, not loading or failing
        objState.delete(id);
      }
    }
    for (const id of new Set([...tracked, ...viewport.objects.keys(), ...queue.ids(), ...displayKeys.keys()])) {
      if (!objects[id]) {
        manager.untrack(id);
        queue.remove(id);
        viewport.removeObject(id);
        objState.delete(id);
        displayKeys.delete(id);
        hintKeys.delete(id);
      }
    }
    // Frame once, from where things will be, before anything has loaded.
    if (autoFrame && hinted && !framedFromHints && viewport.ok) {
      framedFromHints = true;
      autoFrame = false;
      viewport.frameAll();
    }
    if (selected && !objects[selected]) select(null);
    if (selectedDim && !d.dimensions?.[selectedDim]) selectedDim = null;
    viewport.setView(view());
    updateMeasure();
    updateToolbar();
    const parts = ["dims", "outline", "hud", "legends"];
    if (inspector && inspector.id === selected) parts.push("inspector");
    // at once while cheap this frame, else coalesced (see UI_BUDGET_MS)
    if (!uiFree()) schedule(...parts);
    else {
      for (const p of parts) pending.add(p);
      flushParts();
    }
    perf.sync.add(now() - t0);
  }
  handle.on("change", sync);
  cleanups.push(() => handle.off("change", sync));
  sync();

  // for probes and the importer's verify step: renderer.info, queue and timing stats
  const debug = {
    get renderer() {
      return viewport.renderer ?? null;
    },
    viewport,
    queue,
    manager,
    perf,
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
    dead = true;
    try {
      handle.broadcast?.({ type: PRESENCE, selected: null, hover: null });
    } catch {
      // ignore
    }
    if (frameReq != null) caf(frameReq);
    if (uiResetReq != null) caf(uiResetReq);
    clearTimeout(cameraTimer);
    clearTimeout(toastTimer);
    clearTimeout(hoverSendTimer);
    for (const c of cleanups) c();
    inspector?.unmountControls?.();
    inspector?.unmountAbout?.();
    queue.dispose();
    manager.dispose();
    viewport.dispose();
    if (globalThis.__sceneDebug === debug) delete globalThis.__sceneDebug;
    root.remove();
    style.remove();
  };
}
