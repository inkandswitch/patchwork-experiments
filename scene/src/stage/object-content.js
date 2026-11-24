// An object as the viewport draws it: two nodes and what hangs in them.
// `group` carries its transform, relative to its parent's group, so attached
// objects follow their parent. It holds `body` (its content, and its
// visibility) and the groups of any objects attached to it. Hiding an object
// hides its body only, so its attachments stay visible; hiding a group
// object (kind "group", no content) hides its whole `group` node, so
// everything filed under it goes too. Boxes, picking and snapping look at
// bodies, so they never count a child's geometry as the parent's.
//
// What's in a body: a placeholder box from a hint until the GLB arrives, the
// GLB once it has (with its layers shown as chosen and its materials as
// displayed), and an outline when one is asked for. Functions of one entry.

import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Vector3 } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { prepareGLB } from "./gltf-content.js";
import { layerShown, layerStates } from "../layers.js";

/** Dispose everything under root: geometry, materials and their textures (not shared placeholders). */
export function disposeObject(root) {
  root?.traverse?.((o) => {
    if (o.userData?.shared) return; // placeholders share one geometry and material
    if (o.isInstancedMesh) o.dispose?.();
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
      m.dispose?.();
    }
  });
}

/** Set a node's local transform from a doc-shaped { position, rotation (Euler XYZ), scale }. */
export function placeLocal(g, t) {
  g.position.fromArray(t?.position ?? [0, 0, 0]);
  const rot = t?.rotation ?? [0, 0, 0];
  g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, "XYZ");
  const s = Number(t?.scale) || 1;
  g.scale.set(s, s, s);
}

/**
 * What a GLB says about itself, for contentOf(id).extras: the scene's own
 * extras, plus its connectors (in body space), how far they reach
 * (findSnapPoints: the GLB's, else from their spacing; null with fewer than
 * two), its raw legend and its layer table.
 * The stage's fields win over same-named scene extras.
 * @param {{ extras?: object, snap?: { points: object[], radius: number | null }, legend?: object | null, layers?: object[] }} prepared  prepareGLB's result
 */
export function contentExtras(prepared) {
  return Object.freeze({ ...(prepared?.extras ?? {}), connectors: prepared?.snap?.points ?? [], snapRadius: prepared?.snap?.radius ?? null, legend: prepared?.legend ?? null, layers: prepared?.layers ?? [] });
}

/** A new object's nodes and state, its group not yet anywhere. */
export function newEntry(id) {
  const group = new Group();
  group.userData.objectId = id;
  group.name = id;
  const body = new Group();
  body.userData.objectId = id;
  body.name = `${id}:body`;
  group.add(body);
  return {
    group,
    body,
    content: null,
    gen: 0,
    display: null,
    parentId: null,
    kind: "object",
    inherited: { visible: true, opacity: 1 },
    materials: [],
    extras: null, // contentExtras() of its GLB
    box: null, // the box of what's shown of its content, in body space (applyLayers)
    parts: [], // the shown pieces' boxes, for a rotated body (bodyBox)
    allBox: null, // the whole content's box, per GLB
    allParts: [], // every piece, with its layer
    layers: [], // its GLB's layer table, checked (layers.js)
    hint: null, // a Box3 from hint.bounds, shown (and framed) until the GLB arrives
    placeholder: null,
    outlineColors: null,
    outlines: [],
    stats: null,
  };
}

const UNIT_BOX_EDGES = (() => {
  const c = [-0.5, 0.5];
  const pts = [];
  for (const a of c) for (const b of c) {
    pts.push([-0.5, a, b], [0.5, a, b]);
    pts.push([a, -0.5, b], [a, 0.5, b]);
    pts.push([a, b, -0.5], [a, b, 0.5]);
  }
  return pts;
})();

/** The faint box every placeholder shares, in `color` (a three Color). @returns {{ geometry, material }} */
export function placeholderLook(color) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(UNIT_BOX_EDGES.flat(), 3));
  return { geometry, material: new LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }) };
}

/**
 * Where an object will be before its GLB arrives: hint.bounds in its own
 * frame (min/max arrays), drawn as a faint box (`look`, placeholderLook's)
 * and boxed. null clears. @returns {boolean} whether it changed
 */
export function setHint(entry, bounds, look) {
  const ok = bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max) && [...bounds.min, ...bounds.max].every((v) => Number.isFinite(Number(v)));
  const box = ok ? new Box3(new Vector3(...bounds.min.map(Number)), new Vector3(...bounds.max.map(Number))) : null;
  if (box && box.isEmpty()) entry.hint = null;
  else if (!!box !== !!entry.hint || (box && !box.equals(entry.hint))) entry.hint = box;
  else return false;
  if (entry.content || !entry.hint) removePlaceholder(entry);
  else showPlaceholder(entry, look);
  if (entry.outlineColors && !entry.content) drawOutline(entry);
  return true;
}

