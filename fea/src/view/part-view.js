// A part drawn with three.js: its faces (tinted where a support or load is,
// lit under the pointer), the lines between them, the marks of its supports
// and loads, and a run's results in its place. It draws into a group it is
// given and owns nothing else: the study's own viewport (src/tool/viewport.js)
// and the scene's stage (src/scene/edit.js) both use it, each with its own
// three.js (`THREE` is passed in: a scene's renderer can't draw another copy's
// objects).

import { partGeometry, faceEdges } from "../draw/result.js";

/** Colours, sRGB. A viewer may pass its theme's instead. */
export const COLORS = Object.freeze({ body: "#a9aeb5", edge: "#2b2e33", support: "#2f7dd1", load: "#d9432f", hover: "#ffd166", picked: "#f2a900" });

/**
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} parent
 */
export function createPartView(THREE, parent, { colors = COLORS } = {}) {
  const root = new THREE.Group();
  root.name = "fea part";
  parent.add(root);
  const c = Object.fromEntries(Object.entries({ ...COLORS, ...colors }).map(([k, v]) => [k, new THREE.Color(v)]));
  const mix = (a, b, t) => a.clone().lerp(b, t);

  let part = null;
  let geometry = null; // partGeometry(part)
  let partMesh = null, edges = null, ghost = null, resultMesh = null;
  let marks = [];
  let tints = { supports: new Set(), loads: new Set(), active: new Set(), hover: null, picked: null };
  let resultFaces = null;
  let swing = null; // { rest, full }: the result's points before and after it moved

  const dispose = (o) => {
    if (!o) return;
    o.removeFromParent();
    o.geometry?.dispose();
    o.material?.dispose();
  };

  function paint() {
    if (!partMesh) return;
    const attr = partMesh.geometry.getAttribute("color");
    const colorOf = new Map();
    const of = (face) => {
      let col = colorOf.get(face);
      if (col) return col;
      col = c.body;
      const held = tints.supports.has(face), loaded = tints.loads.has(face);
      if (held && loaded) col = mix(c.support, c.load, 0.5);
      else if (held) col = mix(c.body, c.support, 0.75);
      else if (loaded) col = mix(c.body, c.load, 0.75);
      if (tints.active.has(face)) col = mix(col, c.picked, 0.55);
      if (tints.picked === face) col = mix(col, c.picked, 0.8);
      if (tints.hover === face) col = mix(col, c.hover, 0.45);
      colorOf.set(face, col);
      return col;
    };
    const { indices, faces } = geometry;
    for (let t = 0; t < faces.length; t++) {
      const col = of(faces[t]);
      for (let k = 0; k < 3; k++) attr.setXYZ(indices[t * 3 + k], col.r, col.g, col.b);
    }
    attr.needsUpdate = true;
  }

  const lines = (segments, color, { opacity = 1, onTop = false } = {}) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1 || onTop, opacity, depthTest: !onTop });
    const l = new THREE.LineSegments(g, m);
    if (onTop) l.renderOrder = 10;
    l.userData.noPick = true;
    return l;
  };

  return {
    root,
    /** The part to draw, or null for none. Its results, if any were shown, go. */
    setPart(next) {
      for (const o of [partMesh, edges, ghost, resultMesh]) dispose(o);
      partMesh = edges = ghost = resultMesh = null;
      resultFaces = null;
      part = next;
      geometry = null;
      if (!part || !part.tris.length) return;
      geometry = partGeometry(part);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(geometry.normals, 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geometry.positions.length), 3));
      g.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
      partMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      const between = faceEdges(part);
      edges = lines(between, c.edge, { opacity: 0.7 });
      root.add(partMesh, edges);
      paint();
    },
    /** Which faces are held, loaded, being picked for, under the pointer, picked: sets of face numbers and two faces (or null). */
    setTints(next) {
      tints = { ...tints, ...next };
      paint();
    },
    /** The marks of the supports and loads (src/draw/glyphs.js setupGlyphs), or null for none. */
    setMarks(glyphs) {
      for (const m of marks) dispose(m);
      marks = [];
      if (!glyphs) return;
      if (glyphs.supports.length) marks.push(lines(glyphs.supports, c.support, { onTop: true }));
      if (glyphs.loads.length) marks.push(lines(glyphs.loads, c.load, { onTop: true }));
      if (marks.length) root.add(...marks);
    },
    /**
     * A run's results (src/draw/result.js resultGeometry) in the part's place, or null to show the part again.
     * With results up, the part's own outline stays, faint: where it was before it moved.
     */
    setResult(result) {
      dispose(resultMesh);
      dispose(ghost);
      resultMesh = ghost = null;
      resultFaces = null;
      swing = null;
      if (partMesh) partMesh.visible = !result;
      if (edges) edges.visible = !result;
      if (!result) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
      if (result.colors) g.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
      g.setIndex(new THREE.BufferAttribute(result.indices, 1));
      resultMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: !!result.colors, color: result.colors ? 0xffffff : c.body, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));
      resultFaces = result.faces;
      swing = result.scale ? { rest: result.rest, full: Float32Array.from(result.positions) } : null;
      root.add(resultMesh);
      if (part && result.scale) {
        ghost = lines(faceEdges(part), c.edge, { opacity: 0.28 });
        root.add(ghost);
      }
    },
    /**
     * Draw the result part of the way to where it moved: 0 at rest, 1 as moved, −1 the other way (a
     * mode swings both ways). For showing the movement as movement.
     */
    sway(f) {
      if (!resultMesh || !swing) return;
      const at = resultMesh.geometry.getAttribute("position");
      const { rest, full } = swing;
      for (let i = 0; i < rest.length; i++) at.array[i] = rest[i] + f * (full[i] - rest[i]);
      at.needsUpdate = true;
    },
    /** The face of the part a ray hits, and where: `{ face, point }` or null. */
    faceAt(raycaster) {
      const mesh = resultMesh ?? partMesh;
      if (!mesh) return null;
      root.updateMatrixWorld(true);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit || hit.faceIndex == null) return null;
      const faces = resultMesh ? resultFaces : geometry.faces;
      const face = faces ? faces[hit.faceIndex] : null;
      return face == null || face === 0xffffffff ? null : { face, point: hit.point.toArray() };
    },
    /** What is drawn, as a box in the parent's frame, or null. */
    box() {
      const mesh = resultMesh ?? partMesh;
      if (!mesh) return null;
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      return b.isEmpty() ? null : b;
    },
    showing: () => (resultMesh ? "result" : partMesh ? "part" : "nothing"),
    dispose() {
      for (const o of [partMesh, edges, ghost, resultMesh, ...marks]) dispose(o);
      root.removeFromParent();
    },
  };
}
