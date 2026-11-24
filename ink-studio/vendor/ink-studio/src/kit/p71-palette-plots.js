/* Splat geometry and data for RGB and OKLab palette plots. */
(function (K) {
  const P = K.procedural, color = P.materials.perceptual;
  const layouts = {
    rgb: {
      labels: ['R', 'G', 'B'], spans: [[0,1],[0,1],[0,1]], axisStart: [0,0,0],
      tones: ['#ef766e','#7dcb8e','#76a5ec'], position: rgb => rgb
    },
    oklab: {
      labels: ['a', 'L', 'b'], spans: [[-.35,.35],[0,1],[-.35,.35]], axisStart: [0,0,0],
      tones: ['#df8cb3','#e3e7e7','#efc477'], position(coordinates) {
        const [L,a,b] = coordinates;
        return [a,L,b];
      }
    }
  };
  const finite = value => Number.isFinite(value);
  const point = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(finite);
  const add = (a,b) => a.map((value,i) => value + b[i]);
  const packedRGB = rgb => rgb.map(value => Math.round(value * 255));
  const hex = rgb => '#' + color.toHex(rgb).toString(16).padStart(6,'0');

  function plot(definition) {
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype ||
        Object.keys(definition).some(key => !['palette','space','size','radius','frame'].includes(key)))
      throw new TypeError('A palette plot needs a palette, colour space, size, radius and frame settings');
    const { palette, space = 'rgb', size = 4, radius = .023, frame = space === 'rgb' ? 'box' : 'axes' } = definition;
    if (!Array.isArray(palette) || !palette.length || palette.length > 256 ||
        !Object.hasOwn(layouts,space) || !['box','axes','off'].includes(frame) ||
        !finite(size) || size < .01 || size > 10000 || !finite(radius) || radius < .001 || radius > .15)
      throw new RangeError('Use 1–256 swatches, rgb or oklab space, a positive plot size, radius in [.001, .15], and box, axes or off');
    const layout = layouts[space];
    const center = layout.spans.map(([lo,hi]) => (lo+hi)/2);
    const position = coordinates => coordinates.map((value,i) => (value-center[i])*size);
    const points = Array.from(palette,(swatch,index) => {
      const rgb = color.parse(swatch);
      if (!Array.from(rgb).every(finite)) throw new TypeError('A palette plot swatch needs three finite RGB channels');
      const coordinates = space === 'rgb' ? rgb : color.lab(rgb);
      return { index, swatch:hex(rgb), coordinates, position:position(layout.position(coordinates)) };
    });
    const axes = layout.labels.map((label,i) => {
      const [low,high] = layout.spans[i];
      const endpoint = value => position(layout.axisStart.map((n,k) => k === i ? value : n));
      return { label, range:[low,high], from:endpoint(low), to:endpoint(high), color:layout.tones[i] };
    });

    function emit(builder, { origin = [0,0,0], scale = 1, id, frameColor = '#50647a' } = {}) {
      if (!point(origin) || !finite(scale) || scale <= 0 || id !== undefined && (typeof id !== 'string' || !id.trim() || id.length > 256))
        throw new TypeError('Plot placement needs a finite XYZ origin, positive scale and an optional object ID');
      const colorFrame = packedRGB(color.parse(frameColor));
      const placed = p => add(p.map(n => n*scale),origin);
      const span = size*scale;
      const line = (a,b,r,tint) => {
        const delta = K.V.sub(b,a);
        const steps = 12, axis = K.V.norm(delta), length = K.V.len(delta)*scale;
        for (let i=0;i<steps;i++) {
          const middle = a.map((value,k) => value + delta[k]*(i+.5)/steps);
          builder.stick(...placed(middle),axis,length*.45/steps,span*r,tint,3,{em:true,nd:true});
        }
      };
      const first = builder.count();
      if (frame === 'box') {
        const corners = Array.from({length:8},(_,i) =>
          position(layout.spans.map((range,k) => range[(i >> k) & 1])));
        for (let i=0;i<8;i++) for (const axis of [1,2,4]) if (!(i & axis))
          line(corners[i],corners[i | axis],.0032,colorFrame);
      }
      const visibleAxes = frame === 'off' ? [] : axes;
      for (const axis of visibleAxes) {
        const tint = packedRGB(color.parse(axis.color));
        line(axis.from,axis.to,.006,tint);
        builder.iso(...placed(axis.to),span*.013,tint,3,{em:true,nd:true});
      }
      const firstSwatch = builder.count();
      for (const row of points) builder.iso(...placed(row.position),span*radius,packedRGB(color.parse(row.swatch)),3,{em:true,nd:true});
      if (id !== undefined) {
        builder.describeSplats?.(first,firstSwatch,{object:id,target:{tags:['palette-plot-frame']}});
        builder.describeSplats?.(firstSwatch,builder.count(),{object:id,target:{tags:['palette-plot-swatch']}});
      }
      return visibleAxes.map(({label,to,color}) => ({label,at:placed(to),color}));
    }

    return Object.freeze({ space, size, axes:P.data.freeze(axes), points:P.data.freeze(points), emit });
  }

  P.materials.palettePlot = plot;
})(KIT);
