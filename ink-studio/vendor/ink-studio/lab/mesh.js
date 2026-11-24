// A mesh from a file, used as a solid among sculpted ones: ink-studio turn lab/mesh.js     (or straight from the file: ink-studio mesh lab/assets/totem.obj)
const path = require('path'),
  studio = require('..');
module.exports = kit => ({
  id: 'lab-mesh',
  name: 'Mesh as a solid',
  seed: 1,
  build(seed) {
    const K = kit.KIT,
      mesh = K.mesh.fit(studio.readMesh(path.join(__dirname, 'assets', 'totem.obj')), { size: 5, turn: 0.4 }),
      GROUND = [0x3a4048, 0x4a5058, 0x666c70, 0x868c88];
    const look = K.mesh.look(mesh, { hues: 5 }),
      pal = look.pal.concat(GROUND),
      g0 = look.pal.length,
      B = kit.makeBuilder(seed, pal),
      S = K.sculpt(kit.makeSculpt(B));
    S.ground({ r: [g0, g0 + 1, g0 + 1, g0 + 2] }, { rad: 5, res: 0.12 });
    S.mesh(mesh, look, { res: 0.07, cells: 72 });
    /* it is a solid now: a bite out of the cap, and a sculpted stone melted against its foot */
    S.ball([0.9, 4.6, 0.6], 0.55, { r: [g0, g0 + 1] }, { neg: true });
    S.rock && S.rock([1.9, 0.3, 1.2], 0.6, { r: [g0, g0 + 1, g0 + 2, g0 + 3] }, { res: 0.08 });
    S.bake();
    return B.finish({
      cam: { target: [0, 2.4, 0], dist: 15, pitch: 0.2, yaw: 0.5, sway: 0.3 },
      detail: 14,
      palName: 'Lab',
      dither: 0.25,
      radius: 7
    });
  }
});
