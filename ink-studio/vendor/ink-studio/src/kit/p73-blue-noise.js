/* Toroidal void-and-cluster threshold ranks for pixel-scale stipple. */
(function (K) {
  const P = K.procedural,
    integer = (n,a,b) => Number.isSafeInteger(n) && n >= a && n <= b,
    mod = (n,d) => ((n%d)+d)%d;
  function blueNoise({
    width = 32, height = width, sigma = 1.4, density = 0.13,
    attempts = width * height * 2, seed = 0, maxWork = 105000000
  } = {}) {
    if (!integer(width,4,96) || !integer(height,4,96) ||
      !Number.isFinite(sigma) || sigma < 0.35 || sigma > 8 || !Number.isFinite(density) || density <= 0 || density >= 0.5 ||
      !integer(attempts,0,50000) || !Number.isSafeInteger(seed) || !integer(maxWork,1,220000000))
      throw new Error('Blue-noise ranks need a bounded periodic grid, Gaussian width and seed');
    const size = width * height, half = Math.floor(size * 0.5),
      first = Math.min(half-1,Math.max(1,Math.round(size*density))),
      radius = Math.ceil(3*sigma), kernel = [];
    for (let y = -Math.min(radius,Math.floor(height/2)); y <= Math.min(radius,Math.floor((height-1)/2)); y++)
      for (let x = -Math.min(radius,Math.floor(width/2)); x <= Math.min(radius,Math.floor((width-1)/2)); x++) {
        if (x*x+y*y > radius*radius) continue;
        kernel.push({ x,y,weight: Math.exp(-(x*x+y*y)/(2*sigma*sigma)) });
      }
    const mandatory = size * size + (first * 2 + size + size - half) * kernel.length;
    if (mandatory > maxWork) throw new Error('Blue-noise ranks exceed their work budget');
    const relaxation = Math.min(attempts,Math.floor((maxWork-mandatory)/(2*(size+kernel.length)))),
      heat = new Float64Array(size), on = new Uint8Array(size), ranks = new Int32Array(size),
      order = Int32Array.from({ length:size },(_,i)=>i), rng = K.grow.dice(P.data.hash('void-and-cluster',seed));
    let work = 0;
    function toggle(i, value) {
      const x = i % width, y = Math.floor(i / width), sign = value ? 1 : -1;
      for (const d of kernel) heat[mod(y+d.y,height)*width+mod(x+d.x,width)] += d.weight * sign;
      on[i] = Number(value);
      work += kernel.length;
    }
    for (let i = 0; i < size-1; i++) {
      const j = i + Math.floor(rng() * (size-i)), q = order[i];
      order[i] = order[j];
      order[j] = q;
    }
    const priority = new Int32Array(size);
    for (let i = 0; i < size; i++) priority[order[i]] = i;
    for (let i = 0; i < first; i++) toggle(order[i],true);
    function extreme(wantCluster) {
      let selected = -1, best = -Infinity;
      const need = Number(wantCluster);
      for (let i = 0; i < size; i++) {
        if (on[i] !== need) continue;
        const value = wantCluster ? heat[i] : -heat[i];
        if (value > best + 1e-11 || (Math.abs(value-best) <= 1e-11 && priority[i] < priority[selected])) {
          best = value;
          selected = i;
        }
      }
      work += size;
      return selected;
    }
    let swaps = 0, converged = false;
    for (let i = 0; i < relaxation; i++) {
      const from = extreme(true);
      toggle(from,false);
      const to = extreme(false);
      if (to === from || heat[from] - heat[to] < 1e-11) {
        toggle(from,true);
        converged = true;
        break;
      }
      toggle(to,true);
      swaps++;
    }
    const prototype = on.slice();
    for (let rank = first-1; rank >= 0; rank--) {
      const at = extreme(true);
      ranks[at] = rank;
      toggle(at,false);
    }
    heat.fill(0);
    for (let i = 0; i < size; i++) if (prototype[i]) toggle(i,true);
    for (let rank = first; rank < half; rank++) {
      const at = extreme(false);
      ranks[at] = rank;
      toggle(at,true);
    }
    heat.fill(0);
    const complement = Uint8Array.from(on,v=>1-v);
    on.fill(0);
    for (let i = 0; i < size; i++) if (complement[i]) toggle(i,true);
    for (let rank = half; rank < size; rank++) {
      const at = extreme(true);
      ranks[at] = rank;
      toggle(at,false);
    }
    return Object.freeze({ width,height,ranks, converged, work: Object.freeze({ swaps, comparisons:work }),
      sample(x,y) {
        if (![x,y].every(v => Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER)) throw new Error('Blue-noise coordinates must be finite');
        const i = mod(Math.floor(y),height)*width + mod(Math.floor(x),width);
        return (ranks[i]+0.5)/size;
      }
    });
  }
  P.materials.blueNoise = blueNoise;
})(KIT);
