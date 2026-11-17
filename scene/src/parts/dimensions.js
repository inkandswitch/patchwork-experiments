// scene.dimensions: the saved dimensions in doc.dimensions.
//
// Each dimension is drawn as a line over everything with its end markers and
// a label (its name, if any, and its length in the viewer's units) that can be
// clicked to select it. An end whose object is gone is "fixed" (frozen at its
// stored world point); an end that no longer lies on its object's geometry
// (the object was rebuilt with another shape) is "off surface". The
// Dimensions panel lists them, to select and delete.
//
// Saved dimensions are the doc's, drawn in every body (an author's
// annotation, like a label); measuring them, their panel, selecting one by
// its label and deleting it are the editor's (../stage/bodies.js): only in
// Edit.
//
// A dimension is selectable though it isn't a scene object: selecting one
// sets local.selected, the one selection, to its ref "dimension:<id>"
// (STAGE.md, "Targets and refs"), so selecting an object (or anything else)
// lets go of it with nothing to reconcile. Delete is a command on that ref;
// Escape (the stage's ladder) and a click elsewhere in the view (the Edit hand's
// click) clear it, as they clear any selection. This
// part lets go of a ref whose dimension went.
//
// They are the focus doc's (api.focus()): drawn in its stage, in its frame,
// and drawn again where the focus goes; the panel is the view's, and lists
// the focus doc's.

import css from "./dimensions.css?inline";
import { detachAnchor, distance } from "../anchors.js";
import { applyMatrix } from "../transform.js";
import { formatLength } from "../units.js";
import { distanceToPrimitives, onSurfaceTolerance } from "../surface.js";
import { drawerTab, tabToggle } from "./tab.js";
import { editor } from "./editor.js";
import { contentMatrix } from "../stage/scope.js";
import { editing } from "../stage/bodies.js";
import { perFocus } from "./per-focus.js";

/** The ref kind for dimensions: a selected dimension is the target "dimension:<id>". */
export const KIND = "dimension";
const PREFIX = `${KIND}:`;

/** The target that names a dimension. */
export const dimensionRef = (id) => PREFIX + id;

/**
 * The dimension id a target names, or null: a "dimension:<id>" ref, unless an
 * object has that id (an object id always means the object). Whether that
 * dimension still exists is the caller's to ask. Pure.
 * @param {string | null} target
 * @param {object} [objects]  scene.objects
 */
export function dimensionIdOf(target, objects = null) {
  if (typeof target !== "string" || !target.startsWith(PREFIX) || objects?.[target]) return null;
  return target.slice(PREFIX.length) || null;
}

const vec3 = (w) => (Array.isArray(w) ? [0, 1, 2].map((i) => Number(w[i]) || 0) : [0, 0, 0]);

/**
 * Where an anchor is now, and whether it is still attached: through its
 * object's displayed world matrix while that object is in the scene and the
 * anchor has a local point, else its stored world point. Pure.
 * @param {{ objectId?, local?, world? }} anchor
 * @param {object} objects  scene.objects
 * @param {(id: string) => number[] | null} worldOf
 * @returns {{ world: number[], attached: boolean }}
 */
export function resolveEnd(anchor, objects, worldOf) {
  const id = anchor?.objectId;
  if (id && objects?.[id] && Array.isArray(anchor.local) && anchor.local.length === 3) {
    const m = worldOf(id);
    if (Array.isArray(m) && m.length === 16) return { world: applyMatrix(m, anchor.local.map(Number)), attached: true };
  }
  return { world: vec3(anchor?.world), attached: false };
}

/**
 * The dimensions as drawn and listed. Pure.
 * @param {object} dims  doc.dimensions
 * @param {object} objects  scene.objects
 * @param {{ worldOf: Function, units: string, selected: string | null, gap?: (objectId, local) => { distance, tolerance } | null }} o
 * @returns {{ id, a, b, length, text, selected, detached, offSurface }[]}
 */
