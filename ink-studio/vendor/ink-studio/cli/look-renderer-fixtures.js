const parity = [
  { id: 'baseline', expected: { left: [128, 96, 64], right: [96, 128, 176], background: [16, 20, 33] } },
  { id: 'tetrahedral', look: 'tetrahedral', expected: { left: [96, 64, 128], right: [96, 176, 96] } },
  { id: 'trilinear', look: 'trilinear', expected: { left: [48, 64, 128], right: [48, 176, 96] } },
  { id: 'linear-legal-range', look: 'linear-legal-range', tolerance: 1,
    expected: { left: [92, 68, 44], right: [68, 92, 128] } },
  { id: 'scoped-palette', look: 'scoped', expected: { left: [18, 120, 68], right: [96, 128, 176] } },
  { id: 'spatial-mask', look: 'masked', tolerance: 1, expected: { left: [74, 108, 66] } },
  { id: 'projected-texture-mask', look: 'texture', tolerance: 1, expected: { left: [73,108,66] } },
  { id: 'glass-control', glass: true, tolerance: 1, expected: { left: [76, 152, 38] } },
  { id: 'coverage-compositing', look: 'glass', glass: true, tolerance: 1, expected: { left: [76, 57, 140] } },
  { id: 'pane-stack', look: 'glass-stack', glass: true, tolerance: 2, expected: { left: [171,57,133] } },
  { id: 'masked-pane', look: 'glass-mask', glass: true, tolerance: 2, expected: { left: [76,104,90] } },
  { id: 'layered-panes', look: 'glass', glass: true, layers: true, tolerance: 2, expected: { left: [121,43,105] } },
  { id: 'refracted-pane', look: 'glass', glass: true, refract: 12, tolerance: 2, expected: { left: [76,57,140] } }
];

const profile = [
  { id: 'baseline' },
  { id: 'global-lut', look: 'tetrahedral' },
  { id: 'scoped-palette', look: 'scoped' },
  { id: 'scoped-mask', look: 'masked' },
  { id: 'layered-coverage', look: 'glass-mask', glass: true }
];

const samples = { left: [41, 40], right: [79, 40], background: [0, 0] };

// The same builder runs in Node and in the browser. It depends only on the bundled toolkit.
function buildFixture({ makeBuilder }, fixture, splats) {
  const palette = [0x101421, 0x806040, 0x6080b0, 0x00ee00];
  // Include the ungraded composite color so the native palette can represent the glass control.
  if (fixture.glass) palette.push(0x4c9826);
  const builder = makeBuilder(7, palette);
  const normal = [0, 0, 1];
  function disc(x, y, z, radius, color, object, glass = false, opacity = .4) {
    const start = builder.count();
    builder.disc(x, y, z, normal, radius, .035, builder.P[color], glass ? opacity : 3, glass ? { gl: true, nd: true } : undefined);
    builder.describeSplats(start, builder.count(), { object, material: glass ? 'glass' : 'clay' });
  }
  if (splats === undefined) {
    disc(-.8, 0, 0, .47, 1, 'left');
    disc(.8, 0, 0, .47, 2, 'right');
    if (fixture.glass) disc(-.8, 0, .32, .32, 3, 'pane', true);
    if (fixture.layers) disc(-.8,0,.62,.28,3,'pane-front',true,.25);
  } else {
    const side = Math.ceil(Math.sqrt(splats)), spacing = 2.6 / side;
    for (let i = 0; i < splats; i++) {
      const column = i % side, left = column < side / 2;
      const x=(column+.5)*spacing-1.3, y=(Math.floor(i/side)+.5)*spacing-1.3;
      if (fixture.glass && i%3===1) disc(x,y,.25,spacing*.68,3,'pane',true);
      else disc(x,y,0,spacing*.52,left?1:2,left?'left':'right');
    }
  }

  const look = fixture.glass ? { coverageAware: true } : {};
  const kind = fixture.look;
  if (['trilinear', 'tetrahedral', 'linear-legal-range'].includes(kind)) {
    const legal = { space: 'srgb-linear', range: [16, 235] };
    const managed = kind === 'linear-legal-range';
    const data = Array.from({ length: 8 }, (_, i) => {
      const r = i & 1, g = (i >> 1) & 1, b = (i >> 2) & 1;
      // A cross-channel product differs between the two interpolants even on a two-point grid.
      return managed ? [r, g, b].map(x => 16 + x * 109.5) : [r * g, b, r];
    }).flat();
    look.colorLut = { size: 2, data, ...(managed ? {
      domainMin: [16, 16, 16], domainMax: [235, 235, 235], domainPolicy: 'error',
      color: { input: legal, output: legal }
    } : { interpolation: kind }) };
  }
  if (['scoped','masked','texture','glass','glass-mask','glass-stack'].includes(kind)) {
    const pane = kind.startsWith('glass');
    const mask = kind==='texture' ? {type:'texture',space:'rest',interpolation:'linear',
      projection:{origin:[-1.2,-.4,0],along:[1,0,0],across:[0,1,0]},scale:[.8,.8],
      raster:{width:2,height:1,frames:[[0,0,0,0,0,0,0,128]]}} :
      { type:'axis', axis:'y',space:'world',range:[-1,1],interpolation:'linear' };
    look.paletteConstraints = { targets: [{
      select:{object:pane?'pane':'left',material:pane?'glass':'clay'},
      ...(kind==='glass-stack'?{stack:{name:'Rose pane',steps:[{type:'channelMix',
        matrix:[[0,1,0],[0,0,0],[0,1,0]]}]}}:{palette:[pane?'#0000ff':'#127844']}),
      ...(['masked','texture','glass-mask'].includes(kind)&&{mask})
    }, ...(fixture.layers?[{object:'pane-front',palette:['#ff0000']}]:[])] };
  }

  return builder.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 }, look, refract: fixture.refract ?? 0, dither: 0 });
}

module.exports = { parity, profile, samples, buildFixture };
