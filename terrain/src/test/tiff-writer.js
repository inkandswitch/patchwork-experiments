// A GeoTIFF writer for tests: one band of float32, little- or big-endian,
// in strips or tiles (a tile listed with no bytes is a sparse tile), with a
// tie point and pixel scale or a ModelTransformation, GeoKeys (the raster
// type and the CRS) and GDAL's nodata.

/**
 * @param {number} w @param {number} h @param {ArrayLike<number>} values  row-major
 * @param {{ le?: boolean, tile?: [number, number] | null, rps?: number, sparse?: number[], scale?: number[], tie?: number[], transformation?: number[] | null, point?: boolean, crs?: number, nodata?: string | null }} o
 */
export function writeTiff(w, h, values, { le = true, tile = null, rps = 2, sparse = [], scale = null, tie = null, transformation = null, point = false, crs = 4326, nodata = "-99999" } = {}) {
  const chunks = []; // [offset placeholder index, bytes]
  let tail = 8;
  const blocks = [];
  const put = (bytes) => {
    const at = tail;
    blocks.push([at, bytes]);
    tail += bytes.length + (bytes.length % 2);
    return at;
  };
  const f32 = (arr) => {
    const b = new Uint8Array(arr.length * 4);
    const dv = new DataView(b.buffer);
    arr.forEach((v, k) => dv.setFloat32(k * 4, v, le));
    return b;
  };
  const f64 = (arr) => {
    const b = new Uint8Array(arr.length * 8);
    const dv = new DataView(b.buffer);
    arr.forEach((v, k) => dv.setFloat64(k * 8, v, le));
    return b;
  };
  const u32 = (arr) => {
    const b = new Uint8Array(arr.length * 4);
    const dv = new DataView(b.buffer);
    arr.forEach((v, k) => dv.setUint32(k * 4, v, le));
    return b;
  };
  const u16 = (arr) => {
    const b = new Uint8Array(arr.length * 2);
    const dv = new DataView(b.buffer);
    arr.forEach((v, k) => dv.setUint16(k * 2, v, le));
    return b;
  };
  const offsets = [], counts = [];
  if (tile) {
    const [tw, th] = tile;
    const across = Math.ceil(w / tw), down = Math.ceil(h / th);
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const k = ty * across + tx;
        if (sparse.includes(k)) {
          offsets.push(0);
          counts.push(0);
          continue;
        }
        const t = new Float32Array(tw * th);
        for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) {
          const y = ty * th + r, x = tx * tw + c;
          t[r * tw + c] = y < h && x < w ? values[y * w + x] : 0;
        }
        offsets.push(put(f32(t)));
        counts.push(tw * th * 4);
      }
    }
  } else {
    for (let y0 = 0; y0 < h; y0 += rps) {
      const rows = Math.min(rps, h - y0);
      offsets.push(put(f32(Array.from(values).slice(y0 * w, (y0 + rows) * w))));
      counts.push(rows * w * 4);
    }
  }
  const entries = [];
  const arr = (tag, type, list, enc) => entries.push([tag, type, list.length, list.length * (type === 3 ? 2 : type === 12 ? 8 : 4) <= 4 ? list : put(enc(list))]);
  entries.push([256, 4, 1, [w]], [257, 4, 1, [h]], [258, 3, 1, [32]], [259, 3, 1, [1]], [262, 3, 1, [1]], [277, 3, 1, [1]], [339, 3, 1, [3]]);
  if (tile) {
    entries.push([322, 4, 1, [tile[0]]], [323, 4, 1, [tile[1]]]);
    arr(324, 4, offsets, u32);
    arr(325, 4, counts, u32);
  } else {
    entries.push([278, 4, 1, [rps]]);
    arr(273, 4, offsets, u32);
    arr(279, 4, counts, u32);
  }
  if (scale) arr(33550, 12, scale, f64);
  if (tie) arr(33922, 12, tie, f64);
  if (transformation) arr(34264, 12, transformation, f64);
  arr(34735, 3, [1, 1, 0, 2, 1025, 0, 1, point ? 2 : 1, 2048, 0, 1, crs], u16);
  if (nodata != null) {
    const nd = new TextEncoder().encode(nodata + "\0");
    entries.push([42113, 2, nd.length, nd.length <= 4 ? [...nd] : put(nd)]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const ifd = tail;
  tail += 2 + 12 * entries.length + 4;
  const out = new Uint8Array(tail);
  const dv = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49] : [0x4d, 0x4d]);
  dv.setUint16(2, 42, le);
  dv.setUint32(4, ifd, le);
  dv.setUint16(ifd, entries.length, le);
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifd + 2 + 12 * i;
    dv.setUint16(at, tag, le);
    dv.setUint16(at + 2, type, le);
    dv.setUint32(at + 4, count, le);
    if (Array.isArray(value)) {
      if (type === 3) value.forEach((v, k) => dv.setUint16(at + 8 + k * 2, v, le));
      else if (type === 2) value.forEach((v, k) => (out[at + 8 + k] = v));
      else dv.setUint32(at + 8, value[0], le);
    } else dv.setUint32(at + 8, value, le);
  });
  for (const [at, bytes] of blocks) out.set(bytes, at);
  void chunks;
  return out;
}
