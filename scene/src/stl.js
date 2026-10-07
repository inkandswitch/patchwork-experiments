// STL (binary and ASCII) → triangle soup, plus unit / up-axis conversion to the
// scene's Y-up metres. Pure; no three.

import { UNITS } from "./units.js";

const decoder = new TextDecoder();

/** Accept Uint8Array | ArrayBuffer | string | anything with toString (ImmutableString). */
function toBytesOrText(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === "string") return input;
  if (input != null && typeof input.toString === "function") return String(input);
  throw new Error("STL: no content");
}

/** Binary iff the size matches the triangle count in the header. */
export function isBinarySTL(bytes) {
  if (bytes.byteLength < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 === bytes.byteLength) return true;
  // Some exporters pad or truncate; fall back to "doesn't look like ASCII".
  const head = decoder.decode(bytes.subarray(0, Math.min(bytes.byteLength, 512))).trimStart();
  const looksAscii = /^solid\b/i.test(head) && /facet|endsolid/i.test(decoder.decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096))));
  return !looksAscii && 84 + n * 50 <= bytes.byteLength;
}

function parseBinary(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const positions = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const base = 84 + t * 50 + 12; // skip the stored normal
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = dv.getFloat32(base + k * 4, true);
  }
  const header = decoder.decode(bytes.subarray(0, 80)).replace(/\0+$/, "").trim();
  return { positions, name: header.replace(/^solid\s*/i, "").trim() || null };
}

function parseAscii(text) {
  const out = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (out.length % 9) throw new Error(`STL: ${out.length / 3} vertices is not a whole number of triangles`);
  if (out.some((v) => !Number.isFinite(v))) throw new Error("STL: unreadable vertex coordinate");
  const name = /^\s*solid[ \t]*([^\r\n]*)/i.exec(text)?.[1]?.trim() || null;
  return { positions: Float32Array.from(out), name };
}

/**
 * @returns {{ positions: Float32Array, triangles: number, name: string | null, format: "binary" | "ascii" }}
 *   positions are a triangle soup in the file's own units and axes.
 */
export function parseSTL(input) {
  const data = toBytesOrText(input);
  let result;
  let format;
  if (typeof data === "string") {
    result = parseAscii(data);
    format = "ascii";
  } else if (isBinarySTL(data)) {
    result = parseBinary(data);
    format = "binary";
  } else {
    result = parseAscii(decoder.decode(data));
    format = "ascii";
  }
  return { ...result, triangles: result.positions.length / 9, format };
}

/**
 * Convert positions in place-safe fashion (returns a new array) from the file's
 * unit/up-axis to Y-up metres. Z-up → Y-up is a −90° turn about X:
 * (x, y, z) ↦ (x, z, −y), which keeps handedness and so keeps winding.
 */
export function toYUpMeters(positions, { unit = "mm", up = "z" } = {}) {
  const s = UNITS[unit] ?? 1;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * s;
    const y = positions[i + 1] * s;
    const z = positions[i + 2] * s;
    if (up === "z") {
      out[i] = x;
      out[i + 1] = z;
      out[i + 2] = -y;
    } else {
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = z;
    }
  }
  return out;
}
