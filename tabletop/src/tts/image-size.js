// An image's size from its header, without decoding it. Pure. PNG (IHDR),
// JPEG (the first start-of-frame marker) and GIF (the logical screen); null
// for anything else or anything cut short.

/** @returns {{ width: number, height: number } | null} */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b || b.length < 10) return null;
  const be16 = (i) => (b[i] << 8) | b[i + 1];
  const be32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  // PNG: the signature, then IHDR's width and height
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return b.length >= 24 ? ok(be32(16), be32(20)) : null;
  // GIF87a / GIF89a: little-endian width and height
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(b[6] | (b[7] << 8), b[8] | (b[9] << 8));
  // JPEG: walk the markers to the first SOFn (not DHT C4, JPG C8, DAC CC)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(be16(i + 7), be16(i + 5));
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

const ok = (width, height) => (width > 0 && height > 0 ? { width, height } : null);
