/* Rest-space material patterns with art-pixel filtering. */
const SurfaceDetailKits = (() => {
  const stable = typeof StableDetail === 'undefined' ? require('./stable-detail.js') : StableDetail;
  const axes = {x:[1,0,0],y:[0,1,0],z:[0,0,1]};
  const defaults = {
    'stone-joints': {size:[.66,.36],width:.050,colors:['#3e4443','#879085','#c7bda3']},
    'exposed-brick': {size:[.48,.215],width:.027,colors:['#ad957c','#a35a45','#e09169']},
    'chipped-plaster': {size:[1.2,.90],width:.040,colors:['#846d61','#d2baa3','#f4dfb8']},
    'roof-seams': {size:[.55,.33],width:.038,colors:['#54363c','#955149','#d39372'],axes:['x','z']},
    'cloth-stitching': {size:[.16,.24],width:.042,colors:['#563542','#e5bb88','#fff0bc'],axes:['x','y']},
    'crevice-moss': {size:[.40,.30],width:.15,colors:['#364c36','#657e43','#9da962']}
  };
  const recipes = Object.freeze(Object.keys(defaults));
  const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const clamp = value => Math.max(0,Math.min(1,value));
  const mix = (a,b,t) => a+(b-a)*t;
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const fract = x => x-Math.floor(x);
  const smooth = (lo,hi,value) => {
    const t = clamp((value-lo)/(hi-lo));
    return t*t*(3-2*t);
  };
  function range(value,lo,hi,label) {
    if (!Array.isArray(value) || value.length!==2 || !Array.from(value).every(Number.isFinite) ||
        value[0]<lo || value[1]>hi || value[1]<=value[0])
      throw new RangeError('Detail kit '+label+' needs an increasing range from '+lo+' to '+hi);
    return value.slice();
  }
  function axis(value) {
    const v = typeof value==='string' && Object.hasOwn(axes,value) ? axes[value] : value;
    if (!Array.isArray(v) || v.length!==3 || !Array.from(v).every(Number.isFinite) || !Number.isFinite(Math.hypot(...v)) || Math.hypot(...v)<1e-6)
      throw new TypeError('Detail kit axes need x, y, z or a nonzero XYZ vector');
    const length = Math.hypot(...v);
    return v.map(n=>n/length);
  }
  function prepare(value, readColor) {
    const fields = ['recipe','size','width','origin','axes','seed','variation','coverage','stagger','repeat','colors',
      'fade','normal','exposure','crevices'];
    if (!plain(value) || !Object.hasOwn(defaults,value.recipe) || Object.keys(value).some(key=>!fields.includes(key)))
      throw new TypeError('Detail kit needs a registered recipe and pattern settings');
    const { recipe, seed = 0, origin = [0,0,0], variation = .28, coverage = .72, stagger = .5,
      repeat = false, crevices = 'both' } = value;
    const recipeDefaults = defaults[recipe];
    const { size = recipeDefaults.size, width = recipeDefaults.width, colors = recipeDefaults.colors } = value;
    if (!Array.isArray(size) || size.length!==2 || !Array.from(size).every(n=>Number.isFinite(n) && n>=.0001 && n<=1e4) ||
        !Number.isFinite(width) || width<.0001 || width>Math.min(...size) ||
        !Array.isArray(origin) || origin.length!==3 || !Array.from(origin).every(Number.isFinite) ||
        !Number.isSafeInteger(seed) || [variation,coverage,stagger].some(v=>!Number.isFinite(v)||v<0||v>1) ||
        typeof repeat!=='boolean' || !['both','geometry','joints'].includes(crevices) ||
        !Array.isArray(colors) || colors.length!==3)
      throw new RangeError('Invalid detail kit dimensions, seed, coverage or colors');
    const basis = value.axes ?? recipeDefaults.axes;
    let projection;
    if (basis !== undefined) {
      if (!Array.isArray(basis) || basis.length!==2) throw new TypeError('Detail kit needs two projection axes');
      projection = Array.from(basis,axis);
      if (Math.abs(dot(...projection))>.001) throw new RangeError('Detail kit projection axes must be perpendicular');
    }
    let normal, exposure;
    if (value.normal !== undefined) {
      const n = value.normal;
      if (!plain(n) || Object.keys(n).some(key=>!['axis','range'].includes(key)))
        throw new TypeError('Detail kit normal needs an axis and range');
      normal = { axis:axis(n.axis),range:range(n.range,-1,1,'normal') };
    }
    if (value.exposure !== undefined) {
      const e = value.exposure;
      if (!plain(e) || Object.keys(e).some(key=>!['channel','range','invert'].includes(key)) ||
          !['rain','light','wind','fog'].includes(e.channel) || e.invert!==undefined && typeof e.invert!=='boolean')
        throw new TypeError('Detail kit exposure needs a rain, light, wind or fog channel');
      exposure = {...e,range:range(e.range ?? [0,1],0,1,'exposure')};
    }
    return { recipe,seed,size:size.slice(),width,origin:origin.slice(),projection,normal,exposure,variation,coverage,stagger,
      repeat,crevices, colors:Array.from(colors,readColor), fade:range(value.fade ?? [.44,1.45],0,16,'fade') };
  }
  const needsDistance = settings => Object.values(settings.layers ?? {}).some(layer=>
    layer?.type==='detailKit' && layer.pattern?.recipe==='crevice-moss' && layer.pattern.crevices!=='joints' &&
    (layer.strength!==0 || layer.drive?.strength!==undefined));

  function shade(kit, frame, out, strength, joints, shadow) {
    const { position,normal,footprint,noise,hash,concavity } = frame;
    const { recipe,size,width,origin,projection,coverage,variation,stagger,colors,fade } = kit;
    let weight = strength;
    if (kit.normal) weight *= smooth(...kit.normal.range,dot(normal,kit.normal.axis));
    if (kit.exposure) {
      const exposed = smooth(...kit.exposure.range,frame.exposure?.(kit.exposure.channel) ?? 1);
      weight *= kit.exposure.invert ? 1-exposed : exposed;
    }
    if (!weight) return joints;
    const seed = kit.seed+frame.seed, p = position.map((n,i)=>n-origin[i]);
    const facing = normal.map(Math.abs);
    const basis = projection ?? (facing[1]>Math.max(facing[0],facing[2]) ? [axes.x,axes.z] :
      facing[0]>facing[2] ? [axes.z,axes.y] : [axes.x,axes.y]);
    const u = dot(p,basis[0]), v = dot(p,basis[1]);
    const cellV = Math.floor(v/size[1]), cell = u/size[0]+(cellV&1)*stagger;
    const vPhase = fract(v/size[1])*size[1], uPhase = fract(cell)*size[0];
    const pixel = Math.max(1e-6,footprint);
    const filtered = stable.weight(fade,width/pixel);
    const soft = Math.min(width*.58,pixel*.58);
    const band = distance => (1-smooth(Math.max(0,width*.5-soft),width*.5+soft,distance))*filtered;
    const light = shadow ? .48+.30*frame.visibility+.22*frame.lambert : 1;
    function paint(color,gain,weight) {
      if (!(weight>0)) return;
      const amount=clamp(weight);
      for (let c=0;c<3;c++) {
        out[c]=mix(out[c],color[c]*gain,amount);
        if (frame.reflected) frame.reflected[c]*=1-amount;
      }
    }
    const [dark,base,rim] = colors;

    if (recipe==='chipped-plaster') {
      const grain = (span,key) => mix(.5,noise(p,span,key),stable.weight(fade,span/pixel));
      const field = .68*grain(size[0],seed)+.24*grain(size[1]*.43,seed+19)+.08*grain(size[1]*.17,seed+31);
      const cut = 1-coverage, transition = Math.max(.012,Math.min(.16,pixel/size[0]*.65));
      const cover = mix(coverage,smooth(cut-transition,cut+transition,field),stable.weight(fade,size[0]/pixel));
      const lip = cover*(1-smooth(cut,cut+width/size[0]*1.9,field))*filtered;
      paint(base,light,cover*weight*.93);
      paint(dark,light,lip*weight*.72);
      paint(rim,light,lip*weight*.28);
      return joints*(1-cover*weight);
    }
    if (recipe==='crevice-moss') {
      if (!filtered) return joints;
      const geometry = kit.crevices==='joints' ? 0 : concavity(width);
      const recessed = Math.max(geometry,kit.crevices==='geometry' ? 0 : joints);
      if (!recessed) return joints;
      const grain = noise(p,size[0]*.32,seed);
      const patch = smooth(1-coverage-.16,1-coverage+.16,noise(p,size[0],seed+5));
      const moss = patch*Math.sqrt(recessed)*weight*filtered;
      paint(dark,light,moss*.90);
      paint(base,light,moss*smooth(.17,.66,grain));
      paint(rim,light,moss*smooth(.63,.90,grain)*.65);
      return joints;
    }
    if (recipe==='cloth-stitching') {
      const along = Math.max(0,Math.abs(uPhase-size[0]*.5)-size[0]*.26);
      const across = kit.repeat ? Math.min(vPhase,size[1]-vPhase) : Math.abs(v);
      paint(dark,light,band(Math.hypot(along,across+width*.30))*weight*.63);
      paint(base,light,band(Math.hypot(along,across))*weight);
      paint(rim,light,band(Math.hypot(along,across*1.4))*weight*.40);
      return joints;
    }

    const hEdge = Math.min(vPhase,size[1]-vPhase);
    const vEdge = Math.min(uPhase,size[0]-uPhase);
    const vertical = recipe==='roof-seams' ? band(vEdge)*(1-smooth(size[1]*.48,size[1]*.80,vPhase)) : band(vEdge);
    const seam = Math.max(band(hEdge),vertical);
    const lip = band(Math.abs(vPhase-width*.86))*(1-seam);
    const tone = hash(Math.floor(cell),cellV,0,seed)-.5;
    const cellDetail = stable.weight(fade,Math.min(...size)/pixel);
    if (recipe==='exposed-brick' || recipe==='roof-seams') {
      const body = .89+tone*variation*cellDetail*.46;
      paint(base,light*body,weight*.88);
    } else {
      const gain = 1+tone*variation*weight*cellDetail*.42;
      for (let c=0;c<3;c++) {
        out[c]=clamp(out[c]*gain);
        if (frame.reflected) frame.reflected[c]=clamp(frame.reflected[c]*gain);
      }
    }
    paint(dark,light,seam*weight*.93);
    paint(rim,light,lip*weight*(recipe==='stone-joints' ? .44 : .68));
    return Math.max(joints,seam*weight);
  }

  return Object.freeze({ recipes,prepare,needsDistance,shade });
})();
if (typeof module !== 'undefined') module.exports = SurfaceDetailKits;
