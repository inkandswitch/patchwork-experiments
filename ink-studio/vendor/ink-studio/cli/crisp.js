// How crisp a picture is, measured at its own pixel size: the numbers from the pixel-art study, so a diorama can be held to the
// references. measure(img, { mask }) -> { stray, specks, flat, fine, straight, checker, colours, px } and strayMap(img) for a view.
// The background (the dark void round a diorama, or the world's own background colour, joined to the frame's edge) is left out of
// every measure.
'use strict';

// what the references came to (true pixel size; five exact and three snapped): the targets a crisp diorama should meet
const TARGETS = { stray: 0.02, specks: 0.07, flat: 0.25, fine: 0.21 };
// (and where a picture should come to at least: drawn edges as dense as the references', a spread of brightness as wide)
const FLOORS = { edges: 0.06, spread: 0.45 };
const REFERENCE = {
  stray: [0.004, 0.066, 0.012],
  specks: [0.021, 0.224, 0.065],
  flat: [0.207, 0.427, 0.262],
  fine: [0.102, 0.208, 0.191],
  straight: [0.12, 0.29, 0.167],
  edges: [0.025, 0.103, 0.082],
  spread: [0.304, 0.766, 0.503],
  cool: [-0.575, 0.965, 0.231]
};

const keyOf = (rgb, i) => (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];

function background(img, bgc) {
  const { w, h, rgb } = img,
    k = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) k[i] = keyOf(rgb, i);
  // colours that make up more than 2% of the frame's edge and are dark: what joins to the edge in them is background
  const count = new Map();
  let edgeN = 0;
  const edge = i => {
    count.set(k[i], (count.get(k[i]) || 0) + 1);
    edgeN++;
  };
  for (let x = 0; x < w; x++) (edge(x), edge((h - 1) * w + x));
  for (let y = 0; y < h; y++) (edge(y * w), edge(y * w + w - 1));
  const dark = new Set();
  for (const [c, n] of count) {
    const l = (((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)) / 3;
    if (n > 0.02 * edgeN && (l < 40 || c === bgc)) dark.add(c);
  }
  const bg = new Uint8Array(w * h),
    q = [];
  const seed = i => {
    if (!bg[i] && dark.has(k[i])) ((bg[i] = 1), q.push(i));
  };
  for (let x = 0; x < w; x++) (seed(x), seed((h - 1) * w + x));
  for (let y = 0; y < h; y++) (seed(y * w), seed(y * w + w - 1));
  while (q.length) {
    const i = q.pop(),
      x = i % w,
      y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  // (one pixel more, so the line where a diorama meets the void is not counted either way)
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let b = 0;
      for (let dy = -1; dy <= 1 && !b; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx,
            Y = y + dy;
          if (X >= 0 && Y >= 0 && X < w && Y < h && bg[Y * w + X]) b = 1;
        }
      mask[y * w + x] = b ? 0 : 1;
    }
  return { k, mask };
}

