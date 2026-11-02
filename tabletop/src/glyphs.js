// Numbers drawn with boxes, seven-segment style, lying flat on a face: no
// textures needed. Pure. The digit's top is towards −Z, so it reads the right
// way up to someone on the +Z side looking down (turn the piece to face others).

const SEGMENTS = {
  0: "abcdef",
  1: "bc",
  2: "abged",
  3: "abgcd",
  4: "fgbc",
  5: "afgcd",
  6: "afgedc",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
};

/**
 * Box parts for a number, centred at `at` ([x, y, z], y = the surface it sits on).
 * @param {number | string} value  digits only
 * @param {{ at: number[], height: number, color: string, thick?: number }} o
 *   height of a digit; thick: how far it stands off the surface
 */
export function numberParts(value, { at, height, color, thick = 0.0002 }) {
  const digits = String(value).split("").filter((c) => c in SEGMENTS);
  const w = height * 0.55; // a digit's width
  const s = height * 0.14; // a stroke's width
  const gap = height * 0.18;
  const total = digits.length * w + (digits.length - 1) * gap;
  const parts = [];
  digits.forEach((ch, i) => {
    const cx = at[0] - total / 2 + w / 2 + i * (w + gap);
    const cz = at[2];
    const y = at[1];
    const h = height;
    const horiz = (z) => ({ shape: "box", size: [w, thick, s], at: [cx, y, z], color });
    const vert = (x, z) => ({ shape: "box", size: [s, thick, h / 2], at: [x, y, z], color });
    const left = cx - w / 2 + s / 2;
    const right = cx + w / 2 - s / 2;
    const seg = {
      a: horiz(cz - h / 2 + s / 2),
      g: horiz(cz),
      d: horiz(cz + h / 2 - s / 2),
      f: vert(left, cz - h / 4),
      b: vert(right, cz - h / 4),
      e: vert(left, cz + h / 4),
      c: vert(right, cz + h / 4),
    };
    for (const k of SEGMENTS[ch]) parts.push(seg[k]);
  });
  return parts;
}
