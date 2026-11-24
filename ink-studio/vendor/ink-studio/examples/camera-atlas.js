const studio = require('..');

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'camera-atlas',
  name: 'Relay yard',
  seed: 52,
  build(seed) {
    const B = makeBuilder(seed, [
      0x080d1b, 0x14243b, 0x203c55, 0x2e5871, 0x4b7986, 0x7ab8b0,
      0x39283d, 0x693942, 0xa9554a, 0xe28152, 0xffbb78, 0xffedb4,
      0x214d56, 0x277a75, 0x55b994, 0xaeebbc,
      0x30355b, 0x5d5287, 0x9483c4, 0xcebcf5
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .34, sky: .23, sun: K.V.norm([-.64, .67, .38]), sunK: .85 });
    S.pixelSize(25);
    const stone = K.pixel.masonry({ r: [1, 2, 3, 4], seed, joint: 1, stone: [11, 7] });
    const steel = { r: [1, 2, 3, 4, 5] }, copper = { r: [6, 7, 8, 9, 10] };
    const amber = { r: [9, 10, 11], em: true }, mint = { r: [13, 14, 15], em: true };
    const iris = { r: [16, 17, 18, 19] }, purple = { r: [17, 18, 19], em: true };
    const box = (at, half, material, res = .1, rd = .045) => S.box(at, half, material, { res, rd });
    box([0, -.26, 0], [4.84, .25, 2.25], stone, .15, .12);
    box([0, -.045, 1.82], [4.69, .12, .23], steel, .13, .06);
    box([0, .08, 1.79], [4.47, .026, .03], copper, .13, .01);
    for (let i = -8; i <= 8; i++) {
      const x = i * .52;
      box([x, .117, 1.79], [.084, .022, .029], i % 3 ? amber : mint, .041, .008);
    }
    for (const x of [-3.02, -.25, 2.49]) {
      box([x, .062, 0], [1.05, .12, .88], steel, .11);
      box([x, .20, 0], [.85, .085, .73], stone, .09);
      box([x, .27, .72], [.66, .022, .035], x < -1 ? amber : x > 1 ? mint : purple, .065);
    }

    // West antenna.
    box([-3.02, .54, 0], [.58, .27, .47], copper, .088);
    box([-3.02, 1.51, 0], [.12, .99, .13], copper, .08);
    for (const [y, radius] of [[1.18, .47], [1.62, .62], [2.12, .41]]) {
      const ring = Array.from({ length: 25 }, (_, i) => {
        const angle = i * Math.PI / 12;
        return [-3.02 + radius * Math.cos(angle), y + .08 * Math.sin(angle), radius * Math.sin(angle)];
      });
      S.tube(ring, .033, .028, amber, { res: .062 });
    }
    S.ball([-3.02, 2.61, 0], .12, amber, { res: .047 });
    for (const side of [-1, 1])
      S.tube([[-3.02 + side * .45, .55, .27], [-3.02 + side * .20, 1.62, .16], [-3.02, 2.29, .02]],
        .041, .035, steel, { res: .064 });

    // Central violet receiver.
    box([-.25, .57, .09], [.46, .30, .47], iris, .08);
    box([-.25, .93, .09], [.18, .22, .17], steel, .065);
    S.ball([-.25, 1.33, .09], [.76, .65, .22], iris, { res: .078 });
    S.ball([-.25, 1.37, .298], [.58, .49, .07], { r: [1, 16, 17] }, { res: .069 });
    S.ball([-.25, 1.36, .36], [.15, .15, .09], purple, { res: .043 });
    for (const side of [-1, 1]) S.tube([[-.25 + side * .65, 1.49, .21], [-.25 + side * .35, 1.34, .43], [-.25, 1.36, .48]],
      .04, .033, iris, { res: .067 });

    // Green coolant bank.
    for (const [x, z, height] of [[1.99, -.18, 1.47], [2.52, .12, 1.17], [3, -.17, 1.68]]) {
      S.ball([x, .26 + height / 2, z], [.215, height / 2, .225], { r: [2, 12, 13, 14, 15] }, { res: .066 });
      box([x, .38, z], [.245, .092, .245], steel, .078);
      box([x, height + .055, z], [.222, .13, .24], steel, .068);
      box([x, height + .195, z], [.103, .029, .102], mint, .047);
    }

    // A monitor face shares the static floor atlas, with room for other devices.
    const tileWidth = 68, tileHeight = 48;
    const surfaces = SpriteSurface.make(160, 160);
    surfaces.face([-4.5, .14, 1.40], [9, 0, 0], [0, 0, -.27], 100, 8,
      (x, y) => (x % 11 + y) % 11 < 3 ? 0xa66552 : 0x2b4b64);
    const screen = surfaces.reserve(tileWidth, tileHeight);
    surfaces.faceRegion([1.53, 2.08, -1.055], [2.17, 0, 0], [0, 1.51, 0], screen);
    box([2.62, 2.84, -1.37], [1.16, .82, .13], steel, .085, .055);
    box([2.62, 3.65, -1.226], [1.13, .035, .025], copper, .092, .012);
    for (const x of [1.7, 3.52]) box([x, 1.09, -1.38], [.09, 1.09, .10], steel, .084);
    for (const x of [3.38, 3.54, 3.7]) box([x, 1.995, -1.226], [.029, .024, .029], x < 3.7 ? amber : mint, .036);
    S.bake();

    const pixels = surfaces.finish();
    const cameras = [
      { id: 'west', target: [-3.02, 1.38, 0], yaw: .23, pitch: .09, dist: 4.4, fps: 12 },
      { id: 'dish', target: [-.25, 1.13, .02], yaw: -.62, pitch: .24, dist: 3.66, fps: 6 },
      { id: 'coolant', target: [2.49, 1.03, -.03], yaw: -.40, pitch: .27, dist: 3.37, fps: 4 }
    ];
    const atlas = studio.createCameraAtlas({
      width: 3 * (tileWidth + 2), height: tileHeight, maxViewsPerFrame: 2,
      maxPixelsPerFrame: 2 * tileWidth * tileHeight,
      views: cameras.map(({ id, fps, target, yaw, pitch, dist }, i) => ({
        id, fps, rect: [i * (tileWidth + 2), 0, tileWidth, tileHeight],
        frame: ({ time }) => ({ camera: { target, pitch, dist, yaw: yaw + .17 * Math.sin(time * (i + 1) * .6) },
          spriteSurfaces: false })
      }))
    });
    const sync = atlas.bindSurface(pixels, 'west', screen);
    const overlays = cameras.map(({ id }, i) => atlas.layer(id, { rect: [34 + i * 103, 31, 96, 67] }));
    const chrome = { draw: cameras.flatMap(({ id, fps }, i) => [
      { type: 'rect', rect: [33 + 103 * i, 30, 98, 69], color: '#415a76' },
      { type: 'text', at: [82 + 103 * i, 108], text: id.toUpperCase() + ' / ' + fps, size: 7, width: 1, color: '#a3b6c9' }
    ]) };
    const world = B.finish({
      cam: { target: [0, 1.56, 0], dist: 12.5, yaw: -.22, pitch: .37, fov: .64 },
      radius: 7, detail: 24, dither: .16, spriteSurfaces: pixels,
      look: { pixelSize: 2, splatCoverage: 'continuous', composite: { layers: [chrome, ...overlays] } }
    });
    const stage = K.stage(world);
    stage.add({ update(_dt, time) { atlas.capture(world, { time }); sync(); } });
    return world;
  }
});
