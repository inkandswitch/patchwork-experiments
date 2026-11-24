// PNG output supports RGB8, RGBA8, indexed colour and grayscale.
const zlib = require('zlib'),
  fs = require('fs');
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
const crc = buf => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4),
    td = Buffer.concat([Buffer.from(type, 'ascii'), data]),
    cr = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
function scanlines(w, h, pixels, channels) {
  const stride = w * channels;
  if (pixels.length !== stride * h) throw new Error('PNG pixel count does not match its shape');
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++)
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  return zlib.deflateSync(raw, { level: 6 });
}
function withAlpha(rgb, alpha) {
  if (rgb.length !== alpha.length * 3) throw new Error('PNG alpha count does not match its shape');
  const rgba = new Uint8Array(alpha.length * 4);
  for (let p = 0; p < alpha.length; p++) {
    rgba[p*4] = rgb[p*3];
    rgba[p*4+1] = rgb[p*3+1];
    rgba[p*4+2] = rgb[p*3+2];
    rgba[p*4+3] = alpha[p];
  }
  return rgba;
}
function header(w, h, bits, color) {
  const hd = Buffer.alloc(13);
  hd.writeUInt32BE(w, 0);
  hd.writeUInt32BE(h, 4);
  hd[8] = bits;
  hd[9] = color;
  return hd;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function image(hd, compressed) {
  return Buffer.concat([signature, chunk('IHDR', hd), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}
function encode(w, h, pixels, channels = 3) {
  if (![3,4].includes(channels)) throw new Error('PNG pixel count does not match its shape');
  return image(header(w, h, 8, channels === 4 ? 6 : 2), scanlines(w, h, pixels, channels));
}
function encodeGray(w, h, values) {
  if (values instanceof Uint16Array) {
    const bytes = Buffer.alloc(values.length * 2);
    for (let i = 0; i < values.length; i++) bytes.writeUInt16BE(values[i], i * 2);
    return image(header(w, h, 16, 0), scanlines(w, h, bytes, 2));
  }
  return image(header(w, h, 8, 0), scanlines(w, h, values, 1));
}
function write(file, w, h, rgb, alpha) {
  fs.writeFileSync(file, alpha ? encode(w, h, withAlpha(rgb, alpha), 4) : encode(w, h, rgb));
}
function writeIndexed(file, w, h, slots, palette) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 ||
      !Array.isArray(slots) || slots.length !== w*h || !Array.isArray(palette) ||
      !palette.length || palette.length > 256)
    throw new Error('Indexed PNG needs dimensions, one slot per pixel and 1–256 RGB entries');
  const table = Buffer.from(Array.from(palette,color=>{
    if (!Array.isArray(color) || color.length !== 3 ||
        !Array.from(color).every(n=>Number.isInteger(n) && n>=0 && n<=255))
      throw new Error('Indexed PNG palette entries must be RGB bytes');
    return color;
  }).flat());
  const holes = slots.includes(null), empty = palette.length;
  if (holes && empty === 256) throw new Error('Indexed PNG needs a free slot for transparency');
  const pixels = Uint8Array.from(slots, slot=>{
    if (slot === null) return empty;
    if (!Number.isInteger(slot) || slot < 0 || slot >= palette.length)
      throw new Error('Indexed PNG pixel references a missing palette slot');
    return slot;
  });
  const hd = Buffer.alloc(13);
  hd.writeUInt32BE(w,0);
  hd.writeUInt32BE(h,4);
  hd[8] = 8;
  hd[9] = 3;
  const out = [Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hd),
    chunk('PLTE',holes ? Buffer.concat([table,Buffer.alloc(3)]) : table)];
  if (holes) {
    const alpha = Buffer.alloc(empty+1,255);
    alpha[empty] = 0;
    out.push(chunk('tRNS',alpha));
  }
  out.push(chunk('IDAT',scanlines(w,h,pixels,1)),chunk('IEND',Buffer.alloc(0)));
  fs.writeFileSync(file,Buffer.concat(out));
}
function decode(file, capturePalette) {
  const b = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  if (b.length < 33 || !b.subarray(0, 8).equals(signature)) throw new Error('Not a PNG file');
  let p = 8, w = 0, h = 0, bits, color, interlace, table, transparency;
  const parts = [];
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + len > b.length) throw new Error('Truncated PNG chunk');
    const d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      if (len !== 13 || d[10] || d[11] || d[12] > 1) throw new Error('PNG must use standard filtering, compression and interlacing');
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      bits = d[8];
      color = d[9];
      interlace = d[12];
    } else if (type === 'PLTE') table = d;
    else if (type === 'tRNS') transparency = d;
    else if (type === 'IDAT') parts.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const allowed = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (!w || !h || w * h > 16777216 || !ch || !allowed.includes(bits))
    throw new Error('Unsupported PNG dimensions or colour format');
  const entries = table?.length / 3;
  if (color === 3 && (!Number.isInteger(entries) || entries < 1 || entries > 2 ** bits || transparency?.length > entries))
    throw new Error('Invalid indexed PNG palette');
  const counts = capturePalette && color === 3 ? new Uint32Array(entries) : null;
  const out = counts ? null : bits === 16 ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
  const sampleMask = (1 << bits) - 1, max = color === 3 ? 255 : sampleMask;
  const bpp = Math.ceil(ch * bits / 8);
  const passLayouts = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const passes = passLayouts.map(([x,y,dx,dy]) => ({
    x, y, dx, dy, width: Math.max(0, Math.ceil((w-x)/dx)), height: Math.max(0, Math.ceil((h-y)/dy))
  })).filter(pass => pass.width && pass.height);
  const scanlineSize = passes.reduce((n, {width,height}) => n + height * (1 + Math.ceil(width * ch * bits / 8)), 0);
  const raw = zlib.inflateSync(Buffer.concat(parts), { maxOutputLength: scanlineSize });
  if (raw.length !== scanlineSize) throw new Error('Invalid PNG scanline length');

  const transparent = i => transparency && transparency.length >= 2 * (i + 1) ? transparency.readUInt16BE(2 * i) : -1;
  const tr = transparent(0), tg = transparent(1), tb = transparent(2);
  let cursor = 0;
  for (const pass of passes) {
    const {width,height,dx,dy} = pass, rowBytes = Math.ceil(width * ch * bits / 8);
    const row = new Uint8Array(rowBytes), prev = new Uint8Array(rowBytes);
    const sample = i => bits === 16 ? row[2 * i] * 256 + row[2 * i + 1]
      : bits === 8 ? row[i]
      : (row[(i * bits) >> 3] >> (8 - bits - (i * bits & 7))) & sampleMask;
    for (let y = 0; y < height; y++) {
      const filter = raw[cursor++];
      if (filter > 4) throw new Error('Invalid PNG filter');
      for (let i = 0; i < rowBytes; i++) {
        const x = raw[cursor++], a = i >= bpp ? row[i - bpp] : 0,
          u = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = x;
        if (filter === 1) v = x + a;
        else if (filter === 2) v = x + u;
        else if (filter === 3) v = x + ((a + u) >> 1);
        else if (filter === 4) {
          const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? u : c);
        }
        row[i] = v & 255;
      }
      for (let x = 0; x < width; x++) {
        const dst = ((pass.y + y*dy)*w + pass.x + x*dx)*4, src = x*ch;
        if (color === 3) {
          const index = sample(src);
          if (index >= entries) throw new Error('PNG references a colour outside its palette');
          if (counts) counts[index]++;
          else {
            out[dst] = table[index*3]; out[dst+1] = table[index*3+1]; out[dst+2] = table[index*3+2];
            out[dst+3] = transparency?.[index] ?? 255;
          }
        } else if (color === 0 || color === 4) {
          const gray = sample(src);
          out[dst] = out[dst+1] = out[dst+2] = gray;
          out[dst+3] = color === 4 ? sample(src+1) : gray === tr ? 0 : max;
        } else {
          const r = sample(src), g = sample(src+1), bl = sample(src+2);
          out[dst] = r; out[dst+1] = g; out[dst+2] = bl;
          out[dst+3] = color === 6 ? sample(src+3) : r === tr && g === tg && bl === tb ? 0 : max;
        }
      }
      prev.set(row);
    }
  }
  if (counts) return { w, h, bitDepth: bits, indexed: { table, transparency, counts } };
  return { w, h, data: out, max, ...(capturePalette && { bitDepth: bits }) };
}
function raster(file) { return decode(file, false); }
function paletteSource(file) { return decode(file, true); }
function read(file) {
  const { w, h, data, max } = raster(file);
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(data[Math.floor(i / 3) * 4 + i % 3] * 255 / max);
  return { w, h, rgb };
}
function packFrame({ w, h, rgb, alpha }) {
  const channels = alpha ? 4 : 3, hd = header(w, h, 8, alpha ? 6 : 2);
  return { header: hd, compressed: scanlines(w, h, alpha ? withAlpha(rgb, alpha) : rgb, channels) };
}

