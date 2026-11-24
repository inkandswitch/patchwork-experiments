/* Deterministic output-space layout for camera-anchored labels and fixed legends. */
const ViewAnnotations = (() => {
  const drawing = typeof DrawingPrimitives === 'undefined' ? require('./drawing-primitives.js') : DrawingPrimitives;
  const finite = Number.isFinite;
  const tuple = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(finite);
  const check = (ok, message) => { if (!ok) throw new TypeError('Annotations: ' + message); };
  const keys = (value, allowed, message) => check(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => allowed.includes(key)), message);
  const range = (value, min, max, name) => {
    check(finite(value) && value >= min && value <= max, 'invalid ' + name);
    return value;
  };
  const count = (value, min, max, name) => {
    check(Number.isInteger(value), 'invalid ' + name);
    return range(value, min, max, name);
  };
  const string = (value, name, max = 160) => {
    check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'invalid ' + name);
    return value;
  };
  const color = (value = '#ffffff') => { drawing.color(value); return value; };
  const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const compass = [[1,-1],[-1,-1],[1,1],[-1,1],[1,0],[-1,0],[0,-1],[0,1]];
  const radii = [0, 16, 36, 60, 90];
  const styleKeys = ['size', 'padding', 'color', 'background', 'border', 'leaderColor', 'leaderWidth'];
  const defaultBands = [{ distance: 0, maxLabels: 32 }, { distance: 14, maxLabels: 16 }, { distance: 28, maxLabels: 8 }];
  const defaults = { size: 11, padding: 6, color: '#e7f5ff', background: '#0b1728eb', border: '#3b5871',
    leaderWidth: 1, leaderColor: '#7ca7bd' };

  function style(input, inherited) {
    if (input !== undefined) keys(input, styleKeys, 'invalid label or legend style');
    const result = { ...inherited, ...input };
    range(result.size,5,64,'text size');
    range(result.padding,0,64,'padding');
    range(result.leaderWidth,.25,12,'leader width');
    color(result.color);
    color(result.leaderColor);
    for (const name of ['background','border']) if (result[name] !== false) color(result[name]);
    return result;
  }

  function anchor(value) {
    if (tuple(value,3)) return value.slice();
    keys(value,['entity','socket','mark','part','bone','splat','selector','point','offset'],'invalid world anchor');
    const kinds = ['entity','mark','part','bone','splat','selector'].filter(name => value[name] !== undefined);
    check(kinds.length === 1, 'world anchors need one source');
    const [kind] = kinds;
    if (kind === 'part') {
      check(typeof value.part === 'string' && value.part.trim().length > 0 ||
        Number.isSafeInteger(value.part) && value.part >= 0, 'invalid rig part anchor');
    } else if (kind === 'entity' || kind === 'mark') string(value[kind],kind,256);
    else if (kind === 'selector') {
      check(value.selector && Object.getPrototypeOf(value.selector) === Object.prototype &&
        Object.keys(value.selector).length > 0 && Object.values(value.selector).every(v =>
          typeof v === 'string' || Number.isSafeInteger(v)), 'invalid render selector');
    } else check(Number.isSafeInteger(value[kind]) && value[kind] >= 0, 'invalid ' + kind + ' anchor');
    if (value.socket !== undefined) {
      check(kind === 'entity', 'socket anchors need an entity');
      string(value.socket,'socket',96);
    }
    check(value.point === undefined || (kind === 'part' || kind === 'bone') && tuple(value.point,3),'invalid rest point');
    check(value.offset === undefined || tuple(value.offset,3),'invalid world offset');
    return { ...value, ...(value.offset && { offset: value.offset.slice() }),
      ...(value.point && { point: value.point.slice() }), ...(value.selector && { selector: { ...value.selector } }) };
  }

  function prepare(definition) {
    if (definition === undefined) return null;
    keys(definition,['labels','legends','density','margin','gap','avoid','style'],'invalid layer settings');
    const { labels = [], legends = [], density = defaultBands, margin = 8, gap = 5, avoid = [] } = definition;
    check(Array.isArray(labels) && labels.length <= 1024 && Array.isArray(legends) && legends.length <= 16 &&
      Array.isArray(density) && density.length > 0 && density.length <= 32 && Array.isArray(avoid) && avoid.length <= 128,
      'layer exceeds its label, legend, density or reservation budget');
    const base = style(definition.style,defaults), ids = new Set();
    function unique(id) {
      string(id,'annotation ID',128);
      check(!ids.has(id),'duplicate annotation ID ' + id);
      ids.add(id);
      return id;
    }
    const tags = Array.from(labels,row => {
      keys(row,['id','text','at','space','priority','offset','leader','minDistance','maxDistance','style'],'invalid label');
      const { space = 'world', offset = [12,-12], leader = 'straight', priority = 0, minDistance = 0, maxDistance = 1e9 } = row;
      check(['screen','world'].includes(space) && tuple(offset,2) && offset.every(n => Math.abs(n) <= 4096) &&
        [false,'straight','elbow'].includes(leader) && finite(priority), 'invalid label space, offset, leader or priority');
      check(space !== 'screen' || tuple(row.at,2) && row.minDistance === undefined && row.maxDistance === undefined,
        'screen labels need XY and use no world distance limits');
      range(minDistance,0,1e9,'minimum distance');
      range(maxDistance,minDistance,1e9,'maximum distance');
      return { id: unique(row.id), text: string(row.text,'label text'), at: space === 'world' ? anchor(row.at) : row.at.slice(),
        space, priority, offset: offset.slice(), leader, minDistance, maxDistance, style: style(row.style,base) };
    });
    const panels = Array.from(legends,row => {
      keys(row,['id','title','items','corner','at','offset','style'],'invalid legend');
      const { title, items, at, corner = 'top-right', offset = [12,12] } = row;
      check(Array.isArray(items) && items.length >= 1 && items.length <= 32 && tuple(offset,2) &&
        offset.every(n => n >= 0 && n <= 4096) && corners.includes(corner) &&
        (at === undefined || tuple(at,2) && row.corner === undefined && row.offset === undefined),
        'legend needs 1 to 32 items and a screen position or corner');
      return { id: unique(row.id), title: title === undefined ? undefined : string(title,'legend title'), corner,
        at: at?.slice(), offset: offset.slice(), style: style(row.style,base), items: Array.from(items,item => {
          keys(item,['text','color','symbol'],'invalid legend item');
          const { symbol = 'box' } = item;
          check(['box','line','dot'].includes(symbol),'invalid legend symbol');
          return { text: string(item.text,'legend item text'), color: color(item.color), symbol };
        }) };
    });
    let previous = -1;
    const bands = Array.from(density,row => {
      keys(row,['distance','maxLabels','gap'],'invalid density band');
      const distance = range(row.distance,0,1e9,'density distance');
      check(distance > previous,'density distances must be strictly increasing');
      previous = distance;
      return { distance, maxLabels: count(row.maxLabels,0,1024,'density label budget'), gap: range(row.gap ?? gap,0,128,'density gap') };
    });
    check(bands[0].distance === 0,'the first density band must begin at zero');
    return { labels: tags, legends: panels, bands, margin: range(margin,0,128,'viewport margin'), gap: range(gap,0,128,'gap'),
      avoid: Array.from(avoid,rect => {
        check(tuple(rect,4) && rect[2] > 0 && rect[3] > 0,'invalid reserved rectangle');
        return rect.slice();
      }), needsCamera: tags.some(row => row.space === 'world') };
  }

  const intersects = (a,b,gap) => a[0] < b[0]+b[2]+gap && a[0]+a[2]+gap > b[0] &&
    a[1] < b[1]+b[3]+gap && a[1]+a[3]+gap > b[1];
  const inside = (point, r) => point[0] >= r[0] && point[0] <= r[0]+r[2] && point[1] >= r[1] && point[1] <= r[1]+r[3];
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

  function hits(a,b,box) {
    let low = 0, high = 1;
    for (let i=0; i<2; i++) {
      const d = b[i]-a[i], min = box[i], max = min+box[i+2];
      if (d === 0) {
        if (a[i] < min || a[i] > max) return false;
      } else {
        const start = (min-a[i])/d, end = (max-a[i])/d;
        low = Math.max(low,Math.min(start,end));
        high = Math.min(high,Math.max(start,end));
        if (high < low) return false;
      }
    }
    return true;
  }
  const through = (route, box) => route.slice(1).some((end,i) => hits(route[i], end, box));

  function measure(text, size, glyphs) {
    const glyph = glyphs(text,size,{ width: Math.max(.8,size*.10) });
    let x=0, y=0;
    for (const line of glyph.strokes) for (const point of line) {
      x = Math.max(x,Math.abs(point[0]));
      y = Math.max(y,Math.abs(point[1]));
    }
    return { w: Math.max(1,2*x+glyph.width), h: Math.max(size,2*y+glyph.width), width: glyph.width };
  }

  const rect = (box,tint) => ({ type:'rect', rect:box, color:tint });
  const path = (points,tint,width=1,closed=false) => ({ type:'path', points, color:tint, width, closed });
  const text = (value,at,style,width) => ({ type:'text', text:value, at, color:style.color, size:style.size, width });
  function panel(out, box, style) {
    if (style.background) out.push(rect(box,style.background));
    if (style.border) {
      const [x,y,w,h] = box;
      out.push(path([[x+.5,y+.5],[x+w-.5,y+.5],[x+w-.5,y+h-.5],[x+.5,y+h-.5]],style.border,1,true));
    }
  }

  function layout(settings, { width, height, camera, world, time = 0, glyphs, resolve }) {
    check(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 &&
      typeof glyphs === 'function', 'layout needs frame dimensions and a stroke font');
    const project = settings.needsCamera ? drawing.projector(camera,width,height) : null;
    const setback = camera?.setback ?? 0;
    const distance = project ? Math.max(0,(camera.distance ?? setback)-setback) : 0;
    const band = settings.bands.findLast(row => row.distance <= distance);
    const bounds = [settings.margin,settings.margin,width-settings.margin,height-settings.margin];
    const fits = ([x,y,w,h]) => x >= bounds[0] && y >= bounds[1] && x+w <= bounds[2] && y+h <= bounds[3];
    const taken = [...settings.avoid], leaders = [], boxes = [], legends = [], labels = [], skipped = [];
    const legendDraw = [], leaderDraw = [], labelDraw = [];
    for (const item of settings.legends) {
      const { style, title } = item, p = style.padding, swatch = style.size, spacing = 6;
      const heading = title && measure(title,style.size,glyphs);
      const rows = item.items.map(row => ({ ...row, ink: measure(row.text,style.size,glyphs) }));
      const rowHeight = Math.max(swatch,...rows.map(row => row.ink.h))+spacing;
      const w = Math.ceil(2*p + Math.max(heading?.w ?? 0, swatch+spacing+Math.max(...rows.map(row => row.ink.w))));
      const h = Math.ceil(2*p + (heading ? heading.h+spacing : 0) + rows.length*rowHeight-spacing);
      const [dx,dy] = item.offset;
      const [x,y] = item.at ?? [item.corner.endsWith('right') ? width-dx-w : dx,
        item.corner.startsWith('bottom') ? height-dy-h : dy];
      const box = [x,y,w,h];
      if (x < 0 || y < 0 || x+w > width || y+h > height || taken.some(other => intersects(box,other,settings.gap))) {
        skipped.push({ id:item.id, reason:'legend-space' });
        continue;
      }
      taken.push(box);
      legends.push({ id:item.id, box });
      panel(legendDraw,box,style);
      let lineY = y+p;
      if (heading) {
        legendDraw.push(text(title,[x+p+heading.w*.5,lineY+heading.h*.5],style,heading.width));
        lineY += heading.h+spacing;
      }
      for (const row of rows) {
        const center = lineY+(rowHeight-spacing)*.5, left = x+p;
        if (row.symbol === 'dot') {
          const radius = swatch*.28;
          const ring = Array.from({ length:12 },(_,i) => [left+swatch*.5+radius*Math.cos(i*Math.PI/6),center+radius*Math.sin(i*Math.PI/6)]);
          legendDraw.push({ type:'polygon',points:ring,fill:row.color });
        } else if (row.symbol === 'line') legendDraw.push(path([[left,center],[left+swatch,center]],row.color,2));
        else legendDraw.push(rect([left,center-swatch*.31,swatch*.75,swatch*.62],row.color));
        legendDraw.push(text(row.text,[left+swatch+spacing+row.ink.w*.5,center],style,row.ink.width));
        lineY += rowHeight;
      }
    }

    const candidates = [];
    for (const label of settings.labels) {
      let point = label.at, depth = 0;
      if (label.space === 'world') {
        if (!Array.isArray(point)) point = resolve?.(point,{ world,time });
        if (!tuple(point,3)) { skipped.push({ id:label.id,reason:'unresolved' }); continue; }
        const view = project.toView(point);
        if (!project.visible(view)) { skipped.push({ id:label.id,reason:'clipped' }); continue; }
        depth = Math.max(0,view[2]-setback);
        if (depth < label.minDistance || depth > label.maxDistance) {
          skipped.push({ id:label.id,reason:'distance' });
          continue;
        }
        point = project.point(view);
      }
      if (!inside(point,[0,0,width,height])) { skipped.push({ id:label.id,reason:'offscreen' }); continue; }
      candidates.push({ label,point,depth });
    }
    candidates.sort((a,b) => b.label.priority-a.label.priority || a.depth-b.depth ||
      (a.label.id < b.label.id ? -1 : a.label.id === b.label.id ? 0 : 1));
    let used = 0;
    for (const { label,point,depth } of candidates) {
      if (label.space === 'world' && used >= band.maxLabels) {
        skipped.push({ id:label.id,reason:'density' });
        continue;
      }
      const { style, offset } = label, ink = measure(label.text,style.size,glyphs);
      const size = [Math.ceil(ink.w+2*style.padding),Math.ceil(ink.h+2*style.padding)];
      function place(dx,dy) {
        const shift = [dx,dy];
        const [x,y] = point.map((n,i) => Math.round(n+shift[i]-size[i]*(shift[i] < 0 ? 1 : shift[i] === 0 ? .5 : 0)));
        const box = [x,y,...size];
        if (!fits(box) || taken.some(other => intersects(box,other,band.gap)) || leaders.some(leader => through(leader,box))) return;
        if (!label.leader) return { box, route:[] };
        if (inside(point,box)) return;
        const end = [clamp(point[0],x,x+size[0]),clamp(point[1],y,y+size[1])];
        const routes = label.leader === 'straight' ? [[point,end]] :
          [[point,[end[0],point[1]],end],[point,[point[0],end[1]],end]];
        const route = routes.find(route => !taken.some(other => through(route,other)));
        return route && { box,route };
      }
      let placement = place(...offset);
      for (const radius of radii) {
        if (placement) break;
        for (const [dx,dy] of compass) {
          placement = place(dx*(Math.max(10,Math.abs(offset[0]))+radius),dy*(Math.max(10,Math.abs(offset[1]))+radius));
          if (placement) break;
        }
      }
      if (!placement) { skipped.push({ id:label.id,reason:'collision' }); continue; }
      const { box,route } = placement;
      taken.push(box);
      boxes.push({ label, box, ink });
      if (route.length) {
        leaders.push(route);
        leaderDraw.push(path(route,style.leaderColor,style.leaderWidth));
        leaderDraw.push(rect([point[0]-1.5,point[1]-1.5,3,3],style.leaderColor));
      }
      if (label.space === 'world') used++;
      labels.push({ id:label.id, point, box, route, distance:depth });
    }
    for (const { label,box,ink } of boxes) {
      panel(labelDraw,box,label.style);
      labelDraw.push(text(label.text,[box[0]+box[2]*.5,box[1]+box[3]*.5],label.style,ink.width));
    }
    return { labels, legends, skipped, distance, budget:band.maxLabels, draw:[...leaderDraw,...labelDraw,...legendDraw] };
  }

  return Object.freeze({ prepare, layout });
})();
if (typeof module !== 'undefined') module.exports = ViewAnnotations;
