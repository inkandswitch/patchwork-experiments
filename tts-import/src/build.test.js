// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";
import { buildKind, d6Faces, faceUpAt } from "./build.js";
import { parseGLB } from "./glb.js";
import { CARD } from "./kinds.js";
import { parseOBJ } from "./obj.js";
import { nodeImages } from "./test/node-images.js";
import { decodePNG, solidPNG } from "./test/png.js";

const U = 0.0254;

beforeAll(() => {
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap = async (blob) => {
    const img = decodePNG(new Uint8Array(await blob.arrayBuffer()));
    return { width: img.width, height: img.height, data: img.data, close() {} };
  };
});

function load(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, "", resolve, reject));
}

/** A build context over in-memory assets: url → PNG bytes; meshes: url → OBJ text. */
function ctxFor(imagesByUrl = {}, meshesByUrl = {}) {
  const images = nodeImages();
  const handles = new Map();
  const open = async (url) => {
    if (!imagesByUrl[url]) return null;
    if (!handles.has(url)) handles.set(url, await images.open(imagesByUrl[url], "image/png"));
    return handles.get(url);
  };
  return {
    images,
    unit: U,
    async texture(url, rect, max) {
      const h = await open(url);
      return h ? images.crop(h, rect, { maxSize: max }) : null;
    },
    async imageSize(url) {
      const h = await open(url);
      return h && { width: h.width, height: h.height };
    },
    async shape(url) {
      const h = await open(url);
      return h ? images.shape(h, { x: 0, y: 0, w: 1, h: 1 }) : null;
    },
    async mesh(url) {
      return meshesByUrl[url] ? parseOBJ(meshesByUrl[url]) : null;
    },
  };
}

