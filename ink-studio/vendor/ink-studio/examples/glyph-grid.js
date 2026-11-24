/* A damaged terminal rebuilds its inscription around fragments from another memory. */
module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'glyph-grid',
  name: 'Palimpsest Terminal',
  seed: 53,
  build(seed) {
    const G = K.glyphGrid;
    const B = makeBuilder(seed, [
      0x080e1b, 0x142332, 0x22394b, 0x3a576b, 0x648393, 0x94afb6,
      0x311d2b, 0x593138, 0x915441, 0xcb7955, 0xf6ae75, 0xffe3ab,
      0x214b55, 0x34777e, 0x57b5b2, 0xacfff0
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .35, sky: .2, sun: K.V.norm([-.67, .61, .53]), sunK: .8 });
    S.pixelSize(27);
    const casing = { r: [1, 2, 3, 4] }, deep = { r: [0, 1, 2, 3] };
    const copper = { r: [6, 7, 8, 9, 10] }, amber = { r: [9, 10, 11], em: true };
    const mint = { r: [13, 14, 15], em: true };
    const box = (at, half, material, res = .085, rd = .04) => S.box(at, half, material, { res, rd });

    const width = 49, height = 8, alphabet = K.inspection.font({});
    function inscription(text) {
      const cells = new Uint8Array(width * height);
      [...text].forEach((ch, glyph) => {
        const bits = alphabet.get(ch);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < 6; x++) cells[y * width + glyph * 7 + x] = Number(bits[y * 6 + x] > 0);
      });
      return cells;
    }
    const archive = inscription('ARCHIVE'), rival = inscription('ORACLES');
    const signal = G.create({ width, height, initial: archive, seed,
      patterns: [{ cells: archive, weight: 1 }, { cells: rival, weight: .28 }] });
    const status = G.create({ width: 30, height: 1, states: 4, seed: seed + 1, boundary: 'wrap',
      neighborhood: [[-1, 0], [1, 0]], initial: ({ x }) => x % 10 === 2 ? 3 : 0,
      rule: ({ state, neighbors, random }) => state > 0 ? state - 1 :
        neighbors.includes(3) || random() < .025 ? 3 : 0 });
    const dice = K.grow.dice(seed + 678);
    const damage = Array.from(archive, (value, i) => {
      const x = i % width, y = Math.floor(i / width), glyph = Math.floor(x / 7), col = x % 7;
      const spacer = col >= 5 || y === 7;
      const fragment = !spacer && (glyph === 1 && col < 3 && y < 4 ||
        glyph === 2 && col >= 3 && y > 3 || glyph === 3 && y < 2 ||
        glyph === 4 && col < 2 && y > 2 || glyph === 5 && y === 3);
      const locked = spacer || fragment || dice() < .09;
      const state = spacer ? 0 : fragment ? rival[i] : locked || dice() > .49 ? value : Number(dice() < .23);
      return { x, y, state, locked };
    });

    const copy = frame => ({ ...frame, cells: frame.cells.slice(), locked: frame.locked.slice() });
    const fault = 9, repair = 15, stable = 54, step = .1;
    const simulation = K.procedural.graph.simulation({
      initial: { sign: signal.snapshot(), bus: status.snapshot() },
      clone: ({ sign, bus }) => ({ sign: copy(sign), bus: copy(bus) }),
      dt: step, seed, checkpoint: 8, cache: 12,
      step({ sign, bus }, { index }) {
        signal.restore(sign);
        status.restore(bus);
        if (index === fault) signal.edit(damage);
        if (index >= repair && index < stable) signal.recall(1, {
          fraction: .054 + (index - repair) * .0032,
          temperature: Math.max(0, .096 - (index - repair) * .004)
        });
        if (index % 2 === 0) status.step();
        return { sign: signal.snapshot(), bus: status.snapshot() };
      }
    });

    const phosphor = G.paint({ mode: 'pixel', tiles: [
      { color: '#0c1c25' }, { color: '#ffb569' }, { color: '#73ece0' }, { color: '#ffedb5' }
    ] });
    const halos = G.paint({ mode: 'pixel', tiles: [
      null, { color: '#ff88366f' }, { color: '#6ceae99f' }, { color: '#ffdd7aff' }
    ] });
    const busInk = G.paint({ tiles: [
      { glyph: ' ', background: '#0d1a27' }, { glyph: '·', color: '#527989', background: '#0d1a27' },
      { glyph: '┼', color: '#7daea3', background: '#0d1a27' }, { glyph: '■', color: '#86dcca', background: '#0d1a27' }
    ] });

    // The texture and splats share the same physical origin and pixel spacing.
    const px = .12, signX = -width * px / 2, signY = 2.80, z = 1.15;
    const surfaces = SpriteSurface.make(192, 96);
    const panel = surfaces.reserve(width, height);
    surfaces.faceRegion([signX, signY - height * px, z], [width * px, 0, 0], [0, height * px, 0], panel);
    const bus = surfaces.reserve(180, 8);
    surfaces.faceRegion([-2.95, 1.29, 1.13], [5.90, 0, 0], [0, .26, 0], bus);
    const texture = surfaces.finish();

    box([0, 1.99, .44], [3.44, 1.28, .52], casing, .108, .15);
    box([0, 2.31, .950], [3.05, .63, .041], deep, .082, .05);
    for (const side of [-1, 1]) {
      const x = side * 3.18;
      box([x, 2.08, .96], [.14, .95, .095], copper, .076, .065);
      for (let i = 0; i < 4; i++) {
        box([x, 1.38 + i * .29, 1.065], [.041, .031, .026], i === 1 ? mint : copper, .039, .009);
      }
      box([side * 2.48, .60, .31], [.17, .32, .21], casing, .086, .09);
      S.tube([[side * 2.97, .64, .48], [side * 2.62, .30, .68], [side * 1.61, .22, .73]],
        .052, .045, copper, { res: .102 });
    }
    for (const y of [1.74, 2.91]) box([0, y, 1.00], [3.03, .052, .037], copper, .1, .02);
    box([0, 1.42, .952], [3.06, .19, .052], deep, .095, .03);
    box([0, .23, .30], [3.71, .20, .87], casing, .125, .11);
    box([0, .075, .29], [3.89, .12, 1.04], deep, .131, .08);

    for (let i = 0; i < 18; i++) {
      const x = (i - 8.5) * .36;
      box([x, 3.13, .82], [.099, .029, .05], i % 6 === 0 ? amber : deep, .055, .015);
      box([x, .33, 1.025], [.051, .022, .023], i % 3 === 0 ? amber : casing, .043, .01);
    }
    S.bake();

    let current, prevTick = -1;
    function view(t) {
      const snap = simulation.sample(Math.max(0, t));
      if (snap.frame === prevTick) return current;
      const { sign, bus } = snap.state;
      const old = snap.frame > 0 ? simulation.sample((snap.frame - 1) * step).state.sign.cells : undefined;
      const cells = Uint8Array.from(sign.cells, (value, i) => value && (
        snap.frame >= fault && sign.locked[i] && damage[i].state !== archive[i] ? 2 :
          snap.frame >= fault && old && !old[i] ? 3 : 1));
      prevTick = snap.frame;
      current = { sign: { ...sign, states: 4, cells }, bus };
      return current;
    }
    const light = K.frameSplats(B, width * height, (draw, _dt, t) => {
      halos.emit(view(t).sign, draw, { origin: [signX, signY, z + .032], across: [px, 0, 0], down: [0, -px, 0],
        width: .039, density: .56, depth: false });
    });
    const world = B.finish({
      cam: { target: [0, 1.83, .40], dist: 9.65, yaw: -.10, pitch: .115, fov: .64 },
      radius: 7, detail: 27, dither: .18, look: { pixelSize: 2, splatCoverage: 'continuous' },
      spriteSurfaces: texture
    });
    const stage = K.stage(world);
    stage.add(light);
    let written;
    function refresh(t) {
      const shown = view(t);
      if (shown === written) return;
      SpriteSurface.update(texture, panel, phosphor.raster(shown.sign));
      SpriteSurface.update(texture, bus, busInk.raster(shown.bus));
      written = shown;
    }
    stage.add({ update(_dt, t) { refresh(t); } });
    refresh(0);
    return world;
  }
});