function showPlaceholder(entry, look) {
  let ph = entry.placeholder;
  if (!ph) {
    ph = new LineSegments(look.geometry, look.material);
    ph.name = "placeholder";
    ph.userData.shared = true;
    ph.raycast = () => {};
    entry.placeholder = ph;
    entry.body.add(ph);
  }
  const c = entry.hint.getCenter(new Vector3());
  const size = entry.hint.getSize(new Vector3()).max(new Vector3(1e-4, 1e-4, 1e-4));
  ph.position.copy(c);
  ph.scale.copy(size);
}

export function removePlaceholder(entry) {
  if (!entry.placeholder) return;
  entry.placeholder.removeFromParent();
  entry.placeholder = null;
}

/**
 * Draw an object's box in these colours (CSS strings; several alternate as
 * dashes), 2.5 px, as a child of its body (so it follows, hides and goes
 * with the object, and is never picked); null clears.
 */
export function setOutline(entry, colors) {
  entry.outlineColors = colors?.length ? [...colors] : null;
  drawOutline(entry);
}

function drawOutline(entry) {
  for (const l of entry.outlines) {
    l.removeFromParent();
    l.geometry.dispose();
    l.material.dispose();
  }
  entry.outlines = [];
  const box = entry.content ? entry.box : entry.hint;
  if (!entry.outlineColors || !box || box.isEmpty() || entry.kind === "group") return;
  const { min, max } = box;
  const corner = (i) => [i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const positions = edges.flatMap(([a, b]) => [...corner(a), ...corner(b)]);
  const n = entry.outlineColors.length;
  const dash = Math.max(box.getSize(new Vector3()).length() / 18, 1e-5);
  entry.outlineColors.forEach((c, i) => {
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const material = new LineMaterial({ color: new Color(c), linewidth: 2.5, transparent: true, depthWrite: false, ...(n > 1 ? { dashed: true, dashSize: dash, gapSize: dash * (n - 1), dashOffset: -i * dash } : {}) });
    const line = new LineSegments2(geometry, material);
    if (n > 1) line.computeLineDistances();
    line.renderOrder = 3;
    line.raycast = () => {};
    line.userData.noPick = true;
    line.name = "outline";
    entry.body.add(line);
    entry.outlines.push(line);
  });
}

/**
 * Swap a GLB's bytes into an object: prepared (prepareGLB), its shaders
 * compiled (`compile(content)`, a promise: off the main thread where the
 * browser can, KHR_parallel_shader_compile, so a new material doesn't stall
 * the first frame it appears in), then put in the body in place of what was
 * there. While it compiles it's in `compiling`, so whoever disposes the
 * renderer meanwhile can release it while the renderer can still let go of
 * its programs (after renderer.dispose() nothing can, and they'd keep the
 * renderer and the whole scene graph alive). Whenever `stale()` says a
 * newer swap or a removal overtook it, it's dropped.
 * @returns {Promise<{ prepareMs: number, compileMs: number, attachMs: number, triangles: number } | null>} what it took, or null: dropped
 */
export async function swapGLB(entry, bytes, { compile, stale, compiling, themeColor }) {
  const t0 = performance.now();
  const prepared = await prepareGLB(bytes);
  const t1 = performance.now();
  if (stale()) {
    disposeObject(prepared.content);
    return null;
  }
  compiling.add(prepared.content);
  try {
    await compile(prepared.content);
  } catch {
    // it compiles on first draw instead
  }
  const t2 = performance.now();
  const mine = compiling.delete(prepared.content);
  if (stale()) {
    if (mine) disposeObject(prepared.content);
    return null;
  }
  attachContent(entry, prepared, themeColor());
  return { prepareMs: +(t1 - t0).toFixed(1), compileMs: +(t2 - t1).toFixed(1), attachMs: +(performance.now() - t2).toFixed(1), triangles: prepared.stats.triangles };
}

/** Put a prepared GLB in the body in place of what was there, which is disposed, with its layers, outline and materials as displayed. */
function attachContent(entry, prepared, themeColor) {
  if (entry.content) {
    entry.content.removeFromParent();
    disposeObject(entry.content);
  }
  entry.content = prepared.content;
  entry.materials = prepared.materials;
  entry.extras = contentExtras(prepared);
  entry.box = entry.allBox = prepared.box;
  entry.parts = entry.allParts = prepared.parts ?? [];
  entry.layers = prepared.layers ?? [];
  entry.stats = prepared.stats;
  removePlaceholder(entry);
  entry.body.add(prepared.content);
  applyLayers(entry);
  if (entry.outlineColors) drawOutline(entry);
  applyMaterials(entry, themeColor);
}

/**
 * Display state from the scene doc: visible, colour, opacity, wireframe,
 * layers and transform (`transform`: a held pose, else the doc's).
 * `inherited` is what its group ancestors contribute (groups.js
 * inheritedDisplay): their opacity multiplies in, their hiding hides it.
 */
export function display(entry, obj, inherited, transform, themeColor) {
  entry.display = obj;
  entry.inherited = inherited ?? { visible: true, opacity: 1 };
  entry.kind = obj?.kind === "group" ? "group" : "object";
  const g = entry.group;
  if (entry.kind === "group") {
    g.visible = obj.visible !== false;
    entry.body.visible = true;
  } else {
    g.visible = true;
    // a group hides what's filed in it (it has no node above it to do so)
    entry.body.visible = obj?.visible !== false && entry.inherited.visible !== false;
  }
  placeLocal(g, transform ?? {});
  applyMaterials(entry, themeColor);
  applyLayers(entry);
}

/**
 * Show each of an object's meshes as its layer is shown (layers.js: the
 * object's own `layers` choices over its GLB's table), and box only what's
 * shown, so a hidden layer is neither drawn, picked, snapped to, nor counted
 * in the object's bounds. A GLB with no layer table is left as it is.
 */
function applyLayers(entry) {
  if (!entry.content || !entry.layers?.length) return;
  const states = layerStates(entry.layers, entry.display?.layers);
  entry.content.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints) o.visible = layerShown(states, o.userData.layer ?? null);
  });
  entry.parts = entry.allParts.filter((p) => layerShown(states, p.layer ?? null));
  const box = new Box3();
  for (const p of entry.parts) box.union(p.box.clone().applyMatrix4(p.matrix));
  entry.box = box.isEmpty() ? null : box;
}

