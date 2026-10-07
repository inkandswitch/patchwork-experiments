// Turning GLB bytes into what the viewport shows. three.js objects only, no
// renderer, so it runs (and is tested) without WebGL.
//
// - One shared GLTFLoader, with the meshopt decoder (EXT_meshopt_compression);
//   KHR_mesh_quantization, KHR_materials_* and KHR_texture_transform are
//   GLTFLoader built-ins.
// - Quantized POSITION attributes become Float32, so vertex snapping and
//   anchor checks (which read the raw arrays) see metres.
// - GLTFLoader's own default material (a primitive with no material) is found
//   exactly, through parser.associations, and drawn in the theme colour; every
//   material the file authored keeps its colour, named or not.
// - Meshes that reuse one (geometry, material) pair inside a GLB collapse into
//   one InstancedMesh: one draw call instead of one per node.
// - Scene material rules (material-rules.js) are applied on top of the GLB's
//   values, and can be re-applied when they change.

import { Box3, BufferAttribute, DoubleSide, InstancedMesh, Matrix4 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toArrayBuffer } from "./file-content.js";
import { resolveMaterialSet } from "./material-rules.js";

let loader = null;

/** The one GLTFLoader, built on first use. (Each parse makes its own parser, so sharing it is safe.) */
export function sharedLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

/** Parse GLB bytes. Resolves to GLTFLoader's result ({ scene, parser, … }). */
export function loadGLTF(bytes) {
  return sharedLoader().parseAsync(toArrayBuffer(bytes), "");
}

const meshLike = (o) => o.isMesh || o.isLine || o.isPoints;

/**
 * Replace every quantized (normalized or integer) POSITION with a Float32 one.
 * @returns {number} how many attributes were converted
 */
export function dequantizePositions(root) {
  let converted = 0;
  const done = new Set();
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || done.has(g)) return;
    done.add(g);
    const attr = g.getAttribute?.("position");
    if (!attr) return;
    const raw = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
    if (!attr.normalized && raw instanceof Float32Array) return;
    const out = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      out[i * 3] = attr.getX(i);
      out[i * 3 + 1] = attr.getY(i);
      out[i * 3 + 2] = attr.getZ(i);
    }
    g.setAttribute("position", new BufferAttribute(out, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    converted++;
  });
  return converted;
}

/**
 * The materials a file authored (anything else is GLTFLoader's default).
 * Associations cover mesh materials and their clones. The Line/Points
 * materials GLTFLoader derives from one (and their vertex-colour clones)
 * carry no association of their own, so those are decided per primitive: an
 * object made from a primitive that names a material in the file has an
 * authored material, whatever class GLTFLoader turned it into.
 * @param {object} parser  GLTFLoader's parser
 * @param {object} [root]  the loaded scene, to find those Line/Points objects
 * @returns {Set<object>}
 */
export function authoredMaterials(parser, root = null) {
  const authored = new Set();
  const assoc = parser?.associations;
  for (const [k, v] of assoc ?? []) if (k?.isMaterial && v?.materials !== undefined) authored.add(k);
  const meshDefs = parser?.json?.meshes ?? [];
  root?.traverse?.((o) => {
    if (!meshLike(o) || !o.material) return;
    const a = assoc?.get?.(o);
    if (a?.meshes === undefined || a.primitives === undefined) return;
    if (meshDefs[a.meshes]?.primitives?.[a.primitives]?.material === undefined) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) authored.add(m);
  });
  return authored;
}

const snapshotColor = (c) => (c?.isColor ? c.clone() : null);

/**
 * Every distinct material under root, prepared for display: double-sided on
 * meshes, GLTFLoader's default marked `useThemeColor` (matte), and the GLB's
 * own values kept in userData.gltf so rules can be re-applied from scratch.
 * @returns {object[]} the distinct materials
 */
export function prepareMaterials(root, parser) {
  const authored = parser ? authoredMaterials(parser, root) : null;
  const seen = new Set();
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (o.isMesh) {
        m.side = DoubleSide;
        m.userData.onMesh = true;
      }
      if (seen.has(m)) continue;
      seen.add(m);
      const isDefault = authored ? !authored.has(m) : false;
      if (isDefault && m.isMeshStandardMaterial) {
        // white metal: black without an environment, chrome with one. It means "no material".
        m.metalness = 0;
        m.roughness = 0.75;
      }
      m.userData.useThemeColor = isDefault;
      m.userData.gltf = {
        color: snapshotColor(m.color),
        emissive: snapshotColor(m.emissive),
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: m.opacity,
        transparent: m.transparent,
        transmission: m.transmission,
      };
    }
  });
  return [...seen];
}

/**
 * Put back the GLB's values and apply the scene's rules on top; leaves the
 * results in userData.base* for applyDisplay (which layers the object's own
 * colour and opacity over them).
 */
