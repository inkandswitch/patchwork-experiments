// A minimal GeoTIFF reader: one band of uncompressed float32, in strips or
// tiles, either byte order, with its georeference (ModelPixelScale and
// ModelTiepoint, or a ModelTransformation without rotation), whether a
// pixel's value is its area's or its centre point's (GTRasterTypeGeoKey),
// and GDAL's nodata. That is what NCEI's exportImage sends when asked for
// `format=tiff&pixelType=F32&compression=None`, what CHS's NONNA GeoServer
// sends (big-endian, ModelTransformation) and what NRCan's HRDEM WCS sends;
// anything else is refused with a reason rather than misread.
//
// A tile or strip with no bytes at all (offset 0, count 0: NCEI sends a
// tile with no data that way) is the nodata value, or NaN without one.

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
  transformation: 34264,
  geoKeys: 34735,
  nodata: 42113,
};
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, data: Float32Array, pixelScale: number[] | null, tiepoint: number[] | null, nodata: number | null, geo: Geo | null }}
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
  const nd = tags.get(TAG.nodata);
  const nodata = typeof nd === "string" && nd.trim() !== "" ? Number(nd) : null;
  const empty = nodata ?? NaN;
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
      const x0 = (k % across) * tw, y0 = Math.floor(k / across) * th;
      const rows = Math.min(th, height - y0), cols = Math.min(tw, width - x0);
      if (counts[k] === 0) {
        // a sparse tile: nothing there
        for (let r = 0; r < rows; r++) data.fill(empty, (y0 + r) * width + x0, (y0 + r) * width + x0 + cols);
        return;
      }
      if (counts[k] < tw * th * 4 || o + tw * th * 4 > u8.length) throw new Error("A TIFF tile shorter than it says.");
      put(o, x0, y0, tw, th, rows, cols);
    });
  } else {
    const rps = one(TAG.rowsPerStrip, height);
    const offs = tags.get(TAG.stripOffsets), counts = tags.get(TAG.stripByteCounts);
    if (!offs) throw new Error("A TIFF with neither strips nor tiles.");
    offs.forEach((o, k) => {
      const y0 = k * rps, rows = Math.min(rps, height - y0);
      if (counts[k] === 0) {
        data.fill(empty, y0 * width, (y0 + rows) * width);
        return;
      }
      if (counts[k] < rows * width * 4 || o + rows * width * 4 > u8.length) throw new Error("A TIFF strip shorter than it says.");
      put(o, 0, y0, width, rows, rows, width);
    });
  }
  const pixelScale = tags.get(TAG.pixelScale) ?? null, tiepoint = tags.get(TAG.tiepoint) ?? null, transformation = tags.get(TAG.transformation) ?? null;
  return { width, height, data, pixelScale, tiepoint, nodata, geo: georeference({ pixelScale, tiepoint, transformation, keys: tags.get(TAG.geoKeys) ?? null }) };
}

/**
 * Where a raster's pixels are: a model (x, y) for pixel (col, row)'s
 * centre is (x0 + (col + c)·dx, y0 + (row + c)·dy) with c = 0.5 when the
 * pixel stands for its area (GeoTIFF's default) and 0 when for its point.
 * dy is negative for a north-up raster. `crs` is the EPSG code the keys
 * name (4326 for latitude and longitude, x = lon, y = lat), else null.
 * @typedef {{ x0: number, y0: number, dx: number, dy: number, point: boolean, crs: number | null }} Geo
 */

/** The georeference from the tags, or null without one. A ModelTransformation with rotation or shear is refused. */
export function georeference({ pixelScale, tiepoint, transformation, keys }) {
  const key = (id) => {
    if (!Array.isArray(keys)) return null;
    for (let k = 4; k + 3 < keys.length; k += 4) if (keys[k] === id && keys[k + 1] === 0) return keys[k + 3];
    return null;
  };
  // GTRasterTypeGeoKey (1025): 1 PixelIsArea (the default), 2 PixelIsPoint
  const point = key(1025) === 2;
  // a projected raster names its projection (32767: user-defined, as a local frame is), a geographic one its datum
  const crs = key(3072) ?? key(2048) ?? null;
  if (transformation && transformation.length >= 16) {
    const m = transformation;
    if (m[1] !== 0 || m[4] !== 0) throw new Error("A GeoTIFF whose ModelTransformation rotates or shears the raster: not read.");
    return { x0: m[3], y0: m[7], dx: m[0], dy: m[5], point, crs };
  }
  if (pixelScale && tiepoint && tiepoint.length >= 6) {
    const [I, J, , X, Y] = tiepoint;
    const [sx, sy] = pixelScale;
    // the tie point is pixel (I, J)'s corner (area) or centre (point)
    return { x0: X - I * sx, y0: Y + J * sy, dx: sx, dy: -sy, point, crs };
  }
  return null;
}
