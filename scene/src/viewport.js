// The three.js side of the scene tool: renderer, camera, orbit + transform
// controls, lighting, object groups, grid / axes / triad, bounding-box and
// point-to-point dimensions, DOM overlay labels, and picking with vertex snap.
// It knows nothing about automerge; tool.js drives it from the scene doc.

import {
  AdditiveBlending,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { formatLength, gridFor, roundForDisplay, toUnits } from "./units.js";
import { applyMaterialRules, prepareGLB } from "./gltf-content.js";
import { rulesKey, sanitizeRules } from "./material-rules.js";
import { buildBVH, installLazyBVH, wantsBVH } from "./pick-accel.js";
import { distanceToPrimitives, onSurfaceTolerance } from "./surface.js";
import { onThemeChange, resolveCssColor } from "./theme.js";

const TRIAD_PX = 96;
const DEFAULT_THEME = {
  bg: [0.96, 0.96, 0.96],
  fg: [0.1, 0.1, 0.1],
  gridMajor: [0.6, 0.6, 0.6],
  gridMinor: [0.82, 0.82, 0.82],
  accent: [0.2, 0.9, 0.75],
  remote: [0.6, 0.4, 0.9],
  muted: [0.5, 0.5, 0.5],
  object: [0.7, 0.72, 0.78],
  axisX: [0.85, 0.2, 0.2],
  axisY: [0.2, 0.7, 0.25],
  axisZ: [0.2, 0.4, 0.9],
  dim: [0.9, 0.5, 0.1],
};
const THEME_VARS = {
  bg: "--scene-viewport-bg",
  fg: "--scene-fg",
  gridMajor: "--scene-grid-major",
  gridMinor: "--scene-grid-minor",
  accent: "--scene-accent",
  remote: "--scene-remote",
  muted: "--scene-muted",
  object: "--scene-object",
  axisX: "--scene-axis-x",
  axisY: "--scene-axis-y",
  axisZ: "--scene-axis-z",
  dim: "--scene-dimension",
};

const color = (rgb) => new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
const v3 = (a) => new Vector3(a[0], a[1], a[2]);

/** Does this matrix rotate (or shear) anything, beyond per-axis scale and translation? */
function hasRotation(m) {
  const e = m.elements;
  const scale = Math.abs(e[0]) + Math.abs(e[5]) + Math.abs(e[10]) || 1;
  const eps = 1e-9 * scale;
  return Math.abs(e[1]) > eps || Math.abs(e[2]) > eps || Math.abs(e[4]) > eps || Math.abs(e[6]) > eps || Math.abs(e[8]) > eps || Math.abs(e[9]) > eps;
}

function disposeObject(root) {
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

const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

function lineGeometry(points) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  return g;
}

/** Light intensities (see the constructor). keyFrom: the key light's direction, from the origin. */
export const LIGHTS = Object.freeze({ key: 1.5, keyFrom: [0.45, 1, 0.6], headlight: 0.45, hemisphere: 0.35, environment: 0.35 });

// Which labels give way when they overlap: a label is hidden if it would cover
// one of higher (or equal, earlier) rank. Dimensions and axis names never hide.
const LABEL_RANK = { "dimension-label": 3, "axis-label": 2, "triad-label": 2, "bounds-label": 1, "grid-label": 0 };
const NEVER_HIDE = 2;

function labelRank(entry) {
  for (const c of entry.el.classList) if (c in LABEL_RANK) return LABEL_RANK[c];
  return 1;
}

export function declutter(entries) {
  const sized = entries.map((e) => {
    const text = e.el.textContent;
    if (e.sizeFor !== text || !e.w) {
      e.w = e.el.offsetWidth;
      e.h = e.el.offsetHeight;
      e.sizeFor = text;
    }
    return { e, rank: labelRank(e) };
  });
  sized.sort((a, b) => b.rank - a.rank);
  const kept = [];
  const gap = 2;
  for (const { e, rank } of sized) {
    const r = { x0: e.p.x - e.w / 2 - gap, x1: e.p.x + e.w / 2 + gap, y0: e.p.y - e.h / 2 - gap, y1: e.p.y + e.h / 2 + gap };
    const hit = rank < NEVER_HIDE && kept.some((k) => r.x0 < k.x1 && r.x1 > k.x0 && r.y0 < k.y1 && r.y1 > k.y0);
    e.el.style.visibility = hit ? "hidden" : "";
    if (!hit) kept.push(r);
  }
}

/**
 * Where a dimension's label goes. At its midpoint, unless the dimension is
 * short on screen — under 2½ label widths — in which case the label would sit
 * on top of the very thing it measures (a cleat's length is about one label
 * wide at any sensible zoom, and even a close-up of it leaves the label over
 * its middle). Then it moves off the line, perpendicular to it and
 * upward where it can, far enough for its box to clear the line by `gap`, and
 * gets a leader back to the midpoint. Pure; screen pixels.
 * @returns {{ x: number, y: number, leader: null | { x0: number, y0: number, x1: number, y1: number } }}
 */
export function placeDimensionLabel(pa, pb, w, h, gap = 14) {
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy);
  if (len >= 2.5 * w) return { x: mx, y: my, leader: null };
  // perpendicular, pointing up the screen (or right, for a vertical line)
  let nx = len > 1e-6 ? -dy / len : 0;
  let ny = len > 1e-6 ? dx / len : -1;
  if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) (nx = -nx), (ny = -ny);
  const d = gap + Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
  const x = mx + nx * d;
  const y = my + ny * d;
  return { x, y, leader: { x0: mx, y0: my, x1: x, y1: y } };
}

/** A provider's legend, checked; null when it isn't usable. Pure. */
export function sanitizeLegend(l) {
  if (!l || typeof l !== "object") return null;
  const min = Number(l.min);
  const max = Number(l.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
  const stops = Array.isArray(l.stops) ? l.stops.filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) : [];
  if (stops.length < 2) return null;
  const str = (v) => (typeof v === "string" ? v.slice(0, 60) : "");
  return { title: str(l.title), unit: str(l.unit), min, max, stops: stops.slice(0, 32) };
}

