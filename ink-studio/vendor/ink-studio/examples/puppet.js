module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => {
  function build(seed, exportOptions) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    if (!exportOptions) {
      S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.2 });
      S.bake();
    }

    const tags = K.deform.tags(S);
    S.ball([0, 1, 0], [0.55, 1, 0.55], { r: [1, 2, 3, 4] }, { tag: 'body', res: 0.12 });
    S.ball([0, 2.25, 0], 0.4, { r: [5, 6, 7] }, { tag: 'head', res: 0.1 });
    const mesh =
      exportOptions &&
      K.model.fromSculpt(S, {
        name: 'Celebrating puppet',
        bounds: { min: [-0.75, -0.22, -0.75], max: [0.75, 2.85, 0.75] },
        resolution: exportOptions.resolution,
        method: exportOptions.method,
        targetTriangles: exportOptions.targetTriangles
      });
    S.bake();

    const W = B.finish({
      cam: { target: [0, 1.5, 0], dist: 12, pitch: 0.15, yaw: 0.4 },
      detail: 14,
      dither: 0.25
    });
    const clip = K.acts.clip('victory', { part: 'body', unit: 0.01 });
    function pose(t, dt, puppet) {
      clip.sample(t % 2, puppet.pose);
      puppet.look('head', [3, 2, 2], { limit: 45 });
    }
    const puppet = K.puppet(W, {
      react: true,
      parts: {
        body: { ids: tags.body, pivot: [0, 0, 0], slices: 6 },
        head: { ids: tags.head, pivot: [0, 2, 0], parent: 'body' }
      },
      pose
    });
    return mesh
      ? K.model.fromPuppet(mesh, puppet, {
          clips: [{ name: 'Victory', duration: exportOptions.duration ?? 2, fps: exportOptions.fps, pose }]
        })
      : W;
  }
  return {
    id: 'puppet-example',
    name: 'Celebrating puppet',
    seed: 3,
    build: seed => build(seed),
    model: (seed, options = {}) => build(seed, options)
  };
};
