'use strict';
/* ------------------------------------------------------------------
   Scene generators. Every object is emitted as gaussians:
   16 floats per splat =
     [x, y, z, density] [c00, c01, c02, packedRGB] [c11, c12, c22, kind] [phase, speed, range, extra]
   Palette indices: 0 void, 1 dark, 2 mid, 3 light, 4 pale, 5-7 reds.
   ------------------------------------------------------------------ */
const PAL_HEX = [0x0b1114, 0x1c3626, 0x356b36, 0x82b552, 0xdff0c4, 0x4a0d1a, 0xad1f36, 0xff6474];
const PALETTES = [
  { name: 'Moss', luma: false, spread: 0.3, colors: PAL_HEX },
  { name: 'Bone', luma: true, spread: 0.4, colors: [0x0e0d12, 0x3a3540, 0x7d7482, 0xc4bdb6, 0xf4efe0] },
  { name: 'Ember', luma: true, spread: 0.4, colors: [0x100808, 0x4a1418, 0x9c2a24, 0xe6772e, 0xffe2a0] },
  { name: 'One bit', luma: true, spread: 1.0, colors: [0x0b1114, 0xdff0c4] }
];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const r = mulberry32(seed);
  const p = new Uint8Array(512),
    g = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    p[i] = i;
    g[i] = r();
  }
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  function n3(x, y, z) {
    let xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = x - xi,
      yf = y - yi,
      zf = z - zi;
    xi &= 255;
    yi &= 255;
    zi &= 255;
    const u = xf * xf * (3 - 2 * xf),
      v = yf * yf * (3 - 2 * yf),
      w = zf * zf * (3 - 2 * zf);
    const A = p[xi] + yi,
      B = p[xi + 1] + yi;
    const AA = p[A] + zi,
      AB = p[A + 1] + zi,
      BA = p[B] + zi,
      BB = p[B + 1] + zi;
    const x00 = g[p[AA]] + u * (g[p[BA]] - g[p[AA]]),
      x10 = g[p[AB]] + u * (g[p[BB]] - g[p[AB]]);
    const x01 = g[p[AA + 1]] + u * (g[p[BA + 1]] - g[p[AA + 1]]),
      x11 = g[p[AB + 1]] + u * (g[p[BB + 1]] - g[p[AB + 1]]);
    const y0 = x00 + v * (x10 - x00),
      y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  }
  function fbm(x, y, z, oct) {
    let s = 0,
      a = 0.5,
      n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * n3(x, y, z);
      n += a;
      x *= 2.03;
      y *= 2.03;
      z *= 2.03;
      a *= 0.5;
    }
    return s / n;
  }
  return { n3, fbm };
}