// share of brightness variation in eight bands from 0 to 0.5 cycles a pixel, averaged over 32-pixel patches of what is not background
function spectrum(img, mask) {
  const { w, h, rgb } = img,
    P = 32,
    c = P / 2;
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 3;
  const han = Float64Array.from({ length: P }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (P - 1)));
  const cs = Float64Array.from({ length: P * P }, (_, j) => Math.cos((2 * Math.PI * Math.floor(j / P) * (j % P)) / P)),
    sn = Float64Array.from({ length: P * P }, (_, j) => -Math.sin((2 * Math.PI * Math.floor(j / P) * (j % P)) / P));
  const acc = new Float64Array(P * P),
    re = new Float64Array(P * P),
    im = new Float64Array(P * P),
    re2 = new Float64Array(P * P),
    im2 = new Float64Array(P * P);
  let n = 0;
  for (let y0 = 0; y0 + P <= h; y0 += P / 2)
    for (let x0 = 0; x0 + P <= w; x0 += P / 2) {
      let inside = 0,
        mean = 0;
      for (let y = 0; y < P; y++)
        for (let x = 0; x < P; x++) {
          inside += mask[(y0 + y) * w + x0 + x];
          mean += L[(y0 + y) * w + x0 + x];
        }
      if (inside < 0.98 * P * P) continue;
      mean /= P * P;
      // rows, then columns
      for (let y = 0; y < P; y++)
        for (let u = 0; u < P; u++) {
          let a = 0,
            b = 0;
          for (let x = 0; x < P; x++) {
            const v = (L[(y0 + y) * w + x0 + x] - mean) * han[x] * han[y];
            a += v * cs[u * P + x];
            b += v * sn[u * P + x];
          }
          re[y * P + u] = a;
          im[y * P + u] = b;
        }
      for (let u = 0; u < P; u++)
        for (let v = 0; v < P; v++) {
          let a = 0,
            b = 0;
          for (let y = 0; y < P; y++) {
            const cr = cs[v * P + y],
              ci = sn[v * P + y],
              xr = re[y * P + u],
              xi = im[y * P + u];
            a += xr * cr - xi * ci;
            b += xr * ci + xi * cr;
          }
          re2[v * P + u] = a;
          im2[v * P + u] = b;
        }
      for (let j = 0; j < P * P; j++) acc[j] += re2[j] * re2[j] + im2[j] * im2[j];
      n++;
    }
  if (!n) return null;
  const bands = new Float64Array(8);
  let tot = 0,
    mid = 0,
    axis = 0;
  for (let v = 0; v < P; v++)
    for (let u = 0; u < P; u++) {
      const fu = u < c ? u : u - P,
        fv = v < c ? v : v - P,
        r = Math.hypot(fu, fv) / P;
      if (r <= 1 / P || r > 0.5) continue;
      const pw = acc[v * P + u];
      tot += pw;
      bands[Math.min(7, Math.floor((r / 0.5) * 8 - 1e-9))] += pw;
      if (r > 0.12) {
        mid += pw;
        if (fu === 0 || fv === 0) axis += pw;
      }
    }
  return {
    bands: Array.from(bands, b => b / tot),
    fine: (bands[4] + bands[5] + bands[6] + bands[7]) / tot,
    straight: axis / mid,
    patches: n
  };
}

// o.bg: the world's own background colour (0xrrggbb), left out wherever it joins the frame's edge, however light it is
function measure(img, o) {
  const { w, h } = img,
    { k, mask } = background(img, o && o.bg);
  let px = 0,
    stray = 0,
    flat = 0,
    checker = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      px++;
      let e8 = 0,
        e4 = 0,
        dg = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (k[i + dy * w + dx] === k[i]) {
            e8++;
            if (!dx || !dy) e4++;
            else dg++;
          }
        }
      if (e8 === 0) stray++;
      if (e8 === 8) flat++;
      if (e4 === 0 && dg >= 3) checker++;
    }
  // specks: pixels in same-colour patches (joined side to side) of three or fewer
  const lab = new Int32Array(w * h).fill(-1),
    size = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] >= 0) continue;
    const id = size.length,
      q = [i];
    lab[i] = id;
    let n = 0;
    while (q.length) {
      const j = q.pop(),
        x = j % w,
        y = (j / w) | 0;
      n++;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
      for (const m of nb) if (m >= 0 && lab[m] < 0 && k[m] === k[i]) ((lab[m] = id), q.push(m));
    }
    size.push(n);
  }
  let specks = 0;
  const cc = new Map();
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (size[lab[i]] <= 3) specks++;
      cc.set(k[i], (cc.get(k[i]) || 0) + 1);
    }
  const counts = Array.from(cc.values()).sort((a, b) => b - a);
  let run = 0,
    colours = 0;
  for (const c of counts) {
    run += c;
    colours++;
    if (run >= 0.95 * px) break;
  }
  const sp = spectrum(img, mask);
  /* drawn edges: the share of side-by-side pairs of pixels that differ in brightness by more than an eighth (the references draw
     more of these: outlines, rims, tufts); spread: the 5th to 95th percentile of brightness; cool: how much nearer a cool blue
     (240) the darkest fifth's hue is than the lightest fifth's, from -1 to 1 (the references shade toward blue and light toward warm) */
  const { rgb } = img,
    lum = i => (rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114) / 255;
  let pairs = 0,
    steps = 0;
  const ls = [];
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      ls.push(lum(i));
      for (const j of [i + 1, i + w]) {
        if (!mask[j]) continue;
        pairs++;
        if (Math.abs(lum(i) - lum(j)) > 0.125) steps++;
      }
    }
  ls.sort((a, b) => a - b);
  const pct = q => (ls.length ? ls[Math.min(ls.length - 1, Math.floor(q * ls.length))] : 0),
    lo = pct(0.2),
    hi = pct(0.8),
    hueOf = i => {
      const r = rgb[i * 3] / 255,
        g = rgb[i * 3 + 1] / 255,
        b = rgb[i * 3 + 2] / 255,
        mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      if (mx - mn < 0.06) return null;
      const hh =
        mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      return (hh * Math.PI) / 3;
    },
    hd = [0, 0],
    hl = [0, 0];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const l = lum(i),
      a = l <= lo ? hd : l >= hi ? hl : null;
    if (!a) continue;
    const hh = hueOf(i);
    if (hh === null) continue;
    a[0] += Math.cos(hh);
    a[1] += Math.sin(hh);
  }
  const ang = a => ((Math.atan2(a[1], a[0]) * 180) / Math.PI + 360) % 360,
    from = (d, t) => Math.abs(((d - t + 540) % 360) - 180);
  return {
    edges: pairs ? steps / pairs : 0,
    spread: pct(0.95) - pct(0.05),
    cool: (from(ang(hl), 240) - from(ang(hd), 240)) / 180,
    px,
    stray: stray / px,
    specks: specks / px,
    flat: flat / px,
    checker: checker / px,
    colours,
    fine: sp ? sp.fine : NaN,
    straight: sp ? sp.straight : NaN,
    bands: sp ? sp.bands : null
  };
}

