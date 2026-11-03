// A kind (kinds.js) → a GLB: geometry in the TTS frame (shapes.js), baked
// into the scene's frame, textured with the kind's images.
//
// `ctx` gives the assets, already resolved; every accessor returns null for a
// missing asset, and the kind is still drawn (untextured, in its colour) with
// a note saying what was missing:
//   ctx.unit                         metres per TTS unit
//   ctx.texture(url, rect, maxSize)  → { bytes, mimeType, width, height, hasAlpha } | null
//   ctx.imageSize(url)               → { width, height } | null
//   ctx.shape(url)                   → "opaque" | "circle" | "cutout" | null
//   ctx.mesh(url)                    → parsed OBJ (obj.js) | null
//   ctx.flipObjX                     TTS mirrors x when it loads an OBJ, as Unity's importer does (default true)
//   ctx.sizes                        max texture sizes { card, tile, board, model }

import { bake, box, ellipseOutline, hexOutline, lathe, partsBounds, polyhedron, rectOutline, roundedOutline, slab, translateParts } from "./shapes.js";
import { bakePoint, convertYaw, unityRotation, transpose, applyMat3 } from "./convert.js";
import { computeNormals, encodeGLB } from "./glb.js";
import { BOARD_HALF, CARD, DIE6 } from "./kinds.js";

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const SIZES = { card: 512, tile: 1024, board: 2048, model: 1024, die: 512 };
const PAPER = "#f2f0ea";

/** Model MaterialIndex → PBR: 0 plastic, 1 wood, 2 metal, 3 cardboard, 4 glass. */
const MATERIALS = [
  { roughness: 0.45, metallic: 0 },
  { roughness: 0.75, metallic: 0 },
  { roughness: 0.35, metallic: 0.8 },
  { roughness: 0.9, metallic: 0 },
  { roughness: 0.1, metallic: 0 },
];

/** Standard pip layouts on a face, in [-1, 1]². */
const PIPS = {
  1: [[0, 0]],
  2: [[-0.5, -0.5], [0.5, 0.5]],
  3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  6: [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0], [0.5, 0], [-0.5, 0.6], [0.5, 0.6]],
};
/** TTS's own d6: which value is up at which rotation (from real saves' RotationValues). */
const D6_DEFAULT = [
  { value: "1", rotation: [-90, 0, 0] },
  { value: "2", rotation: [0, 0, 0] },
  { value: "3", rotation: [0, 0, -90] },
  { value: "4", rotation: [0, 0, 90] },
  { value: "5", rotation: [0, 0, -180] },
  { value: "6", rotation: [90, 0, 0] },
];
/** Custom d6 image: TTS's template (Modding/Dice Templates/D6.png) is 3 × 3 cells, values in the lower two rows. */
const D6_CELLS = { 2: [0, 1], 4: [1, 1], 5: [2, 1], 1: [0, 2], 3: [1, 2], 6: [2, 2] };
const FACE_KEYS = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };

/** Which cube face (in the die's own frame) is up when a die is turned to `rotation` (TTS degrees). */
export function faceUpAt(rotation) {
  const n = applyMat3(transpose(unityRotation(rotation)), [0, 1, 0]);
  let best = "+y", bestDot = -Infinity;
  for (const [k, v] of Object.entries(FACE_KEYS)) {
    const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    if (d > bestDot) [best, bestDot] = [k, d];
  }
  return best;
}

/** Value → face key for a d6, from its RotationValues (or TTS's default). */
export function d6Faces(faces) {
  const list = faces?.length === 6 ? faces : D6_DEFAULT;
  const out = {};
  for (const f of list) out[faceUpAt(f.rotation)] = String(f.value);
  return out;
}

function pipParts(faceValues, size) {
  const h = size / 2;
  const parts = [];
  for (const [key, value] of Object.entries(faceValues)) {
    const pips = PIPS[Number(value)];
    if (!pips) continue;
    const n = FACE_KEYS[key];
    const axis = n.findIndex((v) => v !== 0);
    const [ua, va] = [0, 1, 2].filter((k) => k !== axis);
    for (const [pu, pv] of pips) {
      const centre = [0, 0, 0];
      centre[axis] = n[axis] * (h + 0.004);
      centre[ua] = pu * h * 0.55;
      centre[va] = pv * h * 0.55;
      const r = size * 0.09;
      const sz = [0, 0, 0].map((_, k) => (k === axis ? 0.004 : r * 2));
      parts.push(...translateParts(box(sz[0], sz[1], sz[2], { slot: "pip", name: "pip" }), centre));
    }
  }
  return parts;
}

