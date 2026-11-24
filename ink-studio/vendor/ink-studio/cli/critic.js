'use strict';
/* A critic for pixel art that names the mistakes pixel artists name, measured on a picture at its own pixel size ({ w, h, rgb }).
   lint(img, { bg }) counts, over the pixels that are not background:
     orphans   lone pixels: none of the eight round them is the same colour (noise, unless it is a glint or an eye)
     doubles   in a line one pixel thick, the extra pixel at the corner of a step (an L where the step should meet corner to corner),
               which makes the line read two pixels thick there
     jaggies   uneven steps along a line: one run of a staircase two or more pixels longer or shorter than the run beside it
               (a slope drawn 1, 3, 1 instead of 2, 2, 2)
     banding   a strip of a middle tone one pixel wide laid between a darker and a lighter one, running along with them: tones that
               only echo an edge, step by step, instead of making a shape
     pillow    how much each shape is darker all round its rim than in its middle, whichever way its rim faces: shading that follows
               the outline instead of the light (0: the rim is darker only on one side; 1: dark all round)
     noise     the share of pixels in clusters of three or fewer of one colour
     colours   how many colours
   and lintMap draws where each is: orphans red, doubles magenta, jaggies yellow, banding cyan, on the picture dimmed.
   gif(frames, delay) writes an animated GIF of pictures of the same size (at most 256 colours across them), for shimmer.
   flicker(frames, { bg }) is the share of pixels that change and change back (A, B, A over three frames) in a sequence: with the
   camera moving smoothly a pixel should go from one colour to the next, not back and forth. */

const lumOf = (rgb, i) => (rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114) / 255;
const colOf = (rgb, i) => (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];

