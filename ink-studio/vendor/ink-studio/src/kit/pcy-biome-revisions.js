/* Atomic headless publication of the physical and rendered sides of a biome world. */
(function (K) {
  const P = K.procedural, { freeze } = P.data;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const inputs = ['view', 'bricks', 'time', 'tiles', 'indices', 'sources', 'optics', 'meta'];
  const dependencyGraph = P.spatialDependencies.create({
    terrain:{writes:['terrain/solid','terrain/style','terrain/medium','terrain/tiles','water/sources','water/optics','render/layout']},
    spans:{reads:['terrain/solid','terrain/medium','terrain/tiles'],writes:['terrain/spans']},
    flood:{reads:['terrain/spans','water/sources'],writes:['water/filled']},
    water:{reads:['water/filled','water/optics'],writes:['water/medium']},
    routes:{reads:['terrain/solid','terrain/tiles','water/filled']},
    splats:{reads:['terrain/solid','terrain/style','terrain/medium','water/medium','render/layout']}
  });
  const initialInputs = { bricks: null, time: 0, sources: [], meta: {} };

  function capture(change) {
    if (!change || typeof change !== 'object' || Array.isArray(change) ||
        Object.keys(change).some(key => !inputs.includes(key)))
      throw new TypeError('A biome revision needs an authored input patch');
    const input = { ...change };
    for (const key of ['tiles', 'indices', 'sources', 'meta']) {
      if (own(input, key) && input[key] !== undefined) input[key] = freeze(P.data.clone(input[key]));
    }
    if (input.optics && typeof input.optics !== 'function') input.optics = freeze(P.data.clone(input.optics));
    return input;
  }

  function create({ compiler, tiles, indices, sources = [], optics, meta = {}, span = {}, flood = {},
    agent = {}, brushGrid = {}, historyLimit = 16, derive } = {}) {
    if (typeof compiler?.realize !== 'function' || typeof compiler?.prepare !== 'function' ||
        typeof compiler?.makeWorld !== 'function' ||
        !Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 128 ||
        (derive !== undefined && typeof derive !== 'function'))
      throw new TypeError('Biome revisions need a compiler, bounded history, and an optional derivation callback');
    const defaults = capture({ tiles, indices, sources, optics, meta });
    const spanOptions = Object.freeze({ ...span, volumes: span.volumes?.map(row => Object.freeze({ ...row,
      current: Array.isArray(row.current) ? Object.freeze(row.current.slice()) : row.current
    })) });
    const floodOptions = freeze(P.data.clone(flood));
    const traversal = agent === false ? false : Object.freeze({ ...agent, origin: agent.origin?.slice() });
    const brickOptions = freeze(P.data.clone(brushGrid));
    const revisions = new WeakMap(), undoStack = [], redoStack = [];
    let current = null, number = 0, queue = Promise.resolve();

    function enqueue(task) {
      const pending = queue.then(task);
      queue = pending.catch(() => {});
      return pending;
    }

    function commit(change, { clock } = {}) {
      if (clock !== undefined && typeof clock !== 'function') throw new TypeError('Expected a revision clock');
      const edit = typeof change === 'function' ? change : capture(change);
      return enqueue(async () => {
        const timings = {};
        async function stage(name, run) {
          const start = clock?.(), result = await run();
          if (clock) timings[name] = clock() - start;
          return result;
        }
        const before = current, old = revisions.get(before);
        const patch = typeof edit === 'function' ? capture(await stage('edit', () => edit(before))) : edit;
        const input = { ...initialInputs, ...defaults, ...old?.input, ...patch };
        if (!Array.isArray(input.tiles) || !input.tiles.length || !Array.isArray(input.indices))
          throw new TypeError('A biome revision needs span tile descriptions and chunk indices');
        const dry = compiler.prepare(input.view, { bricks: input.bricks, time: input.time });
        const intent = old && dry.view.changesFrom(old.dry.view);
        const trace = dependencyGraph.begin();
        const changed = key => !old || input[key] !== old.input[key] &&
          (typeof input[key] === 'function' || typeof old.input[key] === 'function' ||
            JSON.stringify(input[key]) !== JSON.stringify(old.input[key]));
        const emit = (system,field,boxes,reason) => {
          // A producer reports its output extent. Local causes are linked per write;
          // connected flood effects can also follow the stage's full causal record.
          if (boxes.length > 4096) {
            trace.change(system,field,null,reason+'-region-budget',trace.affected(system).slice(0,64).map(row=>row.id));
            return;
          }
          for (const box of boxes) trace.change(system,field,box,reason,
            trace.affected(system,box).slice(0,64).map(row=>row.id));
        };
        if (!old || intent.global || input.time !== old.input.time) {
          emit('terrain','terrain/solid',[null],!old ? 'initial-revision' :
            input.time !== old.input.time ? 'time-changed' : 'biome-replaced');
        } else {
          const bricks = channel => (input.bricks ? input.bricks.changesFrom(old.input.bricks,{channel}) :
            old.input.bricks?.changesFrom(null,{channel})) ?? [];
          const yMin = Math.min(...input.tiles.map(tile => tile.bounds.min[1]));
          const yMax = Math.max(...input.tiles.map(tile => tile.bounds.max[1]));
          const authored = intent.regions.map(({min,max}) =>
            ({min:[min[0],yMin,min[2]],max:[max[0],yMax,max[2]]}));
          emit('terrain','terrain/solid',authored,'biome-region-edited');
          emit('terrain','terrain/solid',bricks('offset'),'sparse-terrain-edited');
          emit('terrain','terrain/style',bricks('material'),'surface-painted');
          emit('terrain','terrain/medium',bricks('medium'),'medium-tag-edited');
        }
        if (changed('tiles')) emit('terrain','terrain/tiles',[null],'tile-layout');
        if (changed('sources')) emit('terrain','water/sources',[null],'water-source-edited');
        if (changed('optics')) emit('terrain','water/optics',[null],'water-optics-edited');
        if (changed('indices')) emit('terrain','render/layout',[null],'chunk-layout');
        const solids = trace.affected('spans').filter(row=>row.field === 'terrain/solid' || row.field === 'terrain/medium');
        const dirtyBounds = solids.some(row=>row.bounds === null) ? undefined : solids.map(row=>row.bounds);

        const spans = await stage('spans', () => dry.bakeSpanTiles({ ...spanOptions, tiles: input.tiles,
          previous: before?.spans, dirtyBounds }));
        trace.recordWork('spans','span-tiles',spans.work);
        const currentTiles = new Map(spans.ids.map((id,i)=>[id,spans.tiles[i]]));
        const oldTiles = new Map((before?.spans.ids ?? []).map((id,i)=>[id,before.spans.tiles[i]]));
        emit('spans','terrain/spans',[...spans.work.changed.map(id=>currentTiles.get(id).bounds),
          ...spans.work.removed.map(id=>oldTiles.get(id).bounds)],'span-grid-changed');

        const filled = await stage('fill', () => P.spanFlood.create({ ...floodOptions,
          tiles: spans.tiles, sources: input.sources, previous: before?.flood }));
        trace.recordWork('flood','flood-topology-and-fill',filled.work);
        if (before) {
          const oldGrids = new Set(before.flood.tiles), nextGrids = new Set(filled.tiles);
          emit('flood','water/filled',[...new Map([
            ...filled.tiles.filter(grid=>!oldGrids.has(grid)),
            ...before.flood.tiles.filter(grid=>!nextGrids.has(grid))
          ].map(({bounds})=>[JSON.stringify(bounds),bounds])).values()],'filled-grid-changed');
        } else emit('flood','water/filled',[null],'initial-fill');

        let waterWork;
        const water = await stage('water', () => P.waterBodies.sceneFromSpans(filled.tiles, {
          optics: input.optics, previous: before?.water, onWork: value => {waterWork=value;}
        }));
        trace.recordWork('water','water-boundaries',waterWork);
        emit('water','water/medium',water.changesFrom(before?.water),'water-boundary-changed');

        const frame = compiler.prepare(input.view, { water, bricks: input.bricks, time: input.time, geometryFrom: dry });
        const graph = traversal && await stage('graph', () => frame.traversalGraph({ ...traversal,
          tiles: filled.tiles, previous: before?.graph || undefined, dirtyBounds }));
        if (graph) trace.recordWork('routes','traversal-tiles',graph.work);
        const chunks = await stage('chunks', () => compiler.realize(frame, input.indices, {
          previous: old?.chunks, changes:trace.affected('splats')
        }));
        const replaced = new Set(chunks.replaced.map(chunk=>chunk.key));
        trace.recordWork('splats','splat-chunks',{
          rebuilt:[...replaced], removed:chunks.removed,
          reused:chunks.chunks.filter(chunk=>!replaced.has(chunk.key)).map(chunk=>chunk.key),
          reusedSurface:chunks.replaced.filter(chunk=>chunk.work.reusedSurface).map(chunk=>chunk.key)
        });
        const dependencies = freeze({declarations:dependencyGraph.describe,...trace.report()});
        const world = await stage('assembly', () => {
          const value = compiler.makeWorld(frame, chunks.chunks, { ...input.meta, traversalGraph: graph || undefined });
          return Object.freeze(value);
        });
        const snapshot = { id: number + 1, bricks: input.bricks, frame, spans, flood: filled, water,
          graph: graph || null, patch: chunks, chunks: chunks.chunks, world, dependencies };
        const extra = derive && await stage('derive', () =>
          derive(Object.freeze({ ...snapshot, timings: Object.freeze({ ...timings }) }), before));
        const result = Object.freeze({ ...snapshot, extra, timings: Object.freeze(timings) });
        revisions.set(result, { input, dry, chunks });
        if (before && historyLimit) {
          undoStack.push(before);
          if (undoStack.length > historyLimit) undoStack.shift();
        }
        redoStack.length = 0;
        number++;
        current = result;
        return result;
      });
    }

    function sculpt(brush, options) {
      if (!brush || typeof brush !== 'object') throw new TypeError('Expected sparse brush options');
      const stroke = { ...brush, bounds: freeze(P.data.clone(brush.bounds)) };
      return commit(before => {
        if (!before) throw new Error('Publish an initial biome revision before sculpting');
        const bricks = before.bricks ?? P.sparseBricks.create({ ...brickOptions, base: revisions.get(before).dry.distance });
        return { bricks: bricks.edit(stroke) };
      }, options);
    }

    const history = (source, target) => enqueue(() => {
      if (!source.length) return null;
      target.push(current);
      current = source.pop();
      return current;
    });
    return Object.freeze({ current: () => current, commit, sculpt,
      undo: () => history(undoStack, redoStack), redo: () => history(redoStack, undoStack) });
  }

  P.biomeRevisions = Object.freeze({ create });
})(KIT);