export function dimensionList(dims, objects, { worldOf, units, selected = null, gap = null }) {
  const out = [];
  for (const [id, dim] of Object.entries(dims ?? {})) {
    if (!dim || typeof dim !== "object") continue;
    const a = resolveEnd(dim.a, objects, worldOf);
    const b = resolveEnd(dim.b, objects, worldOf);
    const length = distance(a.world, b.world);
    // an end that no longer lies on its object: the object was rebuilt with
    // other geometry, and the anchor stayed where the old surface was
    const offSurface = ["a", "b"].some((end) => {
      const an = dim[end];
      if (!gap || !an?.objectId || !objects?.[an.objectId] || !Array.isArray(an.local)) return false;
      const g = gap(an.objectId, [...an.local]);
      return !!g && g.distance > g.tolerance;
    });
    const len = formatLength(length, units);
    out.push({
      id,
      a: a.world,
      b: b.world,
      length,
      text: (dim.label ? `${dim.label}: ${len}` : len) + (offSurface ? " · off surface" : ""),
      selected: id === selected,
      detached: !a.attached || !b.attached,
      offSurface,
    });
  }
  return out;
}

/**
 * Detach, in a draft doc, every dimension end on an object that's going,
 * freezing it at its current world point (resolved against `objects`, the
 * scene before the removal). @returns {number} how many ends were detached
 */
export function detachEnds(draft, ids, objects) {
  const gone = new Set(ids ?? []);
  let n = 0;
  if (!gone.size || !draft?.dimensions) return n;
  for (const [dimId, dim] of Object.entries(draft.dimensions)) {
    for (const end of ["a", "b"]) {
      const an = dim?.[end];
      if (!an || !gone.has(an.objectId)) continue;
      draft.dimensions[dimId][end] = detachAnchor(JSON.parse(JSON.stringify(an)), objects);
      n++;
    }
  }
  return n;
}

/**
 * How far a point in an object's own frame is from its geometry (a three.js
 * content node), with the on-surface tolerance; null while there's nothing
 * to ask. Cached per content node, so a rebuilt object is measured afresh.
 */
export function surfaceGapper(THREE) {
  const cache = new WeakMap();
  return function gap(root, local) {
    if (!root || !Array.isArray(local) || local.length !== 3) return null;
    let cached = cache.get(root);
    if (!cached) {
      root.updateWorldMatrix?.(true, true);
      const prims = [];
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      const inst = new THREE.Matrix4();
      root.traverse((o) => {
        const pos = o.geometry?.attributes?.position;
        if (!pos || !(o.isMesh || o.isLine || o.isPoints)) return;
        const mode = o.isMesh ? 4 : o.isLineSegments ? 1 : o.isLineLoop ? 2 : o.isLine ? 3 : 0;
        const copies = o.isInstancedMesh ? o.count : 1;
        // (in the object's own frame: the frame choke point's one way in, whatever frame it's drawn in)
        const inRoot = contentMatrix(root, o);
        for (let c = 0; c < copies; c++) {
          const mm = new THREE.Matrix4().fromArray(inRoot);
          if (o.isInstancedMesh) mm.multiply((o.getMatrixAt(c, inst), inst));
          const m = mm.elements;
          const P = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
            P[i * 3] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
            P[i * 3 + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
            P[i * 3 + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
            for (let k = 0; k < 3; k++) {
              if (P[i * 3 + k] < lo[k]) lo[k] = P[i * 3 + k];
              if (P[i * 3 + k] > hi[k]) hi[k] = P[i * 3 + k];
            }
          }
          prims.push({ positions: P, index: o.geometry.index?.array ?? null, mode });
        }
      });
      const diag = prims.length ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
      cached = { prims, tolerance: onSurfaceTolerance(diag), gaps: new Map() };
      cache.set(root, cached);
    }
    if (!cached.prims.length) return null;
    const key = local.join(",");
    let d = cached.gaps.get(key);
    if (d === undefined) {
      d = distanceToPrimitives(cached.prims, local.map(Number));
      cached.gaps.set(key, d);
    }
    return { distance: d, tolerance: cached.tolerance };
  };
}

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null && c !== false) e.append(c);
  return e;
};