/** DOM labels that track 3D points. Grouped so each feature can replace its own set. */
class LabelLayer {
  constructor(parent) {
    this.el = document.createElement("div");
    this.el.className = "labels";
    parent.append(this.el);
    this.groups = new Map(); // group → Map(key → { el, world, item })
  }
  sync(group, items) {
    const prev = this.groups.get(group) ?? new Map();
    const next = new Map();
    for (const item of items) {
      let entry = prev.get(item.key);
      if (!entry) {
        const el = document.createElement("div");
        entry = { el };
        this.el.append(el);
      }
      prev.delete(item.key);
      entry.world = item.world ? v3(item.world) : null;
      entry.ends = item.ends ? item.ends.map(v3) : null;
      entry.screen = item.screen ?? null;
      entry.item = item;
      const el = entry.el;
      el.className = `label ${item.className ?? ""}`.trim();
      if (el.textContent !== item.text) el.textContent = item.text;
      for (const [k, v] of Object.entries(item.data ?? {})) {
        if (v == null || v === false) el.removeAttribute(`data-${k}`);
        else el.setAttribute(`data-${k}`, v === true ? "" : String(v));
      }
      el.onpointerdown = item.onPointerDown
        ? (e) => {
            e.stopPropagation();
            item.onPointerDown(e);
          }
        : null;
      next.set(item.key, entry);
    }
    for (const { el, leader } of prev.values()) {
      el.remove();
      leader?.remove();
    }
    this.groups.set(group, next);
  }
  update(project) {
    const placed = [];
    for (const entries of this.groups.values()) {
      for (const entry of entries.values()) {
        const p = entry.screen ?? (entry.world ? project(entry.world) : null);
        if (!p) {
          entry.el.style.display = "none";
          if (entry.leader) entry.leader.style.display = "none";
          entry.p = null;
          continue;
        }
        entry.el.style.display = "";
        let at = p;
        let leader = null;
        if (entry.ends) {
          const pa = project(entry.ends[0]);
          const pb = project(entry.ends[1]);
          if (pa && pb) {
            if (entry.sizeFor !== entry.el.textContent || !entry.w) {
              entry.w = entry.el.offsetWidth;
              entry.h = entry.el.offsetHeight;
              entry.sizeFor = entry.el.textContent;
            }
            const placedAt = placeDimensionLabel(pa, pb, entry.w || 0, entry.h || 0);
            at = { x: placedAt.x, y: placedAt.y };
            leader = placedAt.leader;
          }
        }
        this.drawLeader(entry, leader);
        entry.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
        entry.p = at;
        placed.push(entry);
      }
    }
    declutter(placed);
  }
  drawLeader(entry, l) {
    if (!l) {
      if (entry.leader) entry.leader.style.display = "none";
      return;
    }
    if (!entry.leader) {
      entry.leader = document.createElement("div");
      entry.leader.className = "label-leader";
      this.el.prepend(entry.leader);
    }
    const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    const ang = Math.atan2(l.y1 - l.y0, l.x1 - l.x0);
    entry.leader.style.display = "";
    entry.leader.style.width = `${len.toFixed(1)}px`;
    entry.leader.style.transform = `translate(${l.x0.toFixed(1)}px, ${l.y0.toFixed(1)}px) rotate(${ang.toFixed(4)}rad)`;
  }
  dispose() {
    this.el.remove();
    this.groups.clear();
  }
}

/**
 * The vertex nearest a screen point, in screen space, among `count` vertices
 * of one geometry. Pure, so it can be tested without WebGL.
 *
 * Measuring wants the extreme points of a part (a stem head, a horn tip), and
 * those sit on its silhouette, where a click either misses the mesh by a pixel
 * or lands on a face that doesn't contain them. So the snap looks at every
 * vertex near the cursor, not only the three of the face under it. A vertex
 * further from the eye than `maxDepth` (behind the surface the ray hit) is
 * skipped, so it doesn't snap through a hull to its far side.
 *
 * @param {ArrayLike<number>} array  positions, `stride` floats apart, starting at `offset`
 * @param {ArrayLike<number>} mvp    column-major model → clip matrix
 * @param {ArrayLike<number>} model  column-major model → world matrix
 * @returns {{ index: number, d: number, world: [number, number, number] } | null}
 */