// a picture of where the stray pixels are: the picture dimmed, stray pixels in full colour with a red mark round them
function strayMap(img, o) {
  const { w, h, rgb } = img,
    { k, mask } = background(img, o && o.bg),
    out = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = rgb[i * 3 + c] * 0.3;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let lone = true;
      for (let dy = -1; dy <= 1 && lone; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && k[i + dy * w + dx] === k[i]) lone = false;
      if (!lone) continue;
      out[i * 3] = 255;
      out[i * 3 + 1] = 40;
      out[i * 3 + 2] = 40;
    }
  return { w, h, rgb: out };
}

// a picture of the drawn edges the measure counts: the picture dimmed, each pixel on a step of more than an eighth in brightness
// to the right or above it marked in yellow, so it can be seen what makes a picture busy
function edgeMap(img, o) {
  const { w, h, rgb } = img,
    { mask } = background(img, o && o.bg),
    out = new Uint8Array(w * h * 3),
    lum = i => (rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114) / 255;
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = rgb[i * 3 + c] * 0.35;
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if ([i + 1, i + w].some(j => mask[j] && Math.abs(lum(i) - lum(j)) > 0.125)) {
        out[i * 3] = 255;
        out[i * 3 + 1] = 220;
        out[i * 3 + 2] = 40;
      }
    }
  return { w, h, rgb: out };
}

/* a picture brought to n colours (k-means from a spread of starting colours), as a pixel artist's palette would be: a reference saved
   as a JPEG carries thousands of near colours of noise, which would read as stray pixels and specks */
function quantize(img, n = 32) {
  const { w, h, rgb } = img,
    N = w * h,
    step = Math.max(1, Math.floor(N / 20000)),
    C = [];
  for (let k = 0; k < n; k++) {
    const i = (Math.floor(((k + 0.5) / n) * N) * 7919) % N;
    C.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
  }
  const near = (r, g, b) => {
    let bi = 0,
      bd = 1e9;
    for (let k = 0; k < n; k++) {
      const d = (r - C[k][0]) ** 2 + (g - C[k][1]) ** 2 + (b - C[k][2]) ** 2;
      if (d < bd) ((bd = d), (bi = k));
    }
    return bi;
  };
  for (let it = 0; it < 10; it++) {
    const S = Array.from({ length: n }, () => [0, 0, 0, 0]);
    for (let i = 0; i < N; i += step) {
      const k = near(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]),
        s = S[k];
      s[0] += rgb[i * 3];
      s[1] += rgb[i * 3 + 1];
      s[2] += rgb[i * 3 + 2];
      s[3]++;
    }
    S.forEach((s, k) => s[3] && (C[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  const out = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) {
    const c = C[near(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])];
    out[i * 3] = Math.round(c[0]);
    out[i * 3 + 1] = Math.round(c[1]);
    out[i * 3 + 2] = Math.round(c[2]);
  }
  return { w, h, rgb: out };
}

module.exports = { measure, strayMap, edgeMap, quantize, TARGETS, FLOORS, REFERENCE };