function encodeFrame(frame) {
  return image(frame.header, frame.compressed);
}

// The numbered PNG frames and APNG share their compressed image data.
function encodeAnimation(frames, fps) {
  const hd = frames[0].header;
  const ac = Buffer.alloc(8);
  ac.writeUInt32BE(frames.length, 0);
  ac.writeUInt32BE(0, 4);
  const out = [signature, chunk('IHDR', hd), chunk('acTL', ac)];
  let seq = 0;
  frames.forEach((frame, i) => {
    if (!hd.equals(frame.header)) throw new Error('Animated PNG frames need the same dimensions and channels');
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0);
    hd.copy(fc, 4, 0, 8);
    fc.writeUInt16BE(1, 20);
    fc.writeUInt16BE(fps, 22);
    out.push(chunk('fcTL', fc));
    const z = frame.compressed;
    if (i === 0) out.push(chunk('IDAT', z));
    else {
      const sq = Buffer.alloc(4);
      sq.writeUInt32BE(seq++, 0);
      out.push(chunk('fdAT', Buffer.concat([sq, z])));
    }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}
function animate(file, frames, fps) {
  fs.writeFileSync(file, encodeAnimation(frames.map(packFrame), fps));
}
module.exports = { encode, encodeGray, write, writeIndexed, read, raster, paletteSource, animate, packFrame, encodeFrame, encodeAnimation };
