// bytes + extension → a three.js Object3D, Y-up. One place that knows formats.
import { loadThree } from "./three.js";

export const FORMATS = ["glb", "gltf", "stl", "3mf", "3dm", "obj", "ply"];
const Z_UP = new Set(["stl", "3mf", "ply"]);

const buf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const text = (b) => (typeof b === "string" ? b : new TextDecoder().decode(b));

export function fileBytes(doc) {
  const c = doc?.content;
  if (c == null) throw new Error("file has no content");
  if (c instanceof Uint8Array) return c;
  if (ArrayBuffer.isView(c)) return new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  return new TextEncoder().encode(String(c));
}

export function extOf(doc) {
  const e = doc?.extension || String(doc?.name ?? "").split(".").pop();
  return String(e ?? "").toLowerCase().replace(/^\./, "");
}

/** Returns { object, notes }. */
export async function loadModel(bytes, ext) {
  const T = await loadThree();
  const { THREE } = T;
  const gltf = (ab) => new Promise((res, rej) => new T.GLTFLoader().parse(ab, "", res, rej));
  const material = () => new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  let object, notes = "";
  switch (ext) {
    case "glb":
    case "gltf":
      object = (await gltf(ext === "glb" ? buf(bytes) : text(bytes))).scene;
      break;
    case "3dm": {
      const { convertOffThread } = await import("./offthread.js");
      const r = await convertOffThread(bytes, {}, "model");
      object = (await gltf(buf(r.glb))).scene;
      notes = r.meta.notes;
      break;
    }
    case "stl": {
      const g = new T.STLLoader().parse(buf(bytes));
      if (!g.attributes.normal) g.computeVertexNormals();
      const m = g.hasColors ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) : material();
      object = new THREE.Mesh(g, m);
      notes = `${(g.attributes.position.count / 3).toLocaleString()} triangles`;
      break;
    }
    case "3mf":
      object = new T.ThreeMFLoader().parse(buf(bytes));
      break;
    case "obj":
      object = new T.OBJLoader().parse(text(bytes));
      object.traverse((o) => { if (o.isMesh && !o.material?.map) o.material = material(); });
      break;
    case "ply": {
      const g = new T.PLYLoader().parse(buf(bytes));
      if (!g.attributes.normal) g.computeVertexNormals();
      object = new THREE.Mesh(g, g.attributes.color ? new THREE.MeshStandardMaterial({ vertexColors: true }) : material());
      break;
    }
    default:
      throw new Error(`Can't show .${ext} files (supported: ${FORMATS.join(", ")})`);
  }
  if (Z_UP.has(ext)) {
    const g = new THREE.Group();
    object.rotation.x = -Math.PI / 2;
    g.add(object);
    object = g;
  }
  if (!notes) {
    let tris = 0;
    object.traverse((o) => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    notes = `${Math.round(tris).toLocaleString()} triangles`;
  }
  return { object, notes };
}
