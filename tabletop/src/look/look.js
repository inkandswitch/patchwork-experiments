// A piece → its GLB: what it looks like (GAME-FORMAT.md §4), drawn once and
// shown by every copy of it on every table.
//
// A piece is drawn one of two ways:
//   - from `parts`: boxes, tapered boxes and turned shapes (shapes.js), slabs
//     with images on them (slab.js: cards, tiles, tokens, boards) and models
//     (an OBJ file doc, obj.js), each placed at `at`, turned by `rotation`;
//   - as a document (`doc`): whatever `scene:source` draws that document's
//     type draws it (a die, by dice/source.js), found by the caller.
// Snap points become the scene's connectors (`extras.connectors`), whole
// frames and all (the scene keeps each one's rotation; table/slots.js reads
// it back from content(id).extras), and a snap radius `extras.snapRadius`.
//
// Files are read through the caller (`read(url)` → the file doc, or null),
// so nothing here knows a repo; images are decoded, cropped and encoded by an
// image backend (images.js in a browser; test/node-images.js in tests), so
// nothing here knows a canvas. A missing file never fails a drawing: the part
// is drawn without it (in its colour; a model as a see-through box) and a
// note says what was missing.
//
// `drawer(io)` keeps what it has decoded between pieces (a card sheet is read
// once for its seventy cards), a few images at a time, and may draw several
// pieces at once: it decodes up to `decodes` images at a time (decoding is
// most of what drawing costs a browser: ~40 ms a token, ~100 ms a sheet),
// and holds at most `held` decoded at once, in use or kept for the next
// piece (a 4096 × 2880 sheet is ~47 MB decoded), so its memory is bounded
// however many draw. An image is held for each use (a crop, a measure) and
// let go after; only one no draw is using is ever closed, the least recently
// used first, and a use that finds every image in use waits for one to be
// let go (a use holds one image, and never waits holding it).

import { computeNormals, encodeGLB } from "../glb.js";
import { partGeometry } from "../shapes.js";
import { composeMatrix } from "../table/frame.js";
import { parseOBJ } from "./obj.js";
import { outlineOf, slab } from "./slab.js";

// bump when the way a look becomes a GLB changes, so every GLB is drawn again
// 3: the format's looks (slabs, models, documents); rotation per part
// (not bumped for dropping extras["tabletop.slots"]: a GLB that still has it
// reads the same, from its connectors, and the key is ignored)
export const LOOK_VERSION = 3;

/** Everything a piece's GLB is drawn from, as one string: the same string, the same GLB. */
export function lookKey(piece) {
  return JSON.stringify({
    v: LOOK_VERSION,
    parts: piece?.parts ?? null,
    doc: piece?.doc ?? null,
    snapPoints: piece?.snapPoints ?? null,
    snapRadius: piece?.snapRadius ?? null,
  });
}

/**
 * A piece's snap points ({ position, rotation?, tags? }) as the scene's
 * connectors. A connector with tags takes only objects with one of them (the
 * hand's rule): a card slot is tagged "card", and so is every card.
 */
export function connectorsOf(points) {
  return (points ?? []).map((p) => {
    const tags = (Array.isArray(p?.tags) ? p.tags : []).filter((t) => typeof t === "string" && t);
    return {
      position: [...(p?.position ?? [0, 0, 0])].map(Number),
      ...(Array.isArray(p?.rotation) ? { rotation: p.rotation.map(Number) } : {}),
      ...(tags.length ? { tags: [...tags] } : {}),
    };
  });
}

/** The connectors and snap radius a piece's GLB carries. */
export function extrasOf(piece) {
  const extras = {};
  if (Array.isArray(piece?.snapPoints) && piece.snapPoints.length) extras.connectors = connectorsOf(piece.snapPoints);
  if (Number(piece?.snapRadius) > 0) extras.snapRadius = Number(piece.snapRadius);
  return extras;
}

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const colorOf = (c, d = "#cccccc") => (COLOR.test(String(c ?? "")) ? String(c).toLowerCase() : d);
const STAND_IN = "#a0a0a8b0"; // a see-through grey: a stand-in reads as one
/** How big an image may be drawn on a slab, by the slab's longest side (m): a card's face needs less than a board. */
export const textureSize = (longest) => (longest < 0.1 ? 512 : longest < 0.3 ? 1024 : 2048);
const MODEL_TEXTURE = 1024;
/** How big a picture a document's piece is given (a die's face: a centimetre or two across). */
const DOC_TEXTURE = 256;

