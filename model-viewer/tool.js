// "3D Model Viewer": orbit any 3D file (glb, stl, 3dm, 3mf, obj, ply) outside a scene.
// A model with layers (a .3dm, or a GLB that declares them: layers.js) gets a
// Layers panel. Its ticks are this view's, like Wireframe and Grid: they start
// as the file has them and aren't saved (a scene keeps its own, per object).
import { loadThree } from "./three.js";
import { loadModel, fileBytes, extOf } from "./load.js";
import { layerChoices, layerShown, layerStates, nodeLayer } from "./layers.js";

const CSS = `
@layer package { :root, :host, [theme] {
  --mv-bg: var(--editor-fill, white);
  --mv-fg: var(--editor-line, black);
  --mv-muted: var(--editor-line-offset-50, #888);
  --mv-panel: color-mix(in oklch, var(--editor-fill, white) 85%, transparent);
  --mv-border: var(--editor-fill-offset-20, #ccc);
  --mv-font: var(--editor-family-sans, system-ui, sans-serif);
}}
.model-viewer { position: relative; height: 100%; width: 100%; overflow: hidden; background: var(--mv-bg); color: var(--mv-fg); font-family: var(--mv-font); font-size: 12px; }
.model-viewer canvas { display: block; width: 100%; height: 100%; outline: none; }
.model-viewer .mv-bar { position: absolute; top: 8px; left: 8px; right: 8px; display: flex; gap: 6px; align-items: center; pointer-events: none; }
.model-viewer .mv-bar > * { pointer-events: auto; }
.model-viewer .mv-info { background: var(--mv-panel); border: 1px solid var(--mv-border); border-radius: 6px; padding: 4px 8px; color: var(--mv-muted); }
.model-viewer .mv-info:empty { display: none; }
.model-viewer .mv-info b { color: var(--mv-fg); font-weight: 600; }
.model-viewer .mv-spacer { flex: 1; }
.model-viewer button { background: var(--mv-panel); color: var(--mv-fg); border: 1px solid var(--mv-border); border-radius: 6px; padding: 4px 8px; font: inherit; cursor: pointer; }
.model-viewer button[data-on] { border-color: var(--mv-fg); }
.model-viewer .mv-layers { position: absolute; top: 44px; right: 8px; max-width: min(320px, 60%); max-height: calc(100% - 52px); overflow: auto; background: var(--mv-panel); border: 1px solid var(--mv-border); border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.model-viewer .mv-layers[hidden], .model-viewer [hidden] { display: none; }
.model-viewer .mv-layers-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; color: var(--mv-muted); }
.model-viewer .mv-layers-head button { border: none; background: none; padding: 0; color: var(--mv-muted); text-decoration: underline; }
.model-viewer .mv-layer { display: flex; align-items: center; gap: 4px; padding-inline-start: calc(var(--depth, 0) * 14px); white-space: nowrap; cursor: pointer; }
.model-viewer .mv-layer span { overflow: hidden; text-overflow: ellipsis; }
.model-viewer .mv-layer[data-shown="false"] { color: var(--mv-muted); }
.model-viewer .mv-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--mv-muted); padding: 24px; text-align: center; pointer-events: none; }
`;

