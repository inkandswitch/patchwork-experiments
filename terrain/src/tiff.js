// A minimal GeoTIFF reader: one band of uncompressed float32, in strips or
// tiles, with its georeference (ModelPixelScale, ModelTiepoint) and GDAL's
// nodata. That is exactly what NCEI's exportImage sends when asked for
// `format=tiff&pixelType=F32&compression=None`; anything else is refused
// with a reason rather than misread.

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planar: 284,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  nodata: 42113,
};
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, data: Float32Array, pixelScale: number[] | null, tiepoint: number[] | null, nodata: number | null }}
 */
export function readTiff(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const order = String.fromCharCode(u8[0], u8[1]);
  if (order !== "II" && order !== "MM") throw new Error("Not a TIFF (no byte-order mark).");
  const le = order === "II";
  if (dv.getUint16(2, le) !== 42) throw new Error("Not a classic TIFF (BigTIFF and others aren't read).");
  const ifd = dv.getUint32(4, le);
  const count = dv.getUint16(ifd, le);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + 12 * i;
    const tag = dv.getUint16(at, le);
    const type = dv.getUint16(at + 2, le);
    const n = dv.getUint32(at + 4, le);
    const size = SIZES[type];
    if (!size) continue;
    const off = size * n <= 4 ? at + 8 : dv.getUint32(at + 8, le);
    if (type === 2) {
      tags.set(tag, new TextDecoder().decode(u8.subarray(off, off + n)).replace(/\0+$/, ""));
      continue;
    }
    const vals = [];
    for (let k = 0; k < n; k++) {
      const p = off + k * size;
      vals.push(
        type === 3 ? dv.getUint16(p, le)
        : type === 4 ? dv.getUint32(p, le)
        : type === 8 ? dv.getInt16(p, le)
        : type === 9 ? dv.getInt32(p, le)
        : type === 11 ? dv.getFloat32(p, le)
        : type === 12 ? dv.getFloat64(p, le)
        : type === 16 ? Number(dv.getBigUint64(p, le))
        : type === 5 ? dv.getUint32(p, le) / dv.getUint32(p + 4, le)
        : u8[p],
      );
    }
    tags.set(tag, vals);
  }
  const one = (t, d) => (tags.has(t) ? tags.get(t)[0] : d);
  const width = one(TAG.width), height = one(TAG.height);
  if (!width || !height) throw new Error("A TIFF with no size.");
  if (one(TAG.compression, 1) !== 1) throw new Error(`A compressed TIFF (compression ${one(TAG.compression)}): ask for compression=None.`);
  if (one(TAG.samplesPerPixel, 1) !== 1) throw new Error(`A TIFF with ${one(TAG.samplesPerPixel)} bands: one is read.`);
  if (one(TAG.bitsPerSample, 0) !== 32 || one(TAG.sampleFormat, 1) !== 3) throw new Error("Not a float32 TIFF.");
  const data = new Float32Array(width * height);
  const put = (src, x0, y0, w, h, rowsHere, colsHere) => {
    const sdv = new DataView(u8.buffer, u8.byteOffset + src, w * h * 4);
    for (let r = 0; r < rowsHere; r++) for (let c = 0; c < colsHere; c++) data[(y0 + r) * width + x0 + c] = sdv.getFloat32((r * w + c) * 4, le);
  };
  if (tags.has(TAG.tileOffsets)) {
    const tw = one(TAG.tileWidth), th = one(TAG.tileLength);
    const offs = tags.get(TAG.tileOffsets), counts = tags.get(TAG.tileByteCounts);
    const across = Math.ceil(width / tw);
    offs.forEach((o, k) => {
      if (counts[k] < tw * th * 4) throw new Error("A TIFF tile shorter than it says.");
      const x0 = (k % across) * tw, y0 = Math.floor(k / across) * th;
      put(o, x0, y0, tw, th, Math.min(th, height - y0), Math.min(tw, width - x0));
    });
  } else {
    const rps = one(TAG.rowsPerStrip, height);
    const offs = tags.get(TAG.stripOffsets), counts = tags.get(TAG.stripByteCounts);
    if (!offs) throw new Error("A TIFF with neither strips nor tiles.");
    offs.forEach((o, k) => {
      const y0 = k * rps, rows = Math.min(rps, height - y0);
      if (counts[k] < rows * width * 4) throw new Error("A TIFF strip shorter than it says.");
      put(o, 0, y0, width, rows, rows, width);
    });
  }
  const nd = tags.get(TAG.nodata);
  return {
    width,
    height,
    data,
    pixelScale: tags.get(TAG.pixelScale) ?? null,
    tiepoint: tags.get(TAG.tiepoint) ?? null,
    nodata: typeof nd === "string" && nd.trim() !== "" ? Number(nd) : null,
  };
}