/** Points and normals placed at `at`, turned by `rotation` (Euler XYZ), as a part says. */
function place(g, part) {
  const at = Array.isArray(part?.at) ? part.at.map(Number) : [0, 0, 0];
  const rot = Array.isArray(part?.rotation) ? part.rotation.map(Number) : null;
  if (!rot && at.every((v) => v === 0)) return g;
  const M = composeMatrix({ position: at, rotation: rot ?? [0, 0, 0], scale: 1 });
  const positions = new Array(g.positions.length);
  const normals = g.normals ? new Array(g.normals.length) : null;
  for (let i = 0; i < g.positions.length; i += 3) {
    const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
    positions[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
    positions[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    positions[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (normals) {
      const [a, b, c] = [g.normals[i], g.normals[i + 1], g.normals[i + 2]];
      normals[i] = M[0] * a + M[4] * b + M[8] * c;
      normals[i + 1] = M[1] * a + M[5] * b + M[9] * c;
      normals[i + 2] = M[2] * a + M[6] * b + M[10] * c;
    }
  }
  return { ...g, positions, normals };
}

/** The box round some primitives: { min, max }, or null. */
export function boundsOf(prims) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims)
    for (let i = 0; i < p.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

const round5 = (b) => (b ? { min: b.min.map((v) => +(+v).toFixed(5) + 0), max: b.max.map((v) => +(+v).toFixed(5) + 0) } : null);

/** A unit cube's corners → a box part (for a model that couldn't be read). */
const unitBox = () => partGeometry({ shape: "box", size: [1, 1, 1], at: [0, -0.5, 0] });

/**
 * Something that draws pieces, keeping what it has read between them.
 * @param {{
 *   read?: (url: string) => Promise<{ content: Uint8Array | string, mimeType?: string, extension?: string, origin?: { urls?: string[] } } | null>,
 *   images?: { open, crop, shape, close } | null,
 *   source?: (type: string) => Promise<{ build({ doc }): Promise<{ kind: string, glb: Uint8Array, meta?: { bounds? } }> } | null>,
 * }} io
 */
export function drawer({ read = async () => null, images = null, source = async () => null, decodes = 4, held = 6 } = {}) {
  const files = new Map(); // url → Promise<file doc | null>
  const crops = new Map(); // url|rect|max → Promise<crop | null>
  const meshes = new Map(); // url → Promise<parsed OBJ | null>

  const file = (url) => {
    if (!files.has(url)) files.set(url, Promise.resolve(read(url)).catch(() => null));
    return files.get(url);
  };
  const bytesOf = (f) => (f?.content instanceof Uint8Array ? f.content : typeof f?.content === "string" ? new TextEncoder().encode(f.content) : null);
  // ── decoded images: held for each use and let go after, at most `held` at once, `decodes` decoding at once ──
  const opened = new Map(); // url → { p: Promise<image handle | null>, uses, last }
  const room = []; // uses waiting for an image to be let go
  let tick = 0;
  let decoding = 0;
  const lanes = []; // decodes waiting for a lane
  let closed = false;
  const shut = (url, e) => {
    opened.delete(url);
    e.p.then((h) => h && images.close?.(h));
  };
  /** Close the least recently used image no draw is using: false if every one is in use. */
  const evict = () => {
    let old = null;
    for (const [u, e] of opened) if (e.uses === 0 && (!old || e.last < old[1].last)) old = [u, e];
    if (old) shut(...old);
    return !!old;
  };
  const decode = async (url) => {
    const f = await file(url);
    const bytes = bytesOf(f);
    if (!bytes) return null;
    if (decoding >= decodes) await new Promise((r) => lanes.push(r));
    decoding++;
    try {
      return await images.open(bytes, f.mimeType);
    } catch {
      return null;
    } finally {
      decoding--;
      lanes.shift()?.();
    }
  };
  /** Hold an image (decoding it if nothing has it): its entry, to let go of after. */
  const hold = async (url) => {
    for (;;) {
      const e = opened.get(url);
      if (e) {
        e.uses++;
        e.last = ++tick;
        return e;
      }
      if (opened.size < held || evict()) break;
      await new Promise((r) => room.push(r));
    }
    const e = { p: decode(url), uses: 1, last: ++tick };
    opened.set(url, e);
    return e;
  };
  const letGo = (url, e) => {
    if (--e.uses > 0) return;
    if (closed && opened.get(url) === e) shut(url, e);
    // every use waiting looks again (one may find its image held by another, and leave this one for the next)
    for (const r of room.splice(0)) r();
  };
  /** fn(the image, decoded) with it held throughout; null if there's no image. */
  const using = async (url, fn) => {
    if (!images) return null;
    const e = await hold(url);
    try {
      const h = await e.p;
      return h ? await fn(h) : null;
    } finally {
      letGo(url, e);
    }
  };
  const crop = (image, max) => {
    const r = image.rect ?? [0, 0, 1, 1];
    const key = `${image.file}|${r.join(",")}|${max}`;
    if (!crops.has(key)) crops.set(key, using(image.file, (h) => images.crop(h, { x: r[0], y: r[1], w: r[2], h: r[3] }, { maxSize: max })).catch(() => null));
    return crops.get(key);
  };
  const shapeOf = (image) => {
    const r = image.rect ?? [0, 0, 1, 1];
    return using(image.file, (h) => images.shape(h, { x: r[0], y: r[1], w: r[2], h: r[3] })).catch(() => null);
  };
  /** An image's width over its height, as it lies on its face (its cell of the sheet, turned), or null. */
  const aspectOf = async (image) => {
    const h = await using(image.file, (x) => ({ width: x.width, height: x.height })).catch(() => null);
    if (!h?.width || !h?.height) return null;
    const r = image.rect ?? [0, 0, 1, 1];
    const a = (h.width * r[2]) / (h.height * r[3]);
    return image.turn === 90 || image.turn === 270 ? 1 / a : a;
  };
  const mesh = (url) => {
    if (!meshes.has(url))
      meshes.set(
        url,
        file(url).then((f) => {
          if (!f || (f.extension && f.extension !== "obj")) return null;
          try {
            return parseOBJ(f.content);
          } catch {
            return null;
          }
        }),
      );
    return meshes.get(url);
  };

  /** Draw one piece: { glb, bounds, notes, origins }. */
  async function draw(piece) {
    const notes = [];
    const origins = new Set();
    const noteOrigin = async (url) => {
      for (const u of (await file(url))?.origin?.urls ?? []) if (typeof u === "string") origins.add(u);
    };

    // ── drawn as a document, by whatever draws its type ──
    if (piece?.doc) {
      const type = piece.doc?.["@patchwork"]?.type;
      const src = typeof type === "string" ? await Promise.resolve(source(type)).catch(() => null) : null;
      if (src?.build) {
        try {
          // what it shows from files (a die's pictured faces) is cropped here, read as any part's image is
          const image = async (im) => {
            if (!im?.file) return null;
            await noteOrigin(im.file);
            const t = images ? await crop({ file: im.file, rect: im.rect }, DOC_TEXTURE) : null;
            if (!t) notes.push(`missing image: ${im.file}`);
            return t;
          };
          const out = await src.build({ doc: piece.doc, image });
          if (out?.kind === "glb" && out.glb?.byteLength) return { glb: out.glb, bounds: round5(out.meta?.bounds ?? null), notes, origins: [...origins].sort() };
        } catch (err) {
          notes.push(`couldn't draw the ${type}: ${err?.message ?? err}`);
        }
      } else notes.push(`nothing installed here draws a “${type}”: drawn as a stand-in`);
      const g = partGeometry({ shape: "box", size: [0.02, 0.02, 0.02] });
      const prims = [{ ...g, material: { color: STAND_IN, roughness: 0.6 } }];
      return finish(piece, prims, [], notes, origins);
    }

    // ── drawn from parts ──
    const prims = []; // { positions, normals, uvs?, indices, material }
    const imgs = []; // the GLB's images
    const imageIndex = new Map(); // a crop → its index
    const texture = async (image, max, what) => {
      if (!image?.file) return null;
      await noteOrigin(image.file);
      if (!images) {
        notes.push(`no image backend: ${what} drawn without its image`);
        return null;
      }
      const t = await crop(image, max);
      if (!t) {
        notes.push(`missing ${what}: ${image.file}`);
        return null;
      }
      if (!imageIndex.has(t)) {
        imageIndex.set(t, imgs.length);
        imgs.push({ bytes: t.bytes, mimeType: t.mimeType });
      }
      return { index: imageIndex.get(t), hasAlpha: t.hasAlpha };
    };
    const faceMaterial = (tex, base) =>
      tex ? { texture: { image: tex.index, wrap: "clamp" }, color: "#ffffff", roughness: base.roughness ?? 0.7, metalness: base.metalness, ...(tex.hasAlpha ? { alphaMode: "MASK", alphaCutoff: 0.5 } : {}) } : base;

    for (const part of piece?.parts ?? []) {
      const base = { color: colorOf(part.color), roughness: part.roughness ?? 0.6, metalness: part.metalness };
      switch (part?.shape) {
        case "box":
        case "frustum":
        case "lathe": {
          const g = partGeometry({ ...part, at: [0, 0, 0] });
          if (g.positions.length) prims.push({ ...place(g, part), material: base });
          break;
        }
        case "slab": {
          const [w0, d] = (part.size ?? [0, 0]).map(Number);
          // as wide as its image says: size[0] is its width for a square image (a TTS tile or token stretched to its picture)
          const w = part.aspect === "image" && part.top ? w0 * ((await aspectOf(part.top)) ?? 1) : w0;
          const hx = w / 2;
          const hz = d / 2;
          const max = textureSize(Math.max(w, d));
          const top = await texture(part.top, max, "image");
          // a cut-out's other side is cut the same: without an image of its own, it shows its top's
          const bottom = part.bottom ? await texture(part.bottom, max, "back image") : part.outline === "cutout" ? top : null;
          let { outline, smooth } = outlineOf(part.outline, hx, hz);
          let sides = true;
          let cut = false;
          if (part.outline === "cutout") {
            const shape = part.top && images ? await shapeOf(part.top) : null;
            if (shape === "circle") ({ outline, smooth } = outlineOf("circle", hx, hz));
            else if (shape !== "opaque") [sides, cut] = [false, true];
          }
          const faces = slab(outline, Number(part.thickness) || 0, { hx, hz, sides, smoothSides: smooth, turns: { top: part.top?.turn, bottom: part.bottom?.turn } });
          const mat = { top: faceMaterial(top, base), bottom: faceMaterial(bottom, base), side: { ...base, color: colorOf(part.side, base.color) } };
          if (cut) for (const k of ["top", "bottom"]) if (mat[k].texture) mat[k] = { ...mat[k], alphaMode: "MASK", alphaCutoff: 0.5 };
          for (const f of faces) prims.push({ ...place(f, part), uvs: mat[f.slot].texture ? f.uvs : undefined, material: mat[f.slot] });
          break;
        }
        case "model": {
          await noteOrigin(part.file);
          const obj = await mesh(part.file);
          const M = Array.isArray(part.matrix) && part.matrix.length === 9 ? part.matrix.map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
          if (!obj || !obj.indices.length) {
            notes.push(`missing model: ${part.file}`);
            prims.push({ ...place(linear(unitBox(), M), part), material: { color: STAND_IN, roughness: 0.6 } });
            break;
          }
          const g = linear({ positions: Array.from(obj.positions), normals: obj.normals ? Array.from(obj.normals) : null, indices: Array.from(obj.indices) }, M);
          // OBJ's v runs up from the image's bottom; glTF's down from its top
          const uvs = obj.uvs ? Array.from(obj.uvs, (v, i) => (i % 2 ? 1 - v : v)) : null;
          const tex = part.texture && uvs ? await texture({ file: part.texture }, MODEL_TEXTURE, "model texture") : null;
          if (part.texture && !uvs) notes.push("model has no uvs: drawn without its texture");
          const mat = { ...base, ...(tex ? { texture: { image: tex.index } } : {}), ...(tex?.hasAlpha ? { alphaMode: "MASK", alphaCutoff: 0.5 } : {}) };
          prims.push({ ...place(g, part), uvs: tex ? uvs : undefined, material: mat });
          break;
        }
        default:
          break;
      }
    }
    return finish(piece, prims, imgs, notes, origins);
  }

  /** Let go of every image: those no draw is using now, those still in use when they're let go. */
  function close() {
    closed = true;
    for (const [u, e] of [...opened]) if (e.uses === 0) shut(u, e);
  }

  return { draw, close };
}

/** Points by a 3 × 3 matrix (row-major), normals by its inverse transpose; a mirror re-winds. */
function linear(g, M) {
  const [a, b, c, d, e, f, gg, h, i] = M;
  const det = a * (e * i - f * h) - b * (d * i - f * gg) + c * (d * h - e * gg);
  // cofactors: the inverse transpose, up to the determinant's scale (normals are renormalised)
  const N = [e * i - f * h, f * gg - d * i, d * h - e * gg, c * h - b * i, a * i - c * gg, b * gg - a * h, b * f - c * e, c * d - a * f, a * e - b * d];
  const positions = new Array(g.positions.length);
  for (let k = 0; k < g.positions.length; k += 3) {
    const [x, y, z] = [g.positions[k], g.positions[k + 1], g.positions[k + 2]];
    positions[k] = a * x + b * y + c * z;
    positions[k + 1] = d * x + e * y + f * z;
    positions[k + 2] = gg * x + h * y + i * z;
  }
  let normals = null;
  if (g.normals?.length) {
    const s = det < 0 ? -1 : 1;
    normals = new Array(g.normals.length);
    for (let k = 0; k < g.normals.length; k += 3) {
      const [x, y, z] = [g.normals[k], g.normals[k + 1], g.normals[k + 2]];
      const n = [N[0] * x + N[1] * y + N[2] * z, N[3] * x + N[4] * y + N[5] * z, N[6] * x + N[7] * y + N[8] * z].map((v) => v * s);
      const l = Math.hypot(...n) || 1;
      normals[k] = n[0] / l;
      normals[k + 1] = n[1] / l;
      normals[k + 2] = n[2] / l;
    }
  }
  let indices = g.indices ? [...g.indices] : Array.from({ length: positions.length / 3 }, (_, k) => k);
  if (det < 0) for (let k = 0; k + 2 < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]];
  return { positions, normals, indices };
}

/** Primitives sharing a material share a mesh: fewer draw calls for a board of twenty-five tiles. */
function finish(piece, prims, imgs, notes, origins) {
  const byMaterial = new Map();
  for (const p of prims) {
    const m = p.material;
    const key = JSON.stringify([m.color, m.roughness ?? null, m.metalness ?? null, m.texture?.image ?? null, m.alphaMode ?? null, !!p.uvs]);
    let g = byMaterial.get(key);
    if (!g) byMaterial.set(key, (g = { material: m, name: null, positions: [], normals: [], uvs: p.uvs ? [] : null, indices: [] }));
    const base = g.positions.length / 3;
    const n = p.positions.length / 3;
    const normals = p.normals?.length === p.positions.length && !hasZero(p.normals) ? p.normals : computeNormals(Float32Array.from(p.positions), Uint32Array.from(p.indices ?? Array.from({ length: n }, (_, k) => k)));
    for (let k = 0; k < p.positions.length; k++) g.positions.push(p.positions[k]);
    for (let k = 0; k < normals.length; k++) g.normals.push(normals[k]);
    if (g.uvs) for (let k = 0; k < n * 2; k++) g.uvs.push(p.uvs?.[k] ?? 0);
    const idx = p.indices ?? Array.from({ length: n }, (_, k) => k);
    for (const k of idx) g.indices.push(base + k);
  }
  const meshes = [...byMaterial.values()].map((g, k) => {
    const { color, roughness, metalness, texture, alphaMode, alphaCutoff } = g.material;
    return {
      name: `${String(piece?.name || "piece")}${k ? ` ${k + 1}` : ""}`,
      positions: new Float32Array(g.positions),
      normals: new Float32Array(g.normals),
      indices: new Uint32Array(g.indices),
      ...(g.uvs && texture ? { uvs: new Float32Array(g.uvs), texture } : {}),
      color,
      roughness: roughness ?? 0.6,
      ...(metalness != null ? { metallic: metalness } : {}),
      ...(alphaMode ? { alphaMode, ...(alphaCutoff != null ? { alphaCutoff } : {}) } : {}),
    };
  });
  const extras = extrasOf(piece);
  const glb = encodeGLB({ generator: "patchwork tabletop", images: imgs, meshes, ...(Object.keys(extras).length ? { extras } : {}) });
  return { glb, bounds: round5(boundsOf(meshes)), notes, origins: [...origins].sort() };
}

function hasZero(n) {
  for (let i = 0; i < n.length; i += 3) if (n[i] === 0 && n[i + 1] === 0 && n[i + 2] === 0) return true;
  return false;
}

/** A short hash of a string (FNV-1a, two 32-bit lanes), for keys: a look's file in a scene's assets. */
export function shortHash(s) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** A file doc's name for a piece's GLB. */
export const glbName = (piece) => `${String(piece?.name || "piece").replace(/[\\/:]/g, "-")}.glb`;
