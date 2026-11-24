/* Responsive layout resolves named rectangles independently of their raster content. */
(function (P) {
  const R = P.raster, D = P.drawing2d;
  const finite = Number.isFinite;
  const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
    !['__proto__','constructor','prototype'].includes(value);
  const tuple = (value,n,valid) => Array.isArray(value) && value.length === n && Array.from(value).every(valid);
  const fraction = value => finite(value) && value >= 0 && value <= 1;
  const lengths = value => finite(value) || typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(value);
  const measure = (value,span) => typeof value === 'string' ? Number(value.slice(0,-1))*span/100 : value;
  const boxValues = value => tuple(value,4,Number.isSafeInteger) && value[2] >= 0 && value[3] >= 0;

  function boxes({width, height, boxes: definitions} = {}) {
    if (![width,height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) ||
        !Array.isArray(definitions) || definitions.length > 1024)
      throw new RangeError('Layout needs a bounded canvas and named boxes');
    const specs = new Map(), resolved = new Map(), visiting = new Set();
    for (const box of definitions) {
      const {id:name, parent} = box ?? {};
      if (!id(name) || specs.has(name) || parent !== undefined && !id(parent))
        throw new TypeError('Layout boxes need unique IDs and valid parent names');
      specs.set(name,box);
    }
    function resolve(name) {
      if (resolved.has(name)) return resolved.get(name);
      if (visiting.has(name)) throw new RangeError('Layout parent cycle at ' + name);
      if (!specs.has(name)) throw new RangeError('Unknown layout parent ' + name);
      visiting.add(name);
      const {parent, size = ['100%','100%'], offset = [0,0], anchor = [0,0], pivot = [0,0], padding = 0} = specs.get(name);
      const insets = Array.isArray(padding) ? padding : [padding,padding,padding,padding];
      if (!tuple(size,2,lengths) || !tuple(offset,2,lengths) || !tuple(anchor,2,fraction) ||
          !tuple(pivot,2,fraction) || !tuple(insets,4,lengths))
        throw new TypeError('Invalid relative dimensions, alignment or padding for layout box ' + name);
      const [px,py,pw,ph] = parent === undefined ? [0,0,width,height] : resolve(parent).inner;
      const w = measure(size[0],pw), h = measure(size[1],ph);
      const x = px + pw*anchor[0] + measure(offset[0],pw) - w*pivot[0];
      const y = py + ph*anchor[1] + measure(offset[1],ph) - h*pivot[1];
      const [l,t,r,b] = insets.map((value,i)=>measure(value,i%2 ? h : w));
      if (![x,y,x+w,y+h,l,t,r,b].every(n => finite(n) && Math.abs(n) <= 1e9) ||
          w <= 0 || h <= 0 || Math.min(l,t,r,b) < 0 || l+r >= w || t+b >= h)
        throw new RangeError('Layout size or padding is out of range for box ' + name);
      const inner = [x+l,y+t,w-l-r,h-t-b], result = {id:name, ...(parent!==undefined && {parent}),
        rect:P.proportions.pixelRect({min:[x,y],max:[x+w,y+h]}),
        content:P.proportions.pixelRect({min:[x+l,y+t],max:[x+w-r,y+h-b]})};
      const entry = {inner,result};
      visiting.delete(name);
      resolved.set(name,entry);
      return entry;
    }
    return Object.fromEntries([...specs.keys()].map(name=>[name,resolve(name).result]));
  }

  function place(source, box, {fit = 'contain', align = [.5,.5], filter = 'nearest', area = 'content', clip = true} = {}) {
    if (!['contain','cover','stretch','none'].includes(fit) || !tuple(align,2,fraction) ||
        !['content','rect'].includes(area) || !['nearest','bilinear'].includes(filter) || typeof clip !== 'boolean')
      throw new TypeError('Invalid layout fit, filter or alignment');
    const region = Array.isArray(box) ? box : box?.[area];
    if (!boxValues(region) || !region[2] || !region[3] || !P.graphTypes.validator('raster')(source))
      throw new TypeError('Layout placement needs a nonempty box and valid raster');
    const [x,y,w,h] = region, {width:sw,height:sh} = source;
    let width = w, height = h;
    if (fit !== 'stretch') {
      const ratio = fit === 'none' ? 1 : (fit === 'contain' ? Math.min : Math.max)(w/sw,h/sh);
      width = Math.max(1,Math.round(sw*ratio)); height = Math.max(1,Math.round(sh*ratio));
    }
    const left = Math.round((w-width)*align[0]), top = Math.round((h-height)*align[1]);
    let value = width===sw && height===sh ? source : R.resize(source,{width,height,filter});
    if (clip && (width > w || height > h)) {
      value = R.crop(value,{x:Math.max(0,-left),y:Math.max(0,-top),width:Math.min(w,width),height:Math.min(h,height)});
      return {source:value,x:x+Math.max(0,left),y:y+Math.max(0,top)};
    }
    return {source:value,x:x+left,y:y+top};
  }

  Object.assign(D,{boxes,place});
})(KIT.procedural);