// the background: pixels of the given colour (or very dark) joined to the picture's edge
function backgroundMask(img, bg) {
  const { w, h, rgb } = img,
    N = w * h,
    out = new Uint8Array(N),
    isBg = i => (bg !== undefined ? colOf(rgb, i) === bg : false) || lumOf(rgb, i) < 0.06,
    stack = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (isBg(y * w + x)) stack.push(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (isBg(y * w + x)) stack.push(y * w + x);
  while (stack.length) {
    const i = stack.pop();
    if (out[i]) continue;
    out[i] = 1;
    const x = i % w,
      y = (i / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const X = x + dx,
        Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X;
      if (!out[j] && isBg(j)) stack.push(j);
    }
  }
  return out;
}

function lint(img, o = {}) {
  const { w, h, rgb } = img,
    N = w * h,
    bgm = backgroundMask(img, o.bg),
    C = new Int32Array(N),
    L = new Float32Array(N);
  for (let i = 0; i < N; i++) ((C[i] = colOf(rgb, i)), (L[i] = lumOf(rgb, i)));
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x),
    same = (i, j) => j >= 0 && C[i] === C[j],
    mark = { orphan: new Uint8Array(N), double: new Uint8Array(N), jaggy: new Uint8Array(N), band: new Uint8Array(N) };
  let content = 0;
  for (let i = 0; i < N; i++) if (!bgm[i]) content++;

  // orphans
  let orphans = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bgm[i]) continue;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && same(i, at(x + dx, y + dy))) any = true;
      if (!any) (orphans++, (mark.orphan[i] = 1));
    }

  // lines: thin dark strokes. A pixel is on one when it is darker than every other colour round it (background aside), it is in
  // no 2x2 block of its colour, and its colour runs on (eight-connected) for six pixels or more
  const block = i => {
    const x = i % w,
      y = (i / w) | 0;
    for (const [ax, ay] of [
      [0, 0],
      [-1, 0],
      [0, -1],
      [-1, -1]
    ]) {
      const a = at(x + ax, y + ay),
        b = at(x + ax + 1, y + ay),
        c = at(x + ax, y + ay + 1),
        d = at(x + ax + 1, y + ay + 1);
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0 && same(i, a) && same(i, b) && same(i, c) && same(i, d)) return true;
    }
    return false;
  };
  const dark = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bgm[i] || block(i)) continue;
      let ok = true,
        n = 0;
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = at(x + dx, y + dy);
          if (j < 0 || (!dx && !dy) || same(i, j) || bgm[j]) continue;
          n++;
          if (L[j] - L[i] < 0.06) ok = false;
        }
      if (ok && n >= 2) dark[i] = 1;
    }
  const line = new Uint8Array(N),
    seenL = new Uint8Array(N);
  for (let i0 = 0; i0 < N; i0++) {
    if (!dark[i0] || seenL[i0]) continue;
    const comp = [i0];
    seenL[i0] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k],
        x = i % w,
        y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = at(x + dx, y + dy);
          if (j >= 0 && dark[j] && !seenL[j] && C[j] === C[i]) ((seenL[j] = 1), comp.push(j));
        }
    }
    if (comp.length >= 6) for (const i of comp) line[i] = 1;
  }
  // doubles: on a line, a pixel at the inside corner of a step, with the line going on from both arms (so the corner of a box,
  // where the line turns and stops, is left alone)
  let lineN = 0,
    doubles = 0;
  const onLine = j => j >= 0 && line[j];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!line[i]) continue;
      lineN++;
      for (const [ax, ay] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
      ]) {
        const hx = at(x + ax, y),
          vy = at(x, y + ay);
        if (!(onLine(hx) && onLine(vy) && same(i, hx) && same(i, vy))) continue;
        // (the arms go on: past the horizontal one along x or diagonally, past the vertical one along y or diagonally)
        const goH = onLine(at(x + 2 * ax, y)) || onLine(at(x + 2 * ax, y - ay)),
          goV = onLine(at(x, y + 2 * ay)) || onLine(at(x - ax, y + 2 * ay));
        if (goH && goV && !onLine(at(x - ax, y)) && !onLine(at(x, y - ay))) {
          doubles++;
          mark.double[i] = 1;
          break;
        }
      }
    }

  /* jaggies: along an edge between two colours (or a colour and the background), the staircase it makes, row by row: the runs of
     edge on each row, each starting just past where the one on the row before ended. Along a staircase of four runs or more, a run
     two or more pixels longer or shorter than the next is a jaggy; so are its columns, for steep edges */
  let steps = 0,
    jaggies = 0;
  const stairs = horiz => {
    const A = horiz ? h : w,
      Bn = horiz ? w : h,
      idx = (a, b) => (horiz ? a * w + b : b * w + a);
    for (const side of [1, -1]) {
      // runs on each line a of pixels whose neighbour across (a + side) is another colour
      const runs = [];
      for (let a = 0; a < A; a++) {
        const row = [];
        let st = -1;
        for (let b = 0; b <= Bn; b++) {
          let e = false;
          if (b < Bn) {
            const i = idx(a, b),
              a2 = a + side;
            e = !bgm[i] && (a2 < 0 || a2 >= A || C[idx(a2, b)] !== C[i]);
          }
          if (e && st < 0) st = b;
          if (!e && st >= 0) {
            row.push({ s: st, e: b - 1, c: C[idx(a, st)], next: null, prev: false });
            st = -1;
          }
        }
        runs.push(row);
      }
      // link a run to one on the next line that carries on the staircase: it begins one past this one's end, or ends one before
      // its start, and is the same colour
      for (let a = 0; a + 1 < A; a++)
        for (const r of runs[a])
          for (const q of runs[a + 1])
            if (q.c === r.c && (q.s === r.e + 1 || q.e === r.s - 1)) {
              r.next = q;
              q.prev = true;
              break;
            }
      for (let a = 0; a < A; a++)
        for (const r of runs[a]) {
          if (r.prev) continue;
          const chain = [];
          let a2 = a;
          for (let q = r; q; q = q.next, a2++) chain.push([q, a2]);
          if (chain.length < 4) continue;
          // (the ends of a staircase are cut where it meets something else, so they are not judged)
          for (let k = 1; k + 2 < chain.length; k++) {
            const [r0] = chain[k],
              [r1, a1] = chain[k + 1],
              l0 = r0.e - r0.s + 1,
              l1 = r1.e - r1.s + 1;
            steps++;
            if (Math.abs(l0 - l1) >= 2) {
              jaggies++;
              for (let b = r1.s; b <= r1.e; b++) mark.jaggy[idx(a1, b)] = 1;
            }
          }
        }
    }
  };
  stairs(true);
  stairs(false);

  // banding: a middle tone one pixel wide between a darker and a lighter, kept up along the strip for three pixels or more
  let bandN = 0;
  const bandAt = (x, y, dx, dy) => {
    const i = at(x, y),
      a = at(x - dx, y - dy),
      b = at(x + dx, y + dy);
    if (i < 0 || a < 0 || b < 0 || bgm[i] || bgm[a] || bgm[b] || same(i, a) || same(i, b) || C[a] === C[b])
      return false;
    return (L[a] < L[i] && L[i] < L[b]) || (L[a] > L[i] && L[i] > L[b]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (const [dx, dy, px, py] of [
        [1, 0, 0, 1],
        [0, 1, 1, 0]
      ]) {
        if (!bandAt(x, y, dx, dy)) continue;
        let run = 1;
        for (const sg of [-1, 1]) for (let k = 1; k < 4 && bandAt(x + sg * k * px, y + sg * k * py, dx, dy); k++) run++;
        if (run >= 3) {
          bandN++;
          mark.band[y * w + x] = 1;
          break;
        }
      }
    }

  // pillow: each pixel at the rim of a shape (beside the background) against the mean of the shape's middle, by which way the
  // rim faces (eight ways); dark on every side is pillow shading
  const dist = new Float32Array(N).fill(1e9),
    q = [];
  for (let i = 0; i < N; i++) if (bgm[i]) ((dist[i] = 0), q.push(i));
  for (let k = 0; k < q.length; k++) {
    const i = q[k],
      x = i % w,
      y = (i / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const j = at(x + dx, y + dy);
      if (j >= 0 && dist[j] > dist[i] + 1) ((dist[j] = dist[i] + 1), q.push(j));
    }
  }
  let mid = 0,
    midN = 0;
  const rim = Array.from({ length: 8 }, () => [0, 0]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bgm[i]) continue;
      if (dist[i] >= 4) ((mid += L[i]), midN++);
      else if (dist[i] === 1) {
        // (which way the rim faces: away from the inside, down the slope of the distance)
        let gx = 0,
          gy = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const j = at(x + dx, y + dy);
          if (j >= 0) ((gx -= dx * dist[j]), (gy -= dy * dist[j]));
        }
        if (!gx && !gy) continue;
        const k = (Math.round((Math.atan2(gy, gx) / (2 * Math.PI)) * 8) + 8) % 8;
        rim[k][0] += L[i];
        rim[k][1]++;
      }
    }
  const midL = midN ? mid / midN : 0,
    rimDark = rim.filter(r => r[1] > 4).map(r => Math.max(0, midL - r[0] / r[1]));
  const pillow = rimDark.length >= 4 && Math.max(...rimDark) > 0.02 ? Math.min(...rimDark) / Math.max(...rimDark) : 0;

  // noise: clusters of three or fewer pixels of one colour (four-connected)
  const seen = new Uint8Array(N);
  let noisy = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (seen[i0] || bgm[i0]) continue;
    const comp = [i0];
    seen[i0] = 1;
    for (let k = 0; k < comp.length && comp.length <= 4; k++) {
      const i = comp[k],
        x = i % w,
        y = (i / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const j = at(x + dx, y + dy);
        if (j >= 0 && !seen[j] && !bgm[j] && C[j] === C[i]) ((seen[j] = 1), comp.push(j));
      }
    }
    if (comp.length <= 3) noisy += comp.length;
  }
  const cols = new Set();
  for (let i = 0; i < N; i++) if (!bgm[i]) cols.add(C[i]);
  const per = v => (content ? v / content : 0);
  return {
    content,
    orphans: per(orphans),
    doubles: lineN ? doubles / lineN : 0,
    jaggies: steps ? jaggies / steps : 0,
    banding: per(bandN),
    pillow,
    noise: per(noisy),
    colours: cols.size,
    mark,
    bg: bgm
  };
}