// ---------------- shared builder: splat storage plus shape helpers ----------------
function makeBuilder(seed, hex, { renderMetadata = true, initialCapacity = 1 << 15, detailBudgets, shadowArt: shadowSettings } = {}) {
  const detailBudget = DetailBudgets.prepare(detailBudgets);
  const shadowArt = ShadowArt.prepare(shadowSettings);
  if (shadowArt?.cast || shadowArt?.receive) renderMetadata = true;
  if (detailBudget?.affectsCleanup || detailBudget?.fineOn || detailBudget?.fineOff) renderMetadata = true;
  if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 1 || initialCapacity > Number.MAX_SAFE_INTEGER / 16)
    throw new RangeError('Initial splat capacity must be a positive integer');
  seed = seed >>> 0;
  let gen = mulberry32(seed ^ 0x5bd1e995);
  const R = () => gen(),
    reseed = s2 => {
      gen = mulberry32(((s2 >>> 0) ^ 0x5bd1e995) >>> 0);
    }; // a builder's random stream can be restarted, so one thing built in two places comes out the same
  const { n3, fbm } = makeNoise(seed ^ 0x9e3779b9);
  const TAU = Math.PI * 2,
    UP = [0, 1, 0];
  const P = (hex || PAL_HEX).map(h => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  const rr = (a, b) => a + (b - a) * R();
  const pick = arr => arr[(R() * arr.length) | 0];
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const gauss = () => (R() + R() + R() + R() - 2) * 1.732;
  const randDir = () => {
    const y = R() * 2 - 1,
      a = R() * TAU,
      r = Math.sqrt(1 - y * y);
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  const fib = (k, n) => {
    const y = 1 - (2 * (k + 0.5)) / n,
      r = Math.sqrt(Math.max(0, 1 - y * y)),
      a = k * 2.399963;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };

  let cap = initialCapacity,
    n = 0,
    data = new Float32Array(cap * 16);
  function reserveRow() {
    if (n < cap) return;
    cap *= 2;
    const expanded = new Float32Array(cap * 16);
    expanded.set(data);
    data = expanded;
  }
  const moving = [],
    back = [],
    cidx = [],
    nrms = [];
  let curN = null;
  let ownerRows, materialRows, targetRows, muteEmission, materialAlbedo, materialPixelStyles, opticalSplats;
  let unnamedOwners = new WeakMap(), unnamedMaterials = new WeakMap();
  const ownerIds = new Map(), materialIds = new Map();
  const ownerNames = [null], materialNames = [null];
  const targetKeys = new Map(), targetNames = [null];
  let targetValues = new WeakMap();
  function renderId(value, labels, unnamed, names) {
    if (value == null) return 0;
    const hasLabel = typeof value === 'string' || typeof value === 'number';
    const ids = hasLabel ? labels : unnamed;
    let id = ids.get(value);
    if (id === undefined) {
      id = names.length;
      ids.set(value, id);
      names.push(hasLabel ? value : null);
    }
    return id;
  }
  function describeAlbedo(first, end, color) {
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || first < 0 || end < first || end > n)
      throw new RangeError('Albedo range must belong to the builder');
    if (first === end) return;
    const rgb = RenderStages.albedo(color, hex || PAL_HEX);
    if (!materialAlbedo || materialAlbedo.length < cap) {
      const next = new Uint32Array(cap);
      if (materialAlbedo) next.set(materialAlbedo);
      materialAlbedo = next;
    }
    materialAlbedo.fill(rgb + 1, first, end);
  }
  function describePixelStyle(first, end, style, pair) {
    if (first === end || !style.edge && !style.mode && !style.steps) return;
    if (!materialPixelStyles || materialPixelStyles.length < cap * 4) {
      const next = new Float32Array(cap * 4);
      if (materialPixelStyles) next.set(materialPixelStyles);
      materialPixelStyles = next;
    }
    const pack = index => {
      const [r, g, b] = P[index];
      return r + 256 * g + 65536 * b;
    };
    const low = pair ? pack(pair[0]) : 0, high = pair ? pack(pair[1]) : 0;
    const key = style.mode + style.steps * 8 + (pair ? MaterialPixelStyle.PAIR + pair[2] * .5 : 0);
    for (let i = first; i < end; i++) {
      const j = i * 4;
      materialPixelStyles[j] = style.edge;
      materialPixelStyles[j + 1] = key + (pix?.[i * 8] ? MaterialPixelStyle.PATTERN : 0);
      materialPixelStyles[j + 2] = low;
      materialPixelStyles[j + 3] = high;
    }
  }
  // Labels can be shared across several solids or supplied for splats built directly.
  function describeOptical(first, end, profile) {
    if (first >= end) return;
    const packed = OpticalMaterials.pack(profile), stride = OpticalMaterials.STRIDE;
    if (!opticalSplats || opticalSplats.length < end * stride) {
      const next = new Float32Array(Math.max(end * stride, opticalSplats ? opticalSplats.length * 2 : 256 * stride));
      if (opticalSplats) next.set(opticalSplats);
      opticalSplats = next;
    }
    for (let i = first; i < end; i++) opticalSplats.set(packed, i * stride);
  }

  function describeSplats(first, end, { object, material, target } = {}) {
    if (!renderMetadata || first === end) return;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || first < 0 || end < first || end > n)
      throw new RangeError('Splat metadata range must belong to the builder');
    if (!ownerRows || ownerRows.length < cap) {
      const owners = new Uint32Array(cap), materials = new Uint32Array(cap);
      if (ownerRows) {
        owners.set(ownerRows);
        materials.set(materialRows);
      }
      ownerRows = owners;
      materialRows = materials;
    }
    ownerRows.fill(renderId(object, ownerIds, unnamedOwners, ownerNames), first, end);
    materialRows.fill(renderId(material, materialIds, unnamedMaterials, materialNames), first, end);
    if (target) {
      let id = targetValues.get(target);
      if (id === undefined) {
        const labels = TargetSelectors.describe(target);
        const key = SplatProvenance.targetKey(labels);
        if (!targetKeys.has(key)) {
          targetKeys.set(key, targetNames.length);
          targetNames.push(JSON.parse(JSON.stringify(labels)));
        }
        id = targetKeys.get(key);
        targetValues.set(target, id);
      }
      if (!targetRows || targetRows.length < cap) {
        const next = new Uint32Array(cap);
        if (targetRows) next.set(targetRows);
        targetRows = next;
      }
      targetRows.fill(id, first, end);
    } else if (targetRows) targetRows.fill(0, first, end);
  }

  function renderRows() {
    if (!renderMetadata && !opticalSplats) return undefined;
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) if (nrms[i]) normals.set(nrms[i], i * 3);
    if (!renderMetadata) return { normals };
    return {
      normals,
      muteEmission: muteEmission?.slice(0, n),
      objectIds: ownerRows?.slice(0, n),
      materialIds: materialRows?.slice(0, n),
      ...(targetRows && { targetIds: targetRows.slice(0, n), targets: targetNames.slice() }),
      objects: ownerNames.slice(),
      materials: materialNames.slice()
    };
  }
  /* the birth time given to the dabs laid next (null: there from the start). The motions that use the last number for themselves
     (falling, rising, flapping, swelling, writhing, a placed copy's sway) cannot grow */
  let bornV = null,
    wetV = null;
  const OWNEX = [0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1];
  /* Inked detail (optional, see S.fine in the sculptor): a dab may carry a small picture of the surface under it, four colours by four,
     looked up for each pixel it covers. Twelve numbers a dab: the sixteen palette colours (four to a number), the two half-axes of the
     tile on the surface, and the colour the dab was given, so a dab recoloured later is known and drawn plain. */
  let fine = null,
    attr = null,
    attrN = null,
    pix = null,
    pixHas = false,
    surfaceData = null,
    surfacePending = false,
    shadowLod;
  const renderSdfs = [];
  let bevelIds = new WeakMap();
  const surfaces = [],
    surfaceIds = new Map(),
    surfaceRow = new Float32Array(SurfaceLook.STRIDE);
  function surfaceNext(settings, nx, ny, nz, light, visibility = 1, tangent, bevelDistance) {
    let ids = surfaceIds.get(settings);
    if (!ids) surfaceIds.set(settings, (ids = new Map()));
    if (bevelDistance && !bevelIds.has(bevelDistance)) bevelIds.set(bevelDistance, surfaces.length + 1);
    const key = light.join(',') + (bevelDistance ? '/' + bevelIds.get(bevelDistance) : '');
    let id = ids.get(key);
    if (id === undefined) {
      id = surfaces.push({ settings, light: Array.from(light), ...(bevelDistance && { bevelDistance }) });
      ids.set(key, id);
    }
    surfaceRow.set([id, nx, ny, nz, visibility, tangent?.[0] ?? 0, tangent?.[1] ?? 0, tangent?.[2] ?? 0]);
    surfacePending = true;
  }
  /* colour worked out per pixel (a diorama's look.pixel): for a dab laid next, the ramp it is coloured from, how lit it is, the pattern
     laid on it (a K.pixel material's pat) and the way its surface faces; the picture then decides each pixel from these, not from the
     dab's one colour. Eight numbers a dab; the ramps and patterns are kept once each */
  const pixN = new Float32Array(8),
    ramps = [],
    rampOff = [],
    rampIx = new Map(),
    rampNoIx = new Map(),
    rampByText = new Map(),
    pats = [],
    patIx = new Map();
  /* (fx, fy, fz: the way the shape it is lit as faces, if that is not its own: folded into two numbers; 9, 9 when there is none.
      noLine: the material draws no outline, as clouds and water. Ramps with the same colours are one ramp, so an outline is drawn
      only where one material meets another) */
  function pixelRamp(ramp, noLine) {
    const ix = noLine ? rampNoIx : rampIx;
    let r = ix.get(ramp);
    if (r === undefined) {
      const text = (noLine ? '!' : '') + Array.from(ramp).join(',');
      r = rampByText.get(text);
      if (r === undefined) {
        r = ramps.push(Array.from(ramp)) - 1;
        rampOff.push(!!noLine);
        rampByText.set(text, r);
      }
      ix.set(ramp, r);
    }
    return r + 1;
  }
  const pixNext = (ramp, t, pat, nx, ny, nz, fx, fy, fz, noLine) => {
    let pi = 0;
    if (pat) {
      pi = patIx.get(pat);
      if (pi === undefined) {
        pi = pats.push(pat);
        patIx.set(pat, pi);
      }
    }
    pixN[0] = pixelRamp(ramp, noLine);
    pixN[1] = t;
    pixN[2] = pi;
    pixN[3] = nx;
    pixN[4] = ny;
    pixN[5] = nz;
    if (fx === undefined) pixN[6] = pixN[7] = 9;
    else {
      const l = Math.abs(fx) + Math.abs(fy) + Math.abs(fz) || 1;
      let a = fx / l,
        b = fz / l;
      if (fy < 0) {
        const a2 = (1 - Math.abs(b)) * (a >= 0 ? 1 : -1),
          b2 = (1 - Math.abs(a)) * (b >= 0 ? 1 : -1);
        a = a2;
        b = b2;
      }
      pixN[6] = a;
      pixN[7] = b;
    }
    pixHas = true;
  };
  function shadowNext(base, alternate) {
    if (!alternate || !P[alternate.ci]) return;
    const slot = pixHas && alternate.ramp ? pixelRamp(alternate.ramp, alternate.noLine) : 0;
    if (base === alternate.ci && (!pixHas || slot === pixN[0] && Math.fround(alternate.t) === pixN[1]) &&
        (!surfacePending || Math.fround(alternate.visibility) === surfaceRow[4])) return;
    reserveRow();
    const stride = ShadowArt.stride;
    if (!shadowLod || shadowLod.length < cap * stride) {
      const next = new Float32Array(cap * stride);
      if (shadowLod) next.set(shadowLod);
      shadowLod = next;
    }
    const pack = ([r, g, b]) => r + 256 * g + 65536 * b;
    const { referenceSize, belowPixels } = shadowArt.small;
    shadowLod.set([referenceSize / belowPixels, pack(P[base]), pack(P[alternate.ci]), slot,
      alternate.t, alternate.visibility], n * stride);
  }
  /* attributes (see the sculptor's S.keepAttrs): four numbers a dab, for the dabs laid next */
  const attrNext = (a, b, c, d) => {
    attrN = attrN || new Float32Array(4);
    attrN[0] = a;
    attrN[1] = b;
    attrN[2] = c;
    attrN[3] = d;
  };
  const fineTile = (t0, t1, t2, t3, ux, uy, uz, vx, vy, vz, col) => {
    reserveRow();
    if (!fine || fine.length < cap * 12) {
      const f = new Float32Array(cap * 12);
      if (fine) f.set(fine);
      fine = f;
    }
    const o = n * 12;
    fine[o] = t0;
    fine[o + 1] = t1;
    fine[o + 2] = t2;
    fine[o + 3] = t3;
    fine[o + 4] = ux;
    fine[o + 5] = uy;
    fine[o + 6] = uz;
    fine[o + 7] = (col[0] | 0) + (col[1] | 0) * 256 + (col[2] | 0) * 65536;
    fine[o + 8] = vx;
    fine[o + 9] = vy;
    fine[o + 10] = vz;
    fine[o + 11] = 1;
  };
  function push(x, y, z, c00, c01, c02, c11, c12, c22, col, a, an) {
    reserveRow();
    if (attrN) {
      if (!attr || attr.length < cap * 4) {
        const f = new Float32Array(cap * 4);
        if (attr) f.set(attr);
        attr = f;
      }
      attr.set(attrN, n * 4);
    }
    if (pixHas || pix) {
      if (!pix || pix.length < cap * 8) {
        const f = new Float32Array(cap * 8);
        if (pix) f.set(pix);
        pix = f;
      }
      if (pixHas) pix.set(pixN, n * 8);
      else pix.fill(0, n * 8, n * 8 + 8);
      pixHas = false;
    }
    if (surfacePending || surfaceData) {
      const stride = SurfaceLook.STRIDE;
      if (!surfaceData || surfaceData.length < cap * stride) {
        const next = new Float32Array(cap * stride);
        if (surfaceData) next.set(surfaceData);
        surfaceData = next;
      }
      if (surfacePending) surfaceData.set(surfaceRow, n * stride);
      surfacePending = false;
    }
    if (fine && fine[n * 12 + 11] === 1)
      fine[n * 12 + 11] = 2; // the tile laid for this dab is now its own
    else if (fine && n * 12 < fine.length) fine.fill(0, n * 12, n * 12 + 12);
    const o = n * 16;
    data[o] = x;
    data[o + 1] = y;
    data[o + 2] = z;
    data[o + 3] = a;
    data[o + 4] = c00;
    data[o + 5] = c01;
    data[o + 6] = c02;
    data[o + 7] = (col[0] | 0) + (col[1] | 0) * 256 + (col[2] | 0) * 65536;
    data[o + 8] = c11;
    data[o + 9] = c12;
    data[o + 10] = c22;
    cidx.push(P.indexOf(col));
    nrms.push(curN);
    if (an) {
      if (renderMetadata && an.em && an.emission === false) {
        if (!muteEmission || muteEmission.length < cap) {
          const next = new Uint8Array(cap);
          if (muteEmission) next.set(muteEmission);
          muteEmission = next;
        }
        muteEmission[n] = 1;
      }
      // kind, plus flags: 16 = leave out of outlines, 32 = glows (ignores haze and relighting)
      // 64 = behind everything, 256 = glass, 8192 = responds to horizontal airflow, 2048 = drawn as text where a page offers it
      // 32768 bypasses rest-space brushes for world-space surface fragments.
      // (K.ascii), with its own set in 4096 and 16384 (as: 1 ascii, 2 symbols, 3 braille; as: true, the page's)
      const asSet = an.as && an.as !== true ? Math.max(0, Math.min(3, an.as | 0)) : 0;
      data[o + 11] = (an.k || 0) + (an.nd ? 16 : 0) + (an.em ? 32 : 0) + (an.bk ? 64 : 0) + (an.gl ? 256 : 0) + (an.wind ? 8192 : 0)
        + (an.as ? 2048 + (asSet & 1 ? 4096 : 0) + (asSet & 2 ? 16384 : 0) : an.k === 11 && an.cloth ? Airflow.clothFlag : 0)
        + (an.coverage === undefined ? 0 : SampleCoverage.pack(an.coverage, an.coverageEnter));
      if (an.bk) back.push(n);
      data[o + 12] = an.ph || 0;
      data[o + 13] = an.sp || 0;
      data[o + 14] = an.rg || 0;
      data[o + 15] = an.ex || 0;
      if (an.k === 2 || an.k === 3 || an.k === 5 || an.k === 6) moving.push(n);
    }
    /* born: a dab that is not there until its time comes (growth you can watch). Its time goes in the last number, so only the
       motions that leave that free can grow (+ 512: the page and the renderer read it as flag 32) */
    if (bornV !== null && !OWNEX[data[o + 11] % 16]) {
      if (!an) {
        data[o + 11] = 0;
        data[o + 12] = data[o + 13] = data[o + 14] = 0;
      }
      data[o + 11] += 512;
      data[o + 15] = bornV;
    } else if (wetV !== null && !OWNEX[(an ? data[o + 11] : 0) % 16]) {
      /* wet: from its time on the dab darkens, as rain soaks it (+ 1024: flag 64 in the page and the renderer) */
      if (!an) data[o + 11] = data[o + 12] = data[o + 13] = data[o + 14] = 0;
      data[o + 11] += 1024;
      data[o + 15] = wetV;
    } else if (!an) data[o + 11] = data[o + 12] = data[o + 13] = data[o + 14] = data[o + 15] = 0;
    n++;
  }
  function iso(x, y, z, s, col, a, an) {
    const v = s * s;
    push(x, y, z, v, 0, 0, v, 0, v, col, a, an);
  }
  function axial(x, y, z, ax, sa, sp, col, a, an) {
    const p = sp * sp,
      d = sa * sa - p;
    push(
      x,
      y,
      z,
      p + d * ax[0] * ax[0],
      d * ax[0] * ax[1],
      d * ax[0] * ax[2],
      p + d * ax[1] * ax[1],
      d * ax[1] * ax[2],
      p + d * ax[2] * ax[2],
      col,
      a,
      an
    );
  }
  const disc = (x, y, z, nrm, st, sn, col, a, an) => {
    curN = nrm;
    axial(x, y, z, nrm, sn, st, col, a, an);
    curN = null;
  };
  const stick = (x, y, z, ax, sl, sw, col, a, an) => axial(x, y, z, ax, sl, sw, col, a, an);
  /* a dab that is longer one way across the surface than the other (S.follow lays these along the form): nrm the way the surface
     faces, e the long way (across the surface), sa and sb its two half-widths, sn its thickness */
  const dab = (x, y, z, nrm, e, sa, sb, sn, col, a, an) => {
    const fx = nrm[1] * e[2] - nrm[2] * e[1],
      fy = nrm[2] * e[0] - nrm[0] * e[2],
      fz = nrm[0] * e[1] - nrm[1] * e[0],
      A = sa * sa,
      Bq = sb * sb,
      C = sn * sn;
    curN = nrm;
    push(
      x,
      y,
      z,
      A * e[0] * e[0] + Bq * fx * fx + C * nrm[0] * nrm[0],
      A * e[0] * e[1] + Bq * fx * fy + C * nrm[0] * nrm[1],
      A * e[0] * e[2] + Bq * fx * fz + C * nrm[0] * nrm[2],
      A * e[1] * e[1] + Bq * fy * fy + C * nrm[1] * nrm[1],
      A * e[1] * e[2] + Bq * fy * fz + C * nrm[1] * nrm[2],
      A * e[2] * e[2] + Bq * fz * fz + C * nrm[2] * nrm[2],
      col,
      a,
      an
    );
    curN = null;
  };

  let Lv = norm([-0.45, 0.75, 0.5]);
  const setLight = v => {
    Lv = norm(v);
  };
  const lit = nv => clamp(0.5 + 0.5 * dot(nv, Lv), 0, 1);
  function shade(nv, cols, jit) {
    const i = clamp(
      Math.floor((lit(nv) + (R() - 0.5) * (jit === undefined ? 0.1 : jit)) * cols.length),
      0,
      cols.length - 1
    );
    return P[cols[i]];
  }
  const path = (cnt, fn) => {
    const pts = [];
    for (let i = 0; i <= cnt; i++) pts.push(fn(i / cnt));
    return pts;
  };
  // Catmull-Rom through waypoints
  function spline(w, per) {
    const pts = [];
    for (let i = 0; i < w.length - 1; i++) {
      const p0 = w[Math.max(0, i - 1)],
        p1 = w[i],
        p2 = w[i + 1],
        p3 = w[Math.min(w.length - 1, i + 2)];
      for (let s = 0; s < per; s++) {
        const t = s / per,
          t2 = t * t,
          t3 = t2 * t,
          q = [0, 0, 0];
        for (let k = 0; k < 3; k++)
          q[k] =
            0.5 *
            (2 * p1[k] +
              (p2[k] - p0[k]) * t +
              (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
              (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
        pts.push(q);
      }
    }
    pts.push(w[w.length - 1].slice());
    return pts;
  }
  // a vine, branch or cable: three offset strands give it a lit side and a shadow side
  function tube(pts, r0, r1, cols, an) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++)
      total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1],
        d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        len = Math.hypot(d[0], d[1], d[2]);
      if (len < 1e-6) continue;
      const t = [d[0] / len, d[1] / len, d[2] / len],
        lt = dot(Lv, t);
      const h = norm([Lv[0] - t[0] * lt, Lv[1] - t[1] * lt, Lv[2] - t[2] * lt]);
      const rm = mix(r0, r1, (acc + len / 2) / total),
        steps = Math.max(1, Math.ceil(len / (Math.max(rm, 0.045) * 1.3)));
      for (let s = 0; s < steps; s++) {
        const f = (s + 0.5) / steps,
          r = mix(r0, r1, (acc + len * f) / total);
        const x = a[0] + d[0] * f,
          y = a[1] + d[1] * f,
          z = a[2] + d[2] * f,
          sl = Math.max(r * 1.05, (len / steps) * 0.65);
        if (r < 0.056) {
          stick(x, y, z, t, sl, Math.max(r, 0.02), P[cols[1]], 3, an);
          continue;
        }
        stick(x - h[0] * r * 0.45, y - h[1] * r * 0.45, z - h[2] * r * 0.45, t, sl, r * 0.7, P[cols[0]], 3, an);
        stick(x, y, z, t, sl, r * 0.8, P[cols[1]], 3, an);
        stick(x + h[0] * r * 0.5, y + h[1] * r * 0.5, z + h[2] * r * 0.5, t, sl, r * 0.55, P[cols[2]], 3, an);
      }
      acc += len;
    }
  }
  // recursive bare branches
  function branch(p, dir, len, r, depth, cols, spread) {
    const bend = randDir(),
      end = add(p, dir, len);
    const pts = path(5, t => {
      const s = Math.sin(t * Math.PI) * len * 0.14;
      return [
        p[0] + dir[0] * len * t + bend[0] * s,
        p[1] + dir[1] * len * t + bend[1] * s,
        p[2] + dir[2] * len * t + bend[2] * s
      ];
    });
    tube(pts, r, r * 0.62, cols);
    if (depth > 0)
      for (let k = 0; k < 2; k++) {
        const rd = randDir();
        branch(
          end,
          norm([dir[0] + rd[0] * spread, dir[1] + rd[1] * spread + 0.25, dir[2] + rd[2] * spread]),
          len * rr(0.6, 0.8),
          r * 0.62,
          depth - 1,
          cols,
          spread
        );
      }
  }
  // axis-aligned box with flat toon faces; opt.col(face, u, v, p) may return a palette index, or -1 to leave a hole
  function box(cx, y0, cz, w, h, d, cols, opt) {
    opt = opt || {};
    const s = opt.s || 0.14;
    const faces = [
      ['top', [0, 1, 0], [cx - w / 2, y0 + h, cz - d / 2], [w, 0, 0], [0, 0, d]],
      ['front', [0, 0, 1], [cx - w / 2, y0, cz + d / 2], [w, 0, 0], [0, h, 0]],
      ['back', [0, 0, -1], [cx - w / 2, y0, cz - d / 2], [w, 0, 0], [0, h, 0]],
      ['right', [1, 0, 0], [cx + w / 2, y0, cz - d / 2], [0, 0, d], [0, h, 0]],
      ['left', [-1, 0, 0], [cx - w / 2, y0, cz - d / 2], [0, 0, d], [0, h, 0]]
    ];
    for (const [name, nv, o, u, v] of faces) {
      if (opt.skip && opt.skip.indexOf(name) >= 0) continue;
      const lu = Math.hypot(u[0], u[1], u[2]),
        lv = Math.hypot(v[0], v[1], v[2]);
      const nu = Math.max(1, Math.round(lu / s)),
        nvv = Math.max(1, Math.round(lv / s));
      const rc = Math.cos(opt.rot || 0),
        rs = Math.sin(opt.rot || 0),
        wn = [nv[0] * rc + nv[2] * rs, nv[1], -nv[0] * rs + nv[2] * rc];
      const t = lit(wn),
        base = name === 'top' ? cols[3] : t > 0.73 ? cols[2] : t > 0.55 ? cols[1] : cols[0];
      const st = Math.max(lu / nu, lv / nvv) * 0.62;
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nvv; j++) {
          const a = (i + 0.5) / nu,
            b = (j + 0.5) / nvv;
          const p = [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
          let c = base;
          if (opt.col) {
            const r2 = opt.col(name, a, b, p);
            if (r2 === -1) continue;
            if (r2 !== undefined) c = r2;
          }
          const dx = p[0] - cx,
            dz = p[2] - cz;
          disc(cx + dx * rc + dz * rs, p[1], cz - dx * rs + dz * rc, wn, st, st * 0.3, P[c], 3, opt.an);
        }
    }
  }
  // ellipsoid shell; opt.col(d, p, nv) may override the palette index
  function ball(cx, cy, cz, rx, ry, rz, cnt, cols, opt) {
    opt = opt || {};
    const st = opt.st || (2.2 * Math.cbrt(rx * ry * rz)) / Math.sqrt(cnt);
    for (let k = 0; k < cnt; k++) {
      const d = fib(k, cnt),
        p = [cx + d[0] * rx, cy + d[1] * ry, cz + d[2] * rz];
      if (opt.minY !== undefined && p[1] < opt.minY) continue;
      const nv = norm([d[0] / rx, d[1] / ry, d[2] / rz]);
      let col;
      if (opt.col) {
        const c = opt.col(d, p, nv);
        if (c === -1) continue;
        col = c === undefined ? shade(nv, cols) : P[c];
      } else col = shade(nv, cols);
      disc(p[0], p[1], p[2], nv, st, st * 0.35, col, 3, opt.an);
    }
    if (!opt.hollow) iso(cx, cy, cz, Math.min(rx, ry, rz) * 0.6, P[cols[0]], 3, opt.an);
  }
  // upright cylinder of discs; opt.lean shifts the top, opt.flute stripes it
  function cyl(bx, by, bz, r, h, cols, opt) {
    opt = opt || {};
    const sp = opt.s || 0.16,
      rows = Math.max(1, Math.round(h / sp)),
      cnt = Math.max(6, Math.round((TAU * r) / sp)),
      lean = opt.lean || [0, 0];
    for (let j = 0; j < rows; j++) {
      const f = (j + 0.5) / rows,
        ox = bx + lean[0] * f,
        oz = bz + lean[1] * f;
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * TAU,
          nv = [Math.cos(a), 0, Math.sin(a)];
        let i = clamp(Math.floor(lit(nv) * cols.length), 0, cols.length - 1);
        if (opt.flute && k % 2 && i > 0) i--;
        disc(ox + nv[0] * r, by + f * h, oz + nv[2] * r, nv, sp * 0.62, sp * 0.2, P[cols[i]], 3, opt.an);
      }
      iso(ox, by + f * h, oz, r * 0.7, P[cols[0]], 3, opt.an);
    }
  }
  // drifting specks that give the void some depth
  function spores(cnt, bx, cols) {
    for (let i = 0; i < cnt; i++)
      iso(rr(bx[0], bx[1]), rr(bx[2], bx[3]), rr(bx[4], bx[5]), 0.025, P[pick(cols)], 2, {
        k: 6,
        ph: R() * TAU,
        sp: rr(0.2, 0.7),
        rg: rr(0.15, 0.5),
        nd: true
      });
  }
  // flat ground patch; fn(x, z, r) returns a palette index, {c, y, an}, or -1 for a gap
  function ground(rad, fade, fn, step) {
    step = step || 0.2;
    for (let x = -rad; x < rad; x += step)
      for (let z = -rad; z < rad; z += step) {
        const px = x + R() * step,
          pz = z + R() * step,
          r = Math.hypot(px, pz);
        if (r > rad || (fade < rad && R() > smooth(rad, fade, r))) continue;
        const res = fn(px, pz, r);
        if (res === undefined || res === -1) continue;
        if (typeof res === 'number') disc(px, 0, pz, UP, step * 0.75, 0.02, P[res], 2.5);
        else disc(px, res.y || 0, pz, UP, step * 0.75, 0.02, P[res.c], 2.5, res.an);
      }
  }
  // orientation helper: yaw about Y after tilt about X after roll about Z; returns [U, V, W] with V the long axis
  function frame(yaw, tilt, roll) {
    const rot = v => {
      let [x, y, z] = v,
        c = Math.cos(roll || 0),
        s2 = Math.sin(roll || 0);
      [x, y] = [x * c - y * s2, x * s2 + y * c];
      c = Math.cos(tilt || 0);
      s2 = Math.sin(tilt || 0);
      [y, z] = [y * c - z * s2, y * s2 + z * c];
      c = Math.cos(yaw || 0);
      s2 = Math.sin(yaw || 0);
      [x, z] = [x * c + z * s2, -x * s2 + z * c];
      return [x, y, z];
    };
    return [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])];
  }
  // box at any orientation, with flat toon faces; opt.col(axis, sign, a, b, p) may override or return -1
  function slab(c, ax, su, sv, sw, cols, opt) {
    opt = opt || {};
    const s = opt.s || 0.16,
      size = [su, sv, sw];
    for (let a = 0; a < 3; a++)
      for (const sg of [-1, 1]) {
        const N = [ax[a][0] * sg, ax[a][1] * sg, ax[a][2] * sg],
          A = ax[(a + 1) % 3],
          Bx = ax[(a + 2) % 3],
          sa = size[(a + 1) % 3],
          sb = size[(a + 2) % 3],
          h = size[a] / 2;
        const nu = Math.max(1, Math.round(sa / s)),
          nv = Math.max(1, Math.round(sb / s)),
          st = Math.max(sa / nu, sb / nv) * 0.62;
        const t = lit(N),
          base = N[1] > 0.75 ? cols[3] : t > 0.73 ? cols[2] : t > 0.55 ? cols[1] : cols[0];
        for (let i = 0; i < nu; i++)
          for (let j = 0; j < nv; j++) {
            const fa = (i + 0.5) / nu,
              fb = (j + 0.5) / nv,
              ua = (fa - 0.5) * sa,
              ub = (fb - 0.5) * sb;
            const p = [
              c[0] + N[0] * h + A[0] * ua + Bx[0] * ub,
              c[1] + N[1] * h + A[1] * ua + Bx[1] * ub,
              c[2] + N[2] * h + A[2] * ua + Bx[2] * ub
            ];
            let col = base;
            if (opt.col) {
              const r2 = opt.col(a, sg, fa, fb, p);
              if (r2 === -1) continue;
              if (r2 !== undefined) col = r2;
            }
            disc(p[0], p[1], p[2], N, st, st * 0.3, P[col], 3, opt.an);
          }
      }
  }
  // a dome of large soft splats that stands in for sky; fn(dir) picks the colour
  function sky(fn, rad) {
    rad = rad || 70;
    for (let k = 0; k < 260; k++) {
      const d = fib(k, 260);
      iso(d[0] * rad, d[1] * rad, d[2] * rad, rad * 0.2, P[fn(d)], 0.85, { em: true, nd: true });
    }
  }
  // recolour solid splats near local lights: table[zone][paletteIndex] gives the lit colour, zone 0 dimmest
  /* Bounce light (optional: nothing calls this unless a diorama asks, or S.bounce is set). Light that has landed on one thing lights
     the things round it, in its own colour: orange off a fire onto snow, green up under a ledge from the moss below. For each dab a
     few lines are sent out over the side it faces; where one lands, the colour already there is what arrives, weaker with distance.
     The dab then takes the palette colour nearest to what it was plus that light. Only palette colours are ever used.
       sdf (x, y, z)  the finished field (S.sdf)
       o.k     how strong (1)            o.reach  how far light carries (2.4)       o.rays  lines to a dab (8)
       o.glow  how much more a glowing thing gives than a lit one (2.5)             o.from  first dab to do (those before are only lit from)
       o.tint  how much of its colour arrives, 0 for brightness only (1)       o.taps  { ramp: [], t: [] } a dab's ramp and brightness */
  let bounced = 0;
  function bounce(sdf, o) {
    o = o || {};
    const k = o.k === undefined ? 1 : o.k,
      reach = o.reach || 2.4,
      rays = o.rays || 8,
      glow = o.glow === undefined ? 2.5 : o.glow,
      from = o.from === undefined ? bounced : o.from,
      cell = 0.3,
      grid = new Map(),
      key = (x, y, z) =>
        (Math.floor(x / cell) + 512) * 1048576 + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512),
      was = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const q = i * 16;
      was[i] = data[q + 7];
      if (data[q + 3] < 1) continue;
      const kk = key(data[q], data[q + 1], data[q + 2]),
        g = grid.get(kk);
      if (g) g.push(i);
      else grid.set(kk, [i]);
    }
    const near = (x, y, z) => {
      let best = -1,
        bd = 0.3 * 0.3;
      const cx = Math.floor(x / cell),
        cy = Math.floor(y / cell),
        cz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (let c = -1; c <= 1; c++) {
            const g = grid.get((cx + a + 512) * 1048576 + (cy + b + 512) * 1024 + (cz + c + 512));
            if (!g) continue;
            for (let j = 0; j < g.length; j++) {
              const q = g[j] * 16,
                dx = data[q] - x,
                dy = data[q + 1] - y,
                dz = data[q + 2] - z,
                d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bd) {
                bd = d2;
                best = g[j];
              }
            }
          }
      return best;
    };
    let changed = 0;
    for (let i = from; i < n; i++) {
      const q = i * 16,
        nv = nrms[i],
        ci = cidx[i];
      if (!nv || ci < 0 || data[q + 3] < 1 || Math.floor(data[q + 11] / 32) % 2) continue;
      const x = data[q],
        y = data[q + 1],
        z = data[q + 2];
      // two directions across the surface
      let ux = -nv[2],
        uz = nv[0],
        ul = Math.hypot(ux, uz);
      if (ul < 1e-3) ((ux = 1), (uz = 0), (ul = 1));
      ux /= ul;
      uz /= ul;
      const vx = nv[1] * uz,
        vy = nv[2] * ux - nv[0] * uz,
        vz = -nv[1] * ux,
        turn = ((i * 0.6180339) % 1) * TAU;
      let er = 0,
        eg = 0,
        eb = 0;
      for (let r = 0; r < rays; r++) {
        // spread evenly over the side the dab faces, more of them near straight out (where light counts most)
        const rad = Math.sqrt((r + 0.5) / rays),
          an = turn + r * 2.399963,
          a = rad * Math.cos(an),
          b = rad * Math.sin(an),
          c = Math.sqrt(Math.max(0, 1 - rad * rad)),
          dx = ux * a + vx * b + nv[0] * c,
          dy = vy * b + nv[1] * c,
          dz = uz * a + vz * b + nv[2] * c;
        let t = 0.12;
        for (let st = 0; st < 24 && t < reach; st++) {
          const h = sdf(x + dx * t, y + dy * t, z + dz * t);
          if (h < 0.02) {
            const j = near(x + dx * t, y + dy * t, z + dz * t);
            if (j >= 0) {
              const pk = was[j],
                f = 1 - t / reach,
                w = f * f * (Math.floor(data[j * 16 + 11] / 32) % 2 ? glow : 1);
              er += ((pk % 256) / 255) * w;
              eg += ((Math.floor(pk / 256) % 256) / 255) * w;
              eb += (Math.floor(pk / 65536) / 255) * w;
            }
            break;
          }
          t += h < 0.06 ? 0.06 : h;
        }
      }
      er /= rays;
      eg /= rays;
      eb /= rays;
      if (er + eg + eb < 0.02) continue;
      /* The light that arrives first moves the dab up its own ramp (o.taps says which ramp it was shaded on and how bright it came
         out, when the sculptor kept them): that is most of what bounce light does, shadows near bright things fill in. Then, if what
         arrives is strongly coloured, the palette colour nearest to that step plus the coloured light is taken, which is how a fire's
         orange gets onto the snow beside it. */
      const tp = o.taps,
        rp = tp && tp.ramp[i],
        lum = 0.3 * er + 0.59 * eg + 0.11 * eb;
      let step = ci;
      if (rp) step = rp[clamp(Math.floor((tp.t[i] + lum * k) * rp.length), 0, rp.length - 1)];
      const c0 = P[step],
        mx = Math.max(c0[0], c0[1], c0[2], 40),
        tint = o.tint === undefined ? 1 : o.tint,
        tr = c0[0] + (c0[0] / mx) * 190 * (er - lum) * k * tint,
        tg = c0[1] + (c0[1] / mx) * 190 * (eg - lum) * k * tint,
        tb = c0[2] + (c0[2] / mx) * 190 * (eb - lum) * k * tint;
      let best = step,
        bd = (c0[0] - tr) * (c0[0] - tr) + (c0[1] - tg) * (c0[1] - tg) + (c0[2] - tb) * (c0[2] - tb);
      if (tint > 0)
        for (let j = 1; j < P.length; j++) {
          const pj = P[j],
            d = (pj[0] - tr) * (pj[0] - tr) + (pj[1] - tg) * (pj[1] - tg) + (pj[2] - tb) * (pj[2] - tb);
          if (d < bd * 0.8) {
            bd = d / 0.8;
            best = j;
          }
        }
      if (best !== ci) {
        const pj = P[best];
        data[q + 7] = (pj[0] | 0) + (pj[1] | 0) * 256 + (pj[2] | 0) * 65536;
        cidx[i] = best;
        changed++;
      }
    }
    bounced = n;
    return changed;
  }
  function relight(lights, table) {
    for (let i = 0; i < n; i++) {
      const o = i * 16,
        c = cidx[i];
      if (c < 0 || data[o + 3] < 1 || Math.floor(data[o + 11] / 32) % 2) continue;
      let best = 0;
      for (const L of lights) {
        const dx = L.p[0] - data[o],
          dy = L.p[1] - data[o + 1],
          dz = L.p[2] - data[o + 2],
          dist = Math.hypot(dx, dy, dz);
        if (dist > L.r) continue;
        const nv = nrms[i],
          face = nv ? clamp(((nv[0] * dx + nv[1] * dy + nv[2] * dz) / (dist || 1)) * 0.6 + 0.5, 0, 1) : 0.7;
        const t = (1 - dist / L.r) * (0.3 + 0.7 * face) * (L.s || 1);
        if (t > best) best = t;
      }
      const zone = best > 0.5 ? 3 : best > 0.3 ? 2 : best > 0.14 ? 1 : 0;
      if (!zone) continue;
      const m = table[zone - 1][c];
      if (m === undefined) continue;
      data[o + 7] = P[m][0] + P[m][1] * 256 + P[m][2] * 65536;
    }
  }
  // water reflection: solid splats above y0 are copied below it, recoloured through map and broken into streaks
  function mirror(y0, inside, map, o) {
    o = o || {};
    const n0 = n,
      gap = o.gap || 3.2,
      maxH = o.maxH || 9;
    for (let i = 0; i < n0; i++) {
      const s = i * 16,
        y = data[s + 1],
        c = cidx[i];
      if (y < y0 + 0.03 || y > y0 + maxH || data[s + 3] < 1 || map[c] === undefined) continue;
      const x = data[s],
        z = data[s + 2],
        dy = y - y0;
      if (!inside(x, z) || (dy * gap + 0.35 * Math.sin(x * 2.3)) % 1 < 0.3 + dy * 0.05) continue;
      push(
        x + 0.06 * Math.sin(dy * 7 + x),
        y0 - dy,
        z,
        data[s + 4],
        -data[s + 5],
        data[s + 6],
        data[s + 8],
        -data[s + 9],
        data[s + 10],
        P[map[c]],
        3,
        { nd: true }
      );
    }
  }
  function star(x, y, z, s2, c, an) {
    stick(x, y, z, [1, 0, 0], s2, s2 * 0.12 + 0.012, P[c], 3, an);
    stick(x, y, z, UP, s2, s2 * 0.12 + 0.012, P[c], 3, an);
  }
  const precipitationRanges = [], fallingSnowRanges = [];
  function describePrecipitation(first, end, profile = false, spatial = true) {
    if (![first, end].every(Number.isSafeInteger) || first < 0 || end < first || end > n || typeof profile !== 'boolean' || typeof spatial !== 'boolean')
      throw new RangeError('Expected a valid precipitation row range');
    if (end > first) {
      if (spatial) precipitationRanges.push({ first, end, profile });
      else fallingSnowRanges.push({ first, end });
    }
  }
  function finish(meta) {
    const pending = globalThis.INK_DECAL_NEXT;
    if (pending) globalThis.INK_DECAL_NEXT = null;
    const paint = meta?.paint ?? pending, px = 1 / (meta?.detail || 12);
    const legacy = Array.isArray(paint) ? paint : paint?.decals ?? [];
    const paintDecals = [];
    for (const [x, y, z, nx, ny, nz, c] of legacy) {
      if (!P[c]) continue;
      paintDecals.push({ index: n, at: [x, y, z], n: [nx, ny, nz] });
      disc(x + nx * px * 0.3, y + ny * px * 0.3, z + nz * px * 0.3, [nx, ny, nz], px * 0.6, px * 0.12, P[c], 3);
    }
    const correctionRows = [];
    if (paint?.layers !== undefined) {
      for (const group of PaintCorrections.groups(paint, px)) {
        const { at: [x, y, z], n: [nx, ny, nz] } = group;
        correctionRows.push({ ...group, index: n });
        // The renderers resolve this reserved row for their own camera.
        disc(x + nx * px * .3, y + ny * px * .3, z + nz * px * .3, group.n,
          px * .65, px * .12, P[0], 0, { nd: true, rg: PaintCorrections.marker });
      }
    }
    const world = Object.assign(
      {
        data: data.subarray(0, n * 16),
        count: n,
        ...(paintDecals.length && { paintDecals }),
        ...(correctionRows.length && { paintCorrections: PaintCorrections.bind(correctionRows) }),
        renderMetadata: renderRows(),
        ...(renderSdfs.length && {renderSdfs:renderSdfs.slice()}),
        ...(precipitationRanges.length && { precipitationRanges: precipitationRanges.slice() }),
        ...(fallingSnowRanges.length && { fallingSnowRanges: fallingSnowRanges.slice() }),
        ...(materialAlbedo && { materialAlbedo: materialAlbedo.slice(0, n) }),
        ...(opticalSplats && {
          opticalSplats: opticalSplats.length < n * OpticalMaterials.STRIDE ?
            Float32Array.from({ length: n * OpticalMaterials.STRIDE }, (_, i) => opticalSplats[i] ?? 0) :
            opticalSplats.slice(0, n * OpticalMaterials.STRIDE)
        }),
        ...(materialPixelStyles && { materialPixelStyles: materialPixelStyles.slice(0, n * 4) }),
        ...(shadowLod && { shadowLod: shadowLod.length >= n * ShadowArt.stride ? shadowLod.slice(0, n * ShadowArt.stride) :
          Float32Array.from({ length: n * ShadowArt.stride }, (_, i) => shadowLod[i] || 0) }),
        attr: attr ? Float32Array.from({ length: n * 4 }, (_, i) => attr[i] || 0) : undefined,
        pix: pix ? Float32Array.from({ length: n * 8 }, (_, i) => pix[i] || 0) : undefined,
        ramps: pix ? ramps.map(r => r.slice()) : undefined,
        rampOff: pix ? rampOff.slice() : undefined,
        pats: pix ? pats.slice() : undefined,
        ...(surfaceData ? { surfaceData: surfaceData.slice(0, n * SurfaceLook.STRIDE), surfaces: surfaces.slice() } : {}),
        fine: fine
          ? fine.length >= n * 12
            ? fine.subarray(0, n * 12)
            : Float32Array.from({ length: n * 12 }, (_, i) => fine[i] || 0)
          : undefined,
        moving: Int32Array.from(moving),
        back: Int32Array.from(back),
        bg: P[0],
        seed,
        pal: hex || PAL_HEX,
        palName: 'Moss',
        dither: 1,
        fog: { c: 0, start: 1, max: 0 },
        outline: { c: 0, edge: 0 },
        radius: 14
      },
      meta
    );
    if (detailBudgets !== undefined)
      world.look = { ...world.look, detailBudgets: detailBudget?.rules ?? false };
    if (shadowSettings !== undefined)
      world.look = { ...world.look, shadowArt: shadowArt?.settings ?? false };
    if (world.environmentPreset !== undefined && world.environmentPreset !== false) {
      const catalog = KIT.authoring.assetPacks.create({ packs:world.assetPacks ?? [] });
      Object.assign(world,KIT.authoring.environments.apply(world,world.environmentPreset,catalog,world.pal));
    }
    if (world.look?.colorLut !== undefined && world.look.colorLut !== false)
      world.look = { ...world.look, colorLut: ColorLUT.normalize(world.look.colorLut) };
    if (world.look?.colorStack !== undefined && world.look.colorStack !== false)
      world.look = { ...world.look, colorStack: ColorStack.normalize(world.look.colorStack) };
    if (world.celestialTracks) world.celestialTracks = CelestialTracks.compile(world.celestialTracks);
    if (world.areaLights !== undefined) AreaLights.prepare(world.areaLights);
    if (world.bounceProbes !== undefined && world.bounceProbes !== false) world.bounceProbes = KIT.bounceProbes.bake(world);
    if (world.relighting !== undefined) SplatRelighting.settings(world.relighting);
    if (world.atmosphereEmitters) world.atmosphereEmitters = KIT.atmosphere.emitters.compile(world.atmosphereEmitters);
    if (world.splatFields) world.splatFields = KIT.splatFields.compile(world.splatFields);
    if (world.surfaceEffects) world.surfaceEffects = KIT.splatEffects.context(world.surfaceEffects);
    return world;
  }
  // hand over everything pushed so far and start again empty
  const take = () => {
    const out = data.slice(0, n * 16);
    n = 0;
    fine = null;
    attr = null;
    attrN = null;
    pix = null;
    pixHas = false;
    surfaceData = null;
    surfacePending = false;
    shadowLod = undefined;
    surfaces.length = 0;
    renderSdfs.length = 0;
    surfaceIds.clear();
    bevelIds = new WeakMap();
    bounced = 0;
    cidx.length = 0;
    nrms.length = 0;
    ownerRows = materialRows = muteEmission = materialAlbedo = materialPixelStyles = opticalSplats = undefined;
    unnamedOwners = new WeakMap();
    unnamedMaterials = new WeakMap();
    ownerIds.clear();
    materialIds.clear();
    targetRows = undefined;
    targetKeys.clear();
    targetNames.length = 1;
    targetValues = new WeakMap();
    ownerNames.length = materialNames.length = 1;
    precipitationRanges.length = fallingSnowRanges.length = 0;
    moving.length = 0;
    back.length = 0;
    return out;
  };
  /* one dab read back: [x, y, z, nx, ny, nz, alpha, kind and flags, packed colour, palette index], or null if it has no surface it lies on */
  const dabAt = (i, out) => {
    const nv = nrms[i];
    if (!nv || i >= n) return null;
    const o = i * 16;
    out = out || new Array(10);
    out[0] = data[o];
    out[1] = data[o + 1];
    out[2] = data[o + 2];
    out[3] = nv[0];
    out[4] = nv[1];
    out[5] = nv[2];
    out[6] = data[o + 3];
    out[7] = data[o + 11];
    out[8] = data[o + 7];
    out[9] = cidx[i];
    return out;
  };
  return {
    detailBudget,
    shadowArt,
    shadowNext,
    count: () => n,
    describeOptical,
    keepRenderSdf(source) {
      for (const ranges of source.rows.values()) for (const range of ranges) {
        const [start,end] = range, points = new Float32Array((end-start)*3);
        for (let i=start;i<end;i++) points.set(data.subarray(i*16,i*16+3),(i-start)*3);
        range.push(points);
      }
      renderSdfs.push(source);
    },
    describeSplats: renderMetadata ? describeSplats : undefined,
    describeAlbedo,
    describePixelStyle,
    describePrecipitation,
    born: v => (bornV = v === undefined || v === null || !isFinite(v) ? null : v),
    wet: v => (wetV = v === undefined || v === null || !isFinite(v) ? null : v),
    fineTile,
    attrNext,
    pixNext,
    surfaceNext,
    dabAt,
    reseed,
    take,
    R,
    rr,
    pick,
    gauss,
    n3,
    fbm,
    P,
    TAU,
    UP,
    clamp,
    mix,
    smooth,
    norm,
    dot,
    add,
    randDir,
    fib,
    iso,
    disc,
    dab,
    stick,
    axial,
    setLight,
    lit,
    shade,
    path,
    spline,
    tube,
    branch,
    box,
    ball,
    cyl,
    spores,
    ground,
    frame,
    slab,
    sky,
    relight,
    bounce,
    mirror,
    star,
    finish
  };
}
