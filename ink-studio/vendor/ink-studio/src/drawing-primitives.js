/* Compile technical drawings to output-pixel strokes and even-odd fills. */
const DrawingPrimitives = (() => {
  const finite = Number.isFinite;
  const tuple = (p, n) => Array.isArray(p) && p.length === n && Array.from(p).every(x => finite(x) && Math.abs(x) <= 1e12);
  const check = (ok, message) => { if (!ok) throw new TypeError(message); };
  const keys = (value, allowed, name) => check(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)), 'Invalid ' + name);
  const bounded = (value, min, max) => finite(value) && value >= min && value <= max;
  const positive = (value, name) => {
    check(bounded(value, 1e-8, 1e9), name + ' must be positive and finite');
    return value;
  };
  const clamp = n => Math.min(1, Math.max(0, n));
  const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
  const step = (a, v, length) => a.map((x, i) => x + v[i]*length);
  const basis = { screen: [[1,0],[0,1]], world: [[1,0,0],[0,1,0],[0,0,1]] };
  const perpendicular = ([x,y]) => [-y,x];
  function directionBetween([x,y], [u,v]) {
    const dx = u-x, dy = v-y, length = Math.hypot(dx,dy);
    return length > 1e-8 ? { length, axis: [dx/length,dy/length] } : null;
  }

  function color(value = '#ffffff') {
    check(typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value), 'Drawing color must be #rrggbb or #rrggbbaa');
    const rgba = value.slice(1).match(/../g).map(pair => parseInt(pair, 16));
    return rgba.length === 3 ? [...rgba, 255] : rgba;
  }

  function vector(value, n, name) {
    check(tuple(value, n), name + ' needs a finite ' + (n === 3 ? 'XYZ' : 'XY') + ' vector');
    return value.slice();
  }

  function unit(value, n, name) {
    const direction = vector(value, n, name), length = Math.hypot(...direction);
    check(length >= 1e-8, name + ' needs a nonzero direction');
    return direction.map(v => v / length);
  }

  function dimension(value, field, space) {
    const units = value ?? 'px';
    check(units === 'px' || units === 'world' && space === 'world', field + ' must be px or world units on a world primitive');
    return units;
  }

  function points(value, n, minimum, name) {
    check(Array.isArray(value) && value.length >= minimum && value.length <= 4096,
      name + ' needs ' + minimum + ' to 4096 points');
    return Array.from(value, row => vector(row, n, name));
  }

  function head(raw, space) {
    const units = dimension(raw.headUnits, 'headUnits', space);
    return { units, length: positive(raw.headLength ?? (units === 'px' ? 10 : .25), 'Head length'),
      width: positive(raw.headWidth ?? (units === 'px' ? 8 : .2), 'Head width') };
  }

  function ticks(raw, space) {
    const units = dimension(raw.tickUnits, 'tickUnits', space);
    return { units, length: positive(raw.tickLength ?? (units === 'px' ? 6 : .12), 'Tick length') };
  }

  function label(value) {
    check(typeof value === 'string' && value.length <= 128, 'Drawing label needs up to 128 characters');
    return value;
  }

  function command(raw) {
    const { type, space = 'screen', widthUnits, width, color: tint } = raw ?? {};
    check(space === 'world' || space === 'screen', 'Primitive space must be world or screen');
    const axes = basis[space], n = axes.length;
    const baseKeys = ['type', 'space', 'widthUnits', 'width', 'color'];
    const headKeys = ['headUnits', 'headLength', 'headWidth'];
    const tickKeys = ['tickUnits', 'tickLength', 'labelSize'];
    const units = dimension(widthUnits, 'widthUnits', space);
    const style = { units, width: positive(width ?? (units === 'px' ? 1 : .02), 'Stroke width'), color: color(tint) };
    const draw = { type, space, style, needsCamera: space === 'world' };
    switch (type) {
      case 'path': {
        keys(raw, [...baseKeys, 'points', 'closed'], 'path command');
        const closed = raw.closed ?? false;
        check(typeof closed === 'boolean', 'Path closed flag must be boolean');
        return { ...draw, points: points(raw.points, n, 2, 'Path'), closed };
      }
      case 'arrow': {
        keys(raw, [...baseKeys, ...headKeys, 'from', 'to'], 'arrow command');
        return { ...draw, from: vector(raw.from, n, 'Arrow start'), to: vector(raw.to, n, 'Arrow tip'), head: head(raw, space) };
      }
      case 'polygon': {
        keys(raw, [...baseKeys, 'points', 'rings', 'fill', 'stroke'], 'polygon command');
        const { points: outline, rings, fill, stroke } = raw;
        check((outline === undefined) !== (rings === undefined), 'Polygon needs points or rings');
        const contours = rings ?? [outline];
        check(Array.isArray(contours) && contours.length > 0 && contours.length <= 64, 'Polygon needs 1 to 64 rings');
        const cooked = Array.from(contours, ring => points(ring, n, 3, 'Polygon ring'));
        check(cooked.reduce((sum, ring) => sum + ring.length, 0) <= 4096, 'Polygon exceeds its vertex budget');
        check(fill !== false || stroke !== undefined && stroke !== false, 'Polygon needs a fill or stroke');
        return { ...draw, rings: cooked, fill: fill === false ? null : color(fill ?? tint),
          stroke: stroke === undefined || stroke === false ? null : color(stroke) };
      }
      case 'grid': {
        keys(raw, [...baseKeys, 'origin', 'u', 'v', 'step', 'counts', 'majorEvery', 'majorColor', 'majorWidth'], 'grid command');
        const { origin, u = axes[0], v = axes[1], step: size = 1, counts, majorEvery = 5, majorColor, majorWidth } = raw;
        const spacing = Array.isArray(size) ? vector(size, 2, 'Grid step') : [size, size];
        spacing.forEach(value => positive(value, 'Grid step'));
        const U = unit(u, n, 'Grid U axis'), V = unit(v, n, 'Grid V axis');
        check(Math.abs(U.reduce((sum, x, i) => sum + x * V[i], 0)) <= 1e-6 &&
          tuple(counts, 2) && counts.every(value => Number.isInteger(value) && bounded(value, 1, 256)) &&
          Number.isInteger(majorEvery) && bounded(majorEvery, 1, 256),
          'Grid needs perpendicular axes, 1 to 256 cells per side, and positive major spacing');
        return { ...draw, origin: vector(origin, n, 'Grid origin'), u: U, v: V, spacing, counts: counts.slice(), majorEvery,
          major: { ...style, width: positive(majorWidth ?? style.width, 'Major line width'), color: color(majorColor ?? tint) } };
      }
      case 'axes': {
        keys(raw, [...baseKeys, ...headKeys, ...tickKeys, 'origin', 'axes'], 'axes command');
        check(Array.isArray(raw.axes) && raw.axes.length > 0 && raw.axes.length <= 6, 'Axes need 1 to 6 directions');
        return { ...draw, origin: vector(raw.origin, n, 'Axes origin'), head: head(raw, space), ticks: ticks(raw, space),
          labelSize: positive(raw.labelSize ?? 10, 'Label size'), axes: Array.from(raw.axes, axis => {
            keys(axis, ['direction', 'length', 'tickEvery', 'color', 'label'], 'axis');
            const length = positive(axis.length, 'Axis length'), every = axis.tickEvery;
            check(every === undefined || bounded(every, 1e-8, 1e9) && length / every <= 256,
              'Axis tick spacing allows up to 256 ticks');
            return { direction: unit(axis.direction, n, 'Axis direction'), length, every,
              color: color(axis.color ?? tint), label: label(axis.label ?? '') };
          }) };
      }
      case 'scaleBar': {
        keys(raw, [...baseKeys, ...tickKeys, 'origin', 'direction', 'length', 'lengthUnits', 'reference', 'divisions', 'label'],
          'scale bar command');
        const { origin, direction = axes[0], length, lengthUnits = space === 'world' ? 'world' : 'px',
          reference, divisions = 4 } = raw;
        const calibrated = space === 'screen' && lengthUnits === 'world';
        check((lengthUnits === 'world' || lengthUnits === 'px' && space === 'screen') &&
          (calibrated ? tuple(reference, 3) : reference === undefined) &&
          Number.isInteger(divisions) && bounded(divisions, 1, 32),
          'Scale bar needs 1 to 32 divisions and a world reference for calibrated screen sizing');
        return { ...draw, needsCamera: draw.needsCamera || calibrated, origin: vector(origin, n, 'Scale bar origin'),
          direction: unit(direction, n, 'Scale bar direction'), length: positive(length, 'Scale bar length'),
          reference: reference?.slice(), divisions, ticks: ticks(raw, space),
          label: label(raw.label ?? (length + (lengthUnits === 'px' ? ' PX' : ' WU'))),
          labelSize: positive(raw.labelSize ?? 10, 'Label size') };
      }
      default: throw new TypeError('Drawing commands support text, rect, path, arrow, polygon, grid, axes and scaleBar');
    }
  }

  function projector(camera, width, height) {
    const { view, tangent, aspect, ortho, clipNear = .4, clipFar = 400 } = camera ?? {};
    check(view?.length === 16 && finite(tangent) && tangent > 0 && finite(aspect) && aspect > 0 &&
      finite(clipNear) && clipNear > 0 && clipFar > clipNear, 'World drawing needs a renderer camera');
    const focal = height / (2*tangent);
    const toView = p => [
      view[0]*p[0] + view[4]*p[1] + view[8]*p[2] + view[12],
      view[1]*p[0] + view[5]*p[1] + view[9]*p[2] + view[13],
      -(view[2]*p[0] + view[6]*p[1] + view[10]*p[2] + view[14])
    ];
    const visible = p => p[2] >= clipNear && p[2] <= clipFar;
    const scale = p => focal / (ortho ? 1 : p[2]);
    // The world may be drawn into a raster with a different aspect ratio and fitted to the output.
    const aspectScale = width / (height*aspect);
    const point = p => [width*.5 + p[0]*scale(p)*aspectScale, height*.5 - p[1]*scale(p)];
    function crossing(a, b, z) {
      const t = (z-a[2])/(b[2]-a[2]);
      return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, z];
    }
    function line(a, b) {
      const low = Math.min(a[2], b[2]), high = Math.max(a[2], b[2]);
      if (low > clipFar || high < clipNear) return null;
      if (!visible(a)) a = crossing(a,b,a[2] < clipNear ? clipNear : clipFar);
      if (!visible(b)) b = crossing(b,a,b[2] < clipNear ? clipNear : clipFar);
      return [a,b];
    }
    function clipRing(ring, z, inside) {
      const output = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[(i+ring.length-1)%ring.length], b = ring[i];
        const previous = inside(a[2], z), current = inside(b[2], z);
        if (previous !== current) output.push(crossing(a,b,z));
        if (current) output.push(b);
      }
      return output;
    }
    function ring(p) {
      const near = clipRing(p, clipNear, (a,b) => a >= b);
      return clipRing(near, clipFar, (a,b) => a <= b);
    }
    // Measure along an output-space direction after the world raster is fitted.
    const pixelsPerUnit = (p, [x,y]) => scale(p)/Math.hypot(x/aspectScale,y);
    return { toView, visible, point, line, ring, pixelsPerUnit };
  }

  function geometry(draw, camera, w, h) {
    const world = draw.space === 'world';
    const project = draw.needsCamera ? projector(camera,w,h) : null;
    const direct = p => p;
    const view = world ? project.toView : direct, xy = world ? project.point : direct;
    const visible = world ? project.visible : () => true;
    const scaled = (n, units, p, direction = basis.screen[1]) =>
      units === 'world' ? n*project.pixelsPerUnit(p,direction) : n;
    const batch = color => ({ color, lines: [], fills: [], labels: [] });
    const result = [];
    function stroke(out, a, b, style = draw.style) {
      const pair = world ? project.line(a,b) : [a,b];
      if (!pair) return;
      const [start, end] = pair.map(xy);
      const direction = style.units === 'world' && directionBetween(start,end);
      const side = direction ? perpendicular(direction.axis) : undefined;
      out.lines.push([start, end, scaled(style.width,style.units,pair[0],side),
        scaled(style.width,style.units,pair[1],side)]);
    }
    function polyline(out, points, closed) {
      for (let i = 1; i < points.length + Number(closed); i++) stroke(out,points[i-1],points[i%points.length]);
    }
    function arrow(out, a, b) {
      const segment = world ? project.line(a,b) : [a,b];
      if (!segment) return;
      if (!visible(b)) return stroke(out,a,b);
      const start = xy(segment[0]), tip = xy(b), direction = directionBetween(start,tip);
      if (!direction) return;
      const { length, axis: dir } = direction, side = perpendicular(dir);
      const { length: headLength, width: headWidth, units } = draw.head;
      let headPixels = headLength;
      if (units === 'world') {
        const distance = Math.hypot(...b.map((v,i) => v-segment[0][i]));
        const base = xy(lerp(b,segment[0],Math.min(.75,headLength/distance)));
        headPixels = Math.hypot(tip[0]-base[0],tip[1]-base[1]);
      }
      if (headPixels <= 1e-8) return stroke(out,a,b);
      const actualLength = Math.min(length*.75,headPixels), fraction = 1-actualLength/length;
      const halfWidth = (scaled(headWidth,units,segment[0],side)*(1-fraction) + scaled(headWidth,units,b,side)*fraction) *
        .5*(actualLength/headPixels);
      const base = step(tip,dir,-actualLength);
      const startWidth = scaled(draw.style.width,draw.style.units,segment[0],side);
      const tipWidth = scaled(draw.style.width,draw.style.units,b,side);
      const baseWidth = startWidth + (tipWidth-startWidth)*fraction;
      out.lines.push([start,base,startWidth,baseWidth]);
      out.fills.push([[tip,step(base,side,halfWidth),step(base,side,-halfWidth)]]);
    }
    function tick(out, p, side, config) {
      const center = xy(p), half = scaled(config.length, config.units, p, side)*.5;
      const width = scaled(draw.style.width, draw.style.units, p, perpendicular(side));
      out.lines.push([step(center,side,-half),step(center,side,half),width,width]);
    }
    function orientation(a, b) {
      const pair = world ? project.line(a,b) : [a,b];
      if (!pair) return null;
      const vector = directionBetween(...pair.map(xy));
      return vector ? { dir: vector.axis, side: perpendicular(vector.axis) } : null;
    }
    const out = batch(draw.style.color);
    if (draw.type === 'path') polyline(out,draw.points.map(view),draw.closed);
    if (draw.type === 'arrow') arrow(out,view(draw.from),view(draw.to));
    if (draw.type === 'polygon') {
      const rings = draw.rings.map(ring => ring.map(view));
      if (draw.fill) {
        const fill = batch(draw.fill);
        fill.fills.push(rings.map(ring => (world ? project.ring(ring) : ring).map(xy)).filter(ring => ring.length >= 3));
        result.push(fill);
      }
      if (draw.stroke) {
        const outline = batch(draw.stroke);
        for (const ring of rings) polyline(outline,ring,true);
        result.push(outline);
      }
    }
    if (draw.type === 'grid') {
      const major = draw.major.width === draw.style.width && draw.major.color.every((value,i) => value === out.color[i]) ?
        out : batch(draw.major.color);
      const span = draw.counts.map((n,i) => n*draw.spacing[i]);
      for (const [i, across, along] of [[0,draw.u,draw.v],[1,draw.v,draw.u]])
        for (let line = 0; line <= draw.counts[i]; line++) {
          const start = step(draw.origin,across,line*draw.spacing[i]);
          const big = line % draw.majorEvery === 0 || line === draw.counts[i];
          stroke(big ? major : out, view(start), view(step(start,along,span[1-i])), big ? draw.major : draw.style);
        }
      result.push(out);
      if (major !== out) result.push(major);
    }
    if (draw.type === 'axes') {
      const from = view(draw.origin);
      for (const axis of draw.axes) {
        const out = batch(axis.color), to = view(step(draw.origin,axis.direction,axis.length));
        const direction = orientation(from,to);
        if (!direction) continue;
        arrow(out,from,to);
        if (axis.every) for (let i = 1; i*axis.every < axis.length; i++) {
          const p = view(step(draw.origin,axis.direction,i*axis.every));
          if (visible(p)) tick(out,p,direction.side,draw.ticks);
        }
        if (axis.label && visible(to))
          out.labels.push({ text: axis.label, at: step(xy(to),direction.dir,draw.labelSize), size: draw.labelSize });
        result.push(out);
      }
    }
    if (draw.type === 'scaleBar') {
      let length = draw.length;
      if (draw.reference) {
        const reference = project.toView(draw.reference);
        if (!project.visible(reference)) return [];
        length *= project.pixelsPerUnit(reference,draw.direction);
      }
      const a = view(draw.origin), b = view(step(draw.origin,draw.direction,length));
      const direction = orientation(a,b);
      if (direction) {
        stroke(out,a,b);
        for (let i = 0; i <= draw.divisions; i++) {
          const p = lerp(a,b,i/draw.divisions);
          if (visible(p)) tick(out,p,direction.side,draw.ticks);
        }
        const center = lerp(a,b,.5);
        if (draw.label && visible(center)) {
          const side = direction.side[1] > 0 ? direction.side.map(n => -n) : direction.side;
          const gap = scaled(draw.ticks.length,draw.ticks.units,center,side)*.5 + draw.labelSize*.8;
          out.labels.push({ text: draw.label, at: step(xy(center),side,gap), size: draw.labelSize });
        }
      }
    }
    if (!['polygon','grid','axes'].includes(draw.type)) result.push(out);
    return result;
  }

  return Object.freeze({ color, command, geometry, projector });
})();
if (typeof module !== 'undefined') module.exports = DrawingPrimitives;
