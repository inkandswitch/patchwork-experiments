/* Shared image distributions measured from exact RGB8 pixel frequencies. */
const PaletteDistributions = (() => {
  let spaces, rasters;
  try { spaces = ColorSpace; rasters = PaletteExtract; }
  catch { spaces = require('./color-space.js'); rasters = require('./palette-extract.js'); }
  const families = [
    ['red','#e45d62'],['orange','#e68c52'],['yellow','#e5c663'],['lime','#a6c459'],
    ['green','#63b875'],['mint','#56bf9f'],['cyan','#58bfc8'],['azure','#629bd7'],
    ['blue','#697bd5'],['violet','#9a77d3'],['magenta','#c974c5'],['rose','#d7739c'],
    ['neutral','#9ba2aa']
  ];
  const roles = ['shadows','midtones','highlights','accents'];
  const metrics = Object.freeze({brightness:'oklab-lightness',hue:'hsv-hue-families',saturation:'hsv-saturation'});
  const unit = n=>Number.isFinite(n) && n>=0 && n<=1;
  const clamp = n=>Math.max(0,Math.min(1,n));
  const fraction = (value,total)=>total ? value/total : 0;
  const swatch = packed=>'#'+packed.toString(16).padStart(6,'0');

  function settings(value = {}) {
    if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(key=>
      !['bins','alpha','shadow','highlight','neutralSaturation','neutralChroma','accentSaturation','accentChroma'].includes(key)))
      throw new TypeError('Palette distributions need histogram and colour classification settings');
    const { bins=12,alpha='visible',shadow=.40,highlight=.75,neutralSaturation=.10,neutralChroma=.02,
      accentSaturation=.65,accentChroma=.10 } = value;
    if (!Number.isSafeInteger(bins) || bins<2 || bins>32 || !['visible','opaque','all'].includes(alpha) ||
        ![shadow,highlight,neutralSaturation,neutralChroma,accentSaturation,accentChroma].every(unit) || shadow>=highlight)
      throw new RangeError('Use 2–32 bins, an alpha mode, and valid distribution thresholds with shadow below highlight');
    return {bins,alpha,shadow,highlight,neutralSaturation,neutralChroma,accentSaturation,accentChroma};
  }

  function hsv([r,g,b]) {
    const high = Math.max(r,g,b), spread = high-Math.min(r,g,b);
    if (!spread) return [0,0];
    const hue = r===high ? (g-b)/spread : g===high ? 2+(b-r)/spread : 4+(r-g)/spread;
    return [Math.floor((hue*2+.5+12)%12),spread/high];
  }

  function inspect(image, config) {
    const { colors,counts,dimensions,alpha } = rasters.colorHistogram(image,{alpha:config.alpha});
    const brightness = new Uint32Array(config.bins), saturation = new Uint32Array(config.bins);
    const hue = new Uint32Array(families.length);
    const toneSwatches = new Uint32Array(roles.length);
    const groups = roles.map(()=>families.map(()=>({pixels:0,peak:0,color:0})));
    const push = (role,family,color,pixels)=>{
      const row = groups[role][family];
      toneSwatches[role]++;
      row.pixels += pixels;
      if (pixels>row.peak || pixels===row.peak && color<row.color) {
        row.peak = pixels;
        row.color = color;
      }
    };
    const slot = n=>Math.min(config.bins-1,Math.floor(n*config.bins));
    for (const color of colors) {
      const pixels = counts(color), rgb=[color>>16,(color>>8)&255,color&255].map(n=>n/255);
      const [L,a,b] = spaces.toOKLab(rgb), lightness = clamp(L), chroma = Math.hypot(a,b);
      const [sector,saturationValue] = hsv(rgb);
      const family = !saturationValue || saturationValue<config.neutralSaturation || chroma<config.neutralChroma ? families.length-1 : sector;
      brightness[slot(lightness)] += pixels;
      saturation[slot(saturationValue)] += pixels;
      hue[family] += pixels;
      push(lightness<config.shadow ? 0 : lightness<config.highlight ? 1 : 2,family,color,pixels);
      if (family!==families.length-1 && saturationValue>=config.accentSaturation && chroma>=config.accentChroma)
        push(3,family,color,pixels);
    }
    const bins = histogram=>Array.from(histogram,(pixels,i)=>({
      range:[i/config.bins,(i+1)/config.bins],pixels,share:fraction(pixels,alpha.included)
    }));
    const tones = Object.fromEntries(groups.map((rows,i)=>{
      const pixels=rows.reduce((sum,row)=>sum+row.pixels,0);
      const present=rows.flatMap((row,k)=>row.pixels ? [{
        family:families[k][0],swatch:swatch(row.color),pixels:row.pixels,share:fraction(row.pixels,pixels)
      }] : []).sort((a,b)=>b.pixels-a.pixels);
      return [roles[i],{pixels,share:fraction(pixels,alpha.included),swatches:toneSwatches[i],families:present}];
    }));
    return { ...dimensions, alpha, sourceSwatches:colors.length, brightness:bins(brightness),saturation:bins(saturation),
      hue:Array.from(hue,(pixels,i)=>({family:families[i][0],swatch:families[i][1],pixels,share:fraction(pixels,alpha.included)})),
      tones };
  }

  function analyze(image, options) {
    const config=settings(options);
    return { settings:config,metrics,...inspect(image,config) };
  }

  function compare(reference, studio, options) {
    const config=settings(options), source=inspect(reference,config), result=inspect(studio,config);
    const delta=key=>source[key].map(({share,range,family},i)=>({
      ...(range ? {range:range.slice()} : {family}),referenceShare:share,studioShare:result[key][i].share,
      change:result[key][i].share-share
    }));
    return { settings:config,metrics,reference:source,studio:result,
      differences:{brightness:delta('brightness'),hue:delta('hue'),saturation:delta('saturation'),
        tones:Object.fromEntries(roles.map(role=>[role,result.tones[role].share-source.tones[role].share]))} };
  }
  return Object.freeze({ analyze, compare });
})();
if (typeof module !== 'undefined') module.exports = PaletteDistributions;