// where each mistake is, over the picture dimmed
function lintMap(img, res) {
  const { w, h, rgb } = img,
    out = new Uint8Array(w * h * 3),
    m = res.mark;
  for (let i = 0; i < w * h; i++) {
    let c = [rgb[i * 3] * 0.35, rgb[i * 3 + 1] * 0.35, rgb[i * 3 + 2] * 0.35];
    if (m.band[i]) c = [40, 220, 230];
    if (m.jaggy[i]) c = [250, 220, 40];
    if (m.double[i]) c = [240, 60, 220];
    if (m.orphan[i]) c = [255, 50, 40];
    out.set(c.map(Math.round), i * 3);
  }
  return { w, h, rgb: out };
}

// the share of pixels that change and change back over three frames (A, B, A), of those that are not background in all three
function flicker(frames, o = {}) {
  if (frames.length < 3) return 0;
  const { w, h } = frames[0],
    N = w * h;
  let flick = 0,
    count = 0;
  const masks = frames.map(f => backgroundMask(f, o.bg));
  for (let k = 0; k + 2 < frames.length; k++) {
    const a = frames[k].rgb,
      b = frames[k + 1].rgb,
      c = frames[k + 2].rgb;
    for (let i = 0; i < N; i++) {
      if (masks[k][i] || masks[k + 1][i] || masks[k + 2][i]) continue;
      count++;
      const ca = colOf(a, i),
        cb = colOf(b, i),
        cc = colOf(c, i);
      if (ca !== cb && ca === cc) flick++;
    }
  }
  return count ? flick / count : 0;
}

