// Where two states differ, for any engine: snapshots are memory and
// globals (wasm-state.js), so a difference is a set of byte ranges.


/**
 * The differences between two snapshots: { globals, bytes, regions }, where
 * globals counts the mutable globals that differ, bytes the memory bytes that
 * do, and regions the memory ranges [at, end) that hold them, ranges closer
 * than `gap` bytes merged. Memory one has and the other lacks (after a growth)
 * counts as different throughout.
 */
export function diffStates(a, b, { gap = 64 } = {}) {
  const ha = header(a), hb = header(b);
  let globals = 0;
  for (let i = 0; i < Math.max(ha.globals, hb.globals); i++)
    for (let j = 0; j < 8; j++)
      if (a[8 + 8 * i + j] !== b[8 + 8 * i + j]) {
        globals++;
        break;
      }
  const ma = a.subarray(ha.size), mb = b.subarray(hb.size);
  const common = Math.min(ma.length, mb.length);
  const regions = [];
  let bytes = 0;
  const add = (at, end) => {
    const last = regions.at(-1);
    if (last && at - last[1] <= gap) last[1] = end;
    else regions.push([at, end]);
  };
  // Word by word where both are aligned (a snapshot's memory starts on a
  // word), then byte by byte inside a word that differs.
  const wa = new Uint32Array(ma.buffer, ma.byteOffset, common >> 2);
  const wb = new Uint32Array(mb.buffer, mb.byteOffset, common >> 2);
  for (let w = 0; w < wa.length; w++) {
    if (wa[w] === wb[w]) continue;
    for (let i = w * 4; i < w * 4 + 4; i++)
      if (ma[i] !== mb[i]) {
        bytes++;
        add(i, i + 1);
      }
  }
  for (let i = wa.length * 4; i < common; i++)
    if (ma[i] !== mb[i]) {
      bytes++;
      add(i, i + 1);
    }
  const longer = Math.max(ma.length, mb.length);
  if (longer > common) {
    bytes += longer - common;
    add(common, longer);
  }
  return { globals, bytes, regions, size: longer };
}

/** How many pixels differ between two pictures of the same size, and a mask of them. */
export function diffPictures(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  const mask = new Uint8Array(a.width * a.height);
  let pixels = 0;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4)
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2]) {
      mask[p] = 1;
      pixels++;
    }
  return { pixels, of: mask.length, mask };
}


function header(snap) {
  const dv = new DataView(snap.buffer, snap.byteOffset, 8);
  const globals = dv.getUint32(4, true);
  return { globals, size: 8 + 8 * globals };
}