/** A 2 × 1 sheet: left cell red, right cell green. */
const sheet = solidPNG(8, 4, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
const back = solidPNG(2, 2, [0, 0, 255, 255]);

describe("buildKind", () => {
  it("draws a card: its own cell on top, the back underneath, card-sized, through GLTFLoader", async () => {
    const ctx = ctxFor({ s: sheet, b: back });
    const out = await buildKind({ type: "card", scale: [1, 1, 1], face: { url: "s", rect: { x: 0.5, y: 0, w: 0.5, h: 1 } }, back: { url: "b", rect: { x: 0, y: 0, w: 1, h: 1 } } }, ctx);
    expect(out.notes).toEqual([]);
    expect(out.bounds.max[0] - out.bounds.min[0]).toBeCloseTo(CARD.w * U, 6);
    expect(out.bounds.max[2] - out.bounds.min[2]).toBeCloseTo(CARD.l * U, 6);
    expect(ctx.images.log.crops[0]).toMatchObject({ sx: 4, sy: 0, sw: 4, sh: 4 }); // the right-hand cell
    const gltf = await load(out.glb);
    const top = gltf.scene.getObjectByName("top");
    const bottom = gltf.scene.getObjectByName("bottom");
    expect([...top.material.map.image.data.subarray(0, 4)]).toEqual([0, 255, 0, 255]); // green: the right cell
    expect([...bottom.material.map.image.data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    top.geometry.computeBoundingBox();
    expect(top.geometry.boundingBox.min.y).toBeGreaterThan(0);
    expect(bottom.geometry.getAttribute("normal").getY(0)).toBeCloseTo(-1);
  });

  it("a missing image still draws the piece, plainly, and says so", async () => {
    const out = await buildKind({ type: "card", scale: [1, 1, 1], face: { url: "nope", rect: { x: 0, y: 0, w: 1, h: 1 } }, back: { url: "nope2", rect: { x: 0, y: 0, w: 1, h: 1 } } }, ctxFor());
    expect(out.notes).toEqual(["missing card face: nope", "missing card back: nope2"]);
    expect(parseGLB(out.glb).json.images).toBeUndefined();
  });

  it("sizes a tile by its image (stretch), sits it on its bottom face, bakes scale, and carries snap points as connectors (rotation, tags)", async () => {
    const img = solidPNG(20, 10, [200, 200, 200, 255]);
    const kind = { type: "tile", scale: [3, 1, 3], top: "t", bottom: null, thickness: 0.2, tileType: 0, stretch: true, color: "#336699", snaps: [{ position: [0.5, 0.2, -0.5], rotation: [0, 90, 0], tags: ["Coin"] }, { position: [0, 0.2, 0], rotation: null, tags: [] }] };
    const out = await buildKind(kind, ctxFor({ t: img }));
    // 2·aspect × 2 at scale 1 → 12 × 6 units at scale 3; 0.2 thick from y = 0
    expect(out.bounds.max[0] - out.bounds.min[0]).toBeCloseTo(12 * U, 6);
    expect(out.bounds.max[2] - out.bounds.min[2]).toBeCloseTo(6 * U, 6);
    expect(out.bounds.min[1]).toBeCloseTo(0, 6);
    expect(out.bounds.max[1]).toBeCloseTo(0.2 * U, 6);
    const { json } = parseGLB(out.glb);
    const [a, b] = json.scenes[0].extras.connectors;
    expect(a.position).toEqual([+(1.5 * U).toFixed(5), +(0.2 * U).toFixed(5), +(1.5 * U).toFixed(5)]);
    expect(a.rotation[1]).toBeCloseTo(-Math.PI / 2, 5); // TTS +90° about Y is the scene's −90° (mirrored z)
    expect(a.tags).toEqual(["Coin"]);
    expect(b).toEqual({ position: [0, +(0.2 * U).toFixed(5), 0] });
  });

  it("tokens: a round alpha image becomes a disc, cut out with an alpha mask", async () => {
    const round = solidPNG(32, 32, (x, y) => (Math.hypot(x - 15.5, y - 15.5) < 15 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const out = await buildKind({ type: "token", scale: [1, 1, 1], top: "r", bottom: null, thickness: 0.2, color: "#ffffff", snaps: [] }, ctxFor({ r: round }));
    const { json } = parseGLB(out.glb);
    expect(json.materials.some((m) => m.alphaMode === "MASK")).toBe(true);
    expect(json.meshes.find((m) => m.name === "side")).toBeTruthy(); // a disc has sides
    expect(out.bounds.min[1]).toBeCloseTo(-0.1 * U, 6); // tokens are centred
  });

  it("models: OBJ mirrored in x as TTS loads it, uvs flipped for glTF, textured", async () => {
    const obj = "v 1 0 0\nv 2 0 0\nv 1 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1\n";
    const out = await buildKind({ type: "model", scale: [1, 1, 1], mesh: "m", diffuse: "d", color: "#ffffff", material: 0, snaps: [] }, ctxFor({ d: back }, { m: obj }));
    const gltf = await load(out.glb);
    const mesh = gltf.scene.getObjectByName("model");
    const box = new Box3().setFromBufferAttribute(mesh.geometry.getAttribute("position"));
    // OBJ x = 1..2 → TTS x = -2..-1 → scene x = -2..-1
    expect(box.min.x).toBeCloseTo(-2 * U);
    expect(box.max.x).toBeCloseTo(-1 * U);
    const uv = mesh.geometry.getAttribute("uv");
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 1]); // OBJ (0, 0) is the image's bottom left
    expect(mesh.material.map).toBeTruthy();
    // two mirrors (x on load, z into the scene) make a half turn about y: the OBJ's +z face now faces -z
    const n = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), 0);
    expect(n.z).toBeCloseTo(-1);
  });

  it("a missing model is a stand-in box, noted", async () => {
    const out = await buildKind({ type: "model", scale: [1, 1, 1], mesh: "gone", diffuse: null, color: "#ffffff", material: 0, snaps: [] }, ctxFor());
    expect(out.notes).toEqual(["missing model: gone"]);
  });

  it("dice: which face is up at which rotation, pips on a standard d6, solids for the rest", async () => {
    expect(faceUpAt([0, 0, 0])).toBe("+y");
    expect(faceUpAt([-90, 0, 0])).toBe("+z");
    expect(faceUpAt([0, 0, 180])).toBe("-y");
    // value 3 at (0, 0, -90): Rz(-90) takes -x to +y. Opposite faces add up to 7.
    expect(d6Faces(null)).toEqual({ "+z": "1", "+y": "2", "-x": "3", "+x": "4", "-y": "5", "-z": "6" });
    const d6 = await buildKind({ type: "die", scale: [1, 1, 1], sides: 6, image: null, color: "#ffffff", faces: [] }, ctxFor());
    expect(parseGLB(d6.glb).json.meshes.filter((m) => m.name === "pip")).toHaveLength(21);
    const d20 = await buildKind({ type: "die", scale: [1, 1, 1], sides: 20, image: null, color: "#ff0000", faces: [] }, ctxFor());
    expect(d20.triangles).toBe(20);
    const d10 = await buildKind({ type: "die", scale: [1, 1, 1], sides: 10, image: null, color: "#ff0000", faces: [] }, ctxFor());
    expect(d10.triangles).toBe(20);
  });
});
