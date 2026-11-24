/* Screen drawing reuses Ink's compositing paths, scan conversion, and bitmap glyphs. */
(function (K) {
  const P = K.procedural, R = P.raster;
  const finite = Number.isFinite, maxPoints = 2048;
  const tuple = (value, n, valid = finite) => Array.isArray(value) && value.length === n && Array.from(value).every(valid);
  const point = value => tuple(value, 2, n => finite(n) && Math.abs(n) <= 1e9);
  const solid = color => DrawingPrimitives.color(color);

  function pathSource(source) {
    const points = Array.isArray(source) ? source : source?.points;
    const closed = source?.closed ?? false;
    if (!Array.isArray(points) || points.length < (closed ? 3 : 2) || points.length > maxPoints ||
        !Array.from(points).every(point) || typeof closed !== 'boolean')
      throw new TypeError('Drawing needs a bounded 2D path');
    return {points, closed};
  }

  const arity = {M:2,L:2,H:1,V:1,Q:4,C:6,A:7,Z:0};
  function contours(d, steps = 12) {
    if (typeof d !== 'string' || d.length > 24000 || !Number.isSafeInteger(steps) || steps < 1 || steps > 64)
      throw new RangeError('Invalid drawing path text or curve steps');
    const tokenPattern = /[MLHVQCAZmlhvqcaz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
    const tokens = [];
    let end = 0;
    for (const match of d.matchAll(tokenPattern)) {
      if (!/^[\s,]*$/.test(d.slice(end, match.index))) throw new SyntaxError('Invalid drawing path token');
      end = match.index + match[0].length;
      tokens.push(match[0]);
    }
    if (!/^[\s,]*$/.test(d.slice(end))) throw new SyntaxError('Invalid drawing path token');
    if (!/^[Mm]$/.test(tokens[0])) throw new SyntaxError('A drawing path must start with M or m');
    const normalized = [], closed = [];
    let command, visits = 0;
    for (let i = 0; i < tokens.length;) {
      if (/^[A-Za-z]$/.test(tokens[i])) command = tokens[i++];
      if (!command) throw new SyntaxError('Expected a drawing path command');
      const type = command.toUpperCase(), n = arity[type];
      const args = tokens.slice(i, i + n).map(Number);
      if (args.length !== n || !args.every(value => finite(value) && Math.abs(value) <= 1e9))
        throw new SyntaxError('Wrong arguments for drawing path command ' + command);
      i += n;
      if (type !== 'M' && closed.at(-1)) throw new SyntaxError('A closed contour must be followed by a move command');
      if (type === 'M') closed.push(false);
      if (type === 'Z') closed[closed.length - 1] = true;
      if (type === 'A' && (!args.slice(3,5).every(flag => flag === 0 || flag === 1)))
        throw new SyntaxError('Arc flags must be zero or one');
      visits += type === 'A' ? steps * 2 : type === 'C' || type === 'Q' ? steps : 1;
      if (visits > maxPoints) throw new RangeError('Drawing path exceeds its point budget');
      const straightArc = type === 'A' && (!args[0] || !args[1]);
      normalized.push(straightArc ? (command === 'a' ? 'l' : 'L') : command, ...(straightArc ? args.slice(5) : args));
      if (type === 'M') command = command === 'm' ? 'l' : 'L';
      if (type === 'Z') command = undefined;
    }
    return K.svgPath(normalized.join(' '), steps).map((points,i) => pathSource({points, closed:closed[i]}));
  }

  function path(d, {steps} = {}) {
    const result = contours(d, steps);
    if (result.length !== 1) throw new TypeError('A typed path needs one contour');
    return result[0];
  }

  function ribbon(source, {width = 1, miterLimit = 3, fill = '#ffffff', stroke, strokeWidth} = {}) {
    const {points, closed} = pathSource(source), count = points.length;
    const widths = Array.isArray(width) ? width : points.map(() => width);
    if (!tuple(widths, count, n => finite(n) && n >= 0 && n <= 16384) || !widths.some(n => n > 0) ||
        !finite(miterLimit) || miterLimit < 1 || miterLimit > 32)
      throw new RangeError('Ribbon needs a nonzero width and a finite miter limit');
    const normals = points.slice(0, closed ? count : count - 1).map(([x,y],i) => {
      const [u,v] = points[(i + 1) % count], dx = u - x, dy = v - y, len = Math.hypot(dx,dy);
      if (len < 1e-8) throw new RangeError('Ribbon points must have distinct consecutive positions');
      return [-dy / len, dx / len];
    });
    const left = [], right = [];
    for (let i = 0; i < count; i++) {
      const after = normals[i] ?? normals.at(-1), before = normals[i - 1] ?? (closed ? normals.at(-1) : after);
      const x = before[0] + after[0], y = before[1] + after[1], len = Math.hypot(x,y);
      const [nx,ny] = len < 1e-8 ? after : [x / len,y / len];
      const scale = widths[i] / 2 / Math.max(1/miterLimit,nx*after[0]+ny*after[1]);
      const [px,py] = points[i];
      left.push([px+nx*scale,py+ny*scale]);
      right.push([px-nx*scale,py-ny*scale]);
    }
    const rings = closed ? [left,right] : [[...left,...right.reverse()]];
    return {type:'polygon',rings,fill,...(stroke !== undefined && {stroke}),...(strokeWidth !== undefined && {width:strokeWidth})};
  }

  let glyphs;
  function text(value, {scale = 1, tracking = 0, leading = 0, align = 'left', columns, color = '#ffffff', customGlyphs} = {}) {
    if (typeof value !== 'string' || value.length > 4096 || ![scale,tracking,leading].every(Number.isSafeInteger) ||
        scale < 1 || scale > 32 || tracking < 0 || tracking > 256 || leading < 0 || leading > 256 ||
        !['left','center','right'].includes(align) || columns !== undefined && (!Number.isSafeInteger(columns) || columns < 1))
      throw new RangeError('Invalid bitmap text or layout options');
    glyphs ??= TargetInspection.font(K.ascii.atlas());
    if (customGlyphs !== undefined && (!P.graphTypes.validator('record')(customGlyphs) || Object.keys(customGlyphs).length > 256))
      throw new TypeError('Bitmap custom glyphs need a bounded character map');
    const font = customGlyphs === undefined ? glyphs : TargetInspection.font(K.ascii.atlas(),customGlyphs);
    const rows = value.replace(/\r\n?/g,'\n').split('\n').flatMap(line => {
      const chars = Array.from(line);
      if (!columns || chars.length <= columns) return [chars];
      return Array.from({length:Math.ceil(chars.length/columns)},(_,i)=>chars.slice(i*columns,(i+1)*columns));
    });
    const rgba = solid(color), cell = 6*scale + tracking, step = 8*scale + leading;
    const rowWidth = row => Math.max(0,row.length*cell-tracking);
    const width = Math.max(1,...rows.map(rowWidth)), height = rows.length*step-leading;
    if (width*height > 4e6) throw new RangeError('Bitmap text exceeds its pixel budget');
    const result = R.canvas({width,height});
    const anchor = align === 'left' ? 0 : align === 'center' ? .5 : 1;
    for (let line = 0; line < rows.length; line++) {
      const row = rows[line], x = Math.floor((width-rowWidth(row))*anchor), y = line*step;
      row.forEach((char,index) => {
        const glyph = font.get(char) ?? font.get('?');
        if (!glyph) return;
        for (let v=0; v<8; v++) for (let u=0; u<6; u++) if (glyph[v*6+u])
          for (let dy=0; dy<scale; dy++) for (let dx=0; dx<scale; dx++) {
            const at = ((y+v*scale+dy)*width + x+index*cell+u*scale+dx)*4;
            result.data.set(rgba,at);
          }
      });
    }
    return {value:result,metrics:{width,height,lines:rows.length,scale}};
  }

  function shape(draw) {
    const {type, rect, radius = 0, color, stroke, fill = color ?? '#ffffff', width} = draw;
    if (!tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0 || !finite(radius) || radius < 0)
      throw new RangeError('Shape needs a positive rectangle and a nonnegative radius');
    const [x,y,w,h] = rect;
    if (type === 'rect' && !radius && stroke === undefined && fill !== false)
      return {type:'rect',rect,color:fill};
    const r = Math.min(radius,w/2,h/2);
    let points;
    if (type === 'ellipse') {
      const count = Math.min(128,Math.max(24,Math.ceil(Math.PI*Math.sqrt(Math.max(w,h)))));
      points = Array.from({length:count},(_,i)=>{
        const angle = i/count * Math.PI*2;
        return [x+w*(1+Math.cos(angle))/2,y+h*(1+Math.sin(angle))/2];
      });
    } else if (r) {
      const centers = [[x+w-r,y+r],[x+w-r,y+h-r],[x+r,y+h-r],[x+r,y+r]];
      const segments = Math.min(16,Math.max(4,Math.ceil(Math.sqrt(r))));
      points = centers.flatMap(([cx,cy],j)=>Array.from({length:segments+1},(_,i)=>{
        const angle = (j-1+i/segments)*Math.PI/2;
        return [cx+r*Math.cos(angle),cy+r*Math.sin(angle)];
      }));
    } else points = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    return {type:'polygon',points,fill,...(stroke!==undefined && {stroke}),...(width!==undefined && {width})};
  }

  function drawingPath(draw) {
    const {source, d, points, closed, fill, color, stroke, width, steps} = draw;
    const vertices = source === undefined ? points : Array.isArray(source) ? source : source?.points;
    const paths = d === undefined ? [pathSource({points:vertices,closed:closed ?? source?.closed})] : contours(d,steps);
    const lines = stroke ?? (fill ? false : color ?? '#ffffff');
    const size = width === undefined ? {} : {width};
    const output = [];
    if (fill) {
      if (!paths.every(p => p.closed)) throw new TypeError('A filled path needs closed contours');
      output.push({type:'polygon',rings:paths.map(p=>p.points),fill,...size});
    }
    if (lines) for (const p of paths) output.push({type:'path',...p,color:lines,...size});
    return output;
  }

  function render({width, height, commands, edges = 'smooth'} = {}) {
    if (!Array.isArray(commands) || commands.length > 8192) throw new RangeError('Expected a bounded drawing command array');
    function compile(draw) {
      if (!draw || draw.space !== undefined && draw.space !== 'screen') throw new TypeError('Expected a screen drawing command');
      if (draw.type === 'ellipse' || draw.type === 'rect') return [shape(draw)];
      if (draw.type === 'path') return drawingPath(draw);
      if (draw.type === 'ribbon') return [ribbon(draw.source ?? {points:draw.points,closed:draw.closed},draw)];
      return [draw];
    }
    const shapes = [];
    let vertices = 0;
    for (const draw of commands) for (const shape of compile(draw)) {
      vertices += shape.points?.length ?? 0;
      if (Array.isArray(shape.rings)) for (const ring of shape.rings) vertices += ring?.length ?? 0;
      if (vertices > 262144 || shapes.length >= 8192) throw new RangeError('Drawing exceeds its geometry budget');
      shapes.push(shape);
    }
    return FrameComposite.screenDrawing(width,height,shapes,{edges,bitmap(draw) {
      const {at = [0,0], color = '#ffffff'} = draw;
      if (!point(at) || !at.every(Number.isSafeInteger)) throw new TypeError('Bitmap text needs an integer XY anchor');
      const {value} = text(draw.text,draw);
      return {type:'bitmapStamp',at,stamp:{...value,color:solid(color)}};
    }});
  }

  P.drawing2d = {path, ribbon, text, render};
})(KIT);
