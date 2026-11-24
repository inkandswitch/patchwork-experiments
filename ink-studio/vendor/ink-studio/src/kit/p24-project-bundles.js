/* A JSON diorama and its local dependencies, mounted without a host filesystem. */
(function(K) {
  const A = K.authoring, DIO = K.diorama;
  const format = 'ink-studio/project-bundle', version = 1;
  const maxBytes = 128 * 1024 * 1024, maxFiles = 4096;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const meshExtension = /\.(obj|gltf|glb)$/i;
  let encoder, decoder;
  const encodeText = value => (encoder ??= new TextEncoder()).encode(value);
  const decodeText = value => (decoder ??= new TextDecoder()).decode(value);
  const base64 = value => typeof value === 'string' && value.length % 4 === 0 && /^[a-z\d+/]*={0,2}$/i.test(value);
  const decodeBytes = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));

  function resolvePath(owner, ref) {
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 4096 || /[<>:"|?*\x00-\x1f]/.test(ref) || /^[\\/]/.test(ref))
      throw new TypeError('Project references need local relative paths: ' + ref);
    const parts = owner ? owner.split('/').slice(0, -1) : [];
    for (const piece of ref.replace(/\\/g, '/').split('/')) {
      if (piece === '..') {
        if (!parts.length) throw new RangeError('Project reference leaves the root: ' + ref);
        parts.pop();
      } else if (piece && piece !== '.') parts.push(piece);
    }
    if (!parts.length) throw new TypeError('Expected a project filename');
    return parts.join('/');
  }

  function contents(source) {
    const entry = typeof source === 'string' ? JSON.parse(source) : source;
    if (!object(entry)) throw new TypeError('Expected a project scene or asset JSON object');
    return entry;
  }

  function texturePath(line) {
    const words = line.split(/\s+#/)[0].match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    while (words[0]?.startsWith('-')) {
      const control = words.shift();
      if (['-s', '-o', '-t'].includes(control)) {
        for (let i = 0; i < 3 && words.length && Number.isFinite(Number(words[0])); i++) words.shift();
      } else words.splice(0, control === '-mm' ? 2 : 1);
    }
    return words.join(' ').replace(/^["']|["']$/g, '');
  }

  function model(file, io, decode = true) {
    if (/\.obj$/i.test(file)) {
      const text = io.text(file), library = /^mtllib\s+(.+)$/m.exec(text)?.[1].trim();
      const material = library && resolvePath(file, library.replace(/^["']|["']$/g, ''));
      const mtl = material && io.text(material);
      if (mtl) for (const line of mtl.split(/\r?\n/)) {
        const map = /^\s*(?:map_\w+|bump|disp|decal|norm|refl)\s+(.+)/i.exec(line);
        if (map) io.file(resolvePath(material, texturePath(map[1])));
      }
      if (decode) return K.mesh.obj(text, mtl);
      return;
    }
    const { json, bins } = /\.glb$/i.test(file) ? K.mesh.glbParts(io.bytes(file)) :
      { json: contents(io.text(file)), bins: [] };
    if (json?.asset?.version !== '2.0') throw new TypeError('Project mesh needs glTF 2.0: ' + file);
    const local = uri => resolvePath(file, decodeURIComponent(uri));
    const binary = (json.buffers ?? []).map(({ uri }, i) =>
      uri === undefined ? bins[i] : uri.startsWith('data:') ? null : io.bytes(local(uri)));
    for (const image of json.images ?? []) if (image.uri !== undefined && !image.uri.startsWith('data:')) io.file(local(image.uri));
    if (decode) return K.mesh.gltf(json, binary);
  }

  function visitAttachment(file, io, visited, expectAtlas = false) {
    if (visited.has(file)) return;
    visited.add(file);
    const record = io.file(file);
    if (meshExtension.test(file)) return model(file, io, false);
    if (!expectAtlas && !/\.json$/i.test(file)) return;
    const doc = JSON.parse(io.text(file, record));
    const atlas = typeof doc?.files?.color === 'string' && Number.isSafeInteger(doc.width) && Number.isSafeInteger(doc.height);
    if (expectAtlas && !atlas) throw new TypeError('Invalid sprite atlas in project: ' + file);
    function relative(ref) {
      if (typeof ref === 'string') visitAttachment(resolvePath(file, ref), io, visited);
    }
    if (atlas) {
      Object.values(doc.files).forEach(relative);
      if (typeof doc.cels === 'string') {
        const sidecar = resolvePath(file, doc.cels);
        const cels = contents(io.text(sidecar));
        for (const edit of cels.replacements ?? []) for (const ref of Object.values(edit.files ?? {}))
          visitAttachment(resolvePath(sidecar, ref), io, visited);
      } else for (const edit of doc.cels?.replacements ?? []) Object.values(edit.files ?? {}).forEach(relative);
    } else if (object(doc?.layers) && Number.isSafeInteger(doc.width) && Number.isSafeInteger(doc.height)) {
      for (const layer of Object.values(doc.layers))
        for (const frame of layer?.frames ?? []) relative(typeof frame === 'string' ? frame : frame?.file);
    }
  }

  function reader(get) {
    function file(name, optional = false) {
      const record = get(name);
      if (!record && !optional) throw new Error('Missing project file: ' + name);
      return record;
    }
    function bytes(name) {
      const record = file(name);
      return record.encoding === 'utf8' ? encodeText(record.data) : decodeBytes(record.data);
    }
    function text(name, record = file(name)) {
      return record.encoding === 'utf8' ? record.data : decodeText(bytes(name));
    }
    return { file, bytes, text };
  }

  // The packer records reads. A mounted bundle answers the same reads from its file table.
  function mapAtlasImages({ metadata, images }, transform) {
    const next = structuredClone(metadata);
    const map = imageMap => Object.fromEntries(Object.entries(imageMap).map(([name, data]) => [name, transform(data)]));
    if (next.cels?.replacements) next.cels.replacements = next.cels.replacements.map(({ images, ...edit }) =>
      ({ ...edit, images: map(images) }));
    return { metadata: next, images: map(images) };
  }

  function loadScene(entry, io, source, cache = new Map(), readAtlas) {
    const spec = structuredClone(contents(source ?? io.text(entry)));
    const assets = Object.create(null);
    function mesh(solid, owner, scoped = false) {
      if (solid.kind !== 'mesh' || typeof solid.asset !== 'string') return;
      const location = resolvePath(owner, solid.asset);
      const choices = meshExtension.test(location) ? [location] : ['', '.obj', '.glb', '.gltf'].map(ext => location + ext);
      const file = choices.find(name => io.file(name, true));
      if (!file || !meshExtension.test(file)) throw new Error('Missing project mesh: ' + location);
      if (!cache.has(file)) cache.set(file, model(file, io));
      const key = scoped ? 'project://' + file : solid.asset;
      assets[key] = cache.get(file);
      if (scoped) solid.asset = key;
    }
    const definitions = (table, owner, scoped) => {
      for (const definition of Object.values(table ?? {}))
        for (const solid of DIO.solids({ solids: Object.values(definition?.solids ?? {}) })) mesh(solid, owner, scoped);
    };
    if (spec.dataInputs !== undefined)
      spec.dataInputs = K.dataInputs.embed(spec.dataInputs, file => io.text(resolvePath(entry, file)));
    let prefabs;
    if (spec.prefabLibrary !== undefined) {
      const library = resolvePath(entry, spec.prefabLibrary);
      prefabs = contents(io.text(library));
      definitions(prefabs, library, true);
    }
    definitions(spec.prefabs, entry, false);
    const { spec: expanded } = A.scenePrefabs.expand(spec, { prefabs });
    for (const solid of DIO.solids(expanded)) if (!Object.hasOwn(assets, solid.asset)) mesh(solid, entry);
    const atlasPaths = new Set();
    function atlasFile(ref) {
      const file = resolvePath(entry, ref);
      return io.file(file, true) ? file : file + '/atlas.json';
    }
    const resolveSpriteAtlas = readAtlas && (ref => readAtlas(atlasFile(ref)));
    for (const finish of [spec.style?.finish, spec.finish]) {
      if (!Array.isArray(finish?.spriteAtlases)) continue;
      for (const placement of finish.spriteAtlases) if (typeof placement?.atlas === 'string') {
        const file = atlasFile(placement.atlas);
        if (!atlasPaths.has(file)) visitAttachment(file, io, new Set(), true);
        atlasPaths.add(file);
        readAtlas?.(file);
      }
    }
    const env = { assets, prefabs, resolveSpriteAtlas };
    const problems = DIO.check(spec, env);
    if (problems.some(problem => problem.level === 'error')) {
      const error = new Error(DIO.report(problems));
      error.problems = problems;
      throw error;
    }
    return { spec, env, problems, atlasPaths };
  }

  function open(input) {
    const document = contents(input), { entry, project, toolkit, files, attachments = {}, atlases = {} } = document;
    if (document.format !== format || document.version !== version)
      throw new TypeError('Unsupported Ink Studio project bundle version');
    if (!object(project) || typeof project.id !== 'string' || !Number.isSafeInteger(project.revision) ||
        project.revision < 1 || !object(toolkit) || typeof toolkit.version !== 'string' ||
        !/^[a-f0-9]{64}$/.test(toolkit.sourceHash ?? '') || !object(files) || !object(attachments) || !object(atlases))
      throw new TypeError('Invalid project version information or file table');
    const rows = Object.entries(files);
    if (!rows.length || rows.length > maxFiles || !/\.json$/i.test(entry ?? '') || !Object.hasOwn(files, entry))
      throw new RangeError('A project needs a JSON scene entry and a bounded file table');
    let size = 0;
    const table = new Map();
    for (const [name, record] of rows) {
      if (resolvePath('', name) !== name || !object(record) || typeof record.data !== 'string' ||
          !['utf8', 'base64'].includes(record.encoding))
        throw new TypeError('Invalid project file record: ' + name);
      if (record.encoding === 'base64' && !base64(record.data))
        throw new TypeError('Invalid base64 project file: ' + name);
      size += record.encoding === 'base64' ? record.data.length * 3 / 4 : encodeText(record.data).length;
      if (size > maxBytes) throw new RangeError('Project exceeds the file size budget');
      table.set(name, { encoding: record.encoding, data: record.data });
    }
    const io = reader(name => table.get(name)), lookup = new Map(Object.entries(attachments));
    const visited = new Set();
    for (const [id, name] of lookup) {
      if (!id.trim() || id.length > 256 || resolvePath('', name) !== name) throw new TypeError('Invalid project attachment: ' + id);
      visitAttachment(name, io, visited);
    }
    const atlasSources = new Map(), compiledAtlases = new Map();
    for (const [file, snapshot] of Object.entries(atlases)) {
      io.file(file);
      const portable = mapAtlasImages(snapshot, data => {
        if (!base64(data)) throw new TypeError('Invalid project atlas image: ' + file);
        size += data.length * 3 / 4;
        if (size > maxBytes) throw new RangeError('Project exceeds the file size budget');
        return data;
      });
      atlasSources.set(file, portable);
    }
    function readAtlas(file) {
      if (!atlasSources.has(file)) throw new Error('Missing decoded project atlas: ' + file);
      if (!compiledAtlases.has(file))
        compiledAtlases.set(file, AtlasSprites.compile(mapAtlasImages(atlasSources.get(file), decodeBytes)));
      return compiledAtlases.get(file);
    }
    const authored = contents(io.text(entry));
    const cached = new Map(), resolve = (source = authored) => loadScene(entry, io, source, cached, readAtlas);
    const initial = resolve();
    if (initial.spec.id !== project.id) throw new TypeError('Project ID must match the scene entry');
    const metadata = Object.freeze({ id: project.id, revision: project.revision, entry,
      toolkit: Object.freeze({ version: toolkit.version, sourceHash: toolkit.sourceHash }) });
    function snapshot() {
      return { format, version, project: { id: metadata.id, revision: metadata.revision }, toolkit: { ...metadata.toolkit },
        entry, files: Object.fromEntries([...table].map(([name, record]) => [name, { ...record }])), attachments: Object.fromEntries(lookup),
        ...(atlasSources.size && { atlases: structuredClone(Object.fromEntries(atlasSources)) }) };
    }
    function withScene(source, { revision = metadata.revision + 1 } = {}) {
      const next = structuredClone(contents(source)), data = snapshot();
      for (const [name, definition] of Object.entries(authored.dataInputs ?? {}))
        if (definition.file !== undefined && Object.hasOwn(next.dataInputs ?? {}, name) &&
            K.world.data.equal(next.dataInputs[name], initial.spec.dataInputs[name]))
          next.dataInputs[name] = definition;
      data.project = { id: next.id, revision };
      data.files[entry] = { encoding: 'utf8', data: JSON.stringify(next, null, 2) + '\n' };
      return open(data);
    }
    return Object.freeze({ metadata, snapshot, withScene, resolve,
      scene: () => structuredClone(initial.spec),
      editor({ env, ...options } = {}) {
        const { spec, env: bindings } = resolve();
        return A.sceneEditor.create(spec, { ...options, env: { ...bindings, ...env } });
      },
      build({ seed, env, ...options } = {}) {
        const { spec, env: bindings } = resolve();
        return DIO.scene(spec, { ...bindings, ...env }).build(seed, options);
      },
      files: () => [...table.keys()],
      readFile: name => io.bytes(resolvePath('', name)),
      attachment(id) {
        if (!lookup.has(id)) throw new RangeError('Unknown project attachment: ' + id);
        const name = lookup.get(id);
        return { path: name, bytes: io.bytes(name) };
      }
    });
  }

  A.projectBundles = Object.freeze({ format, version, maxBytes, maxFiles, resolvePath, open, mapAtlasImages,
    collect(entry, get, attachments) {
      const io = reader(get), visited = new Set();
      for (const file of Object.values(attachments)) visitAttachment(file, io, visited);
      return loadScene(entry, io);
    } });
})(KIT);
