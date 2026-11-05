// 3D preview: the bed, the model, and the G-code's toolpaths with a layer
// limit. Renders on demand only — after a control move, a resize, or a change
// to what is shown — never in a standing animation loop.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FEATURES } from "./gcode-preview.js";

const rgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

/**
 * @param {HTMLElement} container
 * @param {object} colors  { bg, bed, grid, model, wall, solid, infill } as sRGB [r, g, b] 0..1
 */
export function createViewer(container, colors) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  container.append(renderer.domElement);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  const controls = new OrbitControls(camera, renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, -2, 3);
  scene.add(sun);

  const modelMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  const bedMaterial = new THREE.MeshBasicMaterial();
  const lineMaterials = Object.fromEntries(FEATURES.map((f) => [f, new THREE.LineBasicMaterial()]));

  let bedGroup = null, modelMesh = null, pathGroup = null, layerEnds = null, layerCount = 0;
  let bed = [325, 320];
  let gridColor = [0.5, 0.5, 0.5];
  let raf = 0, disposed = false;

  function requestRender() {
    if (raf || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!disposed) renderer.render(scene, camera);
    });
  }
  controls.addEventListener("change", requestRender);

  function setColors(c) {
    scene.background = rgb(c.bg);
    bedMaterial.color = rgb(c.bed);
    modelMaterial.color = rgb(c.model);
    for (const f of FEATURES) lineMaterials[f].color = rgb(c[f]);
    gridColor = c.grid;
    buildBed();
    requestRender();
  }

  function buildBed() {
    if (bedGroup) {
      scene.remove(bedGroup);
      bedGroup.traverse((o) => {
        o.geometry?.dispose();
        if (o.material && o.material !== bedMaterial) o.material.dispose();
      });
    }
    const [x, y] = bed;
    bedGroup = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(x, y), bedMaterial);
    plane.position.set(x / 2, y / 2, -0.05);
    const size = Math.max(x, y);
    const grid = new THREE.GridHelper(size, Math.max(1, Math.round(size / 10)), rgb(gridColor), rgb(gridColor));
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.rotation.x = Math.PI / 2;
    grid.position.set(x / 2, y / 2, 0);
    bedGroup.add(plane, grid);
    scene.add(bedGroup);
  }

  function frameBed() {
    controls.target.set(bed[0] / 2, bed[1] / 2, 20);
    camera.position.set(bed[0] / 2 + bed[0] * 0.45, -bed[1] * 0.35, Math.max(bed[0], bed[1]) * 0.7);
    controls.update();
  }

  function setBed(x, y) {
    if (bed[0] === x && bed[1] === y && bedGroup) return;
    bed = [x, y];
    buildBed();
    frameBed();
    requestRender();
  }

  function clearModel() {
    if (modelMesh) {
      scene.remove(modelMesh);
      modelMesh.geometry.dispose();
      modelMesh = null;
    }
  }
  function clearPaths() {
    if (pathGroup) {
      scene.remove(pathGroup);
      pathGroup.traverse((o) => o.geometry?.dispose());
      pathGroup = null;
    }
    layerEnds = null;
    layerCount = 0;
  }

  /** tris: print-space triangles; offset places them on the bed as the slicer does. */
  function showModel(tris, offset, { frame = true } = {}) {
    clearModel();
    if (!tris) return requestRender();
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(tris.length);
    for (let i = 0; i < p.length; i += 3) {
      p[i] = tris[i] + offset[0];
      p[i + 1] = tris[i + 1] + offset[1];
      p[i + 2] = tris[i + 2] + offset[2];
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.computeVertexNormals();
    modelMesh = new THREE.Mesh(g, modelMaterial);
    modelMesh.visible = !pathGroup;
    scene.add(modelMesh);
    if (frame) {
      g.computeBoundingBox();
      const box = g.boundingBox, c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z, 20);
      controls.target.copy(c);
      camera.position.set(c.x + r * 1.6, c.y - r * 2.0, c.z + r * 1.4);
      controls.update();
    }
    requestRender();
  }

  /** preview: parseGcodePreview() output, or null to go back to the model. */
  function showPreview(preview) {
    clearPaths();
    if (!preview || !preview.layers) {
      if (modelMesh) modelMesh.visible = true;
      return requestRender();
    }
    pathGroup = new THREE.Group();
    pathGroup.userData.lines = {};
    for (const f of FEATURES) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(preview.positions[f], 3));
      const m = new THREE.LineSegments(g, lineMaterials[f]);
      pathGroup.userData.lines[f] = m;
      pathGroup.add(m);
    }
    layerEnds = preview.layerEnds;
    layerCount = preview.layers;
    scene.add(pathGroup);
    if (modelMesh) modelMesh.visible = false;
    setLayer(layerCount - 1);
  }

  function setLayer(n) {
    if (!pathGroup) return;
    for (const f of FEATURES) {
      const ends = layerEnds[f];
      pathGroup.userData.lines[f].geometry.setDrawRange(0, ends[Math.max(0, Math.min(n, ends.length - 1))] ?? 0);
    }
    requestRender();
  }

  function setModelVisible(v) {
    if (modelMesh) modelMesh.visible = v;
    if (pathGroup) pathGroup.visible = !v;
    requestRender();
  }

  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  setColors(colors);
  frameBed();

  return {
    setBed,
    setColors,
    showModel,
    showPreview,
    setLayer,
    setModelVisible,
    frame: frameBed,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      clearModel();
      clearPaths();
      if (bedGroup) bedGroup.traverse((o) => o.geometry?.dispose());
      modelMaterial.dispose();
      bedMaterial.dispose();
      for (const m of Object.values(lineMaterials)) m.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
