/* Stock typed geometry, signed-field, camera, light and sprite rig nodes. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph;
  const param = (type, value) => ({ type, default: value });
  const options = param('record', {});
  const lights = param('array<record>', []);
  const value = (type, evaluate) => ({ outputs: { value: type }, run: (inputs, ctx) => ({ value: evaluate(inputs, ctx) }) });
  const clock = (options, ctx) => ({ time: ctx.time, ...options });
  const slices = { value: 'mesh', bounds: 'record', report: 'record' };

  A.operations = Object.freeze({
    'geo.mesh': { inputs: { source: 'mesh' }, ...value('mesh', ({ source }) => A.mesh(source)) },
    'geo.box': { inputs: { options }, ...value('mesh', ({ options }) => A.box(options)) },
    'geo.tube': {
      inputs: { start: 'vec3', end: 'vec3', options },
      ...value('mesh', ({ start, end, options }) => A.tube(start, end, options))
    },
    'geo.triangulate': {
      inputs: { rings: 'array<points>', options },
      ...value('mesh', ({ rings, options }) => A.triangulate(rings, options))
    },
    'geo.transform': {
      inputs: { source: 'mesh', options },
      ...value('mesh', ({ source, options }) => A.transform(source, options))
    },
    'geo.merge': { inputs: { sources: 'array<mesh>' }, ...value('mesh', ({ sources }) => A.merge(sources)) },
    'geo.clip': {
      inputs: { source: 'mesh', planes: 'array<record>', options },
      ...value('mesh', ({ source, planes, options }) => A.clip(source, planes, options))
    },
    'geo.extrudeImage': {
      inputs: { source: 'raster', options }, outputs: { ...slices, front: 'mesh' },
      run: ({ source, options }) => A.extrudeImage(source, options)
    },
    'geo.sliceStack': {
      inputs: { slices: 'array<raster>', options }, outputs: slices,
      run: ({ slices, options }) => A.sliceStack(slices, options)
    },
    'sdf.shape': {
      inputs: { kind: param('string', 'sphere'), options },
      ...value('field', ({ kind, options }) => A.shape(kind, options))
    },
    'sdf.bound': {
      inputs: { source: 'field', bounds: 'record' },
      ...value('field', ({ source, bounds }) => A.boundSDF(source, bounds))
    },
    'sdf.transform': {
      inputs: { source: 'field', options },
      ...value('field', ({ source, options }) => A.transformSDF(source, options))
    },
    'sdf.combine': {
      inputs: { sources: 'array<field>', options },
      ...value('field', ({ sources, options }) => A.combineSDF(sources, options))
    },
    'sdf.mesh': {
      inputs: { source: 'field', options }, time: true,
      ...value('mesh', ({ source, options }, ctx) => A.sdfMesh(source, clock(options, ctx)))
    },
    'sdf.slices': {
      inputs: { source: 'field', options }, outputs: { value: 'array<raster>', layout: 'record' }, time: true,
      run: ({ source, options }, ctx) => A.sdfSlices(source, clock(options, ctx))
    },
    'sdf.render': {
      inputs: { source: 'field', camera: options, lights, options },
      outputs: { value: 'raster', frame: 'renderFrame', report: 'record' }, time: true,
      run: ({ source, camera, lights, options }, ctx) => A.renderSDF(source, { ...clock(options, ctx), camera, lights })
    },
    'scene.camera': { inputs: { options }, ...value('record', ({ options }) => A.camera(options)) },
    'scene.cameraTrack': {
      inputs: { definition: 'record', options }, outputs: { value: 'record', sample: 'record' }, time: true,
      run({ definition, options }, ctx) {
        const sample = A.cameraTrack(definition, clock(options, ctx));
        return { value: sample.camera, sample };
      }
    },
    'scene.light': {
      inputs: { kind: param('string', 'sun'), options },
      ...value('record', ({ kind, options }, { node }) => A.light(kind, { id: node, ...options }))
    },
    'scene.object': { inputs: { source: 'mesh', options },
      ...value('record', ({ source, options }, { node }) => A.object(source, { id: node, ...options }))
    },
    'scene.world': {
      inputs: { objects: 'array<record>', options },
      ...value('world', ({ objects, options }, { seed }) => A.world(objects, { seed, ...options }))
    },
    'scene.diorama': {
      inputs: { definition: 'record', parameters: options }, time: true,
      ...value('world', ({ definition, parameters }, { time, seed }) => K.diorama.build(
        { seed, ...definition }, { parameterInputs: { ...parameters, time } }))
    },
    'rig.bindSprite': {
      inputs: { source: 'raster', bones: 'array<record>', options },
      ...value('record', ({ source, bones, options }) => A.bindSprite(source, bones, options))
    },
    'rig.pose': {
      inputs: { tracks: 'record', options }, time: true,
      ...value('record', ({ tracks, options }, { time }) => A.spritePose(tracks, options.time ?? time))
    },
    'rig.skinSprite': {
      inputs: { source: 'raster', bind: 'record', pose: options, options },
      outputs: { value: 'raster', field: 'raster', points: 'points', joints: 'record' },
      run: ({ source, bind, pose, options }) => A.skinSprite(source, bind, pose, options)
    }
  });
  delete P.sceneGraphSupport;
})(KIT);
