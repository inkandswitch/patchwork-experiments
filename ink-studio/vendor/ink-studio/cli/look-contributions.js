const PixelLook = require('../src/pixel-look.js');
const ArtStability = require('../src/art-stability.js');
const { policyChoice } = require('./palette-pixel.js');

function contributionLook(palettes, policies, targets, targetOffset, fallback, scene, grade) {
  const slot = (i, layer) => targets?.[i] ? targetOffset + targets[i] : layer || fallback;
  const underSlot = layer => [layer, fallback].find(id => id && !policies?.[id - 1]?.mask);
  const spatial = anchor => anchor && anchor.dither !== 'screen';
  function needsSample(i, layer, anchor) {
    const policy = policies?.[slot(i, layer) - 1], explicit = policy?.anchor;
    return Boolean(policy && (policy.mask || policy.tuning?.regions.length || spatial(explicit ?? anchor)));
  }
  function shade(i, layer, rgb, x, y, sample, dither, visit, inherited, claim) {
    const id = slot(i, layer);
    if (!id) return rgb;
    const policy = policies?.[id - 1];
    const choose = (id, plan, weight) => {
      const trace = claim?.[4] && {}, swatches = plan?.swatches ?? palettes[id - 1];
      let index;
      if (plan) {
        const [dx, dy] = ArtStability.sampleCoordinates(plan.anchor ?? inherited, sample, x, y);
        index = PixelLook.paletteIndex(plan, rgb, dx, dy, { scene, grade, useDither:dither, trace,
          placement:plan.tuning && { pixel:[x,y],inherited,sample } });
      } else index = PixelLook.nearest(rgb, swatches, false);
      if (trace) policyChoice(claim[4],plan,rgb,index,{...trace,blended:weight<1},weight,{stage:'lit',colors:plan?.packed ??
        swatches.map(rgb=>rgb.reduce((n,v)=>n*256+Math.round(v*255),0))});
      return swatches[index];
    };
    const amount = policy?.mask ? sample ? policy.mask(sample) : 0 : 1;
    if (amount && policy && visit) visit(policy, policy.mask ? amount : null, amount);
    if (amount === 1) {
      if (claim) claim[0] = id;
      return choose(id,policy,1);
    }

    // A soft mask reveals the underlying material or default look in the same fragment.
    const under = underSlot(layer);
    if (claim) claim[0] = amount > .5 ? id : under ?? 0;
    const underlying = policies?.[under - 1];
    if (!amount && underlying && visit) visit(underlying, null, 1);
    const base = under ? choose(under,underlying,1-amount) : rgb;
    if (!amount) return base;
    return choose(id,policy,amount).map((value, channel) => base[channel] + (value - base[channel]) * amount);
  }
  return { shade, applies: slot, needsSample };
}

function contributionLayers(col, alpha, w, h, patterned, bend) {
  // Pattern RGB and its surviving alpha. Later fragments attenuate only this contribution.
  const pattern = patterned ? new Float32Array(w * h * 4) : null;
  // Captured backdrop RGB, transmission, backdrop alpha, pattern coverage, pane depth and refraction weight.
  const REAR = 8;
  let backdrop;

  function before(p, r, g, b, a, winner, glass, depth, refraction = 1) {
    const ia = 1 - a, q = p * 4, j = p * REAR, k = p * 3;
    if (glass && bend) {
      backdrop ??= new Float32Array(w * h * REAR);
      if (!backdrop[j + 3]) {
        for (let c = 0; c < 3; c++) backdrop[j + c] = col[k + c];
        backdrop[j + 3] = 1;
        backdrop[j + 4] = alpha?.[p] ?? 1;
        backdrop[j + 5] = pattern?.[q + 3] ?? 0;
        backdrop[j + 6] = depth;
        backdrop[j + 7] = refraction;
      }
    }
    if (backdrop) {
      backdrop[j + 3] *= ia;
      if (winner) backdrop[j + 5] = 0;
    }
    if (!pattern) return;
    if (winner) {
      pattern[q] = r;
      pattern[q + 1] = g;
      pattern[q + 2] = b;
      pattern[q + 3] = a;
    } else pattern[q + 3] *= ia;
  }

  function replacePattern(p, rgb) {
    const q = p * 4, j = p * REAR, k = p * 3;
    for (let c = 0; c < 3; c++) {
      const change = rgb[c] - pattern[q + c];
      col[k + c] += change * pattern[q + 3];
      if (backdrop) backdrop[j + c] += change * backdrop[j + 5];
    }
  }

  function refract(glass, depth, linear = false) {
    if (!backdrop) return;
    const at = (x, y) => Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x));
    const colors = linear ? col.slice() : col, coverage = linear && alpha ? alpha.slice() : alpha;
    function tap(p, j, source, weight) {
      if (!weight || source === p) return;
      const sourceRear = backdrop[source * REAR + 3] > 0;
      if (!sourceRear && depth[source] < backdrop[j + 6]) return;
      const from = source * (sourceRear ? REAR : 3), samples = sourceRear ? backdrop : colors;
      for (let c = 0; c < 3; c++) col[p * 3 + c] += (samples[from + c] - backdrop[j + c]) * weight;
      if (alpha) alpha[p] += ((sourceRear ? backdrop[from + 4] : coverage[source]) - backdrop[j + 4]) * weight;
    }
    for (let p = 0; p < w * h; p++) {
      const j = p * REAR, weight = backdrop[j + 3] * backdrop[j + 7];
      if (weight < 1e-6 || glass[p] < 1e-6) continue;
      const x = p % w, y = Math.floor(p / w);
      const dx = (glass[at(x + 1, y)] - glass[at(x - 1, y)]) * bend;
      const dy = (glass[at(x, y + 1)] - glass[at(x, y - 1)]) * bend;
      if (!linear) {
        tap(p, j, at(x + Math.round(dx), y + Math.round(dy)), weight);
        continue;
      }
      const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
      tap(p, j, at(x + ix, y + iy), weight * (1 - fx) * (1 - fy));
      tap(p, j, at(x + ix + 1, y + iy), weight * fx * (1 - fy));
      tap(p, j, at(x + ix, y + iy + 1), weight * (1 - fx) * fy);
      tap(p, j, at(x + ix + 1, y + iy + 1), weight * fx * fy);
    }
  }

  return { before, replacePattern, refract, weight: pixel => pattern?.[pixel * 4 + 3] || 0 };
}

module.exports = { contributionLook, contributionLayers };