export function applyMaterialRules(materials, rules) {
  for (const m of materials) {
    const g = m.userData.gltf;
    if (!g) continue;
    let needsUpdate = false;
    if (g.color && m.color) m.color.copy(g.color);
    if (g.emissive && m.emissive) m.emissive.copy(g.emissive);
    if (g.metalness !== undefined) m.metalness = g.metalness;
    if (g.roughness !== undefined) m.roughness = g.roughness;
    const beforeTransmission = m.transmission;
    if (g.transmission !== undefined) m.transmission = g.transmission;
    let opacity = g.opacity ?? 1;
    const set = m.userData.useThemeColor || !rules?.length ? {} : resolveMaterialSet(m.name ?? "", rules);
    if (set.color && m.color) m.color.set(set.color);
    if (set.emissive && m.emissive) m.emissive.set(set.emissive);
    if (set.metalness !== undefined && "metalness" in m) m.metalness = set.metalness;
    if (set.roughness !== undefined && "roughness" in m) m.roughness = set.roughness;
    if (set.transmission !== undefined && "transmission" in m) m.transmission = set.transmission;
    if (set.opacity !== undefined) opacity = set.opacity;
    // transmission 0 ↔ >0 switches shader programs
    if ("transmission" in m && (beforeTransmission > 0) !== (m.transmission > 0)) needsUpdate = true;
    m.userData.baseColor = m.color ? m.color.clone() : null;
    m.userData.baseOpacity = opacity;
    m.userData.baseTransparent = !!g.transparent || opacity < 1;
    if (needsUpdate) m.needsUpdate = true;
  }
}

/**
 * Collapse meshes that share a geometry and a material into one InstancedMesh
 * each, under `root`. root must be at identity (it isn't in a scene yet).
 * @returns {{ before: number, after: number, instanced: number }} draw calls (mesh-like nodes) before and after
 */
export function collapseInstances(root, minCount = 2) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!meshLike(o)) return;
    before++;
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences) return;
    // three picks the front face per object, not per instance (from the
    // object's own determinant), so a mirrored placement would be drawn
    // inside out as an instance: it stays a plain Mesh
    if (o.matrixWorld.determinant() < 0) return;
    const key = `${o.geometry.uuid}|${o.material.uuid}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(o);
  });
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  let instanced = 0;
  let removed = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < minCount) continue;
    const first = meshes[0];
    const im = new InstancedMesh(first.geometry, first.material, meshes.length);
    im.name = first.name || first.parent?.name || "instances";
    im.userData = { ...first.userData, instancedFrom: meshes.map((m) => m.name) };
    const m = new Matrix4();
    meshes.forEach((mesh, i) => {
      m.multiplyMatrices(inv, mesh.matrixWorld);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingBox();
    im.computeBoundingSphere();
    for (const mesh of meshes) mesh.removeFromParent();
    root.add(im);
    instanced++;
    removed += meshes.length - 1;
  }
  root.updateMatrixWorld(true);
  return { before, after: before - removed, instanced };
}

/** The first mesh's extras.legend (GLTFLoader puts extras in userData). Unchecked. */
export function findLegend(root) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.userData?.legend) found = o.userData.legend;
  });
  return found;
}

/** Triangles drawn, counting instances. */
export function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const per = g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
    n += per * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
}

/** Box of root's geometry in root's own frame (root must be at identity and not parented). */
export function localBox(root) {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  return box.isEmpty() ? null : box;
}

/**
 * Each drawn piece under root (a mesh, line or points object, or one instance
 * of an InstancedMesh) as its geometry's own box plus the matrix from that
 * geometry into root's frame. Boxing these one by one under a rotated object's
 * world matrix gives the same world box as boxing every mesh under its own
 * world matrix (tighter than rotating one box of the whole content).
 * @returns {{ box: Box3, matrix: Matrix4 }[]}
 */
export function localParts(root) {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  const inst = new Matrix4();
  root.traverse((o) => {
    if (!meshLike(o) || !o.geometry) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox || g.boundingBox.isEmpty()) return;
    const base = new Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, inst);
        parts.push({ box: g.boundingBox, matrix: base.clone().multiply(inst) });
      }
    } else parts.push({ box: g.boundingBox, matrix: base });
  });
  return parts;
}

/**
 * Bytes → display-ready content.
 * @returns {Promise<{ content, materials: object[], legend: object | null, box: Box3 | null, parts: { box, matrix }[],
 *   stats: { drawCalls: number, nodes: number, instanced: number, triangles: number, dequantized: number } }>}
 */
export async function prepareGLB(bytes, rules = []) {
  const gltf = await loadGLTF(bytes);
  const content = gltf.scene;
  const dequantized = dequantizePositions(content);
  const materials = prepareMaterials(content, gltf.parser);
  applyMaterialRules(materials, rules);
  const inst = collapseInstances(content);
  return {
    content,
    materials,
    legend: findLegend(content),
    box: localBox(content),
    parts: localParts(content),
    stats: { drawCalls: inst.after, nodes: inst.before, instanced: inst.instanced, triangles: countTriangles(content), dequantized },
  };
}

