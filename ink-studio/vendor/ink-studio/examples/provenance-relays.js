module.exports = api => {
  const { KIT: K, SplatProvenance, TargetSelectors } = api;
  const { world: W, procedural: P } = K;
  const mix = (name, offset) => ({
    name, steps: [{ type: 'channelMix', matrix: [[.62, 0, 0], [0, .62, 0], [0, 0, .62]], offset }]
  });
  const pack = { format: 'ink-studio/asset-pack', id: 'relay', version: 1, revision: 1, title: 'Relay paint', looks: [
    { id: 'relay/cobalt', label: 'Cobalt enamel', stack: mix('Cobalt enamel', [.015, .065, .48]) },
    { id: 'relay/ochre', label: 'Ochre enamel', stage: 'lit', stack: mix('Ochre enamel', [.43, .17, .008]) }
  ] };
  const visual = (half, material, ramp, surfaceId) => ({ half, material, ramp, ...(surfaceId && { surfaceId }) });
  const part = (position, half, material, ramp, surfaceId) => ({ position, visual: visual(half, material, ramp, surfaceId) });
  const grey = [1, 2, 3, 4], steel = [2, 3, 4, 5, 6], enamel = [2, 3, 4, 5, 6], brass = [20, 21, 22, 23];

  return {
    id: 'provenance-relays', name: 'Retained signal relays', seed: 42,
    build(seed, { controls } = {}) {
      const variant = controls?.variant ?? 'full';
      if (!['full', 'rebaked', 'lod'].includes(variant)) throw new Error('Choose full, rebaked or lod');
      const source = W.manifest({
        seed, assetPacks: [pack], prefabs: { relay: { entities: {
          base: part([0,.30,0],[.83,.10,.79],'steel',grey),
          body: part([0,.94,-.04],[.68,.57,.57],'enamel',enamel,'housing'),
          bezel: part([0,1.03,.55],[.48,.19,.065],'steel',grey,'bezel'),
          meter: part([0,1.07,.62],[.34,.069,.019],'glass',[13,14,15,16,17],'meter'),
          needle: part([-.1,1.07,.645],[.018,.04,.01],'brass',[23,24]),
          leftBolt: part([-.42,.77,.57],[.042,.041,.035],'brass',brass),
          rightBolt: part([.42,.77,.57],[.042,.041,.035],'brass',brass),
          cap: part([0,1.57,-.03],[.51,.073,.46],'steel',grey),
          grip: part([0,1.74,-.03],[.34,.055,.061],'brass',brass),
          leftGrip: part([-.32,1.67,-.03],[.05,.079,.054],'brass',brass),
          rightGrip: part([.32,1.67,-.03],[.05,.079,.054],'brass',brass)
        } } }, entities: {
          platform: part([0,.06,0],[2.86,.20,1.24],'steel',grey),
          deck: part([0,.23,0],[2.74,.077,1.14],'steel',steel),
          bridge: part([0,.44,-.43],[.60,.063,.046],'brass',brass),
          marker: part([0,.34,.78],[.29,.045,.14],'steel',grey),
          plate: part([0,.39,.78],[.22,.014,.10],'brass',brass)
        }, visual: {
          bounds: { min: [-3,-.32,-1.39], max: [3,2.1,1.39] },
          resolution: .051, ground: -.12, camera: { target: [0,.69,0], dist: 8.95, yaw: .26, pitch: .45 },
          look: { pixelSize: 2, renderStages: [
            { select: { prefab: 'west', surface: 'housing', material: 'enamel' }, asset: 'relay/cobalt', stage: 'lit' }
          ] }
        }
      });
      const west = W.stamp(source, 'relay', 'west', { position: [-1.17,0,0] }).world;
      const revised = variant !== 'full';
      const both = W.stamp(west, 'relay', 'east', { position: [1.17,0,0], overrides: [
        { op: 'set', path: ['entities', 'east.body', 'lookAsset'], value: {
          asset: 'relay/ochre', strength: revised ? .88 : .52
        } },
        ...(revised ? [
          { op: 'set', path: ['entities', 'east.body', 'visual', 'half'], value: [.68,.69,.57] },
          { op: 'set', path: ['entities', 'east.cap', 'position'], value: [0,1.69,-.03] },
          { op: 'set', path: ['entities', 'east.grip', 'position'], value: [0,1.86,-.03] },
          { op: 'set', path: ['entities', 'east.leftGrip', 'position'], value: [-.32,1.79,-.03] },
          { op: 'set', path: ['entities', 'east.rightGrip', 'position'], value: [.32,1.79,-.03] }
        ] : [])
      ] }).world;
      const run = W.runtime.create(both), query = run.query();
      const baked = W.visual(api, run.view(), query), index = TargetSelectors.index(baked);
      const groups = [[], [], []];
      for (let i = 0; i < baked.count; i++) {
        const { prefabs } = index.row(i);
        groups[prefabs?.includes('west') ? 1 : prefabs?.includes('east') ? 2 : 0].push(i);
      }
      const chunks = groups.map(rows => SplatProvenance.subset(baked, rows));
      const { cam, detail, radius, dither, fog, look, pal } = baked;
      const world = SplatProvenance.join(revised ? [chunks[2], chunks[0], chunks[1]] : chunks,
        { cam, detail, radius, dither, fog, look, pal, outline: { c: 0, edge: .092 }, query: () => query });
      return variant === 'lod' ? P.lod.reduceWorld(world,
        { ratio: .65, maxDistance: .093, maxRadius: .105, minNormal: .92, maxColor: .14 }) : world;
    }
  };
};