export default function ModelViewer(handle, element) {
  const root = document.createElement("div");
  root.className = "model-viewer";
  const style = document.createElement("style");
  style.textContent = CSS;
  const status = document.createElement("div");
  status.className = "mv-status";
  status.textContent = "Loading…";
  const bar = document.createElement("div");
  bar.className = "mv-bar";
  const info = document.createElement("div");
  info.className = "mv-info";
  bar.append(info);
  const layersPanel = document.createElement("div");
  layersPanel.className = "mv-layers";
  layersPanel.hidden = true;
  root.append(style, status, bar, layersPanel);
  element.append(root);

  let disposed = false, raf = 0, ro = null, renderer = null, controls = null, model = null, scene, camera, grid, T;
  let wire = false;
  let loadedKey = null;
  // one setup however many shows arrive while three.js is loading
  let setupPromise = null;
  const ensureSetup = () => (setupPromise ??= setup().catch((e) => { setupPromise = null; throw e; }));

  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => fn(b); return b; };

  // layers: the model's table, this view's ticks, and whether the panel is open
  let layerTable = [];
  let choices = {};
  let layersOpen = true;
  const layersBtn = btn("Layers", () => { layersOpen = !layersOpen; renderLayers(); });
  layersBtn.hidden = true;

  function applyLayers() {
    if (!model || !layerTable.length) return;
    const states = layerStates(layerTable, choices);
    model.traverse((o) => {
      if (o.isMesh || o.isLine || o.isPoints) o.visible = layerShown(states, nodeLayer(o, model));
    });
  }

  function setLayer(layer, on) {
    // a tick back to what the file says is no choice at all
    if (on === layer.visible) delete choices[layer.id];
    else choices[layer.id] = on;
    applyLayers();
    renderLayers();
  }

  function renderLayers() {
    layersBtn.hidden = !layerTable.length;
    layersBtn.toggleAttribute("data-on", layersOpen && layerTable.length > 0);
    layersPanel.hidden = !layersOpen || !layerTable.length;
    if (layersPanel.hidden) return;
    const states = layerStates(layerTable, choices);
    const head = document.createElement("div");
    head.className = "mv-layers-head";
    const title = document.createElement("span");
    title.textContent = `Layers (${layerTable.length})`;
    const reset = btn("Reset", () => { choices = {}; applyLayers(); renderLayers(); });
    reset.title = "Show each layer as the file does";
    reset.hidden = !Object.keys(layerChoices(choices)).length;
    head.append(title, reset);
    const rows = layerTable.map((l) => {
      const st = states.get(l.id);
      const row = document.createElement("label");
      row.className = "mv-layer";
      row.style.setProperty("--depth", String(l.depth));
      row.dataset.shown = String(st.shown);
      if (st.on && !st.shown) row.title = "Hidden with a layer it's in";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = st.on;
      box.onchange = () => setLayer(l, box.checked);
      const name = document.createElement("span");
      name.textContent = l.name;
      row.append(box, name);
      return row;
    });
    layersPanel.replaceChildren(head, ...rows);
  }

  /** The box of what's drawn (hidden layers left out); empty if nothing is. */
  function shownBox() {
    const { THREE } = T;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverseVisible((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints) || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    return box;
  }

  function frame() {
    const { THREE } = T;
    const box = shownBox();
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.length() / 2, 1e-6);
    const d = r / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = d / 1000; camera.far = d * 100; camera.updateProjectionMatrix();
    camera.position.copy(c).add(new THREE.Vector3(1, 0.6, 1.2).normalize().multiplyScalar(d));
    controls.target.copy(c); controls.update();
    grid.position.set(c.x, box.min.y, c.z);
    grid.scale.setScalar(Math.max(size.x, size.z) * 1.5);
    return size;
  }

  const fmt = (m) => (m >= 1 ? `${m.toFixed(2)} m` : `${(m * 1000).toFixed(0)} mm`);

  async function setup() {
    T = await loadThree();
    if (disposed) return;
    const { THREE } = T;
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    root.prepend(renderer.domElement);
    scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 2, 1.5);
    scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x888888, 0.4));
    grid = new THREE.GridHelper(1, 20, 0x888888, 0x888888);
    grid.material.transparent = true; grid.material.opacity = 0.25;
    scene.add(grid);
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const resize = () => {
      const w = root.clientWidth || 1, h = root.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    ro = new ResizeObserver(resize); ro.observe(root); resize();
    let n = 0, bg = "";
    // paint the theme's background into the canvas; re-check twice a second
    const syncBg = () => {
      const c = getComputedStyle(root).backgroundColor;
      if (c === bg) return;
      bg = c;
      const m = c.match(/[\d.]+/g);
      if (!m) return;
      const col = new THREE.Color().setRGB(m[0] / 255, m[1] / 255, m[2] / 255, THREE.SRGBColorSpace);
      renderer.setClearColor(col, 1);
      grid.material.color.set(col.r + col.g + col.b < 1.2 ? 0xaaaaaa : 0x888888);
    };
    const loop = () => { raf = requestAnimationFrame(loop); if (n++ % 30 === 0) syncBg(); controls.update(); renderer.render(scene, camera); };
    loop();
    const spacer = document.createElement("span");
    spacer.className = "mv-spacer";
    const gridBtn = btn("Grid", (b) => { grid.visible = !grid.visible; b.toggleAttribute("data-on", grid.visible); });
    gridBtn.toggleAttribute("data-on", true);
    bar.append(
      spacer,
      btn("Fit", () => model && frame()),
      btn("Wireframe", (b) => { wire = !wire; b.toggleAttribute("data-on", wire); applyWire(); }),
      gridBtn,
      layersBtn,
    );
  }

  function applyWire() {
    model?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = wire; });
  }

  function disposeModel() {
    if (!model) return;
    scene.remove(model);
    model.traverse((o) => {
      o.geometry?.dispose?.();
      for (const m of [].concat(o.material ?? [])) { for (const k in m) m[k]?.isTexture && m[k].dispose(); m.dispose?.(); }
    });
    model = null;
  }

  async function show() {
    const doc = handle.doc();
    if (!doc) return;
    const ext = extOf(doc);
    const key = (handle.heads?.() ?? []).join(",") + ext;
    if (key === loadedKey) return;
    loadedKey = key;
    info.textContent = "";
    status.textContent = `Loading .${ext}…`;
    status.style.display = "";
    try {
      await ensureSetup();
      if (disposed || !renderer) return;
      const { object, notes, layers } = await loadModel(fileBytes(doc), ext);
      if (disposed || loadedKey !== key) return;
      disposeModel();
      model = object;
      scene.add(model);
      applyWire();
      // the ticks carry over a new version of the same file (ids are stable); unknown ones are ignored
      layerTable = layers;
      applyLayers();
      renderLayers();
      const size = frame();
      status.style.display = "none";
      const name = document.createElement("b");
      name.textContent = doc.name ?? "";
      info.append(name, ` · ${notes}` + (size && ext !== "stl" && ext !== "3mf" ? ` · ${fmt(size.x)} × ${fmt(size.z)} × ${fmt(size.y)} high` : ""));
    } catch (e) {
      if (disposed) return;
      status.textContent = String(e?.message ?? e);
      status.style.display = "";
    }
  }

  show();
  handle.on("change", show);
  return () => {
    disposed = true;
    handle.off("change", show);
    cancelAnimationFrame(raf);
    ro?.disconnect();
    if (scene) disposeModel();
    scene?.environment?.dispose();
    controls?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss?.();
    root.remove();
  };
}
