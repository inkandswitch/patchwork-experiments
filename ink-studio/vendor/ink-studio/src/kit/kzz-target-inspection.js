(function (K) {
  const bindings = new WeakMap(),
    fonts = new WeakMap();
  function anchor(spec, { world, time, sceneTime }) {
    const poseTime = sceneTime ?? world.timeDomains?.read('animation').sampleTime ?? time;
    if(spec.node!==undefined){
      const graph=world.sceneGraph;
      if(!graph?.has(spec.node)||spec.socket&&!graph.node(spec.node).sockets.includes(spec.socket))return null;
      const ref={node:spec.node,...(spec.socket&&{socket:spec.socket})},frame=graph.frame(ref);
      if(!frame.visible)return null;
      const p=spec.point??[0,0,0];if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw new TypeError('Invalid hierarchy inspection point');
      if(spec.halfSize&&(!Array.isArray(spec.halfSize)||spec.halfSize.length!==3||!spec.halfSize.every(v=>Number.isFinite(v)&&v>=0)))throw new TypeError('Invalid hierarchy inspection bounds');
      return {at:graph.toWorld(ref,p),...(spec.halfSize&&{halfSize:[0,1,2].map(i=>[0,1,2].reduce((sum,k)=>sum+Math.abs(frame.matrix[i*3+k])*spec.halfSize[k],0))})};
    }
    if (Number.isSafeInteger(spec.splat)) {
      if (spec.splat < 0 || spec.splat >= world.count) return null;
      return { at: K.splatFrames.create(world, poseTime, K.M)(spec.splat).position() };
    }
    if (Number.isSafeInteger(spec.part) || Number.isSafeInteger(spec.bone)) {
      const index = spec.part ?? spec.bone,
        p = spec.point ?? [0, 0, 0];
      if (index < 0 || !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite))
        throw new TypeError('Invalid inspection rig anchor');
      const matrix = spec.part != null ? world.anim?.rig?.M : world.anim?.bones;
      if (!matrix || index * 12 + 11 >= matrix.length) return null;
      const q = index * 12;
      return { at: K.M.app(matrix.subarray(q, q + 9), p).map((v, k) => v + matrix[q + 9 + k]) };
    }
    if (spec.selector) {
      const selector = TargetSelectors.prepare(spec.selector);
      let binding = bindings.get(spec);
      if (
        !binding ||
        binding.data !== world.data ||
        binding.count !== world.count ||
        binding.metadata !== world.renderMetadata
      ) {
        const metadata = TargetSelectors.index(world),
          ids = [];
        for (let i = 0; i < world.count; i++) if (TargetSelectors.matches(selector, metadata.row(i))) ids.push(i);
        binding = { data: world.data, count: world.count, metadata: world.renderMetadata, ids };
        bindings.set(spec, binding);
      }
      if (!binding.ids.length) return null;
      const sample = K.splatFrames.create(world, poseTime, K.M),
        lo = [Infinity, Infinity, Infinity],
        hi = [-Infinity, -Infinity, -Infinity];
      for (const id of binding.ids) {
        const p = sample(id).position();
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
      return { at: lo.map((v, k) => (v + hi[k]) / 2), halfSize: lo.map((v, k) => Math.max(0.02, (hi[k] - v) / 2)) };
    }
    throw new TypeError('Inspection anchors support splat, part, bone, or selector');
  }
  const getFont = settings => {
    if (!settings.glyphs || typeof settings.glyphs !== 'object') return TargetInspection.font(K.ascii.atlas(), settings.glyphs);
    if (!fonts.has(settings.glyphs)) {
      const glyphs = TargetInspection.font(K.ascii.atlas(), settings.glyphs);
      fonts.set(settings.glyphs, glyphs);
    }
    const glyphs = fonts.get(settings.glyphs);
    for (const target of settings.targets)
      for (const ch of target.ripple?.chars ?? '')
        if (!glyphs.has(ch)) throw new RangeError('Missing inspection ripple glyph: ' + ch);
    return glyphs;
  };
  K.inspection = Object.freeze({
    ...TargetInspection,
    anchor,
    font: getFont,
    plan: (settings, context) => TargetInspection.plan(settings, { resolve: anchor, ...context }),
    compose: (frame, plan, settings, depthAt) => TargetInspection.compose(frame, plan, getFont(settings), depthAt)
  });
})(KIT);
