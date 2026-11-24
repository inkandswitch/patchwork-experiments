/* Indexed artwork and measurements for palette and pair charts. */
(function (K) {
  const materials = K.procedural.materials, colors = materials.perceptual;
  const types = ['swatches','brightness','saturation','closest-pairs','dither-pairs'];
  const integer = (n,min,max)=>Number.isSafeInteger(n) && n>=min && n<=max;
  const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const unit = n=>Number.isFinite(n) && n>=0 && n<=1;
  const hex = rgb=>'#'+colors.toHex(rgb).toString(16).padStart(6,'0');
  let font;

  function swatchRows(palette) {
    return Array.from(palette,(value,index)=>{
      const input = colors.parse(value);
      if (!Array.from(input).every(unit)) throw new TypeError('Palette swatches need finite normalized RGB');
      const rgb = input.map(n=>Math.round(n*255)/255);
      const hi = Math.max(...rgb), lo = Math.min(...rgb), lab = colors.lab(rgb);
      return {index,rgb,lab,lightness:Math.max(0,Math.min(1,lab[0])),saturation:hi ? (hi-lo)/hi : 0};
    });
  }

  function swatchPairs(rows) {
    const pairs = [];
    for (let a=0;a<rows.length-1;a++) for (let b=a+1;b<rows.length;b++) {
      const x = rows[a].lab, y = rows[b].lab;
      pairs.push({indices:[a,b],distance:Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2]),
        lightnessDelta:Math.abs(x[0]-y[0])});
    }
    return pairs.sort((a,b)=>a.distance-b.distance || a.indices[0]-b.indices[0] || a.indices[1]-b.indices[1]);
  }

  function reviewPairs(definition) {
    if (!record(definition) || Object.keys(definition).some(key=>
      !['palette','maxDistance','maxLightnessDelta','sort','limit','columns'].includes(key)))
      throw new TypeError('Palette pair review needs a palette and review settings');
    const {palette, maxDistance=.035, maxLightnessDelta=.02, sort='distance', limit=12, columns=4} = definition;
    if (!Array.isArray(palette) || palette.length>256 || !unit(maxDistance) || !unit(maxLightnessDelta) ||
        !['distance','lightness'].includes(sort) || !integer(limit,1,256) || !integer(columns,1,16))
      throw new RangeError('Use up to 256 swatches, thresholds in [0, 1], a distance or lightness sort, and valid preview dimensions');

    const rows = swatchRows(palette), swatches = rows.map(row=>hex(row.rgb));
    const pairs = swatchPairs(rows).map((pair,i)=>{
      const [a,b] = pair.indices, duplicate = swatches[a] === swatches[b];
      return { ...pair, swatches:[swatches[a],swatches[b]], distanceRank:i+1,
        classification:duplicate ? 'duplicate' : pair.distance<=maxDistance ? 'close' : 'distinct',
        lowLightnessSeparation:pair.lightnessDelta<=maxLightnessDelta };
    });
    const lightnessOrder = pairs.slice().sort((a,b)=>a.lightnessDelta-b.lightnessDelta || a.distanceRank-b.distanceRank);
    lightnessOrder.forEach((pair,i)=>{pair.lightnessRank=i+1;});
    const ordered = sort === 'lightness' ? lightnessOrder : pairs;
    const groups = new Map();
    swatches.forEach((swatch,index)=>{
      if (!groups.has(swatch)) groups.set(swatch,[]);
      groups.get(swatch).push(index);
    });
    const duplicateGroups = Array.from(groups,([swatch,indices])=>({swatch,indices})).filter(row=>row.indices.length>1);
    const visible = ordered.slice(0,limit), cols = Math.min(columns,visible.length);
    const cells = visible.map(({indices,distanceRank,lightnessRank},i)=>({
      indices,distanceRank,lightnessRank,bounds:[(i%cols)*3,Math.floor(i/cols)*2,2,1]
    }));
    const w = cols ? 3*cols-1 : 1, h = cols ? 2*Math.ceil(cells.length/cols)-1 : 1;
    const bytes = rows.map(row=>row.rgb.map(n=>Math.round(n*255)));
    function preview(scale=1) {
      if (!integer(scale,1,64) || w*h*scale*scale>2**22)
        throw new RangeError('Palette pair preview exceeds its scale or pixel budget');
      const width=w*scale,height=h*scale, rgb=new Uint8Array(width*height*3), alpha=new Uint8Array(width*height);
      for (const {indices,bounds:[x,y]} of cells) {
        for (let dy=0;dy<scale;dy++) for (let side=0;side<2;side++) {
          const at=(y*scale+dy)*width+(x+side)*scale;
          alpha.fill(255,at,at+scale);
          for (let dx=0;dx<scale;dx++) rgb.set(bytes[indices[side]],(at+dx)*3);
        }
      }
      return { w:width,h:height,rgb,alpha };
    }
    const report = K.procedural.data.freeze({
      palette:swatches, sort, thresholds:{maxDistance,maxLightnessDelta}, duplicateGroups, pairs:ordered,
      counts:{
        pairs:pairs.length,
        duplicate:pairs.filter(pair=>pair.classification==='duplicate').length,
        close:pairs.filter(pair=>pair.classification==='close').length,
        lowLightnessSeparation:pairs.filter(pair=>pair.lowLightnessSeparation).length
      },
      cells
    });
    return Object.freeze({ report, preview });
  }

  function chart(definition) {
    if (!record(definition) || Object.keys(definition).some(key=>
      !['type','palette','columns','cell','gap','labels','limit','pairs','mix'].includes(key)))
      throw new TypeError('A palette chart needs a palette and chart settings');
    const {type = 'swatches', palette, labels = true, gap = 2, pairs, mix = [0,.25,.5,.75,1]} = definition;
    if (!types.includes(type) || !Array.isArray(palette) || !integer(palette.length,1,48) ||
        typeof labels !== 'boolean' || !integer(gap,0,32))
      throw new RangeError('Use a known chart type, 1–48 swatches, a boolean label setting and a gap from 0 to 32');
    const bars = type === 'brightness' || type === 'saturation', dither = type === 'dither-pairs';
    const paired = dither || type === 'closest-pairs';
    const {cell = bars ? [104,8] : dither ? [24,16] : [32,20], columns = type === 'swatches' ? 4 : 3,
      limit = dither ? 4 : 12} = definition;
    if (!Array.isArray(cell) || cell.length!==2 || !integer(cell[0],1,256) || !integer(cell[1],1,128) ||
        !integer(columns,1,48) || !integer(limit,1,48) ||
        (labels && (cell[1] < (bars || dither ? 8 : 10) || !bars && !dither && cell[0] < (paired ? 28 : 14))))
      throw new RangeError('Palette chart cells, labels, columns or limit are out of range');
    if (!dither && (pairs !== undefined || definition.mix !== undefined) ||
        paired && palette.length < 2 ||
        dither && (!Array.isArray(mix) || !integer(mix.length,1,17) || !Array.from(mix).every(unit)))
      throw new RangeError('Dither charts take a list of pairs and 1–17 mix shares. Pair charts need at least two swatches');

    const rows = swatchRows(palette);
    const swatches = Object.freeze(rows.map(row=>hex(row.rgb)));
    const ranked = paired ? swatchPairs(rows) : [];
    let selected = ranked.slice(0,limit);
    if (pairs !== undefined) {
      if (!Array.isArray(pairs) || !integer(pairs.length,1,48)) throw new RangeError('Use 1–48 dither pairs');
      selected = Array.from(pairs,pair=>{
        if (!Array.isArray(pair) || pair.length!==2 || !Array.from(pair).every(n=>integer(n,0,rows.length-1)) || pair[0]===pair[1])
          throw new RangeError('A dither pair needs two distinct palette indices');
        const [a,b] = pair, row = ranked.find(({indices:[i,j]})=>i===Math.min(a,b) && j===Math.max(a,b));
        return {indices:[a,b],distance:row.distance};
      });
    }
    const entries = dither ? selected.map(({indices,distance})=>({indices,distance})) : paired ? selected : rows;
    const cols = bars ? 1 : dither ? mix.length : Math.min(columns,entries.length);
    const rowCount = bars || dither ? entries.length : Math.ceil(entries.length/cols);
    const gutter = labels ? bars ? 16 : dither ? 34 : 0 : 0;
    const [cw,ch] = cell, w = gutter+cols*(cw+gap)-gap, h = rowCount*(ch+gap)-gap;
    if (w*h > 2**20) throw new RangeError('Palette chart exceeds 1,048,576 pixels');
    const slots = new Int16Array(w*h).fill(-1), cells = [];
    const fill = (x,y,width,height,index)=>{
      for (let dy=0;dy<height;dy++) slots.fill(index,(y+dy)*w+x,(y+dy)*w+x+width);
    };
    const low = rows.reduce((a,b)=>a.lightness<=b.lightness ? a : b);
    const high = rows.reduce((a,b)=>a.lightness>=b.lightness ? a : b);
    const contrast = index=>rows[index].lightness-low.lightness > high.lightness-rows[index].lightness ? low.index : high.index;
    function label(index,x,y,ink) {
      font ??= TargetInspection.font(K.ascii.atlas());
      const text = String(index).padStart(2,'0');
      for (let i=0;i<text.length;i++) {
        const bits = font.get(text[i]);
        for (let dy=0;dy<8;dy++) for (let dx=0;dx<6;dx++)
          if (bits[dy*6+dx]) slots[(y+dy)*w+x+i*6+dx] = ink;
      }
    }

    for (let i=0;i<entries.length;i++) {
      const row = entries[i], y = (bars || dither ? i : Math.floor(i/cols))*(ch+gap);
      if (dither) {
        const [a,b] = row.indices;
        if (labels) {
          label(a,0,y,high.index);
          label(b,16,y,high.index);
        }
        for (let col=0;col<cols;col++) {
          const x = gutter+col*(cw+gap), share = mix[col];
          let pixels = 0;
          for (let dy=0;dy<ch;dy++) for (let dx=0;dx<cw;dx++) {
            const second = PixelLook.bayerRank(dx,dy) < share;
            slots[(y+dy)*w+x+dx] = second ? b : a;
            pixels += Number(second);
          }
          cells.push({...row,bounds:[x,y,cw,ch],share,actualShare:pixels/(cw*ch)});
        }
        continue;
      }
      const x = gutter+(i%cols)*(cw+gap), bounds = [x,y,cw,ch];
      if (bars) {
        const value = type === 'brightness' ? row.lightness : row.saturation;
        const length = Math.round(value*cw);
        fill(x,y,length,ch,row.index);
        if (labels) label(row.index,0,y,high.index);
        cells.push({index:row.index,bounds,value,pixels:length});
      } else if (paired) {
        const [a,b] = row.indices, left = Math.floor(cw/2);
        fill(x,y,left,ch,a);
        fill(x+left,y,cw-left,ch,b);
        if (labels) {
          label(a,x+1,y+1,contrast(a));
          label(b,x+left+1,y+1,contrast(b));
        }
        cells.push({...row,bounds});
      } else {
        fill(x,y,cw,ch,row.index);
        if (labels) label(row.index,x+1,y+1,contrast(row.index));
        cells.push({index:row.index,bounds});
      }
    }

    function indexed({size = [1,h/w], wrap = false} = {}) {
      return {width:w,height:h,slots:Array.from(slots,index=>index<0 ? null : index),
        palette:swatches.slice(),origin:'top-left',size,wrap};
    }
    function raster() {
      const rgb = new Uint8Array(w*h*3), alpha = new Uint8Array(w*h);
      const bytes = rows.map(row=>row.rgb.map(n=>Math.round(n*255)));
      slots.forEach((index,pixel)=>{
        if (index<0) return;
        rgb.set(bytes[index],pixel*3);
        alpha[pixel] = 255;
      });
      return {w,h,rgb,alpha,indices:slots.slice(),palette:swatches};
    }
    return Object.freeze({type,w,h,palette:swatches,cells:K.procedural.data.freeze(cells),indexed,raster});
  }

  materials.paletteChart = chart;
  materials.palettePairReview = reviewPairs;
})(KIT);