const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

/** Colour / opacity / wireframe onto an object's materials, over their (rule-adjusted) base values; `themeColor` for those that take the theme's. */
export function applyMaterials(entry, themeColor) {
  const obj = entry.display;
  if (!obj || entry.kind === "group" || !entry.materials.length) return;
  const opacity = clamp01(obj.opacity ?? 1) * clamp01(entry.inherited?.opacity ?? 1);
  const override = obj.color ? new Color(obj.color) : null;
  for (const m of entry.materials) {
    if (m.color) {
      if (override) m.color.copy(override);
      else if (m.userData.useThemeColor) m.color.copy(themeColor);
      else if (m.userData.baseColor) m.color.copy(m.userData.baseColor);
    }
    const base = m.userData.baseOpacity ?? 1;
    const transparent = !!m.userData.baseTransparent || base * opacity < 1;
    const wireframe = "wireframe" in m && m.userData.onMesh ? !!obj.wireframe : m.wireframe;
    if (m.transparent !== transparent || m.wireframe !== wireframe) m.needsUpdate = true;
    m.opacity = base * opacity;
    m.transparent = transparent;
    m.depthWrite = m.opacity >= 1;
    if (wireframe !== undefined) m.wireframe = wireframe;
  }
}

/** Does this matrix rotate (or shear) anything, beyond per-axis scale and translation? */
function hasRotation(m) {
  const e = m.elements;
  const scale = Math.abs(e[0]) + Math.abs(e[5]) + Math.abs(e[10]) || 1;
  const eps = 1e-9 * scale;
  return Math.abs(e[1]) > eps || Math.abs(e[2]) > eps || Math.abs(e[4]) > eps || Math.abs(e[6]) > eps || Math.abs(e[8]) > eps || Math.abs(e[9]) > eps;
}

/**
 * The box of an object's own content (its hint's while the GLB is on its
 * way, unless hints: false) under the matrix `world` of its body; null when
 * there's none.
 */
export function bodyBox(entry, world, hints = true) {
  const local = entry.content ? entry.box : hints ? entry.hint : null;
  if (!local) return null;
  // Only an axis-aligned (unrotated) matrix maps the cached box exactly;
  // under a rotation, box each piece under its own matrix, as three's
  // setFromObject does, so the bounds don't grow with the angle.
  if (entry.content && entry.parts?.length && hasRotation(world)) {
    const box = new Box3();
    const m = new Matrix4();
    const b = new Box3();
    for (const p of entry.parts) box.union(b.copy(p.box).applyMatrix4(m.multiplyMatrices(world, p.matrix)));
    return box.isEmpty() ? null : box;
  }
  const box = local.clone().applyMatrix4(world);
  return box.isEmpty() ? null : box;
}

/**
 * What the stage knows of an object's content. box is in body space (the
 * GLB's own frame): the content's, or its hint's until the GLB arrives.
 * extras (contentExtras) and stats are null until then. root is the
 * three.js content node, for geometry queries in this package: read it,
 * never change it.
 * @returns {{ loaded: boolean, box: { min: number[], max: number[] } | null, extras: object | null, stats: object | null, root: object | null }}
 */
export function contentOf(entry) {
  const b = entry.content ? entry.box : entry.hint;
  return {
    loaded: !!entry.content,
    box: b && !b.isEmpty() ? { min: b.min.toArray(), max: b.max.toArray() } : null,
    extras: entry.content ? entry.extras : null,
    stats: entry.content ? entry.stats : null,
    root: entry.content ?? null,
  };
}
