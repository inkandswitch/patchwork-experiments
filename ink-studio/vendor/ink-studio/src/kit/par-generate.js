/* Stock typed graph ports for the headless generator library. */
(function (K) {
  const P = K.procedural, G = P.generator;
  const options = { type: 'record', default: {} };
  const input = (type, value) => ({ type, default: value });
  const value = (type, generate) => ({ outputs: { value: type }, run: (inputs, context) => ({ value: generate(inputs, context) }) });
  const seeded = (options, context) => ({ seed: context.seed, ...options });
  const timed = (options, context) => ({ time: context.time, ...seeded(options, context) });

  G.operations = Object.freeze({
    'proc.noise': {
      inputs: { definition: input('record', { type: 'simplex', axes: ['x', 'y'] }), options },
      ...value('field', ({ definition, options }, context) => G.noise(definition, seeded(options, context)))
    },
    'proc.pattern': { inputs: { options }, ...value('field', ({ options }) => G.pattern(options)) },
    'proc.sample': {
      inputs: { source: 'field', options }, time: true,
      ...value('raster', ({ source, options }, { time }) => G.sample(source, { time, ...options }))
    },
    'proc.scatter': {
      inputs: { options }, outputs: { value: 'points', samples: 'array<record>', report: 'record' }, time: true,
      run: ({ options }, context) => G.scatter(timed(options, context))
    },
    'proc.reaction': {
      inputs: { steps: input('number', 400), options },
      outputs: { value: 'raster', u: 'raster', report: 'record' },
      run: ({ steps, options }, context) => G.reaction({ ...seeded(options, context), steps })
    },
    'proc.repeat': {
      inputs: { source: 'raster', options },
      ...value('raster', ({ source, options }) => G.repeat(source, options))
    },
    'proc.tiles': {
      inputs: { definitions: 'array<record>', options },
      ...value('record', ({ definitions, options }, context) => G.tiles(definitions, seeded(options, context)))
    },
    'proc.tileImage': {
      inputs: { layout: 'record', images: 'record' },
      ...value('raster', ({ layout, images }) => G.tileImage(layout, images))
    },
    'proc.path': {
      inputs: { points: 'points', options }, outputs: { value: 'path', points: 'points', length: 'number' },
      run: ({ points, options }) => G.path(points, options)
    },
    'proc.rain': {
      inputs: { options }, outputs: { value: 'raster', particles: 'array<record>' }, time: true,
      run: ({ options }, context) => G.rain(timed(options, context))
    },
    'proc.sparks': {
      inputs: { options }, outputs: { value: 'raster', particles: 'array<record>' }, time: true,
      run: ({ options }, context) => G.sparks(timed(options, context))
    },
    'proc.plume': {
      inputs: { options }, outputs: { value: 'raster', recipe: 'record' }, time: true,
      run: ({ options }, context) => G.plume(timed(options, context))
    },
    'proc.tree': {
      inputs: { options }, outputs: { value: 'raster', branches: 'array<record>', leaves: 'points' },
      run: ({ options }, context) => G.tree(seeded(options, context))
    },
    'proc.cable': {
      inputs: { start: 'vec3', end: 'vec3', options },
      outputs: { value: 'raster', path: 'path', length: 'number' },
      run: ({ start, end, options }) => G.cable(start, end, options)
    },
    'proc.parallax': {
      inputs: { layers: 'array<record>', options }, time: true,
      ...value('raster', ({ layers, options }, { time }) => G.parallax(layers, { time, ...options }))
    },
    'proc.horizon': {
      inputs: { bands: 'array<record>', options },
      ...value('record', ({ bands, options }) => G.horizon(bands, options))
    }
  });
  delete P.generatorSupport;
})(KIT);
