// The study's own 3D view: the part, to turn, look at and pick faces on.
// A study needs no scene to be set up; in a scene, the scene's stage does
// this instead (src/scene/edit.js), drawing the same part view.
//
// It draws only when something changed (a turn of the camera, a new tint, a
// resize), not every frame.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPartView } from "../view/part-view.js";
import { showLegend } from "../view/legend.js";

/**
 * A custom property's colour as three.js takes it. The property may be any
 * CSS colour (the theme's are color-mix() in oklch), so it is resolved the
 * way the browser paints it: one pixel of a 2D canvas filled with it.
 */
const cssColor = (el, name, fallback) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${name}, ${fallback})`;
  probe.style.display = "none";
  el.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  try {
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    g.canvas.width = g.canvas.height = 1;
    g.fillStyle = fallback;
    g.fillStyle = resolved; // (an unreadable colour leaves the fallback)
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    return new THREE.Color().setRGB(r / 255, gr / 255, b / 255, THREE.SRGBColorSpace);
  } catch {
    return new THREE.Color(fallback);
  }
};

/**
 * @param {HTMLElement} host   it fills this
 * @returns {{
 *   view: ReturnType<typeof createPartView>,
 *   frame(): void,                       look at everything drawn
 *   invalidate(): void,                  draw once more
 *   onPick(fn: (hit: { face: number, point: number[] } | null, ev: PointerEvent) => void): void,
 *   onHover(fn: (hit: { face: number, point: number[] } | null) => void): void,
 *   setLegend(legend: object|null, note?: string): void,
 *   setHint(text: string): void,
 *   animate(fn: ((seconds: number) => void) | null): void,   called before each frame while set
 *   dispose(): void }}
 */
export function createViewport(host) {
  const el = document.createElement("div");
  el.className = "viewport";
  const canvas = document.createElement("canvas");
  const legendEl = document.createElement("div");
  legendEl.className = "legend";
  legendEl.hidden = true;
  const axesEl = document.createElement("div");
  axesEl.className = "axes-key";
  axesEl.innerHTML = `<span data-axis="x">x</span><span data-axis="y">y up</span><span data-axis="z">z</span>`;
  const hintEl = document.createElement("div");
  hintEl.className = "view-hint";
  hintEl.hidden = true;
  el.append(canvas, legendEl, axesEl, hintEl);
  host.append(el);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 1000);
  camera.position.set(1, 0.8, 1.4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  scene.add(key);
  // the key light rides with the camera, so a face turned toward you is lit
  scene.add(camera);
  camera.add(key);
  key.position.set(0.4, 0.8, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  const view = createPartView(THREE, scene);

  // a small triad in the corner: which way x, y (up) and z run
  const triadScene = new THREE.Scene();
  const triad = new THREE.AxesHelper(1);
  triad.setColors(new THREE.Color("#d9432f"), new THREE.Color("#3a9d5d"), new THREE.Color("#2f7dd1"));
  triadScene.add(triad);
  const triadCamera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10);

  let w = 0, h = 0, pending = false, disposed = false, anim = null, t0 = performance.now();
  const draw = () => {
    pending = false;
    if (disposed || !w || !h) return;
    if (anim) anim((performance.now() - t0) / 1000);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    const s = 64;
    renderer.setScissorTest(true);
    renderer.setScissor(8, 8, s, s);
    renderer.setViewport(8, 8, s, s);
    triadCamera.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(4);
    triadCamera.lookAt(0, 0, 0);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(triadScene, triadCamera);
    renderer.autoClear = true;
    renderer.setScissorTest(false);
    if (anim) invalidate();
  };
  const invalidate = () => {
    if (pending || disposed) return;
    pending = true;
    requestAnimationFrame(draw);
  };
  controls.addEventListener("change", invalidate);

  const theme = () => {
    scene.background = cssColor(el, "--fea-view", "#f4f5f7");
    invalidate();
  };
  const resize = () => {
    const r = el.getBoundingClientRect();
    w = Math.max(1, Math.floor(r.width));
    h = Math.max(1, Math.floor(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  // the host's theme is an attribute on an ancestor: follow it
  const themed = new MutationObserver(theme);
  themed.observe(el.closest("[theme]") ?? document.documentElement, { attributes: true, attributeFilter: ["theme", "class", "style"] });
  theme();
  resize();

  // ---- the pointer: what it is over, and what it clicks
  const raycaster = new THREE.Raycaster();
  let onPick = null, onHover = null, lastHover = undefined, down = null, moveQueued = null;
  const hitAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    return view.faceAt(raycaster);
  };
  const hover = (hit) => {
    const face = hit?.face ?? null;
    if (face === lastHover) return;
    lastHover = face;
    canvas.style.cursor = face == null ? "" : "pointer";
    onHover?.(hit);
  };
  const move = (ev) => {
    if (down) return; // turning the view
    moveQueued = ev;
    requestAnimationFrame(() => {
      if (!moveQueued || disposed) return;
      const e = moveQueued;
      moveQueued = null;
      hover(hitAt(e));
    });
  };
  const press = (ev) => {
    down = { x: ev.clientX, y: ev.clientY, button: ev.button };
  };
  const release = (ev) => {
    const d = down;
    down = null;
    if (!d || d.button !== 0) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 4) return; // a drag turned the view
    onPick?.(hitAt(ev), ev);
  };
  const leave = () => {
    moveQueued = null;
    hover(null);
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointerleave", leave);

  return {
    view,
    el,
    camera,
    frame() {
      const box = view.box();
      if (!box) return;
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
      const away = camera.position.clone().sub(controls.target);
      if (away.lengthSq() === 0) away.set(1, 0.8, 1.4);
      const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.1;
      controls.target.copy(centre);
      camera.position.copy(centre).add(away.normalize().multiplyScalar(distance));
      camera.near = distance / 200;
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    },
    invalidate,
    /** Where a point of the part is on the page (client px), or null if it is behind the eye. */
    project(point) {
      const p = new THREE.Vector3(...point).project(camera);
      if (p.z > 1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    /** Turn the view so the eye looks along `direction` (toward the part), keeping its distance. */
    lookAlong(direction) {
      const d = new THREE.Vector3(...direction).normalize();
      const distance = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).sub(d.multiplyScalar(distance));
      camera.up.set(0, 1, 0);
      if (Math.abs(direction[1]) > 0.99 * Math.hypot(...direction)) camera.up.set(0, 0, -1);
      controls.update();
      invalidate();
    },
    onPick(fn) {
      onPick = fn;
    },
    onHover(fn) {
      onHover = fn;
    },
    setLegend(legend, note = "") {
      showLegend(legendEl, legend, note);
    },
    setHint(text) {
      hintEl.hidden = !text;
      hintEl.textContent = text ?? "";
    },
    animate(fn) {
      anim = fn;
      t0 = performance.now();
      invalidate();
    },
    theme,
    dispose() {
      disposed = true;
      observer.disconnect();
      themed.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointerleave", leave);
      view.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
