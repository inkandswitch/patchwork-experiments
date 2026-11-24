/* A small integration example: authoring owns intent, chunks own realized geometry. */
function retainedExample(K, { canvas, status, resize, undo, redo, draw }) {
  const A = K.authoring,
    P = K.procedural;
  const doc = A.document(),
    context = A.context(doc);
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mountSurface = entity => {
    const { x, width } = entity.parameters;
    return P.surface.plane({ id: 'face', origin: [x - width / 2, 0.35, 0.15], u: [width, 0, 0], v: [0, 1, 0] });
  };
  context.register('mount', {
    describe(entity) {
      const surface = mountSurface(entity);
      return { bounds: surface.bounds, surfaces: [surface] };
    }
  });
  context.rule({
    id: 'fitted-clips',
    types: ['mount'],
    generate(entity) {
      const count = Math.floor(entity.parameters.width / 0.57);
      return Array.from({ length: count }, (_, i) => ({
        key: 'clip-' + (i + 1),
        type: 'clip',
        anchor: { host: entity.id, surface: 'face', uv: [(i + 0.5) / count, 0.75], offset: 0.08 }
      }));
    }
  });
  doc.transact('Create two assemblies', () => {
    doc.create('mount', { id: 'left', parameters: { x: -2.65, width: 2.4 } });
    doc.create('mount', { id: 'right', parameters: { x: 2.65, width: 3.1 } });
  });
  function box(point, half, material, frame = identity) {
    return P.pieces.box(point, half, frame, { material }).mesh;
  }

  function build({ input }, { quality }) {
    const { entity, frames } = input;
    const { x, width } = entity.parameters;
    const material = entity.id === 'left' ? 'glaze' : 'ochre';
    const pieces = [
      box([x, 1.1, 0], [width / 2, 0.11, 0.15], 'basalt'),
      ...[-1, 1].map(side => box([x + side * (width / 2 - 0.12), 0.5, 0], [0.09, 0.5, 0.12], 'basalt'))
    ];
    for (const { R, t } of frames) {
      pieces.push(box(K.V.sub(t, [0, 0.16, 0]), [0.13, 0.18, 0.08], material, R));
      if (quality === 'final') pieces.push(box(K.V.add(t, [0, -0.1, 0.085]), [0.04, 0.045, 0.025], 'cream', R));
    }
    return pieces;
  }

  const chunks = P.chunks.create({ preview: build, refine: build });
  let request = 0;
  async function realize() {
    const generation = ++request;
    const input = doc.entities('mount').map(entity => {
      const clips = context.collection({ anchorHost: entity.id });
      const frames = clips.map(clip => A.worldFrame(context, clip.id));
      return {
        key: entity.id,
        revision: JSON.stringify([entity, clips]),
        input: { entity, frames },
        bounds: P.spatial.expand(mountSurface(entity).bounds, 0.35)
      };
    });
    const preview = await chunks.update(input, { quality: 'preview' });
    if (!preview || generation !== request) return;
    draw(
      canvas,
      chunks.entries().flatMap(entry => entry.value)
    );
    const final = await chunks.update(input);
    if (!final || generation !== request) return;
    draw(
      canvas,
      chunks.entries().flatMap(entry => entry.value)
    );
    const changed = preview.replaced.map(entry => entry.key);
    const kept = input.map(entry => entry.key).filter(key => !changed.includes(key));
    status.textContent = changed.length
      ? 'Updated ' + changed.join(' and ') + (kept.length ? ' · reused ' + kept.join(' and ') : '')
      : 'No geometry changes';
    const history = doc.history();
    undo.disabled = history.undo.length <= 1;
    redo.disabled = history.redo.length === 0;
  }

  function update() {
    realize().catch(error => {
      status.textContent = error.message;
    });
  }
  doc.onChange(update);
  resize.addEventListener('click', () => {
    const width = doc.get('left').parameters.width;
    doc.update('left', { parameters: { width: width > 3 ? 2.4 : 3.6 } });
  });
  undo.addEventListener('click', () => doc.undo());
  redo.addEventListener('click', () => doc.redo());
  update();
}