export function create(api) {
  const { THREE } = api;
  api.style(css);
  // the focus stage's facet, where all of this is
  const F = () => api.focus();
  // its drawing: the focus stage's layer and labels, made again where the focus goes
  const at = perFocus(api, (f) => {
    const layer = f.world({ onTop: true });
    layer.userData.noPick = true;
    drawnKey = null;
    drawnList = null;
    memo = null;
    // Held poses (a halo drag, a carry, a peer's carry) move objects without a
    // doc change: after each frame, a moved anchor object redraws (next frame).
    f.afterRender(() => {
      if (!list.length) return;
      if (currentPoseKey() === poseKey) return;
      gen++;
      refresh(f.scene(), now());
    });
    return { layer, labels: f.labels() };
  });
  const surfaceGap = surfaceGapper(THREE);
  const color = (rgb, fallback) =>
    Array.isArray(rgb) ? new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace) : new THREE.Color(fallback);

  let list = []; // what's drawn and listed now
  let drawnKey = null; // the drawing's key (list + theme)
  let poseKey = ""; // the displayed world matrices of the objects anchors sit on
  const panels = new Set(); // mounted panel renderers

  /** The dimension a target names, if it's in the doc. */
  const dimensionOf = (target, scene) => {
    const id = dimensionIdOf(target, scene?.objects);
    return id != null && scene?.d?.dimensions?.[id] ? id : null;
  };
  // What this reads, as one value: the view's (the selection, prefs, theme)
  // with the stage's load status; the same value while neither changes.
  let seenL = null;
  let seenV = null;
  let seenS = null;
  const seen = (local, view) => (local === seenL && view === seenV ? seenS : ((seenL = local), (seenV = view), (seenS = Object.freeze({ ...view, status: local?.status }))));
  const now = () => {
    const f = F();
    return f ? seen(f.local.get(), f.view.get()) : null;
  };
  let lastSeen = null; // what update() was last given
  const selectedOf = (scene, local) => dimensionOf(local?.selected ?? null, scene);
  const unitsOf = (scene, local) => local?.prefs?.units ?? scene?.d?.view?.units ?? "m";
  const gap = (oid, local) => surfaceGap(F()?.content(oid)?.root ?? null, local);

  function compute(scene, local) {
    return dimensionList(scene?.d?.dimensions, scene?.objects ?? {}, {
      worldOf: (oid) => F()?.worldOf(oid) ?? null,
      units: unitsOf(scene, local),
      selected: selectedOf(scene, local),
      gap,
    });
  }

  /** The objects anchors sit on, and where they're displayed (held poses move them without a doc change). */
  function currentPoseKey() {
    const f = F();
    const dims = f?.doc().dimensions;
    if (!dims) return "";
    const ids = new Set();
    for (const dim of Object.values(dims)) for (const end of ["a", "b"]) if (dim?.[end]?.objectId) ids.add(dim[end].objectId);
    let k = "";
    for (const id of ids) k += `${id}:${f.worldOf(id)?.join(",") ?? ""};`;
    return k;
  }

  /** Select a dimension (its ref is the selection); null lets go of the selected one, if a dimension is selected. */
  function select(id) {
    const f = F();
    if (!f) return;
    const cur = f.view.get().selected ?? null;
    if (id == null) {
      if (dimensionIdOf(cur, f.scene().objects) != null) f.view.select(null);
      return;
    }
    if (cur !== dimensionRef(id)) f.view.select(dimensionRef(id));
  }

  /** Save a measured dimension (two anchors) and select it. @returns {string | null} its id */
  function addDimension(value) {
    const isAnchor = (x) => !!x && typeof x === "object" && Array.isArray(x.world);
    const f = F();
    if (!f || !isAnchor(value?.a) || !isAnchor(value?.b)) return null;
    const id = typeof value.id === "string" && value.id ? value.id : f.newId("d");
    // fresh plain data: automerge won't take a value that's already in a doc
    const dim = JSON.parse(JSON.stringify({ a: value.a, b: value.b, label: value.label ?? null }));
    editor(f).edit(
      (d) => {
        d.dimensions[id] = dim;
      },
      { label: "Add dimension" },
    );
    select(id);
    return id;
  }

  function remove(id) {
    const f = F();
    if (id == null || !f) return;
    editor(f).edit(
      (d) => {
        if (d.dimensions?.[id]) delete d.dimensions[id];
      },
      { label: "Delete dimension" },
    );
    if (f.view.get().selected === dimensionRef(id)) select(null);
  }

  function clearLayer(layer) {
    for (const c of [...layer.children]) {
      c.removeFromParent();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
  }

  const geometry = (pts) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
    return g;
  };
  /** Draw the lines, markers and labels, if they changed. */
  function draw(theme) {
    const here = at();
    if (!here) return;
    const { layer, labels } = here;
    const add = (obj, order) => {
      obj.renderOrder = order;
      obj.raycast = () => {};
      obj.userData.noPick = true;
      layer.add(obj);
    };
    const key = JSON.stringify([list, theme?.dim, theme?.accent]);
    if (key === drawnKey) return;
    drawnKey = key;
    clearLayer(layer);
    const dimCol = color(theme?.dim, 0xe68019);
    const accent = color(theme?.accent, 0x33e6bf);
    const segs = [];
    const selSegs = [];
    const pts = [];
    for (const d of list) {
      (d.selected ? selSegs : segs).push(d.a, d.b);
      pts.push(d.a, d.b);
    }
    if (segs.length) add(new THREE.LineSegments(geometry(segs), new THREE.LineBasicMaterial({ color: dimCol, depthTest: false, transparent: true })), 10);
    if (selSegs.length) add(new THREE.LineSegments(geometry(selSegs), new THREE.LineBasicMaterial({ color: accent, depthTest: false, transparent: true })), 10);
    if (pts.length) add(new THREE.Points(geometry(pts), new THREE.PointsMaterial({ color: dimCol, size: 7, sizeAttenuation: false, depthTest: false, transparent: true })), 11);
    labels.set(
      list.map((d) => ({
        key: d.id,
        text: d.text,
        ends: [d.a, d.b],
        className: "dimension-label",
        rank: 3,
        data: { id: d.id, selected: d.selected, detached: d.detached, offsurface: d.offSurface },
        // selecting one is the editor's (../stage/bodies.js): only while editing
        onPointerDown: () => editing(api.view.get()) && select(d.id),
      })),
    );
    api.invalidate();
  }

  // The list is worked out again only when something it depends on changed:
  // the doc, the selection, the units, load state, or (gen) loaded content
  // or a held pose.
  let memo = null;
  let gen = 0;
  let drawnList = null;
  let drawnTheme;
  function ensure(scene, local) {
    const sel = selectedOf(scene, local);
    const units = unitsOf(scene, local);
    const status = local?.status;
    if (memo && memo.scene === scene && memo.sel === sel && memo.units === units && memo.status === status && memo.gen === gen) return false;
    memo = { scene, sel, units, status, gen };
    list = compute(scene, local);
    poseKey = currentPoseKey();
    return true;
  }

  function refresh(scene, local, theme = local?.theme) {
    ensure(scene, local);
    // (the panel may have worked the list out first, this flush)
    if (list !== drawnList || theme !== drawnTheme) {
      drawnList = list;
      drawnTheme = theme;
      draw(theme);
    }
    for (const p of panels) p.render();
  }

  function update(scene, local, prev) {
    const was = prev?.local ?? null;
    const target = local.selected ?? null;
    // the selected dimension went (deleted here or by a peer)
    const id = dimensionIdOf(target, scene.objects);
    if (id != null && !scene.d?.dimensions?.[id]) {
      const f = F();
      if (f?.view.get().selected === target) f.view.select(null);
      return;
    }
    // same scene and local: content loaded, so "off surface" may have changed
    if (was && scene === prev.scene && local === was) gen++;
    refresh(scene, local);
  }

  /** The Dimensions panel: the list, to select and delete. */
  function mountPanel(host) {
    const ul = el("ul", { class: "dimension-list" });
    host.append(ul);
    let shown = null;
    const p = {
      render() {
        const key = JSON.stringify(list.map((d) => [d.id, d.text, d.selected, d.detached, d.offSurface]));
        if (key === shown) return;
        shown = key;
        ul.replaceChildren(
          ...list.map((d) =>
            el(
              "li",
              { class: "dimension-row", "data-id": d.id, "data-selected": d.selected },
              el(
                "button",
                { type: "button", class: "row-main", onclick: () => select(d.id) },
                d.text,
                d.detached ? el("span", { class: "tag", title: "One end is no longer attached to an object" }, "fixed") : null,
                d.offSurface
                  ? el(
                      "span",
                      {
                        class: "tag",
                        "data-tone": "warn",
                        title: "Its object was rebuilt with different geometry and an anchor no longer lies on it, so this measures the old shape. Delete it and measure again.",
                      },
                      "off surface",
                    )
                  : null,
              ),
              el("button", { type: "button", class: "icon-button", title: "Delete dimension", "aria-label": "Delete dimension", onclick: () => remove(d.id) }, "×"),
            ),
          ),
        );
        if (!list.length) ul.append(el("li", { class: "empty-row" }, "Use Measure to add one."));
      },
    };
    panels.add(p);
    p.render();
    return {
      update(scene, local) {
        // the tab may be updated before this extension's own update has run this flush
        if (scene && local) ensure(scene, local);
        p.render();
      },
      dispose() {
        panels.delete(p);
        ul.remove();
      },
    };
  }

  // Delete applies to a dimension's ref (the key map offers it the
  // selection first), never to the scene or an object. Escape deselects it
  // as the stage's ladder deselects anything.
  const applies = (target, { scene } = {}) => dimensionOf(target, scene ?? F()?.scene()) != null;

  const commands = [
    {
      // a measuring tool's way to save what it measured: run(null, { a, b, id?, label? })
      id: "add",
      edit: true,
      name: "Add dimension",
      show: [],
      state: (target) => (target == null ? { title: "Save a dimension between two anchors" } : null),
      run: (target, value) => addDimension(value),
    },
    {
      id: "delete",
      edit: true,
      name: "Delete dimension",
      key: ["Delete", "Backspace"],
      show: [],
      state: (target, ctx) => (applies(target, ctx) ? { title: "Delete this dimension" } : null),
      run: (target) => remove(dimensionOf(target, F()?.scene())),
    },
  ];

  // a drawer tab the viewer opens (Dimensions in the toolbar)
  const tab = drawerTab(api, { id: "dimensions", title: "Dimensions", mount: mountPanel });
  commands.push(tabToggle(tab, { id: "dimensions", name: "Dimensions", title: "The dimensions saved in this scene" }));

  return {
    update(scene, local, prev, view) {
      const s = seen(local, view);
      update(scene, s, { scene: prev?.scene ?? null, local: prev?.scene ? lastSeen : null });
      lastSeen = s;
      tab.update(scene, s);
    },
    commands,
    tab,
    // (the focus stage's removal: the view's plugins are offered only there)
    beforeRemove(draft, ids) {
      detachEnds(draft, ids, F()?.scene().objects ?? {});
    },
    dispose() {
      tab.dispose();
      panels.clear();
    },
  };
}

export default { create };