export function nearestScreenVertex(array, { count, stride = 3, offset = 0 }, mvp, model, { width, height, x, y, maxPx, eye, maxDepth = Infinity }) {
  const m = mvp;
  let best = null;
  let bestD = maxPx;
  const maxDepth2 = maxDepth * maxDepth;
  for (let i = 0; i < count; i++) {
    const k = offset + i * stride;
    const px = array[k], py = array[k + 1], pz = array[k + 2];
    const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (!(w > 0)) continue; // behind the camera
    const sx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * width;
    const sy = ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * height;
    const d = Math.hypot(sx - x, sy - y);
    if (!(d <= bestD)) continue;
    const wx = model[0] * px + model[4] * py + model[8] * pz + model[12];
    const wy = model[1] * px + model[5] * py + model[9] * pz + model[13];
    const wz = model[2] * px + model[6] * py + model[10] * pz + model[14];
    if ((wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > maxDepth2) continue;
    bestD = d;
    best = { index: i, d, world: [wx, wy, wz] };
  }
  return best;
}

export class Viewport {
  /**
   * @param {object} o
   * @param {HTMLElement} o.host        element to fill (position: relative)
   * @param {HTMLElement} o.themeRoot   element whose CSS variables define colours
   * @param {(ev: PointerEvent, vp: Viewport) => void} [o.onClick]   a click (not a drag, not on the gizmo)
   * @param {(ev: PointerEvent | null, vp: Viewport) => void} [o.onHover]  rAF-throttled; null on leave
   * @param {(objectId, transform) => void} [o.onTransformEnd]
   * @param {(camera) => void} [o.onCameraEnd]
   */
  constructor({ host, themeRoot, onClick, onHover, onTransformEnd, onCameraEnd }) {
    this.host = host;
    this.themeRoot = themeRoot;
    this.cb = { onClick, onHover, onTransformEnd, onCameraEnd };
    this.objects = new Map(); // id → { group, body, content, gen, display, parentId }
    this.view = { grid: true, axes: true, bounds: false, units: "m" };
    this.selection = null;
    this.remoteSelections = [];
    /** content → its geometry in object-local arrays, for anchorGap */
    this.surfaceCache = new WeakMap();
    this.dimensions = [];
    this.measure = null;
    this.theme = { ...DEFAULT_THEME };
    this.disposers = [];
    this.needsRender = true;
    this.helpersDirty = false;
    this.materialRules = [];
    this.materialRulesKey = "[]";
    /** GLB contents prepared but not attached yet (their shaders are compiling) */
    this.compiling = new Set();
    /** the last frame's main pass, from renderer.info */
    this.stats = { calls: 0, triangles: 0, lines: 0, points: 0, geometries: 0, textures: 0, frames: 0 };
    /** slow work, for probes: GLB loads (ms per step) and frames over 16 ms */
    this.perf = { loads: [], slowFrames: [] };
    this.ok = false;

    const tc0 = performance.now();
    try {
      this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    } catch (err) {
      this.error = err;
      return;
    }
    this.ok = true;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = SRGBColorSpace;
    // reset per frame by render(), so the stats are the main pass only (not the triad)
    r.info.autoReset = false;
    this.canvas = r.domElement;
    this.canvas.className = "canvas";
    host.append(this.canvas);
    this.labels = new LabelLayer(host);
    this.caption = document.createElement("div");
    this.caption.className = "grid-caption";
    host.append(this.caption);

    // scene graph
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(2.5, 2, 3.5);
    this.scene.add(this.camera);
    this.pmrem = new PMREMGenerator(r);
    // The room is only needed to render the environment map once. Disposed
    // at once: left alive, its materials' programs stay registered with the
    // renderer, and three's shared DFG LUT texture keeps a dispose listener
    // that reaches them, so a closed viewport's renderer (and, through its
    // last render state, the whole scene graph) could never be collected.
    const tc1 = performance.now();
    const room = new RoomEnvironment();
    this.envTexture = this.pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    const tc2 = performance.now();
    // Lighting. A key light fixed in the world, high and to one side, is what
    // gives a hull's panels (or any faceted part) different shades as the
    // view turns; a weak headlight fills whatever faces the camera so nothing
    // goes black; a dim sky/ground and environment add a little modelling and
    // something for metals to reflect. The total stays near 1 on a face lit by
    // everything, so light albedos — the baked colourmaps especially — keep
    // their colour instead of clipping to pastel.
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = LIGHTS.environment;
    this.hemi = new HemisphereLight(0xffffff, 0x3a3a3a, LIGHTS.hemisphere);
    this.scene.add(this.hemi);
    this.keyLight = new DirectionalLight(0xffffff, LIGHTS.key);
    this.keyLight.position.set(...LIGHTS.keyFrom);
    this.scene.add(this.keyLight);
    this.headlight = new DirectionalLight(0xffffff, LIGHTS.headlight);
    this.headlight.position.set(0.5, 1, 0.8);
    this.camera.add(this.headlight);

    this.content = new Group();
    this.content.name = "objects";
    this.helpers = new Group();
    this.helpers.name = "helpers";
    this.overlay = new Group(); // drawn on top: dimensions, measure preview
    this.overlay.name = "overlay";
    this.scene.add(this.content, this.helpers, this.overlay);

    // controls
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.addEventListener("change", () => this.invalidate());
    this.controls.addEventListener("end", () => this.cb.onCameraEnd?.(this.getCamera()));

    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSpace("world");
    this.gizmoHelper = this.gizmo.getHelper();
    this.scene.add(this.gizmoHelper);
    this.gizmoMode = "translate";
    this.gizmo.addEventListener("change", () => this.invalidate());
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.gizmo.object) {
        const g = this.gizmo.object;
        this.cb.onTransformEnd?.(g.userData.objectId, {
          position: g.position.toArray(),
          rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
          scale: g.scale.x,
        });
        this.refreshHelpers();
      }
    });

    // triad
    this.triadScene = new Scene();
    this.triadCamera = new OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 10);
    this.triad = new Group();
    this.triadScene.add(this.triad);

    installLazyBVH();
    this.raycaster = new Raycaster();
    // with a BVH, each mesh reports only its nearest hit; picking wants just that
    this.raycaster.firstHitOnly = true;
    this.bvhQueue = new Set();
    this.bvhTimer = null;
    this.readTheme();
    this.buildTriad();
    this.wirePointer();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(onThemeChange(() => this.applyTheme()));
    this.resize();

    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const moved = this.controls.update();
      if (this.helpersDirty) {
        this.helpersDirty = false;
        this.rebuildHelpers();
      }
      if (moved || this.needsRender) {
        this.needsRender = false;
        this.render();
      }
    };
    this.raf = requestAnimationFrame(tick);
    /** what building the viewport cost (ms), for probes */
    this.perf.construct = { renderer: +(tc1 - tc0).toFixed(1), environment: +(tc2 - tc1).toFixed(1), total: +(performance.now() - tc0).toFixed(1) };
  }

  invalidate() {
    this.needsRender = true;
  }

  // ─── theme ────────────────────────────────────────────────────────────────

  readTheme() {
    for (const [k, v] of Object.entries(THEME_VARS)) this.theme[k] = resolveCssColor(this.themeRoot, v, DEFAULT_THEME[k]);
    this.renderer.setClearColor(color(this.theme.bg), 1);
  }

  applyTheme() {
    if (!this.ok) return;
    this.readTheme();
    this.buildTriad();
    this.refreshHelpers();
    this.setDimensions(this.dimensions);
    if (this.placeholderMaterial) this.placeholderMaterial.color.copy(color(this.theme.muted));
    for (const [id, entry] of this.objects) if (entry.display) this.applyDisplay(id, entry.display, entry.parentId, entry.inherited);
    this.invalidate();
  }

  // ─── layout ───────────────────────────────────────────────────────────────

  resize() {
    if (!this.ok) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
    this.invalidate();
  }

  project(world) {
    const p = world.clone().project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    return { x: ((p.x + 1) / 2) * this.size.w, y: ((1 - p.y) / 2) * this.size.h };
  }

  render() {
    const tStart = performance.now();
    const r = this.renderer;
    // keep depth precision sensible across mm parts and 20 m hulls
    const dist = this.camera.position.distanceTo(this.controls.target);
    const radius = this.sceneRadius ?? 1;
    this.camera.near = Math.max(dist / 2000, 1e-5);
    this.camera.far = Math.max(dist * 100, dist + radius * 20, 10);
    this.camera.updateProjectionMatrix();

    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    r.autoClear = true;
    r.info.reset();
    r.render(this.scene, this.camera);
    const info = r.info;
    this.stats = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      frames: this.stats.frames + 1,
    };

    if (this.view.axes) {
      r.autoClear = false;
      r.clearDepth();
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.triadCamera.position.copy(dir.multiplyScalar(4));
      this.triadCamera.up.copy(this.camera.up);
      this.triadCamera.lookAt(0, 0, 0);
      const pad = 8;
      r.setScissorTest(true);
      r.setScissor(pad, pad, TRIAD_PX, TRIAD_PX);
      r.setViewport(pad, pad, TRIAD_PX, TRIAD_PX);
      r.render(this.triadScene, this.triadCamera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.size.w, this.size.h);
      r.autoClear = true;
      this.labels.sync(
        "triad",
        ["x", "y", "z"].map((axis, i) => {
          const tip = new Vector3(i === 0 ? 1.27 : 0, i === 1 ? 1.27 : 0, i === 2 ? 1.27 : 0).project(this.triadCamera);
          return {
            key: axis,
            text: axis.toUpperCase(),
            className: "triad-label",
            data: { axis },
            screen: { x: pad + ((tip.x + 1) / 2) * TRIAD_PX, y: this.size.h - pad - ((tip.y + 1) / 2) * TRIAD_PX },
          };
        }),
      );
    } else {
      this.labels.sync("triad", []);
    }
    this.labels.update((w) => this.project(w));
    const ms = performance.now() - tStart;
    if (ms > 16 && this.perf.slowFrames.length < 500) this.perf.slowFrames.push({ at: +tStart.toFixed(1), ms: +ms.toFixed(1), calls: this.stats.calls });
  }

  // ─── objects ──────────────────────────────────────────────────────────────

  // Each object is two nodes. `group` carries its transform, relative to its
  // parent's group, so attached objects follow their parent (the gizmo edits
  // this local transform; TransformControls handles the parent). It holds
  // `body` — the GLB, and the object's visibility — and the groups of any
  // objects attached to it. Hiding an object hides its body only, so its
  // attachments stay visible; hiding a GROUP object (kind "group", no
  // geometry) hides its whole `group` node, so everything below it goes too.
  // Boxes, picking and snapping look at bodies, so they never count a child's
  // geometry as the parent's.
  ensureObject(id) {
    let entry = this.objects.get(id);
    if (!entry) {
      const group = new Group();
      group.userData.objectId = id;
      group.name = id;
      const body = new Group();
      body.userData.objectId = id;
      body.name = `${id}:body`;
      group.add(body);
      this.content.add(group);
      entry = {
        group,
        body,
        content: null,
        gen: 0,
        display: null,
        parentId: null,
        kind: "object",
        inherited: { visible: true, opacity: 1 },
        materials: [],
        legend: null,
        box: null, // content's box in body space, cached per GLB
        parts: [], // its pieces' boxes, for a rotated body (see objectBox)
        hint: null, // a Box3 from hint.bounds, shown (and framed) until the GLB arrives
        placeholder: null,
        stats: null,
      };
      this.objects.set(id, entry);
    }
    return entry;
  }

  /** Put an object's group under its parent's (null = the scene root). */
  setParent(id, parentId) {
    const entry = this.objects.get(id);
    if (!entry) return;
    let target = this.content;
    if (parentId && parentId !== id) {
      const p = this.ensureObject(parentId).group;
      // never make a loop in the scene graph, whatever the caller says
      let loops = false;
      for (let o = p; o; o = o.parent) if (o === entry.group) loops = true;
      if (!loops) target = p;
    }
    if (entry.group.parent !== target) target.add(entry.group);
  }

  removeObject(id) {
    const entry = this.objects.get(id);
    if (!entry) return;
    if (this.gizmo?.object === entry.group) this.gizmo.detach();
    entry.gen++;
    // Attached objects outlive their parent: move them to the root (the scene
    // doc gives them their new transforms).
    for (const child of [...entry.group.children]) if (child !== entry.body) this.content.add(child);
    this.removePlaceholder(entry);
    disposeObject(entry.body);
    entry.group.removeFromParent();
    this.objects.delete(id);
    this.refreshHelpers();
  }

  hasContent(id) {
    return !!this.objects.get(id)?.content;
  }

  /** Per-GLB numbers from the last load: { drawCalls, nodes, instanced, triangles, dequantized }. */
  contentStats(id) {
    return this.objects.get(id)?.stats ?? null;
  }

  /**
   * Where an object will be, before its GLB arrives: hint.bounds in its own
   * frame (min/max arrays), drawn as a faint box and used by Frame. null clears.
   */
  setHint(id, bounds) {
    if (!this.ok) return;
    const entry = this.ensureObject(id);
    const ok = bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max) && [...bounds.min, ...bounds.max].every((v) => Number.isFinite(Number(v)));
    const box = ok ? new Box3(v3(bounds.min.map(Number)), v3(bounds.max.map(Number))) : null;
    if (box && box.isEmpty()) {
      entry.hint = null;
    } else if (!!box !== !!entry.hint || (box && !box.equals(entry.hint))) {
      entry.hint = box;
    } else return;
    if (entry.content || !entry.hint) this.removePlaceholder(entry);
    else this.showPlaceholder(entry);
    this.refreshHelpers();
  }

  showPlaceholder(entry) {
    if (!this.placeholderGeometry) {
      this.placeholderGeometry = lineGeometry(UNIT_BOX_EDGES);
      this.placeholderMaterial = new LineBasicMaterial({ color: color(this.theme.muted), transparent: true, opacity: 0.35, depthWrite: false });
    }
    let ph = entry.placeholder;
    if (!ph) {
      ph = new LineSegments(this.placeholderGeometry, this.placeholderMaterial);
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
    this.invalidate();
  }

  removePlaceholder(entry) {
    if (!entry.placeholder) return;
    entry.placeholder.removeFromParent();
    entry.placeholder = null;
    this.invalidate();
  }

  /** Swap in a new GLB. The old mesh stays until the new one has parsed. */
  async setGLB(id, bytes) {
    if (!this.ok) return;
    const entry = this.ensureObject(id);
    const gen = ++entry.gen;
    const stale = () => entry.gen !== gen || this.objects.get(id) !== entry || !this.ok;
    const t0 = performance.now();
    const prepared = await prepareGLB(bytes);
    const t1 = performance.now();
    if (stale()) {
      disposeObject(prepared.content);
      return;
    }
    applyMaterialRules(prepared.materials, this.materialRules);
    // Compile its shaders before it's drawn, off the main thread where the
    // browser can (KHR_parallel_shader_compile), so a new material doesn't
    // stall the first frame it appears in. While it waits it's in
    // `compiling`: if the viewport is disposed meanwhile, dispose() releases
    // it while the renderer can still let go of its programs (after
    // renderer.dispose() nothing can, and they'd keep the renderer and the
    // whole scene graph alive).
    this.compiling.add(prepared.content);
    try {
      await this.renderer.compileAsync?.(prepared.content, this.camera, this.scene);
    } catch {
      // it compiles on first draw instead
    }
    const t2 = performance.now();
    const mine = this.compiling.delete(prepared.content);
    if (stale()) {
      if (mine) disposeObject(prepared.content);
      return;
    }
    if (entry.content) {
      entry.content.removeFromParent();
      disposeObject(entry.content);
    }
    entry.content = prepared.content;
    entry.materials = prepared.materials;
    entry.legend = sanitizeLegend(prepared.legend);
    entry.box = prepared.box;
    entry.parts = prepared.parts ?? [];
    entry.stats = prepared.stats;
    this.removePlaceholder(entry);
    entry.body.add(prepared.content);
    this.surfaceCache.delete(prepared.content);
    this.queueBVH(prepared.content);
    this.applyMaterials(entry);
    this.refreshHelpers();
    this.invalidate();
    if (this.perf.loads.length < 1000) this.perf.loads.push({ id, prepareMs: +(t1 - t0).toFixed(1), compileMs: +(t2 - t1).toFixed(1), attachMs: +(performance.now() - t2).toFixed(1), triangles: prepared.stats.triangles });
  }

  /** Build the pick BVHs of a new GLB's big meshes in idle time (a pick builds any it still lacks). */
  queueBVH(root) {
    root.traverse((o) => {
      if (o.isMesh && wantsBVH(o.geometry)) this.bvhQueue.add(o.geometry);
    });
    this.scheduleBVH();
  }

  scheduleBVH() {
    if (this.bvhTimer != null || !this.bvhQueue.size || !this.ok) return;
    const idle = globalThis.requestIdleCallback
      ? (f) => ({ cancel: globalThis.cancelIdleCallback.bind(globalThis), id: globalThis.requestIdleCallback(f, { timeout: 3000 }) })
      : (f) => ({ cancel: clearTimeout, id: setTimeout(() => f({ timeRemaining: () => 10 }), 100) });
    this.bvhTimer = idle((deadline) => {
      this.bvhTimer = null;
      if (!this.ok) return;
      for (const g of this.bvhQueue) {
        this.bvhQueue.delete(g);
        buildBVH(g);
        if (deadline.timeRemaining() < 12) break;
      }
      this.scheduleBVH();
    });
  }

  /**
   * The scene's material rules (SCENE-CONTRACT v3 §9), applied to every
   * loaded material now and to every GLB that loads later.
   */
  setMaterialRules(rules) {
    const clean = sanitizeRules(rules);
    const key = rulesKey(clean);
    if (key === this.materialRulesKey) return;
    this.materialRules = clean;
    this.materialRulesKey = key;
    if (!this.ok) return;
    for (const entry of this.objects.values()) {
      if (!entry.materials.length) continue;
      applyMaterialRules(entry.materials, clean);
      this.applyMaterials(entry);
    }
    this.invalidate();
  }

  /**
   * Display state from the scene doc: visible, colour, opacity, wireframe,
   * transform (relative to `parentId`'s, which the caller has already checked
   * for cycles — see hierarchy.js). `inherited` is what its group ancestors
   * contribute (groups.js inheritedDisplay): their opacity multiplies in.
   */
  applyDisplay(id, obj, parentId = null, inherited = null) {
    if (!this.ok) return;
    const entry = this.ensureObject(id);
    entry.display = obj;
    entry.parentId = parentId ?? null;
    entry.inherited = inherited ?? { visible: true, opacity: 1 };
    entry.kind = obj?.kind === "group" ? "group" : "object";
    this.setParent(id, parentId);
    const g = entry.group;
    if (entry.kind === "group") {
      g.visible = obj.visible !== false;
      entry.body.visible = true;
    } else {
      g.visible = true;
      entry.body.visible = obj.visible !== false;
    }
    const t = obj.transform ?? {};
    const dragging = this.gizmo.dragging && this.gizmo.object === g;
    if (!dragging) {
      g.position.fromArray(t.position ?? [0, 0, 0]);
      const rot = t.rotation ?? [0, 0, 0];
      g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, "XYZ");
      const s = Number(t.scale) || 1;
      g.scale.set(s, s, s);
    }
    this.applyMaterials(entry);
    this.refreshHelpers();
    this.invalidate();
  }

  /** Colour / opacity / wireframe onto an object's materials, over their (rule-adjusted) base values. */
  applyMaterials(entry) {
    const obj = entry.display;
    if (!obj || entry.kind === "group" || !entry.materials.length) return;
    const opacity = clamp01(obj.opacity ?? 1) * clamp01(entry.inherited?.opacity ?? 1);
    const override = obj.color ? new Color(obj.color) : null;
    const themeColor = color(this.theme.object);
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

  /**
   * The colour legend an object's GLB carries, if any: a mesh's glTF
   * `extras.legend` (see README). Checked, since it comes from a provider:
   * finite min < max and hex colour stops only. Cached per GLB.
   */
  legendOf(id) {
    return this.objects.get(id)?.legend ?? null;
  }

  /**
   * How far a point in an object's own frame (its GLB's coordinates, where
   * dimension anchors store `local`) is from that object's current geometry,
   * and the tolerance for calling it on the surface. null while there is no
   * geometry to ask.
   * @returns {{ distance: number, tolerance: number } | null}
   */
  anchorGap(id, local) {
    const entry = this.objects.get(id);
    const content = entry?.content;
    if (!content || !Array.isArray(local) || local.length !== 3) return null;
    let cached = this.surfaceCache.get(content);
    if (!cached) {
      content.updateWorldMatrix(true, true);
      const inv = content.matrixWorld.clone().invert();
      const prims = [];
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      const inst = new Matrix4();
      content.traverse((o) => {
        const pos = o.geometry?.attributes?.position;
        if (!pos || !(o.isMesh || o.isLine || o.isPoints)) return;
        const mode = o.isMesh ? 4 : o.isLineSegments ? 1 : o.isLineLoop ? 2 : o.isLine ? 3 : 0;
        const copies = o.isInstancedMesh ? o.count : 1;
        for (let c = 0; c < copies; c++) {
          const mm = inv.clone().multiply(o.matrixWorld);
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
      this.surfaceCache.set(content, cached);
    }
    if (!cached.prims.length) return null;
    const key = local.join(",");
    let distance = cached.gaps.get(key);
    if (distance === undefined) {
      distance = distanceToPrimitives(cached.prims, local.map(Number));
      cached.gaps.set(key, distance);
    }
    return { distance, tolerance: cached.tolerance };
  }

  /** Is this object drawn: its body and every node above it visible (groups hide their subtree)? */
  isShown(entry) {
    if (!entry.body.visible) return false;
    for (let o = entry.group; o && o !== this.content; o = o.parent) if (!o.visible) return false;
    return true;
  }

  /**
   * An object's own geometry (not its attachments'), boxed in world space; its
   * hint box while the GLB is still on its way (unless hints: false). For a
   * group, the union of its shown descendants' boxes.
   */
  objectBox(id, { hints = true } = {}) {
    const entry = this.objects.get(id);
    if (!entry) return null;
    if (entry.kind === "group") return this.groupBox(entry, { hints });
    if (!this.isShown(entry)) return null;
    const local = entry.content ? entry.box : hints ? entry.hint : null;
    if (!local) return null;
    entry.body.updateWorldMatrix(true, false);
    const world = entry.body.matrixWorld;
    // Only an axis-aligned (unrotated) world matrix maps the cached box
    // exactly; under a rotation, box each piece under its own matrix, as
    // three's setFromObject does, so the bounds don't grow with the angle.
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

  groupBox(groupEntry, { hints = true } = {}) {
    const box = new Box3();
    for (const [id, e] of this.objects) {
      if (e.kind === "group") continue;
      let inside = false;
      for (let o = e.group.parent; o && o !== this.content; o = o.parent) {
        if (o === groupEntry.group) {
          inside = true;
          break;
        }
      }
      if (!inside) continue;
      const b = this.objectBox(id, { hints });
      if (b) box.union(b);
    }
    return box.isEmpty() ? null : box;
  }

  sceneBox({ hints = true } = {}) {
    const box = new Box3();
    for (const [id, e] of this.objects) {
      if (e.kind === "group") continue;
      const b = this.objectBox(id, { hints });
      if (b) box.union(b);
    }
    return box;
  }

  sceneSphere() {
    const box = this.sceneBox();
    if (box.isEmpty()) return new Sphere(new Vector3(), 1);
    return box.getBoundingSphere(new Sphere());
  }

  // ─── camera ───────────────────────────────────────────────────────────────

  frame(box) {
    if (!this.ok) return;
    if (!box || box.isEmpty()) box = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
    const sphere = box.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 1e-4);
    const fov = (this.camera.fov * Math.PI) / 180;
    const fit = radius / Math.sin(Math.min(fov, fov * this.camera.aspect) / 2);
    let dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) dir = new Vector3(1, 0.8, 1.4);
    dir.normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, fit * 1.1);
    this.controls.update();
    this.invalidate();
  }

  frameAll() {
    this.frame(this.sceneBox());
  }

  frameObject(id) {
    const b = this.objectBox(id);
    if (b) this.frame(b);
  }

  getCamera() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  setCamera(cam) {
    if (!this.ok || !cam?.position || !cam?.target) return;
    this.camera.position.fromArray(cam.position);
    this.controls.target.fromArray(cam.target);
    this.controls.update();
    this.invalidate();
  }

  // ─── selection & gizmo ────────────────────────────────────────────────────

  setSelection(id) {
    this.selection = id ?? null;
    this.updateGizmo();
    this.refreshHelpers();
  }

  setRemoteSelections(ids) {
    const next = [...new Set(ids.filter(Boolean))];
    // the presence heartbeat calls this every few seconds: redraw only on a change
    if (next.length === this.remoteSelections.length && next.every((id, i) => id === this.remoteSelections[i])) return;
    this.remoteSelections = next;
    this.refreshHelpers();
  }

  /** "translate" | "rotate" | null */
  setGizmoMode(mode) {
    this.gizmoMode = mode;
    this.updateGizmo();
  }

  updateGizmo() {
    if (!this.ok) return;
    const entry = this.selection ? this.objects.get(this.selection) : null;
    if (entry && this.gizmoMode && !this.measure) {
      this.gizmo.setMode(this.gizmoMode);
      if (this.gizmo.object !== entry.group) this.gizmo.attach(entry.group);
    } else if (this.gizmo.object) {
      this.gizmo.detach();
    }
    this.invalidate();
  }

  // ─── view helpers: grid, axes, bounds, selection boxes ────────────────────

  setView(view) {
    this.view = { ...this.view, ...view };
    this.refreshHelpers();
    this.setDimensions(this.dimensions);
  }

  /** Grid, axes, bounds and selection boxes are rebuilt once per frame at most (on the next tick). */
  refreshHelpers() {
    this.helpersDirty = true;
    this.invalidate();
  }

  rebuildHelpers() {
    if (!this.ok) return;
    for (const c of [...this.helpers.children]) {
      c.removeFromParent();
      disposeObject(c);
    }
    const units = this.view.units;
    const box = this.sceneBox();
    const extent = box.isEmpty()
      ? 0.5
      : Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), (box.max.y - box.min.y) / 2);
    const grid = gridFor(extent, units);
    this.gridInfo = grid;
    this.sceneRadius = box.isEmpty() ? 1 : box.getBoundingSphere(new Sphere()).radius;
    const half = grid.size / 2;

    const gridLabels = [];
    if (this.view.grid) {
      const helper = new GridHelper(grid.size, grid.divisions, color(this.theme.gridMajor), color(this.theme.gridMinor));
      helper.material.transparent = true;
      helper.material.opacity = 0.8;
      helper.material.depthWrite = false;
      helper.renderOrder = -1;
      helper.raycast = () => {};
      this.helpers.add(helper);
      // ruler ticks along the X and Z axes, where they stay in view when framed
      const every = Math.max(1, Math.ceil(grid.divisions / 2 / 4));
      const lastI = Math.floor(grid.divisions / 2 / every) * every;
      for (let i = -lastI; i <= lastI; i += every) {
        if (i === 0) continue;
        const x = i * grid.step;
        const text = `${roundForDisplay(toUnits(x, units))}${i === lastI ? ` ${units}` : ""}`;
        gridLabels.push({ key: `x${i}`, world: [x, 0, 0], text, className: "grid-label", data: { axis: "x" } });
        gridLabels.push({ key: `z${i}`, world: [0, 0, x], text, className: "grid-label", data: { axis: "z" } });
      }
    }
    this.labels.sync("grid", gridLabels);
    this.caption.hidden = !this.view.grid;
    this.caption.textContent = `grid ${roundForDisplay(grid.stepInUnits)} ${units}`;

    const axisLabels = [];
    if (this.view.axes) {
      const len = this.view.grid ? half : Math.max(extent * 1.2, 0.1);
      const cols = [this.theme.axisX, this.theme.axisY, this.theme.axisZ];
      ["x", "y", "z"].forEach((axis, i) => {
        const end = [0, 0, 0];
        end[i] = len;
        const line = new Line(lineGeometry([[0, 0, 0], end]), new LineBasicMaterial({ color: color(cols[i]), depthTest: false, transparent: true }));
        line.renderOrder = 1;
        line.raycast = () => {};
        this.helpers.add(line);
        // just past the line's end, so it doesn't sit on the last ruler tick
        const at = end.map((v) => v * 1.07);
        axisLabels.push({ key: axis, world: at, text: axis.toUpperCase(), className: "axis-label", data: { axis } });
      });
    }
    this.labels.sync("axes", axisLabels);

    const boundsLabels = [];
    const boxFor = (id, col, kind) => {
      const b = this.objectBox(id, { hints: kind !== "bounds" });
      if (!b) return null;
      const h = new Box3Helper(b, color(col));
      h.material.depthTest = kind !== "bounds";
      h.material.transparent = true;
      h.material.opacity = kind === "bounds" ? 0.7 : 1;
      h.raycast = () => {};
      this.helpers.add(h);
      return b;
    };
    if (this.selection) boxFor(this.selection, this.theme.accent, "selection");
    for (const id of this.remoteSelections) if (id !== this.selection) boxFor(id, this.theme.remote, "remote");
    if (this.view.bounds) {
      const ids = this.selection && this.objects.has(this.selection) ? [this.selection] : [...this.objects.keys()].filter((id) => this.objects.get(id).kind !== "group");
      for (const id of ids) {
        const b = id === this.selection ? this.objectBox(id, { hints: false }) : boxFor(id, this.theme.muted, "bounds");
        if (!b) continue;
        const { min, max } = b;
        const mid = b.getCenter(new Vector3());
        const size = b.getSize(new Vector3());
        boundsLabels.push(
          { key: `${id}:x`, world: [mid.x, min.y, max.z], text: `${formatLength(size.x, units)}`, className: "bounds-label", data: { axis: "x" } },
          { key: `${id}:y`, world: [max.x, mid.y, max.z], text: `${formatLength(size.y, units)}`, className: "bounds-label", data: { axis: "y" } },
          { key: `${id}:z`, world: [max.x, min.y, mid.z], text: `${formatLength(size.z, units)}`, className: "bounds-label", data: { axis: "z" } },
        );
      }
    }
    this.labels.sync("bounds", boundsLabels);
    this.invalidate();
  }

  buildTriad() {
    if (!this.ok) return;
    for (const c of [...this.triad.children]) {
      c.removeFromParent();
      disposeObject(c);
    }
    const cols = [this.theme.axisX, this.theme.axisY, this.theme.axisZ];
    const dirs = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    dirs.forEach((d, i) => {
      const mat = new MeshBasicMaterial({ color: color(cols[i]) });
      const shaft = new Line(lineGeometry([[0, 0, 0], d.toArray()]), new LineBasicMaterial({ color: color(cols[i]) }));
      const cone = new Mesh(new ConeGeometry(0.12, 0.35, 16), mat);
      cone.position.copy(d);
      cone.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d));
      this.triad.add(shaft, cone);
    });
  }

  // ─── dimensions & measuring ───────────────────────────────────────────────

  /**
   * @param {{ id, a:[x,y,z], b:[x,y,z], text, selected, onPointerDown }[]} list  world coords
   */
  setDimensions(list) {
    this.dimensions = list;
    if (!this.ok) return;
    this.rebuildOverlay();
  }

  /** null, or { a: [x,y,z] | null, hover: [x,y,z] | null, snapped, text } */
  setMeasure(state) {
    const wasActive = !!this.measure;
    this.measure = state;
    if (wasActive !== !!state) this.updateGizmo();
    if (this.ok) this.rebuildOverlay();
  }

  rebuildOverlay() {
    for (const c of [...this.overlay.children]) {
      c.removeFromParent();
      disposeObject(c);
    }
    const dimCol = color(this.theme.dim);
    const accent = color(this.theme.accent);
    const segs = [];
    const selSegs = [];
    const pts = [];
    const labels = [];
    for (const d of this.dimensions) {
      (d.selected ? selSegs : segs).push(d.a, d.b);
      pts.push(d.a, d.b);
      labels.push({
        key: d.id,
        world: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2, (d.a[2] + d.b[2]) / 2],
        ends: [d.a, d.b],
        text: d.text,
        className: "dimension-label",
        data: { selected: !!d.selected, detached: !!d.detached, offSurface: !!d.offSurface },
        onPointerDown: d.onPointerDown,
      });
    }
    const m = this.measure;
    if (m?.a && m.hover) {
      segs.push(m.a, m.hover);
      labels.push({
        key: "__measure",
        world: [(m.a[0] + m.hover[0]) / 2, (m.a[1] + m.hover[1]) / 2, (m.a[2] + m.hover[2]) / 2],
        text: m.text ?? "",
        className: "dimension-label",
        data: { preview: true },
      });
    }
    const addSegs = (list, col) => {
      if (!list.length) return;
      const ls = new LineSegments(lineGeometry(list), new LineBasicMaterial({ color: col, depthTest: false, transparent: true }));
      ls.renderOrder = 10;
      ls.raycast = () => {};
      this.overlay.add(ls);
    };
    addSegs(segs, dimCol);
    addSegs(selSegs, accent);
    const markers = [...pts];
    if (m?.a) markers.push(m.a);
    if (m?.hover) markers.push(m.hover);
    if (markers.length) {
      const p = new Points(
        lineGeometry(markers),
        new PointsMaterial({ color: dimCol, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }),
      );
      p.renderOrder = 11;
      p.raycast = () => {};
      this.overlay.add(p);
    }
    if (m?.hover && m.snapped) {
      const s = new Points(
        lineGeometry([m.hover]),
        new PointsMaterial({ color: accent, size: 12, sizeAttenuation: false, depthTest: false, transparent: true, blending: AdditiveBlending }),
      );
      s.renderOrder = 12;
      s.raycast = () => {};
      this.overlay.add(s);
    }
    this.labels.sync("dims", labels);
    this.invalidate();
  }

  // ─── picking ──────────────────────────────────────────────────────────────

  /**
   * @returns {{ objectId: string | null, world: [x,y,z], snapped: boolean, ground?: boolean } | null}
   */
  /** The nearest vertex of any visible object within `maxPx` of (sx, sy), in front of `maxDepth`. */
  nearestVertex(targets, sx, sy, maxPx, rect, maxDepth) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const viewProj = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const mvp = new Matrix4();
    const eye = cam.position.toArray();
    let best = null;
    const model = new Matrix4();
    const inst = new Matrix4();
    // Cull before scanning vertices: skip any piece whose bounding sphere
    // can't come within maxPx of the cursor (or lies past maxDepth). Scanning
    // every vertex of every shown object costs tens of ms at Solander scale.
    const fPx = rect.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const view = cam.matrixWorldInverse;
    const centre = new Vector3();
    const far = (o, m, px) => {
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (!bs || !Number.isFinite(bs.radius)) return false;
      const r = bs.radius * m.getMaxScaleOnAxis();
      centre.copy(bs.center).applyMatrix4(m);
      if (Math.hypot(centre.x - eye[0], centre.y - eye[1], centre.z - eye[2]) - r > maxDepth) return true;
      centre.applyMatrix4(view);
      const cz = -centre.z;
      if (cz + r < 0) return true; // all behind the camera
      if (cz - r <= 1e-6) return false; // around the camera: can't tell
      const bx = (fPx * r * (1 + Math.abs(centre.x) / cz)) / (cz - r);
      const by = (fPx * r * (1 + Math.abs(centre.y) / cz)) / (cz - r);
      const px0 = rect.width / 2 + (centre.x / cz) * fPx;
      const py0 = rect.height / 2 - (centre.y / cz) * fPx;
      return Math.abs(px0 - sx) > bx + px || Math.abs(py0 - sy) > by + px;
    };
    // For a mesh that has its pick BVH (built in idle time after it loads),
    // visit only the triangles in BVH nodes that come within the snap
    // distance of the pick ray, not every vertex.
    const dir = new Vector3((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const c = new Vector3();
    const size = new Vector3();
    const viaBVH = (bvh, m, mw, limit) => {
      const scaleMax = model.getMaxScaleOnAxis();
      let found = null;
      const test = (v) => {
        const px = v.x, py = v.y, pz = v.z;
        const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
        if (!(w > 0)) return;
        const qx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * rect.width;
        const qy = ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * rect.height;
        const d = Math.hypot(qx - sx, qy - sy);
        if (!(d <= limit)) return;
        const wx = mw[0] * px + mw[4] * py + mw[8] * pz + mw[12];
        const wy = mw[1] * px + mw[5] * py + mw[9] * pz + mw[13];
        const wz = mw[2] * px + mw[6] * py + mw[10] * pz + mw[14];
        if ((wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > maxDepth * maxDepth) return;
        limit = d;
        found = { d, world: [wx, wy, wz] };
      };
      bvh.shapecast({
        intersectsBounds: (box) => {
          box.getCenter(c).applyMatrix4(model);
          const r = (box.getSize(size).length() / 2) * scaleMax;
          const vx = c.x - eye[0], vy = c.y - eye[1], vz = c.z - eye[2];
          const dist = Math.hypot(vx, vy, vz);
          if (dist - r > maxDepth) return false;
          const t = vx * dir.x + vy * dir.y + vz * dir.z;
          if (t + r < 0) return false;
          const perp = Math.sqrt(Math.max(0, dist * dist - t * t));
          // a pixel off the ray at distance D is at least D / fPx away from it
          return perp <= r + ((dist + r) * limit * 1.1) / fPx;
        },
        intersectsTriangle: (tri) => {
          test(tri.a);
          test(tri.b);
          test(tri.c);
          return false;
        },
      });
      return found;
    };
    for (const group of targets) {
      group.traverseVisible((o) => {
        const attr = o.geometry?.getAttribute?.("position");
        if (!attr || attr.itemSize !== 3 || attr.normalized) return;
        const interleaved = !!attr.isInterleavedBufferAttribute;
        const layout = { count: attr.count, stride: interleaved ? attr.data.stride : 3, offset: interleaved ? attr.offset : 0 };
        const copies = o.isInstancedMesh ? o.count : 1;
        for (let c = 0; c < copies; c++) {
          model.copy(o.matrixWorld);
          if (o.isInstancedMesh) model.multiply((o.getMatrixAt(c, inst), inst));
          if (far(o, model, best ? best.d : maxPx)) continue;
          mvp.multiplyMatrices(viewProj, model);
          const bvh = o.isMesh ? o.geometry.boundsTree : null;
          if (bvh) {
            const r = viaBVH(bvh, mvp.elements, model.elements, best ? best.d : maxPx);
            if (r) {
              let objectId = null;
              for (let p = o; p && !objectId; p = p.parent) objectId = p.userData?.objectId ?? null;
              best = { ...r, objectId };
            }
            continue;
          }
          const r = nearestScreenVertex(interleaved ? attr.data.array : attr.array, layout, mvp.elements, model.elements, {
            width: rect.width,
            height: rect.height,
            x: sx,
            y: sy,
            maxPx: best ? best.d : maxPx,
            eye,
            maxDepth,
          });
          if (!r) continue;
          let objectId = null;
          for (let p = o; p && !objectId; p = p.parent) objectId = p.userData?.objectId ?? null;
          best = { ...r, objectId };
        }
      });
    }
    return best;
  }

  pick(clientX, clientY, { snapPx = 10, ground = false } = {}) {
    if (!this.ok) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const ndc = new Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const dist = this.camera.position.distanceTo(this.controls.target);
    const worldPerPx = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / rect.height;
    this.raycaster.params.Line.threshold = worldPerPx * 5;
    this.raycaster.params.Points.threshold = worldPerPx * 5;

    const targets = [...this.objects.values()].filter((e) => e.kind !== "group" && e.content && this.isShown(e)).map((e) => e.body);
    const hits = this.raycaster.intersectObjects(targets, true).filter((h) => {
      for (let o = h.object; o; o = o.parent) if (!o.visible) return false;
      return true;
    });
    const hit = hits[0];
    if (hit) {
      let objectId = null;
      for (let o = hit.object; o; o = o.parent) {
        if (o.userData?.objectId) {
          objectId = o.userData.objectId;
          break;
        }
      }
      let point = hit.point.clone();
      let snapped = false;
      const pos = hit.object.geometry?.getAttribute?.("position");
      const candidates = hit.face ? [hit.face.a, hit.face.b, hit.face.c] : hit.index != null ? [hit.index, hit.index + 1] : [];
      let best = snapPx;
      const v = new Vector3();
      const instM = hit.object.isInstancedMesh && hit.instanceId != null ? new Matrix4() : null;
      if (instM) hit.object.getMatrixAt(hit.instanceId, instM);
      for (const i of candidates) {
        if (!pos || i >= pos.count) continue;
        v.fromBufferAttribute(pos, i);
        if (instM) v.applyMatrix4(instM);
        v.applyMatrix4(hit.object.matrixWorld);
        const p = this.project(v);
        if (!p) continue;
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d <= best) {
          best = d;
          point = v.clone();
          snapped = true;
        }
      }
      // a nearer vertex that isn't on the hit face (a tip on the silhouette)
      const near = snapPx > 0 ? this.nearestVertex(targets, sx, sy, snapped ? best : snapPx, rect, hit.distance + Math.max(worldPerPx * snapPx * 3, 1e-4)) : null;
      if (near && (!snapped || near.d < best)) return { objectId: near.objectId ?? objectId, world: near.world, snapped: true };
      return { objectId, world: point.toArray(), snapped };
    }
    // missed every object by a hair: still snap to a vertex under the cursor
    const near = snapPx > 0 ? this.nearestVertex(targets, sx, sy, snapPx, rect, Infinity) : null;
    if (near) return { objectId: near.objectId, world: near.world, snapped: true };
    if (ground) {
      const p = new Vector3();
      if (this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p)) {
        return { objectId: null, world: p.toArray(), snapped: false, ground: true };
      }
    }
    return null;
  }

  wirePointer() {
    let down = null;
    let hoverQueued = null;
    const onDown = (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, gizmo: this.gizmo.dragging || this.gizmo.axis != null };
    };
    const onUp = (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const wasGizmo = down.gizmo;
      down = null;
      if (moved > 4 || wasGizmo) return;
      this.cb.onClick?.(e, this);
    };
    const onMove = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (hoverQueued) {
        hoverQueued.e = e;
        return;
      }
      hoverQueued = { e };
      requestAnimationFrame(() => {
        const { e: ev } = hoverQueued;
        hoverQueued = null;
        if (this.ok) this.cb.onHover?.(ev, this);
      });
    };
    const onLeave = () => this.cb.onHover?.(null, this);
    this.canvas.addEventListener("pointerdown", onDown);
    this.canvas.addEventListener("pointerup", onUp);
    this.canvas.addEventListener("pointermove", onMove);
    this.canvas.addEventListener("pointerleave", onLeave);
    this.disposers.push(() => {
      this.canvas.removeEventListener("pointerdown", onDown);
      this.canvas.removeEventListener("pointerup", onUp);
      this.canvas.removeEventListener("pointermove", onMove);
      this.canvas.removeEventListener("pointerleave", onLeave);
    });
  }

  dispose() {
    if (!this.ok) return;
    this.ok = false;
    cancelAnimationFrame(this.raf);
    if (this.bvhTimer) this.bvhTimer.cancel(this.bvhTimer.id);
    this.bvhQueue.clear();
    for (const d of this.disposers) d();
    this.gizmo.detach();
    this.gizmo.dispose();
    this.controls.dispose();
    disposeObject(this.scene);
    disposeObject(this.triadScene);
    for (const c of this.compiling) disposeObject(c);
    this.compiling.clear();
    // Whatever might still hold the renderer (three keeps its last render
    // state, which holds the camera, which is in the scene) then reaches an
    // empty scene, not every object's geometry.
    this.scene.clear();
    this.triadScene.clear();
    this.placeholderGeometry?.dispose();
    this.placeholderMaterial?.dispose();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.caption.remove();
    this.labels.dispose();
    this.objects.clear();
  }
}

