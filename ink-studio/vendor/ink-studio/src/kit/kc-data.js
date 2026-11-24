/* kc-data: a diorama written down as data. Plain objects and lists (it can live in a JSON file): what solids there are and what they are made
   of, which of them are moving parts and how they move, what lamps and loose particles there are, what a tap does. Materials are named by
   role (stone, moss, ember ...) and a style says what colours those roles are, so the same diorama can be put in another style by one word.
     K.diorama.check(spec, env)   -> [{ level: 'error' | 'warning', path, problem, hint }]     nothing is built; every mistake is listed at once
     K.diorama.build(spec, env)   -> the world (throws, with the whole list, if check finds errors)
     K.diorama.scene(spec, env)   -> scene descriptor with build, model and drawing authoring hooks
     K.diorama.styles             the looks by name; add your own: { palette: [hex ...], roles: { stone: [1, 2, 3], ... }, sun, amb, sky, finish }
     K.diorama.kinds              what each kind of solid needs and may have (the checker reads this; so can an editor)
   env: { assets: { name: mesh } } for solids of kind 'mesh'. See lab/data-shrine.json for a whole one. */
(function (K) {
  const V = K.V,
    M = K.M,
    TAU = Math.PI * 2,
    DIO = (K.diorama = {});
  const ROLES = [
    'stone',
    'dark',
    'pale',
    'earth',
    'wood',
    'moss',
    'leaf',
    'water',
    'metal',
    'bone',
    'ember',
    'glow',
    'accent'
  ];
  DIO.styles = {
    slate: {
      palette: [
        0x07080b, 0x15171c, 0x2a2e36, 0x474d57, 0x6d747c, 0x9aa09c, 0xcfd2c8, 0x1f3a22, 0x356b36, 0x66a640, 0xa8d05a,
        0x3a2416, 0x5e3b22, 0x8a5a30, 0xb8844a, 0x7a2a1e, 0xc8321e, 0xff7a2a, 0xffd24a, 0xfff3c0, 0x16324a, 0x24567a,
        0x4a9aa0, 0xa8e0d8, 0x4a2760, 0x7a4296, 0xb070c4, 0x6a5a2a, 0xa88a3a, 0xe0c060
      ],
      roles: {
        stone: [1, 2, 3, 4, 5],
        dark: [1, 1, 2, 3],
        pale: [3, 4, 5, 6],
        earth: [11, 11, 12, 13],
        wood: [11, 12, 13, 14],
        moss: [7, 8, 9, 10],
        leaf: [7, 8, 9, 10],
        water: [20, 21, 22, 23],
        metal: [27, 28, 29, 29],
        bone: [4, 5, 6, 6],
        ember: [15, 16, 17, 18],
        glow: [18, 19],
        accent: [24, 25, 26]
      },
      sun: [-0.5, 0.8, 0.45],
      amb: 0.14,
      sky: 0.26,
      finish: { detail: 14, dither: 0.25 }
    },
    moss: {
      palette: [0x0b1114, 0x1c3626, 0x356b36, 0x82b552, 0xdff0c4, 0x4a0d1a, 0xad1f36, 0xff6474],
      roles: {
        stone: [1, 2, 3, 4],
        dark: [0, 1, 1, 2],
        pale: [3, 4, 4],
        earth: [1, 1, 2],
        wood: [1, 2, 2, 3],
        moss: [1, 2, 3],
        leaf: [2, 3, 4],
        water: [5, 5, 6],
        metal: [2, 3, 4],
        bone: [3, 4, 4],
        ember: [5, 6, 7],
        glow: [7, 4],
        accent: [5, 6, 7]
      },
      sun: [-0.45, 0.75, 0.5],
      amb: 0.16,
      sky: 0.3,
      finish: { detail: 12, dither: 0.35 }
    },
    ember: {
      palette: [
        0x0c0708, 0x1e1216, 0x38202a, 0x5a3440, 0x86525a, 0xb88a80, 0xe6c8a8, 0x2a2416, 0x4a4420, 0x7a6e2c, 0x4a1418,
        0x9c2a24, 0xe6772e, 0xffc24a, 0xffeeb0, 0x1a2238, 0x2c3c5e, 0x52688c, 0x8aa6c0, 0x6a3a12, 0xa86a22, 0xe0a640
      ],
      roles: {
        stone: [1, 2, 3, 4, 5],
        dark: [1, 1, 2],
        pale: [4, 5, 6],
        earth: [1, 2, 7, 8],
        wood: [2, 19, 19, 20],
        moss: [7, 8, 9],
        leaf: [8, 9, 21],
        water: [15, 16, 17, 18],
        metal: [19, 20, 21, 21],
        bone: [5, 6, 6],
        ember: [10, 11, 12, 13],
        glow: [13, 14],
        accent: [16, 17, 18]
      },
      sun: [-0.7, 0.45, 0.4],
      amb: 0.12,
      sky: 0.2,
      finish: { detail: 14, dither: 0.3 }
    }
  };

  // ---------------- what may be written ----------------
  const COMMON = {
    id: 'str',
    surfaceId: 'str',
    surfaceState: 1,
    prefabs: 'list',
    tags: 'list',
    mat: 'mat',
    res: 'pos',
    part: 'str',
    group: 'str',
    carve: 'bool',
    ghost: 'bool',
    separate: 'bool',
    turn: 'vec3',
    transform: 'obj',
    modifiers: 'list',
    bump: 'vec2',
    hold: 'bool'
  };
  DIO.kinds = {
    ground: { need: {}, may: { rad: 'pos', stretch: 'pos' } },
    ball: { need: { at: 'vec3', r: 'num|vec3' } },
    rock: { need: { at: 'vec3', r: 'num|vec3' } },
    box: { need: { at: 'vec3', half: 'vec3' }, may: { round: 'num' } },
    lathe: { need: { at: 'vec3', h: 'pos', r: 'num|vec2|profile' } },
    torus: { need: { at: 'vec3', R: 'pos', r: 'pos' } },
    tube: { need: { pts: 'pts', r: 'num|vec2' } },
    stroke: {
      need: { points: 'list' },
      may: { surface: 'obj', axis: 'vec3', width: 'pos', depth: 'pos', taper: 'vec2', pressure: 'list', offset: 'num' }
    },
    fill: { need: { rings: 'list' }, may: { surface: 'obj', frame: 'obj', depth: 'pos', offset: 'num' } },
    regular: { need: { shape: ['d4', 'd6', 'd8', 'd12', 'd20'], at: 'vec3', r: 'pos' }, may: { round: 'num' } },
    extrude: { need: { outline: 'outline', at: 'vec3', depth: 'pos' }, may: { round: 'num' } },
    revolve: { need: { outline: 'outline', at: 'vec3' } },
    puff: { need: { outline: 'outline', at: 'vec3', height: 'pos' } },
    mesh: {
      need: { asset: 'str' },
      may: { size: 'pos', at: 'vec3', spin: 'num', cells: 'pos', thick: 'num', up: ['y', 'z'], hues: 'pos' }
    },
    join: { need: { how: 'join', a: 'solid', b: 'solid' }, may: { size: 'num', steps: 'pos' } },
    fold: {
      need: { of: 'solid' },
      may: { polar: 'pos', mirror: ['x', 'y', 'z'], repeat: 'vec3', count: 'vec3', centre: 'vec3', axis: 'vec3' }
    },
    warp: { need: { of: 'solid' }, may: { twist: 'num', bend: 'num', taper: 'num', centre: 'vec3', wide: 'pos' } },
    shell: { need: { of: 'solid', t: 'pos' } },
    swell: { need: { of: 'solid', by: 'num' } },
    rough: { need: { of: 'solid', by: 'pos' }, may: { scale: 'pos' } },
    bubbles: { need: { of: 'solid' }, may: { cell: 'pos', h: 'pos' } },
    pillar: { need: { at: 'vec3', h: 'pos' }, may: { r: 'pos', bay: 'pos', flutes: 'num' } },
    arch: {
      need: { at: 'vec3' },
      may: { span: 'pos', height: 'pos', depth: 'pos', thick: 'pos', block: 'pos', face: 'vec2' }
    },
    stairs: { need: { at: 'vec3', dir: 'vec3', rise: 'pos' }, may: { width: 'pos', riser: 'pos', tread: 'pos' } },
    fence: { need: { a: 'vec3', b: 'vec3' }, may: { h: 'pos', bay: 'pos', pickets: 'num' } },
    pipe: { need: { pts: 'pts' }, may: { r: 'pos', wall: 'pos', collar: 'pos' } }
  };
  const unaryKinds = ['fold', 'warp', 'shell', 'swell', 'rough', 'bubbles'];
  const modifierKinds = Object.fromEntries(unaryKinds.map(kind => {
    const { of, ...need } = DIO.kinds[kind].need;
    return [kind, { need, may: DIO.kinds[kind].may }];
  }));
  modifierKinds.fold.may = { ...modifierKinds.fold.may, axis: ['x', 'y', 'z'] };
  modifierKinds.warp.may = { ...modifierKinds.warp.may, taper: 'vec2' };
  modifierKinds.join = { need: { how: 'join', shape: 'solid' }, may: DIO.kinds.join.may };
  modifierKinds.mask = { need: { mode: ['keep', 'cut'], shape: 'solid' } };
  const builtKinds = ['pillar', 'arch', 'stairs', 'fence', 'pipe'];
  const activeModifiers = solid => (solid.modifiers ?? []).filter(modifier => modifier.enabled !== false);

  DIO.operandFields = solid => Object.entries(DIO.kinds[solid?.kind]?.need ?? {})
    .filter(([, type]) => type === 'solid').map(([field]) => field);
  DIO.solids = function* (spec, { activeOnly = false } = {}) {
    function* walk(solid) {
      if (!solid || typeof solid !== 'object' || Array.isArray(solid)) return;
      yield solid;
      for (const field of DIO.operandFields(solid)) yield* walk(solid[field]);
      if (Array.isArray(solid.modifiers)) {
        for (const modifier of solid.modifiers)
          if (modifier?.shape && (!activeOnly || modifier.enabled !== false)) yield* walk(modifier.shape);
      }
    }
    if (Array.isArray(spec?.solids)) for (const solid of spec.solids) yield* walk(solid);
  };

  const MOTION = {
    turn: {
      need: { part: 'str' },
      may: { axis: 'vec3', amount: 'num', period: 'pos', phase: 'num', keys: 'list', loop: 'pos' }
    },
    spin: { need: { part: 'str' }, may: { axis: 'vec3', speed: 'num' } },
    bob: {
      need: { part: 'str' },
      may: { axis: 'vec3', amount: 'num', period: 'pos', phase: 'num', keys: 'list', loop: 'pos' }
    },
    squash: {
      need: { part: 'str' },
      may: { axis: 'vec3', amount: 'num', period: 'pos', phase: 'num', keys: 'list', loop: 'pos' }
    }
  };
  const EFFECT = {
    lamp: { need: { at: 'vec3' }, may: { r: 'pos', strength: 'num', flicker: 'num', follow: 'str' } },
    reveal: { need: {}, may: { dur: 'pos', block: 'pos' } },
    dust: { need: { at: 'vec3' }, may: { every: 'pos', n: 'num', colours: 'mat', spread: 'pos' } },
    embers: { need: { at: 'vec3' }, may: { every: 'pos', n: 'num', colours: 'mat' } },
    smoke: { need: { at: 'vec3' }, may: { every: 'pos', n: 'num', colours: 'mat' } },
    sparks: { need: { at: 'vec3' }, may: { every: 'pos', n: 'num', colours: 'mat', dir: 'vec3', speed: 'pos' } },
    rain: { need: { box: 'box' }, may: { rate: 'num', colours: 'mat' } },
    wind: { need: { v: 'vec3' }, may: { swirl: 'num' } }
  };
  const TOP = {
    id: 'str',
    name: 'str',
    blurb: 'str',
    seed: 'num',
    style: 'style',
    palette: 'list',
    assetPacks: 'list',
    environmentPreset: 'obj',
    roles: 'obj',
    camera: 'obj',
    cameraRig: 'obj',
    dataInputs: 'obj',
    dataMarks: 'obj',
    light: 'obj',
    finish: 'obj',
    groups: 'obj',
    parts: 'obj',
    solids: 'list',
    brushRegion: 1,
    breakables: 1,
    motion: 'list',
    timeline: 'obj',
    effects: 'list',
    tap: 'obj',
    spare: 'pos'
  };

  // ---------------- checking ----------------
  const isNum = v => typeof v === 'number' && Number.isFinite(v),
    isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
  function solidTransform(value) {
    if (value === undefined) return null;
    const fields = ['translation', 'rotation', 'scale', 'pivot'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
      throw new TypeError('A solid transform supports translation, rotation, scale and pivot');
    const { translation = [0, 0, 0], rotation = [0, 0, 0], scale = 1, pivot } = value;
    if (![translation, rotation, ...(pivot === undefined ? [] : [pivot])].every(v => isVec(v, 3) && Array.from(v).every(isNum)) ||
        !isNum(scale) || scale < .02 || scale > 20)
      throw new RangeError('A transform needs finite XYZ vectors and uniform scale from 0.02 to 20');
    return { translation, rotation, scale, pivot };
  }
  DIO.solidTransform = solidTransform;
  const lev = (a, b) => {
    const d = [];
    for (let i = 0; i <= a.length; i++) {
      d[i] = [i];
      for (let j = 1; j <= b.length; j++)
        d[i][j] =
          i === 0 ? j : Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  };
  const nearest = (word, list) => {
    let best = null,
      bd = 3;
    for (const w of list) {
      const d = lev(String(word), w);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  };
  const styleOf = spec => {
    const s = spec.style === undefined ? 'slate' : spec.style,
      base = typeof s === 'string' ? DIO.styles[s] : s && s.extends ? DIO.styles[s.extends] : s;
    if (!base) return null;
    const own = typeof s === 'object' ? s : {},
      out = {
        palette: (spec.palette || own.palette || base.palette).slice(),
        roles: Object.assign({}, base.roles, own.roles, spec.roles),
        sun: own.sun || base.sun || [-0.5, 0.8, 0.45],
        amb: own.amb !== undefined ? own.amb : base.amb,
        sky: own.sky !== undefined ? own.sky : base.sky,
        finish: Object.assign({}, base.finish, own.finish, spec.finish)
      };
    if (spec.light) {
      if (spec.light.sun) out.sun = spec.light.sun;
      if (spec.light.amb !== undefined) out.amb = spec.light.amb;
      if (spec.light.sky !== undefined) out.sky = spec.light.sky;
    }
    return out;
  };
  DIO.sceneLook = spec => styleOf(spec)?.finish.look;
  DIO.sceneMaterials = spec => {
    const { palette, roles } = styleOf(spec);
    return { palette, roles };
  };
  function applySurface(material, definition) {
    if (typeof definition === 'string') return K.surface.preset(definition, material);
    if (!definition || typeof definition !== 'object' || Array.isArray(definition))
      throw new TypeError('A surface is a preset name or a settings object');
    const { preset, ...settings } = definition;
    return preset === undefined ? K.surface.material(material, settings) : K.surface.preset(preset, material, settings);
  }
  const lookCatalog = spec => spec.assetPacks === undefined ? undefined :
    K.authoring.assetPacks.create({ packs: spec.assetPacks });
  function materialLook(base, settings, catalog) {
    const surface = settings.surface === undefined ? base : applySurface(base, settings.surface);
    return K.authoring.looks.material(surface, settings.lookAsset, catalog);
  }
  const parameterRoots = ['solids', 'roles', 'palette', 'motion', 'light', 'effects', 'finish', 'tap'];
  function resolveParameters(source, env) {
    let { spec: expanded } = K.authoring.scenePrefabs.expand(source, env);
    if (expanded?.dataMarks !== undefined && expanded.solids === undefined) expanded = { ...expanded, solids: [] };
    let dataInputs;
    if (expanded?.dataInputs !== undefined) {
      try {
        dataInputs = K.dataInputs.prepare(expanded.dataInputs);
      } catch (error) {
        error.problems = [{ level: 'error', path: 'dataInputs', problem: error.message, hint: '' }];
        throw error;
      }
    }
    if (expanded?.parameterBindings === undefined) return { spec: expanded, dataInputs };
    try {
      const { parameterBindings, timeline, dataInputs: authoredData, ...base } = expanded;
      const program = K.parameters.prepare(parameterBindings);
      for (const { path } of program.targets) if (!parameterRoots.includes(path[0]) || path.length < 2)
        throw new RangeError('Unsupported diorama parameter path: ' + path.join('/'));
      const inputs = { ...env?.parameterInputs, ...(dataInputs && { dataInputs }) };
      const { document, values } = program.apply(base, inputs);
      const spec = timeline === undefined ? document : { ...document, timeline };
      return { spec, program, values, inputs, dataInputs };
    } catch (error) {
      error.problems = [{ level: 'error', path: 'parameterBindings', problem: error.message, hint: '' }];
      throw error;
    }
  }

  DIO.check = (source, env) => {
    let resolved;
    try {
      resolved = resolveParameters(source, env);
    } catch (error) {
      return error.problems ?? [{ level: 'error', path: 'prefabs', problem: error.message, hint: '' }];
    }
    return checkResolved(resolved.spec, env, {}, resolved.dataInputs);
  };
  function checkResolved(spec, env, presentation, dataInputs) {
    const out = [],
      bad = (path, problem, hint) => out.push({ level: 'error', path, problem, hint: hint || '' }),
      warn = (path, problem, hint) => out.push({ level: 'warning', path, problem, hint: hint || '' });
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      bad('', 'a diorama is an object', 'start with { "id": ..., "solids": [ ... ] }');
      return out;
    }
    const keys = (o, path, allowed) => {
      for (const k of Object.keys(o))
        if (!(k in allowed)) {
          const n = nearest(k, Object.keys(allowed));
          bad(
            path + (path ? '.' : '') + k,
            'nothing is called "' + k + '" here',
            n ? 'did you mean "' + n + '"?' : 'what may be written: ' + Object.keys(allowed).join(', ')
          );
        }
    };
    keys(spec, '', TOP);
    if (typeof spec.id !== 'string' || !/^[a-z0-9-]+$/.test(spec.id))
      bad('id', 'a diorama needs an id of small letters, digits and dashes', 'for example "old-shrine"');
    const st = styleOf(spec);
    if (!st) {
      bad('style', 'there is no style called "' + spec.style + '"', 'styles: ' + Object.keys(DIO.styles).join(', '));
      return out;
    }
    let surfaceEffects, catalog;
    try {
      catalog = lookCatalog(spec);
    } catch (error) {
      bad('assetPacks', error.message);
    }
    if (catalog || spec.assetPacks === undefined) {
      try {
        st.finish = K.authoring.environments.apply(st.finish,spec.environmentPreset,catalog,st.palette);
      } catch (error) {
        bad('environmentPreset',error.message);
      }
    }
    try {
      PaintCorrections.layers(st.finish.paint);
    } catch (error) {
      bad('finish.paint', error.message);
    }
    if (st.finish.skyEnvironment !== undefined && st.finish.skyEnvironment !== false) {
      try {
        SkyEnvironment.compile(st.finish.skyEnvironment);
      } catch (error) {
        bad('finish.skyEnvironment', error.message);
      }
    }
    try {
      CelestialTracks.settings(st.finish.celestialTracks);
    } catch (error) {
      bad('finish.celestialTracks', error.message);
    }
    try {
      EmissiveFinishes.prepare(st.finish.emissiveFinishes, st.palette);
    } catch (error) {
      bad('finish.emissiveFinishes', error.message);
    }
    try {
      AreaLights.prepare(st.finish.areaLights);
    } catch (error) {
      bad('finish.areaLights', error.message);
    }
    if (st.finish.volumeLighting) {
      try {
        SceneOptics.lighting(st.finish.volumeLighting, st.palette);
      } catch (error) {
        bad('finish.volumeLighting', error.message);
      }
    }
    try {
      ReflectionProbes.prepare(st.finish.reflectionProbes);
    } catch (error) {
      bad('finish.reflectionProbes', error.message);
    }
    try {
      BounceProbes.prepare(st.finish.bounceProbes);
    } catch (error) {
      bad('finish.bounceProbes', error.message);
    }
    try {
      SplatRelighting.settings(st.finish.relighting);
    } catch (error) {
      bad('finish.relighting', error.message);
    }
    try {
      K.atmosphere.emitters.settings(st.finish.atmosphereEmitters);
    } catch (error) {
      bad('finish.atmosphereEmitters', error.message);
    }
    try {
      K.splatFields.settings(st.finish.splatFields);
    } catch (error) {
      bad('finish.splatFields', error.message);
    }
    try {
      VolumeCutouts.settings(st.finish.volumeCutouts);
    } catch (error) {
      bad('finish.volumeCutouts', error.message);
    }
    try {
      SceneOptics.shapedVolumes(st.finish.shapedAtmosphere);
    } catch (error) {
      bad('finish.shapedAtmosphere', error.message);
    }
    try {
      AtmosphereDepthBands.settings(st.finish.atmosphereDepthBands, undefined, st.palette);
    } catch (error) {
      bad('finish.atmosphereDepthBands', error.message);
    }
    try {
      SceneExposure.settings(st.finish.sceneExposure);
    } catch (error) {
      bad('finish.sceneExposure', error.message);
    }
    try {
      Lightning.settings(st.finish.lightning);
    } catch (error) {
      bad('finish.lightning', error.message);
    }
    try {
      WindField.settings(st.finish.windField);
    } catch (error) {
      bad('finish.windField', error.message);
    }
    try {
      WeatherBinding.settings(st.finish.weatherBinding);
    } catch (error) {
      bad('finish.weatherBinding', error.message);
    }
    try {
      K.weather.tracks.compile(st.finish.skyEnvironment,st.finish.weatherTracks);
    } catch (error) {
      bad('finish.weatherTracks',error.message);
    }
    if (st.finish.cloudField !== undefined && st.finish.cloudField !== false) {
      try {
        K.clouds.compile(st.finish.cloudField);
      } catch (error) {
        bad('finish.cloudField', error.message);
      }
    }
    try {
      const cloudShadows = K.clouds.shadowSettings(st.finish.cloudShadows);
      if (cloudShadows && st.finish.cloudField === undefined)
        bad('finish.cloudShadows', 'Cloud shadows need a cloud field');
    } catch (error) {
      bad('finish.cloudShadows', error.message);
    }
    try {
      SkyEnvironment.aerial(st.finish.aerialPerspective);
    } catch (error) {
      bad('finish.aerialPerspective', error.message);
    }
    if (st.finish.skyReflections !== undefined && !['scene', 'material'].includes(st.finish.skyReflections))
      bad('finish.skyReflections', 'skyReflections must be scene or material');
    if (st.finish.surfaceEffects !== undefined) {
      try {
        surfaceEffects = K.splatEffects.context(st.finish.surfaceEffects);
      } catch (error) {
        bad('finish.surfaceEffects', error.message);
      }
    }
    try {
      SculptSampling.prepare(st.finish.adaptiveSampling);
    } catch (error) {
      bad('finish.adaptiveSampling', error.message);
    }
    let look = st.finish.look;
    try {
      look = K.authoring.looks.scene(look, catalog);
    } catch (error) {
      bad('finish.look.asset', error.message);
    }
    if (look?.coverageAware !== undefined && typeof look.coverageAware !== 'boolean')
      bad('finish.look.coverageAware', 'coverageAware must be a boolean');
    if (look?.pixelSize !== undefined && (!Number.isSafeInteger(look.pixelSize) || look.pixelSize < 1))
      bad('finish.look.pixelSize', 'pixelSize must be a positive integer');
    try {
      FrameComposite.settings(look?.composite);
    } catch (error) {
      bad('finish.look.composite', error.message);
    }
    try {
      Cutaway.prepare(look?.cutaway);
    } catch (error) {
      bad('finish.look.cutaway', error.message);
    }
    try {
      RenderGraph.prepare(look?.renderGraph);
    } catch (error) {
      bad('finish.look.renderGraph', error.message);
    }
    try {
      K.afterimages.prepare(look?.afterimages);
    } catch (error) {
      bad('finish.look.afterimages', error.message);
    }
    try {
      K.reconstruction.prepare(look?.reconstruction);
    } catch (error) {
      bad('finish.look.reconstruction', error.message);
    }
    try {
      SilhouetteProtection.prepare(look?.silhouetteProtection);
    } catch (error) {
      bad('finish.look.silhouetteProtection', error.message);
    }
    try {
      DetailBudgets.prepare(look?.detailBudgets);
    } catch (error) {
      bad('finish.look.detailBudgets', error.message);
    }
    try {
      PassQuality.prepare(look?.passQuality);
    } catch (error) {
      bad('finish.look.passQuality', error.message);
    }
    try {
      SdfAssist.prepare(look?.sdfAssist);
    } catch (error) {
      bad('finish.look.sdfAssist', error.message);
    }
    try {
      StableDetail.prepare(look?.stableDetail);
    } catch (error) {
      bad('finish.look.stableDetail', error.message);
    }
    try {
      EdgeFilter.prepare(look?.edgeFilter);
    } catch (error) {
      bad('finish.look.edgeFilter', error.message);
    }
    try {
      ContributionRules.coverageMode(look?.splatCoverage);
    } catch (error) {
      bad('finish.look.splatCoverage', error.message);
    }
    try {
      ShadowArt.prepare(look?.shadowArt);
    } catch (error) {
      bad('finish.look.shadowArt', error.message);
    }
    try {
      ContactShadows.prepare(look?.contactShadows);
    } catch (error) {
      bad('finish.look.contactShadows', error.message);
    }
    try {
      HorizonBands.compile(look?.horizonBands);
    } catch (error) {
      bad('finish.look.horizonBands', error.message);
    }
    try {
      ArtDirection.prepare(look?.artDirection);
    } catch (error) {
      bad('finish.look.artDirection', error.message);
    }
    try {
      EffectPalettes.prepare(look?.effectPalettes, st.palette, st.roles);
    } catch (error) {
      bad('finish.look.effectPalettes', error.message);
    }
    try {
      CameraStaging.prepare(look?.cameraStaging);
    } catch (error) {
      bad('finish.look.cameraStaging', error.message);
    }
    try {
      const motion=look?.cameraImpulses;
      if(motion!==undefined&&motion!==false){if(typeof motion?.sample==='function')CameraImpulses.prepare(motion);else CameraImpulses.create(motion);}
    } catch(error) {
      bad('finish.look.cameraImpulses',error.message);
    }
    try {
      ArtInk.prepare(look?.ink, st.palette);
    } catch (error) {
      bad('finish.look.ink', error.message);
    }
    try {
      ArtEffects.prepare(look?.effects, st.palette);
    } catch (error) {
      bad('finish.look.effects', error.message);
    }
    try {
      ArtStability.prepare(look?.stable);
    } catch (error) {
      bad('finish.look.stable', error.message);
    }
    try {
      SplatOrder.transparency(look?.stableTransparency);
    } catch (error) {
      bad('finish.look.stableTransparency', error.message);
    }
    try {
      PixelLook.toneSettings(look?.tone);
    } catch (error) {
      bad('finish.look.tone', error.message);
    }
    try {
      ColorCurves.prepare(look?.colorCurves);
    } catch (error) {
      bad('finish.look.colorCurves', error.message);
    }
    try {
      SurfaceLook.lightRamps(look?.surfaceLightRamps);
    } catch (error) {
      bad('finish.look.surfaceLightRamps', error.message);
    }
    if (look?.colorLut !== undefined && look.colorLut !== false) {
      try {
        ColorLUT.normalize(look.colorLut);
      } catch (error) {
        bad('finish.look.colorLut', error.message);
      }
    }
    if (spec.light?.surfaceDirection !== undefined)
      try {
        SurfaceLook.prepareLightTrack(spec.light.surfaceDirection);
      } catch (error) {
        bad('light.surfaceDirection', error.message);
      }
    const pal = st.palette;
    if (!Array.isArray(pal) || pal.length < 2 || !pal.every(isNum))
      bad(
        'palette',
        'a palette is a list of colours as numbers',
        'for example [460811, 1382172, ...] (or 0x07080b in a .js file)'
      );
    else if (pal.length > 48)
      bad(
        'palette',
        'a palette holds 48 colours at most; this has ' + pal.length,
        'the picture is reduced to the palette by a shader that takes 48'
      );
    for (const [name, ramp] of Object.entries(st.roles)) {
      if (!Array.isArray(ramp) || !ramp.length)
        bad('roles.' + name, 'a role is a list of palette numbers, dark to light');
      else
        for (const i of ramp)
          if (!Number.isInteger(i) || i < 0 || i >= pal.length)
            bad('roles.' + name, 'colour ' + i + ' is not in the palette (0 to ' + (pal.length - 1) + ')');
    }
    try {
      PixelLook.prepareRemap(look?.paletteRemap, pal, st.roles);
    } catch (error) {
      bad('finish.look.paletteRemap', error.message);
    }
    try {
      PixelLook.prepareColorStack(look?.colorStack, pal, st.roles);
    } catch (error) {
      bad('finish.look.colorStack', error.message);
    }
    try {
      PixelLook.preparePaletteConstraints(look?.paletteConstraints, {
        palette: pal, roles: st.roles, blueNoise: K.procedural.materials.blueNoise, context: surfaceEffects, validateOnly: true
      });
    } catch (error) {
      bad('finish.look.paletteConstraints', error.message);
    }
    try {
      RenderStages.prepare(look?.renderStages, {
        palette: pal, roles: st.roles, blueNoise: K.procedural.materials.blueNoise,
        context: surfaceEffects, validateOnly: true
      });
    } catch (error) {
      bad('finish.look.renderStages', error.message);
    }
    try {
      RenderStages.optics(look?.optics, { palette: pal, roles: st.roles, blueNoise: K.procedural.materials.blueNoise, validateOnly: true });
    } catch (error) {
      bad('finish.look.optics', error.message);
    }
    const roleNames = Object.keys(st.roles),
      ids = new Set(),
      parts = new Set(),
      groups = spec.groups || {},
      assets = (env && env.assets) || {};
    const matOk = (m, path) => {
      if (m === undefined) return;
      const role = typeof m === 'string' ? m : m && m.role;
      if (m && typeof m === 'object') {
        keys(m, path, { role: 1, ramp: 1, noise: 1, scale: 1, glow: 1, over: 1, surface: 1, model: 1, lookAsset: 1, albedo: 1, materialId: 1, surfaceId: 1, pixelStyle: 1, glass: 1, optical: 1, controls: 1 });
        if (m.controls !== undefined) {
          try { MaterialControls.describe(m.controls); }
          catch (error) { bad(path + '.controls', error.message); }
        }
        if (m.glass !== undefined && typeof m.glass !== 'boolean') bad(path + '.glass', 'expected a boolean');
        if (m.optical !== undefined) {
          try { OpticalMaterials.material(m.optical); }
          catch (error) { bad(path + '.optical', error.message); }
        }
        try { MaterialPixelStyle.prepare(m.pixelStyle); }
        catch (error) { bad(path + '.pixelStyle', error.message); }
        for (const key of ['materialId', 'surfaceId'])
          if (m[key] !== undefined && !TargetSelectors.name(m[key])) bad(path + '.' + key, key + ' must be a name');
        if (m.albedo !== undefined) {
          try { RenderStages.albedo(m.albedo, pal); }
          catch (error) { bad(path + '.albedo', error.message); }
        }
        if (m.model !== undefined) {
          const q = m.model, at = path + '.model', channels = { color: 1, emission: 1, roughness: 1, metallic: 1 };
          if (!q || typeof q !== 'object' || Array.isArray(q)) bad(at, 'model material channels need an object');
          else {
            keys(q, at, channels);
            for (const [channel, value] of Object.entries(q)) {
              const valid = channel === 'color' || channel === 'emission' ?
                isVec(value, 3) && value.every(v => v >= 0 && (channel === 'emission' || v <= 1)) :
                isNum(value) && value >= 0 && value <= 1;
              if (!valid) bad(at + '.' + channel, 'invalid model material channel');
            }
          }
        }
        if (m.surface !== undefined || m.lookAsset !== undefined) {
          try {
            const { surface } = materialLook({}, m, catalog);
            if (surface) K.surface.prepare(surface, pal, st.sun, surfaceEffects,
              { paletteRoles: st.roles, blueNoise: K.procedural.materials.blueNoise, validateOnly: true });
          } catch (error) {
            bad(path + (m.lookAsset !== undefined ? '.lookAsset' : '.surface'), error.message);
          }
        }
        if (m.ramp) {
          if (!Array.isArray(m.ramp) || m.ramp.some(i => !Number.isInteger(i) || i < 0 || i >= pal.length))
            bad(path + '.ramp', 'a ramp is a list of palette numbers (0 to ' + (pal.length - 1) + ')');
          return;
        }
        if (m.over) matOk(m.over.role, path + '.over.role');
      }
      if (typeof role !== 'string')
        bad(path, 'a material is a role name, or { "role": name, ... }', 'roles: ' + roleNames.join(', '));
      else if (!st.roles[role]) {
        const n = nearest(role, roleNames);
        bad(
          path,
          'no role called "' + role + '" in this style',
          n ? 'did you mean "' + n + '"?' : 'roles: ' + roleNames.join(', ')
        );
      }
    };
    const outlineOk = (o, path) => {
      if (!o || typeof o !== 'object')
        return bad(
          path,
          'an outline is { "svg": path } or { "ngon": sides, "r": size } or { "star": points, "r": outer, "inner": inner } or { "rect": [w, h] } or { "gear": teeth, "r": size }'
        );
      const k = ['svg', 'ngon', 'star', 'rect', 'gear'].filter(q => q in o);
      if (k.length !== 1) bad(path, 'an outline is one of svg, ngon, star, rect, gear');
      if (o.svg !== undefined && typeof o.svg !== 'string')
        bad(path + '.svg', 'the path is text, as in an SVG file ("M0 0 L10 0 ...")');
    };
    const typeOk = (v, type, path) => {
      if (Array.isArray(type)) {
        if (!type.includes(v)) bad(path, '"' + v + '" is not one of the choices', 'choices: ' + type.join(', '));
        return;
      }
      const alts = type.split('|'),
        one = t =>
          t === 'num'
            ? isNum(v)
            : t === 'pos'
              ? isNum(v) && v > 0
              : t === 'vec3'
                ? isVec(v, 3)
                : t === 'vec2'
                  ? isVec(v, 2)
                  : t === 'str'
                    ? typeof v === 'string'
                    : t === 'bool'
                      ? typeof v === 'boolean'
                      : t === 'list'
                        ? Array.isArray(v)
                        : t === 'obj'
                          ? v && typeof v === 'object'
                          : t === 'pts'
                            ? Array.isArray(v) && v.length >= 2 && v.every(p => isVec(p, 3))
                            : t === 'profile'
                              ? Array.isArray(v) && v.length >= 2 && v.every(p => isVec(p, 2))
                              : t === 'box'
                                ? Array.isArray(v) && v.length === 2 && v.every(p => isVec(p, 3))
                                : null;
      if (type === 'mat') return matOk(v, path);
      if (type === 'solid') return solidOk(v, path, true);
      if (type === 'outline') return outlineOk(v, path);
      if (type === 'join') {
        if (!Object.hasOwn(K.sdf.JOIN, v)) {
          const n = nearest(v, Object.keys(K.sdf.JOIN));
          bad(
            path,
            'no way of joining called "' + v + '"',
            n ? 'did you mean "' + n + '"?' : 'ways: ' + Object.keys(K.sdf.JOIN).join(', ')
          );
        }
        return;
      }
      if (!alts.some(one))
        bad(
          path,
          'this should be ' +
            alts
              .map(
                t =>
                  ({
                    num: 'a number',
                    pos: 'a number above 0',
                    vec3: 'three numbers [x, y, z]',
                    vec2: 'two numbers',
                    str: 'text',
                    bool: 'true or false',
                    list: 'a list',
                    obj: 'an object',
                    pts: 'a list of two or more [x, y, z] points',
                    profile: 'a list of [height 0..1, radius] pairs',
                    box: 'two corners [[x, y, z], [x, y, z]]'
                  })[t]
              )
              .join(' or '),
          'it is ' + JSON.stringify(v)
        );
    };
    const fields = (o, path, def, extra) => {
      const all = Object.assign({ kind: 1, do: 1 }, extra, def.need, def.may);
      keys(o, path, all);
      for (const [k, t] of Object.entries(def.need))
        if (o[k] === undefined)
          bad(path + '.' + k, 'missing', 'a ' + (o.kind || o.do) + ' needs: ' + Object.keys(def.need).join(', '));
      for (const [k, t] of Object.entries(Object.assign({}, extra, def.need, def.may)))
        if (o[k] !== undefined && t !== 1) typeOk(o[k], t, path + '.' + k);
    };
    function checkModifiers(stack, path) {
      if (!Array.isArray(stack)) return;
      const ids = new Set();
      for (let i = 0; i < stack.length; i++) {
        const modifier = stack[i], at = path + '[' + i + ']';
        if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) {
          bad(at, 'a modifier is an object');
          continue;
        }
        if (!TargetSelectors.name(modifier.id) || ids.has(modifier.id))
          bad(at + '.id', 'modifier IDs must be nonempty and unique within the stack');
        ids.add(modifier.id);
        const kind = modifier.kind;
        if (!Object.hasOwn(modifierKinds, kind)) {
          bad(at + '.kind', 'unknown sculpt modifier', 'kinds: ' + Object.keys(modifierKinds).join(', '));
          continue;
        }
        const def = modifierKinds[kind];
        fields(modifier, at, def, { id: 'str', enabled: 'bool' });
        if (Object.hasOwn(modifier, 'do')) bad(at + '.do', 'a sculpt modifier uses kind');
        if (kind === 'fold') {
          if ([modifier.polar, modifier.mirror, modifier.repeat].filter(value => value !== undefined).length !== 1)
            bad(at, 'a fold needs exactly one of polar, mirror or repeat');
          if (modifier.polar !== undefined && (!Number.isSafeInteger(modifier.polar) || modifier.polar < 1))
            bad(at + '.polar', 'polar needs a positive whole repeat count');
          if (modifier.count !== undefined && (!isVec(modifier.count, 3) ||
              !Array.from(modifier.count).every(n => Number.isSafeInteger(n) && n > 0)))
            bad(at + '.count', 'repeat counts must be positive whole numbers');
        }
        if (kind === 'warp') {
          const { twist, bend, taper } = modifier;
          if ([twist, bend, taper].filter(value => value !== undefined).length !== 1 || twist === 0 || bend === 0)
            bad(at, 'a warp needs one nonzero twist or bend, or a taper');
          if (taper !== undefined && (!isVec(taper, 2) || !Array.from(taper).every(n => n > 0)))
            bad(at + '.taper', 'taper needs two positive scale factors');
        }
      }
    }
    let area = 0;
    const res0 = st.finish.res || 0.09;
    function solidOk(s, path, inner) {
      if (!s || typeof s !== 'object')
        return bad(path, 'a solid is an object with a "kind"', 'kinds: ' + Object.keys(DIO.kinds).join(', '));
      const def = Object.hasOwn(DIO.kinds, s.kind) && DIO.kinds[s.kind];
      if (!def) {
        const n = nearest(s.kind, Object.keys(DIO.kinds));
        return bad(
          path + '.kind',
          'no kind of solid called "' + s.kind + '"',
          n ? 'did you mean "' + n + '"?' : 'kinds: ' + Object.keys(DIO.kinds).join(', ')
        );
      }
      fields(s, path, def, COMMON);
      if (s.surfaceState !== undefined) {
        try { K.procedural.surfaceState.projection(s.surfaceState); }
        catch (error) { bad(path + '.surfaceState', error.message); }
      }
      checkModifiers(s.modifiers, path + '.modifiers');
      let scale = 1;
      try {
        scale = solidTransform(s.transform)?.scale ?? 1;
      } catch (error) {
        bad(path + '.transform', error.message);
      }
      if (K.drawing.kind(s)) {
        try {
          K.drawing.prepare(s);
        } catch (error) {
          bad(path, error.message);
        }
      }
      if (s.id !== undefined) {
        if (ids.has(s.id)) bad(path + '.id', 'two solids are called "' + s.id + '"');
        ids.add(s.id);
      }
      if (s.part && !inner) parts.add(s.part);
      if (s.tags !== undefined && (!Array.isArray(s.tags) || !s.tags.every(TargetSelectors.name)))
        bad(path + '.tags', 'tags must be a list of names');
      if (s.prefabs !== undefined && (!Array.isArray(s.prefabs) || !s.prefabs.every(TargetSelectors.name)))
        bad(path + '.prefabs', 'prefabs must be a list of names');
      if (s.surfaceId !== undefined && !TargetSelectors.name(s.surfaceId))
        bad(path + '.surfaceId', 'surfaceId must be a name');
      if (s.part && inner)
        bad(path + '.part', 'a solid inside another cannot be a part of its own', 'put "part" on the outer one');
      if (s.group !== undefined && !groups[s.group])
        bad(
          path + '.group',
          'no group called "' + s.group + '"',
          'groups are declared at the top: "groups": { "' + s.group + '": { "blend": 0.2 } }'
        );
      if (s.carve && s.part) bad(path, 'a carving cannot be a moving part');
      if (s.separate && (!['ball', 'torus'].includes(s.kind) || s.carve || s.group || s.hold || inner))
        bad(path + '.separate', 'separate model geometry needs an independent ball or torus');
      if (s.kind === 'mesh' && typeof s.asset === 'string' && !assets[s.asset])
        bad(
          path + '.asset',
          'no mesh called "' + s.asset + '" was handed in',
          Object.keys(assets).length
            ? 'meshes: ' + Object.keys(assets).join(', ')
            : 'pass { assets: { "' + s.asset + '": mesh } } when building'
        );
      if (s.kind === 'warp' && s.twist === undefined && s.bend === undefined && s.taper === undefined)
        bad(path, 'a warp needs one of twist, bend, taper');
      if (s.kind === 'fold' && s.polar === undefined && s.mirror === undefined && s.repeat === undefined)
        bad(path, 'a fold needs one of polar, mirror, repeat');
      if (s.res !== undefined && isNum(s.res) && s.res < 0.03)
        warn(
          path + '.res',
          'a grain of ' + s.res + ' is very fine',
          'most solids want 0.06 to 0.15; the count goes up with the square'
        );
      const r = isNum(s.r)
          ? s.r
          : isVec(s.r, 3)
            ? Math.max(...s.r)
            : isVec(s.half, 3)
              ? Math.hypot(...s.half)
              : s.kind === 'ground'
                ? (s.rad || 8) * 0.56
                : 1,
        g = isNum(s.res) ? s.res : res0;
      if (!inner && !s.carve) area += (12.6 * (r * scale) ** 2) / (g * g);
    }
    if (!Array.isArray(spec.solids))
      bad(
        'solids',
        'a diorama needs a list of solids',
        'for example [{ "kind": "ground", "mat": "earth" }, { "kind": "ball", "at": [0, 1, 0], "r": 1, "mat": "stone" }]'
      );
    else spec.solids.forEach((s, i) => solidOk(s, 'solids[' + i + ']'));
    for (const [g, v] of Object.entries(groups))
      if (!v || !isNum(v.blend))
        bad('groups.' + g, 'a group says how far its members melt into each other', '{ "blend": 0.2 }');
    const partDefinitions = spec.parts ?? {};
    for (const [p, v] of Object.entries(partDefinitions)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        bad('parts.' + p, 'a part definition must be an object');
        continue;
      }
      if (!parts.has(p))
        bad(
          'parts.' + p,
          'no solid is marked as part "' + p + '"',
          parts.size ? 'parts: ' + [...parts].join(', ') : 'mark a solid with "part": "' + p + '"'
        );
      if (v.joint !== undefined && !isVec(v.joint, 3)) bad('parts.' + p + '.joint', 'a joint is a point [x, y, z]');
      if (v.parent !== undefined && !parts.has(v.parent))
        bad('parts.' + p + '.parent', 'no part called "' + v.parent + '"');
      if (v.parent === p) bad('parts.' + p + '.parent', 'a part cannot hang from itself');
      keys(v, 'parts.' + p, { joint: 1, parent: 1 });
    }
    const checkedParts = new Set();
    for (const part of Object.keys(partDefinitions)) {
      const chain = new Set();
      let name = part;
      while (typeof name === 'string' && Object.hasOwn(partDefinitions, name) && !checkedParts.has(name)) {
        if (chain.has(name)) {
          if (partDefinitions[name]?.parent !== name) bad('parts.' + name + '.parent', 'part parents form a cycle');
          break;
        }
        chain.add(name);
        name = partDefinitions[name]?.parent;
      }
      for (const name of chain) checkedParts.add(name);
    }
    const listOf = (name, table) => {
      const l = spec[name];
      if (l === undefined) return;
      if (!Array.isArray(l)) return bad(name, 'this is a list');
      l.forEach((m, i) => {
        const path = name + '[' + i + ']',
          def = m && table[m.do];
        if (!def)
          return bad(
            path + '.do',
            'nothing called "' + (m && m.do) + '" to do here',
            'choices: ' + Object.keys(table).join(', ')
          );
        fields(m, path, def);
        if (name === 'effects') for (const field of ['n', 'rate', 'strength'])
          if (isNum(m[field]) && m[field] < 0) bad(path + '.' + field, 'value must be nonnegative');
        for (const k of ['part', 'follow'])
          if (typeof m[k] === 'string' && !parts.has(m[k])) {
            const n = nearest(m[k], [...parts]);
            bad(
              path + '.' + k,
              'no part called "' + m[k] + '"',
              n
                ? 'did you mean "' + n + '"?'
                : parts.size
                  ? 'parts: ' + [...parts].join(', ')
                  : 'mark a solid with "part": "' + m[k] + '"'
            );
          }
        if (m.keys !== undefined && (!m.loop || !Array.isArray(m.keys) || m.keys.filter(isNum).length < 4))
          bad(
            path + '.keys',
            'keys are times and values in turn, with "loop" saying how long before they repeat',
            '"keys": [0, 0, 1, 0.5, 2, 0], "loop": 2'
          );
      });
    };
    listOf('motion', MOTION);
    listOf('effects', EFFECT);
    if (spec.dataMarks !== undefined) {
      try {
        presentation.dataMarks = K.dataMarks.prepare(spec.dataMarks, { dataInputs, fixed: true });
      } catch (error) {
        bad('dataMarks', error.message);
      }
    }
    if (spec.cameraRig !== undefined) {
      try {
        presentation.cameraRig = K.cameraRig.compile(spec.cameraRig, { parts });
      } catch (error) {
        bad('cameraRig', error.message);
      }
    }
    if (spec.timeline !== undefined) {
      try {
        presentation.timeline = dioramaTimeline(spec, parts, presentation.cameraRig, look);
      } catch (error) {
        bad('timeline', error.message);
      }
    }
    if (spec.tap !== undefined) {
      keys(spec.tap, 'tap', { do: 1, colours: 1, n: 1 });
      if (!['dust', 'sparks', 'embers'].includes(spec.tap.do)) bad('tap.do', 'a tap can raise dust, sparks or embers');
      matOk(spec.tap.colours, 'tap.colours');
    }
    if (spec.camera) {
      keys(spec.camera, 'camera', { target: 1, dist: 1, pitch: 1, yaw: 1, sway: 1, fov: 1, focalLength:1, sensorHeight:1, focusDistance:1, composition:1, projection: 1 });
      if (spec.camera.target !== undefined && !isVec(spec.camera.target, 3))
        bad('camera.target', 'three numbers [x, y, z]');
      if (spec.camera.fov !== undefined && !K.cameraRig.fovOK(spec.camera.fov))
        bad('camera.fov', 'vertical radians between zero and pi');
      try {
        if(spec.camera.fov!==undefined&&spec.camera.focalLength!==undefined)throw new Error('choose field of view or focal length');
        CameraLens.view(spec.camera);
      } catch(error){bad('camera',error.message);}
      if (spec.camera.projection !== undefined && !K.cameraRig.projectionOK(spec.camera.projection))
        bad('camera.projection', 'expected perspective or orthographic');
    }
    if (spec.brushRegion != null) {
      try {
        K.authoring.brushRegions.prepare(spec, st.roles);
      } catch (error) {
        bad('brushRegion', error.message);
      }
    }
    try {
      const breakables = K.authoring.breakables.prepare(spec);
      if (breakables) presentation.breakables = breakables;
    } catch (error) {
      bad('breakables', error.message);
    }
    if (area > 150000)
      warn(
        'solids',
        'about ' + Math.round(area / 1000) + ',000 splats by a rough count: heavy on a phone',
        'coarser "res" on the big solids brings it down fastest'
      );
    return out;
  }
  DIO.report = list =>
    list
      .map(
        p =>
          (p.level === 'error' ? 'error    ' : 'warning  ') +
          (p.path || '(the whole thing)') +
          ': ' +
          p.problem +
          (p.hint ? '\n           ' + p.hint : '')
      )
      .join('\n');

  // The splat runtime and GLB exporter evaluate the same authored motion.
  function partMotion(B, rig, order, joint, PI, motion) {
    const wave = (m, t) =>
      m.keys
        ? K.kf(t % m.loop, m.keys)
        : (m.amount === undefined ? 0.3 : m.amount) * Math.sin(TAU * (t / (m.period || 3) + (m.phase || 0)));
    return (t, tracks = motion, poses) => {
      for (const p of order) {
        let A = M.id(),
          off = [0, 0, 0];
        for (const m of tracks) {
          if (m.part !== p) continue;
          const ax = B.norm(m.axis || [0, 1, 0]);
          if (m.do === 'turn') A = M.mul(M.rot(ax, wave(m, t)), A);
          else if (m.do === 'spin') A = M.mul(M.rot(ax, (m.speed === undefined ? 1 : m.speed) * t), A);
          else if (m.do === 'bob') off = V.mad(off, ax, wave(m, t));
          else if (m.do === 'squash') A = M.mul(M.stretch(ax, 1 + wave(m, t), true), A);
        }
        const pose = poses?.[p];
        if (pose?.orientation) A = M.mul(pose.orientation, A);
        if (pose?.rotation || pose?.scale !== undefined) {
          const [x, y, z] = pose.rotation ?? [0, 0, 0];
          const rotation = M.mul(M.rot([0, 0, 1], z), M.mul(M.rot([0, 1, 0], y), M.rot([1, 0, 0], x)));
          A = M.mul(rotation, A).map(value => value * (pose.scale ?? 1));
        }
        const j = joint[p], delta = pose?.translation ?? [0, 0, 0];
        if (PI[p] && PI[p].parent) {
          rig.child(p, PI[p].parent, A, j, pose?.translation ? V.add(j, delta) : j);
        } else rig.set(p, A, j, V.add(V.add(j, off), delta));
      }
    };
  }

  // ---------------- building ----------------
  const dynamicMotion = ['axis', 'amount', 'period', 'phase', 'keys', 'loop', 'speed'];
  const dynamicEffect = {
    lamp: ['at', 'r', 'strength', 'flicker'], rain: ['box', 'rate'],
    dust: ['at', 'n', 'every', 'spread'], embers: ['at', 'n', 'every'],
    smoke: ['at', 'n', 'every'], sparks: ['at', 'n', 'every', 'dir', 'speed']
  };
  function dioramaTimeline(spec, parts, cameraRig, look) {
    const poses = { translation: { size: 3 }, rotation: { size: 3, mode: 'radians' },
      orientation: { size: 9, mode: 'orientation' }, scale: { mode: 'positive' } };
    return K.timeline.compile(spec.timeline, { channel([root, name, field, ...rest]) {
      if (root === 'camera' && field === undefined) return K.cameraRig.channel(name, cameraRig?.shots);
      if (root === 'renderGraph' || root === 'inspection')
        return K.presentationTimeline.channel(look, [root, name, field, ...rest]);
      if (rest.length || spec.brushRegion != null) return null;
      if (root === 'poses' && parts.has(name) && Object.hasOwn(poses, field)) return poses[field];
      const effect = root === 'effects' && /^(0|[1-9][0-9]*)$/.test(name) ? spec.effects?.[name] : undefined;
      if (!effect || !dynamicEffect[effect.do]?.includes(field)) return null;
      if (field === 'at' || field === 'dir') return { size: 3 };
      if (field === 'box') return { size: 6 };
      if (['r', 'every', 'spread', 'speed'].includes(field)) return { mode: 'positive' };
      return { mode: 'number', validate: value => value >= 0 && (field !== 'flicker' || value <= 1) };
    } });
  }
  function timelineFrame(timeline, time, effects) {
    const camera = {}, poses = Object.create(null), changes = new Map();
    for (const { path: [root, name, field], value } of timeline.sample(time).edits) {
      if (root === 'camera') camera[name] = value;
      else if (root === 'poses') (poses[name] ??= {})[field] = value;
      else if (root === 'effects') {
        if (!changes.has(name)) changes.set(name, { ...effects[name] });
        changes.get(name)[field] = field === 'box' ? [value.slice(0, 3), value.slice(3)] :
          field === 'n' ? Math.floor(value) : value;
      }
    }
    return { camera, poses, effects: changes.size ? effects.map((effect, i) => changes.get(String(i)) ?? effect) : effects };
  }
  function timelineCamera(world, timeline) {
    world.timeline = timeline;
    if (world.cameraRig) return () => {};
    const names = timeline.targets.filter(path => path[0] === 'camera').map(path => path[1]);
    const base = Object.fromEntries(names.map(name => [name, world.cam[name]]));
    const cameraBase = {...world.cam};
    if (names.length) world.cam = { ...world.cam };
    return frame => Object.assign(world.cam, base, frame.camera, CameraLens.resolve(cameraBase,frame.camera));
  }
  function boundRuntime(source, env, resolved) {
    const { spec, program, inputs } = resolved;
    if (!program) return null;
    const live = ([root, index, field]) => root === 'motion' && spec.motion?.[index] && dynamicMotion.includes(field) ||
      root === 'effects' && dynamicEffect[spec.effects?.[index]?.do]?.includes(field);
    const targets = program.targets.filter(row => live(row.path));
    const frameSource = { ...(spec.motion && { motion: spec.motion }), ...(spec.effects && { effects: spec.effects }) };
    const positive = ['period', 'loop', 'every', 'r', 'spread', 'speed'];
    const nonnegative = ['n', 'rate', 'strength'];
    const vectors = ['axis', 'at', 'dir'];
    let current = { document: frameSource, values: resolved.values }, time = inputs.time ?? 0;
    const copyControls = options => options?.controls === undefined ? {} :
      { controls: K.procedural.data.freeze(K.procedural.data.clone(options.controls)) };
    Object.assign(inputs, copyControls(inputs));
    function read(at, options = inputs) {
      if (!targets.length) return { document: frameSource, values: program.sample({ ...options, time: at }) };
      const result = program.apply(frameSource, { ...options, time: at }, live);
      for (const { path: [root, index, field] } of targets) {
        const row = result.document[root][index], value = row[field];
        const checks = field === 'keys' ? Array.isArray(value) && value.length >= 4 &&
          value.length % 2 === 0 && Array.from(value).every(isNum) && row.loop > 0 :
          field === 'box' ? Array.isArray(value) && value.length === 2 && value.every(v => isVec(v, 3)) :
          vectors.includes(field) ? isVec(value, 3) && Array.from(value).every(isNum) :
          isNum(value) && (!nonnegative.includes(field) || value >= 0) &&
            (!positive.includes(field) || field === 'speed' && root === 'motion' || value > 0);
        if (!checks) throw new RangeError('Invalid live parameter value at ' + [root, index, field].join('/'));
      }
      return result;
    }
    return {
      active: targets.length > 0,
      lamps: targets.some(({ path: [root, index] }) => root === 'effects' && spec.effects[index].do === 'lamp'),
      update(at) {
        const next = read(at);
        current = next;
        time = at;
        return next.document;
      },
      api: Object.freeze({
        values: () => current.values,
        setInputs(options) {
          const next = { ...inputs, ...options, ...copyControls(options) };
          const sampled = read(time, next);
          Object.assign(inputs, next);
          current = sampled;
        },
        bake(options) {
          return DIO.build(source, { ...env, parameterInputs: { ...inputs, time, ...options } });
        }
      })
    };
  }

  const brushField = Symbol('brush field');
  DIO.brushField = (spec, env) => DIO.build(spec, env, { [brushField]: true });
  DIO.build = (source, env, modelOptions) => {
    env = env || {};
    const presentation = {};
    let resolved;
    let problems;
    try {
      resolved = resolveParameters(source, env);
      problems = checkResolved(resolved.spec, env, presentation, resolved.dataInputs);
    } catch (error) {
      if (!error.problems) throw error;
      problems = error.problems;
    }
    const errs = problems.filter(p => p.level === 'error');
    if (errs.length) {
      const e = new Error(
        'diorama "' +
          (source && source.id) +
          '" has ' +
          errs.length +
          ' mistake' +
          (errs.length > 1 ? 's' : '') +
          ':\n' +
          DIO.report(errs)
      );
      e.problems = problems;
      throw e;
    }
    const { spec, dataInputs } = resolved, { timeline, cameraRig, dataMarks } = presentation, dynamics = boundRuntime(source, env, resolved);
    const st0 = styleOf(spec), catalog = lookCatalog(spec),
      seed = spec.seed === undefined ? 1 : spec.seed,
      effects = spec.effects || [],
      motion = spec.motion || [],
      lamps = effects.filter(e => e.do === 'lamp'),
      loose = effects.some(e => ['dust', 'embers', 'smoke', 'sparks', 'rain'].includes(e.do)) || !!spec.tap;
    function bindBreakables(world) {
      try {
        return K.authoring.breakables.bind(world, spec, presentation.breakables);
      } catch (error) {
        error.problems = [{ level: 'error', path: 'breakables', problem: error.message, hint: '' }];
        throw error;
      }
    }
    function marksQuery() {
      const query = resolved.inputs?.query ?? env.parameterInputs?.query;
      return typeof query === 'function' ? query() : query;
    }
    const marks = !modelOptions && dataMarks?.sample(env.parameterInputs?.time ?? 0, { query: marksQuery });
    if (spec.brushRegion != null) {
      if (modelOptions) throw new TypeError('Brush regions are baked as splat geometry');
      const { palette, roles, sun } = st0;
      const { timeline: authoredTimeline, cameraRig: authoredCameraRig, dataInputs: authoredData, dataMarks: authoredMarks, breakables: authoredBreakables, ...geometry } = spec;
      let world = (env.brushSession ?? K.authoring.brushRegions.create()).build(geometry, env, { palette, roles, sun });
      let marksSystem;
      if (marks) {
        const builder = makeBuilder(seed, world.pal);
        K.dataMarks.stamp(builder, marks, { reserve: dataMarks.dynamic });
        const first = world.count;
        if (builder.count()) world = SplatProvenance.join([world, builder.finish({ paint: [] })], world);
        marksSystem = K.dataMarks.bind(world, marks, dataMarks, { first, query: marksQuery });
      }
      world.spec = source;
      bindBreakables(world);
      if (dataInputs) world.dataInputs = dataInputs;
      if (cameraRig) K.cameraRig.bind(world, cameraRig);
      if (dynamics) world.parameters = dynamics.api;
      if (timeline) {
        const apply = timelineCamera(world, timeline);
        if (timeline.targets.length) {
          apply(timelineFrame(timeline, 0, effects));
          K.stage(world).add({ update(dt, t, stage) {
            apply(timelineFrame(timeline, world.timeDomains?.read('camera').sampleTime ?? t + stage.t0, effects));
          } });
        }
      }
      if (marksSystem) {
        const stage = world.anim ?? K.stage(world);
        if (!stage.systems.length) stage.stateful = false;
        stage.add(marksSystem);
      }
      return world;
    }
    st0.finish = K.authoring.environments.apply(st0.finish,spec.environmentPreset,catalog,st0.palette);
    st0.finish.look = K.authoring.looks.scene(st0.finish.look, catalog);
    const cache = !env.makeBuilder && !env.makeSculpt && env.bakeCache, cacheAPI = K.authoring.bakeCache;
    let pal = st0.palette;
    const meshLooks = new Map();
    const activeSolids = [...DIO.solids(spec, { activeOnly: true })];
    for (const s of activeSolids)
      if (s.kind === 'mesh' && s.mat === undefined) {
        const mesh = K.mesh.fit(env.assets[s.asset], { size: s.size || 4, at: s.at, turn: s.spin, up: s.up });
        meshLooks.set(s, { mesh, look: K.mesh.look(mesh, { hues: s.hues || 5, pal }) });
      }
    const { detailBudgets, shadowArt } = st0.finish.look ?? {};
    const B = (env.makeBuilder || makeBuilder)(seed, pal, detailBudgets === undefined && shadowArt === undefined ?
      undefined : { detailBudgets, shadowArt });
    const keepLightCasters = AreaLights.prepare(st0.finish.areaLights).some(light => light.shadows && light.intensity) ||
      EmissiveFinishes.prepare(st0.finish.emissiveFinishes, pal).some(({spill}) => spill?.shadows && spill.intensity) ||
      st0.finish.volumeLighting?.spots?.some(light => light.surfaceIntensity && light.castsShadow !== false);
    let S, grp;
    function startSculpt() {
      S = K.sculpt((env.makeSculpt || makeSculpt)(B));
      S.sun = B.norm(st0.sun);
      if (st0.finish.look?.pixel) S.pixel = true;
      S.keepRenderSdf = keepLightCasters || Boolean(st0.finish.look?.sdfAssist);
      S.captureAlbedo = Boolean(st0.finish.liveSun) ||
        Array.isArray(st0.finish.look?.renderStages) && st0.finish.look.renderStages.some(rule => rule.stage === 'material');
      if (st0.amb !== undefined) S.amb = st0.amb;
      if (st0.sky !== undefined) S.sky = st0.sky;
      if (st0.finish.res) S.res = st0.finish.res;
      if (st0.finish.adaptiveSampling !== undefined) S.adaptiveSampling = st0.finish.adaptiveSampling;
      grp = {};
      for (const [g, v] of Object.entries(spec.groups || {})) grp[g] = S.grp(v.blend);
    }
    startSculpt();
    const rig = modelOptions ? null : K.rig(B, S),
      cap = !modelOptions && lamps.length ? K.light.capture(B, S) : null;
    const ramp = m => (typeof m === 'string' ? st0.roles[m] : m.ramp || st0.roles[m.role]),
      matOf = m => {
        if (m === undefined) m = 'stone';
        const r = ramp(m),
          out = { r, materialId: typeof m === 'string' ? m : m.materialId ?? m.role };
        if (typeof m === 'object') {
          const sc = m.scale || 0.7;
          if (m.noise) out.mod = (x, y, z) => m.noise * (B.n3(x * sc, y * sc, z * sc) - 0.5);
          if (m.glow) out.em = true;
          if (m.model) out.model = m.model;
          if (m.controls !== undefined) out.controls = MaterialControls.describe(m.controls);
          if (m.albedo !== undefined) out.albedo = m.albedo;
          if (m.surfaceId !== undefined) out.surfaceId = m.surfaceId;
          if (m.glass !== undefined) out.glass = m.glass;
          if (m.optical !== undefined) out.optical = m.controls === undefined ? OpticalMaterials.material(m.optical) : m.optical;
          if (m.pixelStyle !== undefined) out.pixelStyle = m.pixelStyle;
          if (m.over) {
            const r2 = ramp(m.over.role),
              above = m.over.above === undefined ? 0.55 : m.over.above,
              patch = m.over.patch === undefined ? 0.5 : m.over.patch;
            out.tex = (x, y, z, ny, t) =>
              ny > above && B.n3(x * 0.9 + 3, y * 0.9, z * 0.9 + 7) > 1 - patch
                ? r2[K.clamp(Math.floor(t * r2.length), 0, r2.length - 1)]
                : undefined;
          }
          if (m.surface !== undefined || m.lookAsset !== undefined) return materialLook(out, m, catalog);
        }
        return out;
      };
    const outline = o =>
      o.svg !== undefined
        ? K.poly2.svg(o.svg, o.size || 2)
        : o.ngon !== undefined
          ? K.poly2.ngon(o.ngon, o.r || 1)
          : o.star !== undefined
            ? K.poly2.star(o.star, o.r || 1, o.inner || (o.r || 1) * 0.5)
            : o.gear !== undefined
              ? K.poly2.gear(o.gear, o.r || 1, o.depth || (o.r || 1) * 0.2)
              : K.poly2.rect(o.rect[0], o.rect[1]);
    function deform(base, s, o) {
      if (s.kind === 'fold') return S.fold(base, s.polar
        ? { polar: s.polar, c: s.centre || [0, 0, 0], axis: s.axis }
        : s.mirror ? { mirror: s.mirror, c: s.centre || [0, 0, 0] }
          : { repeat: s.repeat, count: s.count || [1, 1, 1] }, o);
      if (s.kind === 'warp') return S.warp(base, {
        c: s.centre || [0, 0, 0],
        ...(s.twist !== undefined ? { twist: s.twist } : s.bend !== undefined ? { bend: s.bend } : { taper: s.taper }),
        ...(s.wide && { wide: s.wide })
      }, o);
      if (s.kind === 'shell') return S.shell(base, s.t, o);
      if (s.kind === 'swell') return S.swell(base, s.by, o);
      if (s.kind === 'rough') {
        const sc = s.scale || 1.5;
        return S.rough(base, (x, y, z) => B.n3(x * sc, y * sc, z * sc) - 0.5, s.by, o);
      }
      return S.bubbles(base, { cell: s.cell || 0.5, h: s.h || 0.12, ...o });
    }
    const made = {},
      make = (s, held) => {
        const transform = solidTransform(s.transform);
        const recipe = () => makeSolid(s, held);
        let p;
        if (transform) {
          const { translation, rotation, scale, pivot = s.at ?? [0, 0, 0] } = transform;
          const basis = M.tr(B.frame(...rotation).flat()), inverseBasis = M.tr(basis);
          const direction = vector => M.app(basis, vector);
          const translatedPivot = V.add(pivot, translation);
          const point = vector => V.mad(translatedPivot, direction(V.sub(vector, pivot)), scale);
          const inverse = vector => V.mad(pivot, M.app(inverseBasis, V.sub(vector, translatedPivot)), 1 / scale);
          p = S.transformSolids({ point, inverse, direction, scale }, recipe);
        } else p = recipe();
        if (s.id) made[s.id] = p;
        return p;
      },
      makeSolid = (s, held) => {
        const modifiers = activeModifiers(s);
        const o = { res: s.res, objectId: s.part ?? s.id };
        if (s.id || s.surfaceId || s.tags?.length || s.prefabs?.length) o.target = {
          ...(s.id && { entity: s.id }), ...(s.surfaceId && { surface: s.surfaceId }), ...(s.tags?.length && { tags: s.tags }),
          ...(s.prefabs?.length && { prefabs: s.prefabs })
        };
        if (s.res === undefined) delete o.res;
        if (s.part) {
          o.tag = s.part;
          o.whole = true;
        }
        if (s.group) Object.assign(o, grp[s.group]);
        if (s.carve) o.neg = true;
        if (s.ghost) o.ghost = true;
        if (s.separate && !modifiers.length) o.model = { separate: true, name: s.id ?? s.part ?? s.kind };
        if (s.bump) o.bump = s.bump;
        if (held || s.hold) o.hold = true;
        if (s.turn) o.ax = B.frame(s.turn[0], s.turn[1], s.turn[2]);
        const charts = K.procedural.surfaceState;
        const locate = s.surfaceState && charts.projection(s.surfaceState);
        const m = locate ? charts.bind(matOf(s.mat), locate, B.P) : matOf(s.mat);
        const sub = q => make(q, true), k = s.kind;
        const baseOptions = modifiers.length ? { ...o, hold: true } : o;
        if (s.mat !== undefined && (k === 'join' || unaryKinds.includes(k))) baseOptions.mat = m;
        let p;
        if (k === 'ground') p = S.ground(m, Object.assign({ rad: s.rad || 8 }, s.stretch ? { zs: s.stretch } : {}, baseOptions));
        else if (k === 'ball') p = S.ball(s.at, s.r, m, baseOptions);
        else if (k === 'rock') p = S.rock(s.at, s.r, m, baseOptions);
        else if (k === 'box') p = S.box(s.at, s.half, m, Object.assign(s.round ? { rd: s.round } : {}, baseOptions));
        else if (k === 'lathe')
          p = S.lathe(s.at, s.h, Array.isArray(s.r) && Array.isArray(s.r[0]) ? t => K.kf(t, s.r.flat()) : s.r, m, baseOptions);
        else if (k === 'torus') p = S.torus(s.at, s.R, s.r, m, baseOptions);
        else if (k === 'tube')
          p = S.tube(s.pts, Array.isArray(s.r) ? s.r[0] : s.r, Array.isArray(s.r) ? s.r[1] : s.r, m, baseOptions);
        else if (K.drawing.kind(s)) p = K.drawing.solid(S, s, m, baseOptions);
        else if (k === 'regular')
          p = S.regular(s.shape, s.at, s.r, m, Object.assign(s.round ? { rd: s.round } : {}, baseOptions));
        else if (k === 'extrude')
          p = S.extrude(outline(s.outline), s.at, s.depth, m, Object.assign(s.round ? { rd: s.round } : {}, baseOptions));
        else if (k === 'revolve') p = S.revolve(outline(s.outline), s.at, m, baseOptions);
        else if (k === 'puff') p = S.puff(outline(s.outline), s.at, s.height, m, baseOptions);
        else if (k === 'mesh') {
          const ml = meshLooks.get(s) || {
            mesh: K.mesh.fit(env.assets[s.asset], { size: s.size || 4, at: s.at, turn: s.spin, up: s.up })
          };
          const mat = s.mat !== undefined ? m : locate ? charts.bind(ml.look, locate, B.P) : ml.look;
          const options = { cells: s.cells, thick: s.thick };
          if (cache) {
            const key = cacheAPI.signature([ml.mesh.pos, ml.mesh.tri, options]);
            const data = cache.read('meshFields', key, value => value?.D instanceof Float32Array &&
              value.near instanceof Int32Array && value.D.length === value.near.length &&
              value.n?.length === 3 && value.n.reduce((a, b) => a * b, 1) === value.D.length);
            if (data) options.field = K.mesh.fieldFromData(data);
            else {
              const { sd, tri, ...grid } = options.field = K.mesh.field(ml.mesh, options);
              cache.write('meshFields', key, grid);
            }
          }
          p = S.mesh(ml.mesh, mat, Object.assign(options, baseOptions));
        } else if (k === 'join') p = S.join(s.how, sub(s.a), sub(s.b), Object.assign({ r: s.size, n: s.steps }, baseOptions));
        else if (unaryKinds.includes(k)) p = deform(sub(s.of), s, baseOptions);
        else if (builtKinds.includes(k)) {
          const mats = { stone: m, post: m, rail: m, metal: m },
            oo = Object.assign({}, s, { mats, tag: s.part, res: s.res, objectId: baseOptions.objectId, target: baseOptions.target });
          const buildRecipe = () =>
            k === 'pillar'
              ? K.build.pillar(S, s.at, s.h, oo)
              : k === 'arch'
                ? K.build.arch(S, s.at, oo)
                : k === 'stairs'
                  ? K.build.stairs(S, s.at, s.dir, s.rise, oo)
                  : k === 'fence'
                    ? K.build.fence(S, s.a, s.b, oo)
                    : K.build.pipe(S, s.pts, oo);
          if (baseOptions.hold) {
            const pieces = S.takeSolids(buildRecipe);
            p = pieces.length === 1 ? pieces[0] : S.join('union', pieces[0], pieces.slice(1), { hold: true, r: 0, mat: m });
          } else p = buildRecipe();
        }
        if (locate && s.mat === undefined && (k === 'join' || unaryKinds.includes(k))) p.mat = charts.bind(p.mat, locate, B.P);
        if (modifiers.length) {
          const res = p.res;
          for (const modifier of modifiers) {
            const options = { hold: true };
            let reach = p.reach;
            if (modifier.kind === 'join' || modifier.kind === 'mask') {
              const operand = sub(modifier.shape);
              reach = Math.max(reach, operand.reach);
              if (modifier.kind === 'join') {
                const exact = ['union', 'cut', 'common'].includes(modifier.how);
                p = S.join(modifier.how, p, operand, { ...options, r: modifier.size ?? (exact ? 0 : undefined), n: modifier.steps });
              } else {
                const keep = modifier.mode === 'keep';
                p = S.join(keep ? 'common' : 'cut', p, operand, {
                  ...options, r: 0, mat: p.mat, mask: true
                });
              }
            } else p = deform(p, modifier, options);
            p.reach += reach;
          }
          p = S.add(p, p.mat, { ...o, res, bump: undefined, reach: p.reach });
        }
        return p;
      };
    if (modelOptions?.[brushField]) {
      for (const solid of spec.solids) make(solid);
      S.ready();
      return S;
    }
    if (modelOptions) {
      const groups = new Map(), meshes = [];
      const { duration = timeline?.duration || 4, fps = 30, resolution, method, bounds, targetTriangles } = modelOptions;
      for (const solid of spec.solids) {
        // Ground is an infinite half-space in the sculpt API. Ghosts are render overlays.
        if (solid.kind === 'ground' || (solid.ghost && !solid.separate)) continue;
        const name = solid.part || null;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(solid);
      }
      if (!groups.size) throw new Error('The diorama contains no finite model geometry');
      const parts = spec.parts || {}, names = [], visiting = new Set();
      function place(name) {
        if (visiting.has(name)) throw new Error('Scene rig has a parent cycle at ' + name);
        if (names.includes(name)) return;
        visiting.add(name);
        if (parts[name]?.parent) {
          if (!groups.has(parts[name].parent)) throw new Error('Missing export geometry for part ' + parts[name].parent);
          place(parts[name].parent);
        }
        names.push(name);
        visiting.delete(name);
      }
      for (const name of groups.keys()) if (name !== null) place(name);
      const { rig: previewRig } = names.length ? DIO.build(spec, env).lab : {};
      const joints = [], joint = {};
      for (const name of [null, ...names]) {
        if (!groups.has(name)) continue;
        startSculpt();
        for (const solid of groups.get(name)) make(solid);
        let detail = name === null ? resolution ?? 0.08 :
          Math.min(resolution ?? 0.08, ...groups.get(name).map(solid => solid.res ?? Infinity));
        const hasBody = groups.get(name).some(solid => (!solid.separate || activeModifiers(solid).length) && !solid.carve);
        const restBounds = (name === null ? bounds : undefined) ?? (hasBody ? S.modelBounds(detail * 2) : undefined);
        if (resolution === undefined && name === null && restBounds) {
          const volume = restBounds.max.reduce((v, high, i) => v * (high - restBounds.min[i]), 1);
          detail = Math.max(detail, Math.cbrt(volume / 400000));
        }
        const mesh = K.model.fromSculpt(S, {
          name: name ?? spec.id, palette: pal, resolution: detail, method, bounds: restBounds, targetTriangles
        });
        if (name === null) meshes.push(...K.model.mapModelMeshes(mesh, part => ({ ...part, static: true })));
        else {
          const index = joints.length, box = previewRig.box(name);
          joint[name] = parts[name]?.joint || (box ? [(box.lo[0] + box.hi[0]) * 0.5, box.lo[1], (box.lo[2] + box.hi[2]) * 0.5] : mesh.points[0]);
          joints.push({ name, parent: parts[name]?.parent ? names.indexOf(parts[name].parent) : null,
            head: joint[name], tail: V.mad(joint[name], [0, 1, 0], box ? Math.max(0.05, box.hi[1] - box.lo[1]) : 0.1) });
          meshes.push(...K.model.mapModelMeshes(mesh, part => ({ ...part, weights: part.points.map(() => [[index, 1]]) })));
        }
      }
      const pose = names.length && (motion.length || timeline?.targets.some(path => path[0] === 'poses')) &&
        partMotion(B, previewRig, names, joint, parts, motion);
      const animations = pose ? K.model.sampleClips([{ name: 'Scene motion', duration, fps,
        pose: time => pose(time, dynamics?.active ? dynamics.update(time).motion : motion,
          timeline && timelineFrame(timeline, time, effects).poses) }], (pose, time) => {
        pose(time);
        return names.map(name => {
          const index = previewRig.names.indexOf(name);
          if (index < 0) throw new Error('Splat rig has no part ' + name);
          return Array.from(previewRig.M.slice(index * 12, index * 12 + 12));
        });
      }) : [];
      return { meshes, joints, animations };
    }
    const moving = spec.solids.filter(s => s.part), authoredBounds = new Map();
    const staticBake = cache && !moving.length && !effects.length && !spec.tap && !marks &&
      !presentation.breakables && !S.keepRenderSdf && !st0.finish.paint && !globalThis.INK_DECAL_NEXT &&
      !globalThis.INK_RETAIN_RENDER_SDF && !globalThis.INK_RAMPS;
    const bakeKey = staticBake ? cacheAPI.sceneKey(spec, st0,
      activeSolids.filter(s => s.kind === 'mesh').map(s => env.assets[s.asset])) : undefined;
    const baked = staticBake && cache.read('splats', bakeKey, cacheAPI.isPacked);
    const candidateKeys = staticBake && !baked ? new WeakMap() : null;
    if (candidateKeys) S.sampleCandidates = (solid, spacing, sample, visit) => {
      const key = candidateKeys.get(solid);
      if (key === undefined) return sample(visit);
      const input = cacheAPI.signature([key, spacing]);
      const points = cache.read('candidatePoints', input, value => value instanceof Float64Array && value.length % 3 === 0);
      if (points) {
        for (let i = 0; i < points.length; i += 3) visit(points[i], points[i + 1], points[i + 2]);
      } else {
        const buffer = [];
        const limit = 250000 * 3;
        sample((x, y, z) => {
          if (buffer.length <= limit) buffer.push(x, y, z);
          visit(x, y, z);
        });
        if (buffer.length <= limit) cache.write('candidatePoints', input, Float64Array.from(buffer));
      }
    };
    function placeSolid(s) {
      const p = make(s);
      if (candidateKeys && ['ball', 'box', 'ground', 'mesh'].includes(s.kind) && !s.transform && !activeModifiers(s).length) {
        const { kind, at, r, half, turn, rad, stretch, asset, size, spin, up } = s;
        candidateKeys.set(p, cacheAPI.signature([seed, kind, at, r, half, turn, rad, stretch,
          kind === 'mesh' ? [env.assets[asset].pos, env.assets[asset].tri, size, spin, up] : null]));
      }
      if (p.geometryBounds && (K.drawing.kind(s) || s.transform)) authoredBounds.set(s, p.geometryBounds);
      else if ((s.transform || activeModifiers(s).length) && s.kind !== 'ground') {
        const at = p.bc ?? (s.at && V.add(s.at, s.transform?.translation ?? [0, 0, 0]));
        if (at) authoredBounds.set(s, { min: at, max: at });
      }
    }
    for (const s of spec.solids) if (!s.part) placeSolid(s);
    if (!baked) {
      S.bake();
      if (candidateKeys) S.sampleCandidates = undefined;
    }
    if (moving.length) {
      for (const s of moving) placeSolid(s);
      S.bake();
    }
    const firstMark = marks && K.dataMarks.stamp(B, marks, { reserve: dataMarks.dynamic });
    const pool = loose ? K.pool(B, spec.spare || 600) : null,
      lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (const s of spec.solids) {
      const b = authoredBounds.get(s) ?? (s.at && s.kind !== 'ground' ? { min: s.at, max: s.at } : null);
      if (b) for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], b.min[a]);
        hi[a] = Math.max(hi[a], b.max[a]);
      }
    }
    if (marks) for (const mark of marks) if (mark.status === 'visible') {
      const { position, size } = mark.channels;
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(lo[axis], position[axis]-size);
        hi[axis] = Math.max(hi[axis], position[axis]+size);
      }
    }
    const markRadius = marks?.some(mark => mark.status === 'visible') ? V.dist(lo, hi)*.5 : 0;
    const cam = Object.assign(
      {
        target: lo[0] > 1e8 ? [0, 1.5, 0] : [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2 + 0.5, (lo[2] + hi[2]) / 2],
        dist: Math.max(16, markRadius*3.5),
        pitch: 0.16,
        yaw: 0.4,
        sway: 0.3
      },
      spec.camera
    );
    const W = B.finish(
      Object.assign(
        { cam, detail: 14, palName: typeof spec.style === 'string' ? spec.style : 'Data', dither: 0.25, radius: Math.max(9, markRadius) },
        st0.finish,
        baked || {},
        { made, spec: source, paletteRoles: st0.roles, ...(dynamics && { parameters: dynamics.api }),
          ...(dataInputs && { dataInputs }),
          ...(spec.light?.surfaceDirection !== undefined && { surfaceLight: spec.light.surfaceDirection }) }
      )
    );
    if (env.resolveSpriteAtlas && Array.isArray(W.spriteAtlases))
      W.spriteAtlases = W.spriteAtlases.map(placement => typeof placement?.atlas === 'string' ?
        K.sprite.placeAtlas({ ...placement, atlas: env.resolveSpriteAtlas(placement.atlas) }) : placement);
    if (staticBake && !baked) cache.write('splats', bakeKey, cacheAPI.pack(W));
    if (pool) W.qualityParticleRanges = [{ first: pool.first, count: pool.n }];
    bindBreakables(W);
    const marksSystem = marks && K.dataMarks.bind(W, marks, dataMarks, { first: firstMark, query: marksQuery });
    if (cameraRig) K.cameraRig.bind(W, cameraRig, {
      resolvePart(part, point) {
        if (!rig?.at || !rig.has(part)) return;
        const i = rig.names.indexOf(part);
        return { point: rig.at(i, point), rotation: rig.M.subarray(i*12, i*12+9) };
      }
    });
    const applyCamera = timeline && timelineCamera(W, timeline);
    const timelineActive = !!timeline?.targets.length;
    const liveLamps = dynamics?.lamps || timeline?.targets.some(([root, index]) =>
      root === 'effects' && effects[index].do === 'lamp');
    if (timelineActive) applyCamera(timelineFrame(timeline, 0, effects));
    const authoredStage = moving.length || effects.length || spec.tap || timelineActive;
    if (!authoredStage && !marksSystem) return W;
    const st = K.stage(W);
    if (!authoredStage) st.stateful = false;
    if (marksSystem) st.add(marksSystem);
    rig.bind(st);
    let tracks = motion, activeEffects = effects, poses;
    if (dynamics?.active || timelineActive) st.add({ update(dt, t, stage) {
      const at = t + stage.t0;
      const frame = dynamics?.active ? dynamics.update(at) : undefined;
      tracks = frame?.motion ?? motion;
      activeEffects = frame?.effects ?? effects;
      if (timelineActive) {
        const keyed = timelineFrame(timeline, at, activeEffects);
        applyCamera(W.timeDomains ? timelineFrame(timeline, W.timeDomains.read('camera').sampleTime, activeEffects) : keyed);
        poses = keyed.poses;
        activeEffects = keyed.effects;
      }
    } });
    const partNames = [...new Set(moving.map(s => s.part))],
      PI = spec.parts || {},
      joint = {};
    for (const p of partNames) {
      const bx = rig.box(p),
        j = PI[p] && PI[p].joint;
      joint[p] = j || (bx ? [(bx.lo[0] + bx.hi[0]) / 2, bx.lo[1], (bx.lo[2] + bx.hi[2]) / 2] : [0, 0, 0]);
    }
    const order = partNames.slice().sort((a, b) => {
      const depth = p => {
        let d = 0;
        while (PI[p] && PI[p].parent && d < 20) {
          p = PI[p].parent;
          d++;
        }
        return d;
      };
      return depth(a) - depth(b);
    });
    const poseParts = partMotion(B, rig, order, joint, PI, motion);
    if (partNames.length)
      st.add({
        update(dt, t) {
          poseParts(t, tracks, poses);
          rig.apply();
        }
      });
    let lit = null;
    if (lamps.length) {
      const L = lamps.map(e => ({ p: e.at.slice(), r: e.r ?? 6, s: e.strength ?? 0.9, e,
        s0: e.strength ?? 0.9, index: effects.indexOf(e) }));
      lit = K.light.system(st, cap, L, { sun: { dir: S.sun, amb: S.amb, sky: S.sky, k: S.sunK, parts: partNames } });
      if (!liveLamps) st.add(lit);
      let acc = 0;
      st.add({
        update(dt, t) {
          const direction = st.motionSettings();
          acc += dt;
          if (!liveLamps && direction?.cadence.emissive === undefined && acc < 1 / 12) return;
          acc = 0;
          const flickerTime = ArtDirection.time(direction, t, 'emissive');
          let moved = false;
          L.forEach((l, i) => {
            if (liveLamps) {
              const e = activeEffects[l.index], position = e.follow ? rig.at(e.follow, e.at) : e.at;
              const strength = (e.strength ?? .9) * (1 - (e.flicker ?? 0) *
                (.5 + .5 * Math.sin(flickerTime * 9.1 + i * 2.3) * Math.sin(flickerTime * 5.3 + i)));
              const range = e.r ?? 6;
              if (l.s !== strength || l.r !== range || !position.every((n, axis) => n === l.p[axis])) {
                Object.assign(l, { p: position, s: strength, r: range });
                moved = true;
              }
              return;
            }
            if (l.e.flicker) {
              const strength = l.s0 * (1 - l.e.flicker * (0.5 + 0.5 * Math.sin(flickerTime * 9.1 + i * 2.3) * Math.sin(flickerTime * 5.3 + i)));
              if (l.s !== strength) { l.s = strength; moved = true; }
            }
            if (l.e.follow) {
              l.p = rig.at(l.e.follow, l.e.at);
              moved = true;
            }
          });
          if (moved) lit.touch();
        }
      });
      if (liveLamps) st.add(lit);
    }
    let ps = null;
    if (loose) {
      const winds = effects.filter(e => e.do === 'wind'),
        flow = winds.length
          ? K.flow.sum(
              ...winds.map(w => (w.swirl ? K.flow.sum(K.flow.wind(w.v), K.flow.curl(0.35, w.swirl)) : K.flow.wind(w.v)))
            )
          : undefined;
      ps = K.particles(st, pool, { flow, ground: () => 0 });
      const cols = (e, role) => {
          const r = ramp(e.colours === undefined ? role : e.colours);
          return r.slice().reverse();
        },
        timers = effects.map(() => 0);
      st.add({
        update(dt, t) {
          activeEffects.forEach((e, i) => {
            if (e.do === 'rain') {
              timers[i] += (e.rate ?? 60) * dt;
              const n = Math.floor(timers[i]);
              timers[i] -= n;
              if (n) ps.rain(e.box, n, cols(e, 'water'));
              return;
            }
            if (!ps[e.do] || !e.at) return;
            timers[i] -= dt;
            if (timers[i] > 0) return;
            timers[i] = e.every || 0.5;
            const n = e.n ?? 3;
            if (!n) return;
            if (e.do === 'dust') ps.dust(e.at, n, cols(e, 'earth'), e.spread);
            else if (e.do === 'embers') ps.embers(e.at, n, cols(e, 'ember'));
            else if (e.do === 'smoke') ps.smoke(e.at, n, cols(e, 'dark'));
            else if (e.do === 'sparks') ps.sparks(e.at, n, cols(e, 'glow'), e.dir || null, e.speed);
          });
        },
        poke(hit) {
          if (!hit || !spec.tap) return;
          const t = spec.tap,
            c = cols(t, t.do === 'dust' ? 'earth' : 'ember'),
            n = t.n || 12;
          if (t.do === 'dust') ps.dust(hit.p, n, c, 1.5);
          else if (t.do === 'embers') ps.embers(hit.p, n, c);
          else ps.sparks(hit.p, n, c, null, 4);
        }
      });
      st.add(ps);
    }
    const rv = effects.find(e => e.do === 'reveal');
    if (rv) st.add(K.fx.reveal(st, { auto: true, dur: rv.dur || 1.4, block: rv.block || 0.6 }));
    W.lab = { rig, ps, lit, parts: partNames };
    return W;
  };
  DIO.scene = (spec, env) => {
    const id = 'drawing:' + spec.id, seed0 = spec.seed ?? 1;
    const authoredSolids = spec.solids ?? [];
    const editable = s => K.drawing.kind(s) && typeof s.id === 'string';
    const resolve = (seed, snapshot) => {
      if (snapshot === undefined) return { ...spec, seed: seed ?? seed0 };
      const state = K.authoring.data.validate(snapshot);
      if (state.id !== id) throw Error('Drawing snapshot belongs to a different scene');
      const marks = new Map(Object.values(state.entities).map(({ id, type, parameters, anchor, parent, styleRef }) => {
        const mark = { ...parameters, id, kind: type };
        if (!K.drawing.kind(mark)) throw Error('Invalid drawing entity: ' + id);
        if (anchor || parent || styleRef) throw Error('Set carrier, part and material in drawing parameters: ' + id);
        return [id, mark];
      }));
      const solids = [];
      for (const s of authoredSolids) {
        if (!editable(s)) solids.push(s);
        else if (marks.has(s.id)) {
          solids.push(marks.get(s.id));
          marks.delete(s.id);
        }
      }
      return { ...spec, seed: seed ?? state.seed, solids: solids.concat([...marks.values()]) };
    };
    const build = (seed, { snapshot, controls, parameterInputs } = {}) => DIO.build(resolve(seed, snapshot), {
      ...env, parameterInputs: { ...env?.parameterInputs, ...parameterInputs, ...(controls !== undefined && { controls }) }
    });
    const authoring = (seed, { snapshot } = {}) => {
      const A = K.authoring;
      let document;
      if (snapshot === undefined) {
        const start = A.document({ ...A.document().snapshot(), id, seed: seed ?? seed0 });
        start.transact('Load drawings', () => {
          for (const { id, kind, ...parameters } of authoredSolids.filter(editable))
            start.create(kind, { id, parameters });
        });
        document = A.document(start.snapshot());
      } else {
        resolve(seed, snapshot);
        document = A.document(snapshot);
      }
      return {
        document,
        realize(state = document.snapshot()) {
          try {
            return { world: build(seed, { snapshot: state }) };
          } catch (error) {
            if (!error.problems) throw error;
            return {
              checks: error.problems.filter(p => p.level === 'error').map(({ path, problem }) =>
                ({ pass: false, path, message: problem }))
            };
          }
        }
      };
    };
    return {
      id: spec.id,
      name: spec.name || spec.id,
      blurb: spec.blurb || '',
      seed: seed0,
      build,
      model: (seed, { snapshot, controls, parameterInputs, ...options } = {}) =>
        DIO.build(resolve(seed, snapshot), {
          ...env, parameterInputs: { ...env?.parameterInputs, ...parameterInputs, ...(controls !== undefined && { controls }) }
        }, options),
      authoring
    };
  };
  DIO.roles = ROLES;
})(KIT);
