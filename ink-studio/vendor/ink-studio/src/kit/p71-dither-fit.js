/* Offline fitting of an approved pair to a target at the actual art resolution. */
(function (K) {
  const materials = K.procedural.materials;
  const linear = ColorSpace.prepare('srgb', 'srgb-linear');
  const display = ColorSpace.prepare('srgb-linear', 'srgb');
  const lab = ColorSpace.toOKLab;
  const hex = rgb => '#' + rgb.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16).padStart(2, '0')).join('');
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function prepare(definition, { palette, roles } = {}) {
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype ||
        Object.keys(definition).some(key => !['target', 'policy', 'size'].includes(key)))
      throw new TypeError('A dither fit needs a target, palette policy and optional size');
    const { target, policy, size = [32, 24] } = definition;
    if (!(typeof target === 'string' && /^#[\da-f]{6}$/i.test(target) ||
        Array.isArray(target) && target.length === 3 && Array.from(target).every(n => Number.isFinite(n) && n >= 0 && n <= 1)))
      throw new TypeError('Dither fit target needs a hex swatch or normalized RGB');
    if (!Array.isArray(size) || size.length !== 2 ||
        !Array.from(size).every(n => Number.isSafeInteger(n) && n >= 1 && n <= 256))
      throw new RangeError('Dither fit width and height must be integers in [1, 256]');
    if (!Array.isArray(policy?.dither?.pairs))
      throw new TypeError('Dither fitting needs an explicit dither.pairs list');
    const plan = PixelLook.preparePalette(policy, { palette, roles, blueNoise: materials.blueNoise, prepareDitherTile: true, validateOnly: true });
    const [w, h] = size, area = w * h, pattern = policy.dither.pattern ?? 'bayer';
    const targetHex = typeof target === 'string' ? target.toLowerCase() : hex(target);
    const targetRgb = [1, 3, 5].map(i => parseInt(targetHex.slice(i, i + 2), 16) / 255);
    const targetLab = lab(targetRgb), lightness = Math.min(1, Math.max(0, targetLab[0]));
    const swatches = plan.swatches.map(hex), locked = plan.reservedIndex(targetRgb);
    let best = locked ?? 0, solidError = locked === undefined ? Infinity : 0;
    if (locked === undefined) for (const i of plan.matchSlots) {
      const error = distance(targetLab, lab(plan.swatches[i]));
      if (error < solidError) {
        best = i;
        solidError = error;
      }
    }

    const byPair = new Map();
    for (const { slots, lightness: range } of plan.pairs) {
      const a = Math.min(...slots), b = Math.max(...slots), key = a * swatches.length + b;
      if (!byPair.has(key)) byPair.set(key, { slots:[a,b], matchesLightness:false, ranges:[] });
      const pair = byPair.get(key);
      pair.ranges.push(range ?? null);
      if (!range || lightness >= range[0] && lightness <= range[1]) pair.matchesLightness = true;
    }
    const scale = plan.tuning?.scale ?? 1;
    const rankAt = (x, y) => plan.ranks[Math.floor(x / scale) % plan.width + (Math.floor(y / scale) % plan.height) * plan.width];
    const pairs = [...byPair].sort(([a], [b])=>a-b).map(([,pair])=>pair);
    return { w,h,area,targetLab,target:targetHex,lightness,pattern,scale,locked,rankAt,pairs,seed:policy.dither.seed ?? 0,
      swatches, rgb:plan.swatches, solid:{color:swatches[best],error:solidError} };
  }

  function coverageLevels({ w,h,area,rankAt }) {
    // All attainable two-color coverages, including partial tiles at the edges.
    const counts = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const rank = rankAt(x, y);
      counts.set(rank, 1 + (counts.get(rank) ?? 0));
    }
    const shares = [];
    let pixels = 0;
    for (const [rank, count] of [...counts].sort(([a], [b]) => a - b)) {
      pixels += count;
      if (pixels < area) shares.push({ rank, pixels, share: pixels / area });
    }
    return shares;
  }

  function bestMix(target, colors, linearSwatches, [a,b], coverages) {
    const start = linearSwatches[a], delta = linearSwatches[b].map((n,i)=>n-start[i]);
    let error = Infinity, mix, rgb;
    for (const coverage of coverages) {
      const candidate = display(start.map((n,i)=>n+delta[i]*coverage.share));
      const difference = distance(target,lab(candidate));
      if (difference >= error) continue;
      error = difference;
      mix = coverage;
      rgb = candidate;
    }
    return { colors, secondPixels:mix.pixels, share:mix.share, average:hex(rgb), error, cutoff:mix.rank };
  }

  function indexed({ w,h,area,rankAt }, {colors,cutoff}, { size = [1, h / w], wrap = false } = {}) {
    return { width:w,height:h,palette:colors.slice(),origin:'top-left',size,wrap,
      slots:Array.from({ length:area }, (_,i)=>Number(rankAt(i%w,Math.floor(i/w))<=cutoff)) };
  }

  function compare(tile, references) {
    const {width:w,height:h}=tile, offset=references.length, width=w+offset*(w+2);
    const slots = new Array(width*h).fill(null);
    for (let y=0;y<h;y++) {
      const row=y*width;
      for (let i=0;i<offset;i++) slots.fill(i,row+i*(w+2),row+i*(w+2)+w);
      for (let x=0;x<w;x++) slots[row+offset*(w+2)+x]=offset+tile.slots[y*w+x];
    }
    return {width,height:h,palette:[...references,...tile.palette],slots};
  }

  function fitDither(definition, context) {
    const plan = prepare(definition,context), {target,lightness,pattern,solid,locked,swatches} = plan;
    let best = {colors:[solid.color],secondPixels:0,share:0,average:solid.color,error:solid.error,cutoff:-1};
    const eligible = locked === undefined && solid.error > 0 && pattern !== 'none' ?
      plan.pairs.filter(pair=>pair.matchesLightness) : [];
    if (eligible.length) {
      const coverages = coverageLevels(plan), endpoints = plan.rgb.map(rgb=>linear(rgb));
      if (coverages.length) for (const {slots} of eligible) {
        const fit = bestMix(plan.targetLab,slots.map(i=>swatches[i]),endpoints,slots,coverages);
        if (fit.error < best.error) best = fit;
      }
    }
    const {cutoff,...fit}=best;
    const report = K.procedural.data.freeze({target,lightness,pattern,solid,fit});
    return Object.freeze({report,indexed:options=>indexed(plan,best,options),
      preview:()=>compare(indexed(plan,best),[target,solid.color])});
  }

  function adjacentEdges({w,h,rankAt}, cutoff) {
    let different=0;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const second=rankAt(x,y)<=cutoff;
      if (x+1<w && second!==(rankAt(x+1,y)<=cutoff)) different++;
      if (y+1<h && second!==(rankAt(x,y+1)<=cutoff)) different++;
    }
    const total=(w-1)*h+(h-1)*w;
    return {different,total,share:total ? different/total : 0};
  }

  function reviewDither(definition, context) {
    if (!definition || Object.getPrototypeOf(definition)!==Object.prototype)
      throw new TypeError('A dither review needs a fit definition');
    const { review = {}, ...fit } = definition;
    if (!review || Object.getPrototypeOf(review)!==Object.prototype ||
        Object.keys(review).some(key=>!['minGain','textureLimit','share'].includes(key)))
      throw new TypeError('Dither review needs optional minGain, textureLimit and share settings');
    const {minGain=.01,textureLimit=.12,share}=review;
    if (![minGain,textureLimit].every(n=>Number.isFinite(n)&&n>=0) ||
        share!==undefined && (!Number.isFinite(share)||share<=0||share>=1))
      throw new RangeError('Use nonnegative dither review limits and an optional share strictly between 0 and 1');
    const plan=prepare(fit,context), {target,lightness,pattern,scale,seed,solid,locked,swatches,w,h}=plan;
    const all = pattern==='none' || locked!==undefined || !plan.pairs.some(pair=>pair.matchesLightness) ? [] : coverageLevels(plan);
    const coverages=share===undefined || !all.length ? all :
      [all.reduce((a,b)=>Math.abs(b.share-share)<Math.abs(a.share-share) ? b : a)];
    const endpoints=plan.rgb.map(rgb=>linear(rgb)), sites=plan.rgb.map(lab);
    const cutoffs=[], edgesByCutoff=new Map();
    const pairs=plan.pairs.map(({slots,matchesLightness,ranges},index)=>{
      const [a,b]=slots, colors=slots.map(i=>swatches[i]);
      const contrast={distance:distance(sites[a],sites[b]),lightness:Math.abs(sites[a][0]-sites[b][0])};
      const status=locked!==undefined ? 'reserved-target' : pattern==='none' ? 'dither-disabled' :
        !matchesLightness ? 'outside-lightness' : coverages.length ? 'reviewed' : 'no-mixed-coverage';
      const base={index,colors,contrast,status,lightnessRanges:ranges};
      if (status!=='reviewed') return base;
      const {cutoff,...mix}=bestMix(plan.targetLab,colors,endpoints,slots,coverages);
      cutoffs[index]=cutoff;
      if (!edgesByCutoff.has(cutoff)) edgesByCutoff.set(cutoff,adjacentEdges(plan,cutoff));
      const edges=edgesByCutoff.get(cutoff), gain=solid.error-mix.error;
      const mixRms=contrast.distance*Math.sqrt(mix.share*(1-mix.share));
      const edgeRms=contrast.distance*Math.sqrt(edges.share);
      const texture={edges,mixRms,edgeRms,score:Math.max(mixRms,edgeRms)};
      const flags=[];
      if (gain<=0) flags.push('no-improvement');
      else if (gain<minGain) flags.push('small-improvement');
      if (texture.score>textureLimit) flags.push('high-texture');
      return {...base,mix:{secondPixels:mix.secondPixels,share:mix.share,average:mix.average,error:mix.error},
        gain,texture,flags,useful:flags.length===0};
    });
    const report=K.procedural.data.freeze({target,lightness,pattern,scale,width:w,height:h,metric:'oklab-distance',
      ...(pattern==='blue-noise' && {seed}),settings:{minGain,textureLimit,...(share!==undefined && {share})},solid,pairs});
    function tile(index,options) {
      const pair=pairs[index];
      if (!Number.isSafeInteger(index) || pair?.status!=='reviewed')
        throw new RangeError('Choose a reviewed dither pair index');
      return indexed(plan,{colors:pair.colors,cutoff:cutoffs[index]},options);
    }
    return Object.freeze({report,indexed:tile,preview:index=>compare(tile(index),[target,solid.color,pairs[index].mix.average])});
  }

  materials.fitDither = fitDither;
  materials.reviewDither = reviewDither;
})(KIT);