// an animated GIF of pictures of one size, at most 256 colours across them; delay in hundredths of a second
function gif(frames, delay = 8) {
  const { w, h } = frames[0],
    pal = new Map(),
    cols = [];
  for (const f of frames)
    for (let i = 0; i < w * h; i++) {
      const c = colOf(f.rgb, i);
      if (!pal.has(c)) {
        if (cols.length >= 256) {
          // (too many: the nearest of those there are)
          let best = 0,
            bd = 1e9;
          for (let k = 0; k < cols.length; k++) {
            const d =
              (((cols[k] >> 16) & 255) - ((c >> 16) & 255)) ** 2 +
              (((cols[k] >> 8) & 255) - ((c >> 8) & 255)) ** 2 +
              ((cols[k] & 255) - (c & 255)) ** 2;
            if (d < bd) ((bd = d), (best = k));
          }
          pal.set(c, best);
        } else {
          pal.set(c, cols.length);
          cols.push(c);
        }
      }
    }
  let bits = 1;
  while (1 << bits < Math.max(2, cols.length)) bits++;
  const size = 1 << bits,
    out = [];
  const put = (...b) => out.push(...b),
    u16 = v => put(v & 255, (v >> 8) & 255);
  put(...Buffer.from('GIF89a'));
  u16(w);
  u16(h);
  put(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let k = 0; k < size; k++) {
    const c = cols[k] || 0;
    put((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  put(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0); // (loop for ever)
  for (const f of frames) {
    put(0x21, 0xf9, 4, 0, delay & 255, (delay >> 8) & 255, 0, 0);
    put(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    put(0);
    // LZW, codes from min + 1 bits growing to 12, a clear when the table fills
    const min = Math.max(2, bits),
      clear = 1 << min,
      eoi = clear + 1,
      bytes = [];
    let cur = 0,
      nb = 0,
      width = min + 1,
      next = eoi + 1,
      dict = new Map();
    const emit = code => {
      cur |= code << nb;
      nb += width;
      while (nb >= 8) {
        bytes.push(cur & 255);
        cur >>>= 8;
        nb -= 8;
      }
    };
    emit(clear);
    let prefix = pal.get(colOf(f.rgb, 0));
    for (let i = 1; i < w * h; i++) {
      const k = pal.get(colOf(f.rgb, i)),
        key = prefix * 4096 + k;
      if (dict.has(key)) {
        prefix = dict.get(key);
        continue;
      }
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > 1 << width && width < 12) width++;
      } else {
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        width = min + 1;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (nb > 0) bytes.push(cur & 255);
    put(min);
    for (let k = 0; k < bytes.length; k += 255) {
      const chunk = bytes.slice(k, k + 255);
      put(chunk.length, ...chunk);
    }
    put(0);
  }
  put(0x3b);
  return Buffer.from(out);
}

/* the review's shots: the diorama's own view, from its four sides, from above, from low down, and at three zooms; each
   [label, yaw offset, pitch (null: its own), zoom] */
const SHOTS = [
  ['home', 0, null, 1],
  ['side 2', Math.PI / 2, null, 1],
  ['side 3', Math.PI, null, 1],
  ['side 4', (3 * Math.PI) / 2, null, 1],
  ['top', 0, 1.3, 1],
  ['low', 0, 0.14, 1],
  ['far', 0, null, 0.55],
  ['near', 0, null, 1.7],
  ['close', 0, null, 2.8]
];

// the medians of the pixel-art references at their own pixel size (study/native: nine of them)
const REFERENCE = {
  orphans: 0.015,
  doubles: 0.032,
  jaggies: 0.13,
  banding: 0.024,
  pillow: 0,
  noise: 0.177,
  colours: 48
};

module.exports = { lint, lintMap, flicker, gif, backgroundMask, SHOTS, REFERENCE };