/** Build a kind. Returns { glb, bounds, triangles, notes }. */
export async function buildKind(kind, ctx) {
  const unit = ctx.unit ?? 0.0254;
  const sizes = { ...SIZES, ...(ctx.sizes ?? {}) };
  const notes = [];
  const images = [];
  const imageIndex = new Map();
  const tex = async (url, rect, max, role) => {
    if (!url) return null;
    const t = await ctx.texture(url, rect ?? FULL, max);
    if (!t) {
      notes.push(`missing ${role ?? "image"}: ${url}`);
      return null;
    }
    if (!imageIndex.has(t)) {
      imageIndex.set(t, images.length);
      images.push({ bytes: t.bytes, mimeType: t.mimeType });
    }
    return { index: imageIndex.get(t), hasAlpha: t.hasAlpha, width: t.width, height: t.height };
  };
  const aspectOf = async (url) => {
    const s = url ? await ctx.imageSize(url) : null;
    return s && s.width > 0 && s.height > 0 ? s.width / s.height : null;
  };

  let parts = [];
  const materials = {}; // slot → primitive material fields
  let snapPoints = [];
  let snapFrameX = 1; // board snap points: x before WidthScale

  switch (kind.type) {
    case "card": {
      const face = await tex(kind.face.url, kind.face.rect, sizes.card, "card face");
      const back = await tex(kind.back.url, kind.back.rect, sizes.card, "card back");
      parts = slab(rectOutline(CARD.w / 2, CARD.l / 2), CARD.t);
      materials.top = face ? { texture: { image: face.index, wrap: "clamp" }, color: "#ffffff", roughness: 0.6 } : { color: PAPER };
      materials.bottom = back ? { texture: { image: back.index, wrap: "clamp" }, color: "#ffffff", roughness: 0.6 } : { color: "#8a8478" };
      materials.side = { color: PAPER, roughness: 0.8 };
      break;
    }
    case "tile":
    case "token":
    case "board": {
      const isBoard = kind.type === "board";
      const max = isBoard ? sizes.board : sizes.tile;
      const top = await tex(kind.top, FULL, max, `${kind.type} image`);
      const bottom = kind.bottom ? await tex(kind.bottom, FULL, max, `${kind.type} back`) : top;
      let hx, hz;
      if (isBoard) {
        hz = BOARD_HALF;
        hx = BOARD_HALF * kind.widthScale;
        snapFrameX = kind.widthScale;
      } else {
        const aspect = (await aspectOf(kind.top)) ?? 1;
        hz = 1;
        hx = kind.stretch ? aspect : 1;
      }
      const t = isBoard ? 0.2 : kind.thickness;
      let outline = rectOutline(hx, hz);
      let smooth = false;
      let sides = true;
      let alphaMode = null;
      if (kind.type === "tile") {
        if (kind.tileType === 1) outline = hexOutline(hx, hz);
        else if (kind.tileType === 2) [outline, smooth] = [ellipseOutline(hx, hz), true];
        else if (kind.tileType === 3) outline = roundedOutline(hx, hz, Math.min(hx, hz) * 0.12);
      } else if (kind.type === "token" && top?.hasAlpha) {
        const shape = await ctx.shape(kind.top);
        if (shape === "circle") [outline, smooth, alphaMode] = [ellipseOutline(hx, hz), true, "MASK"];
        else if (shape === "cutout") [sides, alphaMode] = [false, "MASK"];
      }
      parts = slab(outline, t, { hx, hz, sides, smoothSides: smooth });
      // A tile's origin is its bottom face (real saves: tiles lying on the table
      // have posY = the table top, and their snap points sit at y = Thickness);
      // a token's is its middle (a 0.2 token on a mat rests 0.1 above the mat).
      if (kind.type === "tile") parts = translateParts(parts, [0, t / 2, 0]);
      const face = (img) => (img ? { texture: { image: img.index, wrap: "clamp" }, color: kind.type === "token" ? kind.color : "#ffffff", roughness: 0.7, ...(alphaMode ? { alphaMode, alphaCutoff: 0.5 } : {}) } : { color: kind.color });
      materials.top = face(top);
      materials.bottom = face(bottom);
      materials.side = { color: kind.color, roughness: 0.8 };
      snapPoints = kind.snaps ?? [];
      break;
    }
    case "figurine": {
      const front = await tex(kind.front, FULL, sizes.tile, "figurine image");
      const back = kind.back ? await tex(kind.back, FULL, sizes.tile, "figurine back") : front;
      const aspect = (await aspectOf(kind.front)) ?? 0.6;
      const height = 2 * kind.imageScalar;
      const hw = (height * aspect) / 2;
      const base = 0.12;
      // the image stands in the xy plane facing -z (towards the seats), on a round base
      const stand = slab(rectOutline(hw, height / 2), 0.03, { hx: hw, hz: height / 2 }).map((p) => ({
        ...p,
        // the slab lies in xz with its image's top at -z; stand it up with a
        // half turn about (0, 1, -1): (x, y, z) → (-x, -z, -y) — a rotation, so
        // nothing is mirrored — facing -z, the image's top up
        positions: p.positions.map((v, i, a) => (i % 3 === 0 ? -v : i % 3 === 1 ? -a[i + 1] + height / 2 + base : -a[i - 1])),
        normals: p.normals.map((v, i, a) => (i % 3 === 0 ? -v : i % 3 === 1 ? -a[i + 1] : -a[i - 1])),
        slot: p.slot === "top" ? "front" : p.slot === "bottom" ? "back" : "edge",
      }));
      parts = [...stand, ...slab(ellipseOutline(Math.max(0.4, hw * 0.8), Math.max(0.4, hw * 0.8), 32), base, { smoothSides: true }).map((p) => ({ ...translateParts([p], [0, base / 2, 0])[0], slot: "base" }))];
      materials.front = front ? { texture: { image: front.index, wrap: "clamp" }, color: "#ffffff", roughness: 0.7, ...(front.hasAlpha ? { alphaMode: "MASK" } : {}) } : { color: PAPER };
      materials.back = back ? { texture: { image: back.index, wrap: "clamp" }, color: "#ffffff", roughness: 0.7, ...(back.hasAlpha ? { alphaMode: "MASK" } : {}) } : { color: PAPER };
      materials.edge = { color: PAPER };
      materials.base = { color: "#2b2b2b", roughness: 0.5 };
      break;
    }
    case "model": {
      const obj = await ctx.mesh(kind.mesh);
      if (!obj || !obj.indices.length) {
        notes.push(`missing model: ${kind.mesh}`);
        parts = box(1, 1, 1, { name: "missing model" });
        materials.body = { color: kind.color, roughness: 0.6 };
        break;
      }
      const flip = ctx.flipObjX !== false;
      const positions = Array.from(obj.positions);
      const normals = obj.normals ? Array.from(obj.normals) : [];
      const indices = Array.from(obj.indices);
      if (flip) {
        for (let i = 0; i < positions.length; i += 3) positions[i] = -positions[i];
        for (let i = 0; i < normals.length; i += 3) normals[i] = -normals[i];
        for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      }
      const uvs = obj.uvs ? Array.from(obj.uvs, (v, i) => (i % 2 ? 1 - v : v)) : [];
      parts = [{ name: "model", slot: "body", positions, normals, uvs, indices }];
      const diffuse = kind.diffuse && obj.uvs ? await tex(kind.diffuse, FULL, sizes.model, "model texture") : null;
      if (kind.diffuse && !obj.uvs) notes.push("model has no uvs: drawn without its texture");
      const pbr = MATERIALS[kind.material] ?? MATERIALS[0];
      materials.body = { ...pbr, color: kind.color, ...(diffuse ? { texture: { image: diffuse.index } } : {}), ...(diffuse?.hasAlpha ? { alphaMode: "MASK" } : {}) };
      snapPoints = kind.snaps ?? [];
      break;
    }
    case "die": {
      if (kind.sides === 6) {
        const faces = d6Faces(kind.faces);
        const img = kind.image ? await tex(kind.image, FULL, sizes.die, "die image") : null;
        if (img) {
          const uv = (key) => {
            const [c, r] = D6_CELLS[faces[key]] ?? [0, 0];
            return { x: c / 3, y: r / 3, w: 1 / 3, h: 1 / 3 };
          };
          parts = box(DIE6, DIE6, DIE6, { faceUV: uv, name: "d6" });
          materials.body = { texture: { image: img.index, wrap: "clamp" }, color: "#ffffff", roughness: 0.5 };
        } else {
          parts = [...box(DIE6, DIE6, DIE6, { name: "d6" }), ...pipParts(faces, DIE6)];
          materials.body = { color: kind.color, roughness: 0.45 };
          const lum = parseInt(kind.color.slice(1, 3), 16) + parseInt(kind.color.slice(3, 5), 16) + parseInt(kind.color.slice(5, 7), 16);
          materials.pip = { color: lum > 380 ? "#1b1b1b" : "#f4f1ea", roughness: 0.6 };
        }
      } else {
        parts = polyhedron(kind.sides, 0.75);
        materials.body = { color: kind.color, roughness: 0.45 };
        if (kind.image) notes.push(`d${kind.sides} faces are not textured`);
      }
      break;
    }
    case "bag": {
      parts = lathe([[0, 0], [0.9, 0], [1.1, 0.5], [1, 1.2], [0.55, 1.6], [0.65, 1.8], [0, 1.8]], { name: "bag" });
      parts = translateParts(parts, [0, -0.9, 0]);
      materials.body = { color: kind.color, roughness: 0.95 };
      break;
    }
    case "piece": {
      const look = kind.look ?? {};
      const color = look.color ?? kind.color ?? "#d0c8b8";
      if (look.shape === "pawn") {
        const h = look.height ?? 1.4;
        parts = translateParts(lathe([[0, 0], [0.32 * h, 0], [0.3 * h, 0.08 * h], [0.14 * h, 0.2 * h], [0.1 * h, 0.62 * h], [0.2 * h, 0.75 * h], [0.17 * h, 0.92 * h], [0, h]], { name: "pawn" }), [0, -h / 2, 0]);
      } else if (look.shape === "disc") {
        parts = slab(ellipseOutline(look.radius, look.radius, 32), look.height, { smoothSides: true }).map((p) => ({ ...p, slot: "body" }));
      } else if (look.shape === "bowl") {
        parts = translateParts(lathe([[0, 0], [1, 0], [1.6, 0.6], [1.5, 0.62], [0.9, 0.08], [0, 0.08]], { name: "bowl" }), [0, -0.3, 0]);
      } else {
        const [x, y, z] = look.size ?? [0.6, 0.6, 0.6];
        parts = box(x, y, z, { name: "piece" });
      }
      materials.body = { color, roughness: 0.5 };
      break;
    }
    case "table": {
      // its top at y = 0, so things rest on it where the mod had them
      const t = 0.5;
      const img = kind.image ? await tex(kind.image, FULL, sizes.board, "table image") : null;
      parts = translateParts(slab(rectOutline(kind.hx, kind.hz), t), [0, -t / 2, 0]);
      materials.top = img ? { texture: { image: img.index, wrap: "clamp" }, color: "#ffffff", roughness: 0.9 } : { color: "#4d6b56", roughness: 0.95 };
      materials.bottom = { color: "#3b2e24" };
      materials.side = { color: "#5a4535", roughness: 0.7 };
      snapPoints = kind.snaps ?? [];
      break;
    }
    case "pdf": {
      parts = slab(rectOutline(0.85 * 1.3, 1.1 * 1.3), 0.04).map((p) => ({ ...p, slot: p.slot === "side" ? "side" : "page" }));
      materials.page = { color: "#fbfaf6", roughness: 0.9 };
      materials.side = { color: "#d8d4c8" };
      break;
    }
    case "placeholder":
    default: {
      const [x, y, z] = kind.size ?? [0.6, 0.6, 0.6];
      parts = box(x, y, z, { name: "placeholder" });
      // see-through, so a stand-in reads as one
      materials.body = { color: `${kind.color ?? "#a0a0a8"}b0`, roughness: 0.6 };
      break;
    }
  }

  const baked = bake(parts, kind.scale ?? [1, 1, 1], unit);
  const meshes = baked.map((p) => {
    const m = materials[p.slot] ?? materials.body ?? { color: "#cccccc" };
    let normals = p.normals;
    if (!normals || normals.every((v) => v === 0) || hasZeroNormal(normals)) normals = computeNormals(p.positions, p.indices);
    return { name: p.name, positions: p.positions, normals, indices: p.indices, ...(m.texture != null && p.uvs ? { uvs: p.uvs } : {}), ...(m.texture != null && !p.uvs ? omit(m, "texture") : m) };
  });
  const extras = {};
  if (snapPoints.length) {
    extras.snapPoints = snapPoints.map((s) => {
      const position = bakePoint([s.position[0] * snapFrameX, s.position[1], s.position[2]], kind.scale ?? [1, 1, 1], unit).map((v) => +v.toFixed(5));
      return s.yaw == null ? position : { position, yaw: convertYaw(s.yaw) };
    });
  }
  const glb = encodeGLB({ generator: "patchwork tts-import", images, meshes, ...(Object.keys(extras).length ? { extras } : {}) });
  const bounds = partsBounds(baked.map((p) => ({ positions: p.positions })));
  const triangles = baked.reduce((s, p) => s + p.indices.length / 3, 0);
  return { glb, bounds: bounds && { min: bounds.min.map((v) => +v.toFixed(5)), max: bounds.max.map((v) => +v.toFixed(5)) }, triangles, notes };
}

function hasZeroNormal(n) {
  for (let i = 0; i < n.length; i += 3) if (n[i] === 0 && n[i + 1] === 0 && n[i + 2] === 0) return true;
  return false;
}
const omit = (o, k) => {
  const { [k]: _, ...rest } = o;
  return rest;
};
