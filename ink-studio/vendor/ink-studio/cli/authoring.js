const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (scene, snapshot) =>
  createHash('sha256').update(JSON.stringify([scene, snapshot])).digest('hex');

function fileOption(options, name) {
  const value = options[name];
  if (value !== undefined && (typeof value !== 'string' || !value.length))
    throw new Error('--' + name + ' needs a file path');
  return value;
}

function writeNew(file, contents) {
  const destination = path.resolve(file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx');
  try {
    try {
      fs.writeFileSync(fd, contents);
    } finally {
      fs.closeSync(fd);
    }
    fs.linkSync(temporary, destination);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output already exists: ' + file);
    throw error;
  } finally {
    fs.unlinkSync(temporary);
  }
}

function describe(document, context, part) {
  const entities = part === undefined ? document.entities() : [document.get(part)];
  if (!entities[0] && part !== undefined) throw new Error('Unknown part: ' + part);
  return [...entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(entity => ({
    ...entity,
    ...context?.describe(entity.id),
    ...(entity.anchor && context ? { anchorFrame: context.anchor(entity.id) } : {})
  }));
}

function edit(document, request, baseRevision) {
  if (!record(request) || !Array.isArray(request.operations) || !request.operations.length)
    throw new Error('Expected an edit object with a nonempty operations array');
  if (request.revision !== undefined && request.revision !== baseRevision)
    throw new Error('Stale authoring revision. Inspect the current snapshot before editing.');

  document.transact('CLI authoring edit', () => {
    for (const operation of request.operations) {
      const { op, id, patch, rule, key } = operation ?? {};
      const entity = typeof id === 'string' && document.get(id);
      if (!entity) throw new Error('Unknown part: ' + id);
      if (op === 'update') {
        if (!record(patch) || !Object.keys(patch).length ||
            Object.keys(patch).some(name => !['parameters', 'anchor', 'parent', 'styleRef'].includes(name)) ||
            ('parameters' in patch && !record(patch.parameters)))
          throw new Error('Update expects parameters, anchor, parent or styleRef: ' + id);
        document.update(id, patch);
      } else if (op === 'suppress') {
        if (!entity.derived) throw new Error('Only a generated part can be suppressed: ' + id);
        document.suppress(id);
      } else if (op === 'allow') {
        if (typeof rule !== 'string' || !rule || typeof key !== 'string' || !key)
          throw new Error('Allow expects an owner id, rule and generated key');
        document.allow(id, rule, key);
      } else {
        throw new Error('Unknown authoring operation: ' + op);
      }
    }
  });
}

function changes(before, after) {
  const previous = new Map(before.map(part => [part.id, part]));
  const next = new Map(after.map(part => [part.id, part]));
  return {
    added: after.filter(part => !previous.has(part.id)).map(part => part.id),
    removed: before.filter(part => !next.has(part.id)).map(part => part.id),
    updated: after.filter(part => previous.has(part.id) &&
      JSON.stringify(part) !== JSON.stringify(previous.get(part.id))).map(part => part.id)
  };
}

module.exports = async function authoring(args, options, { scene, render }) {
  const [mode, source, edits] = args;
  const inspect = mode === 'inspect', apply = mode === 'apply', preview = mode === 'preview';
  if (!(inspect && args.length === 2 || (preview || apply) && args.length === 3))
    throw new Error('Usage: ink-studio authoring inspect <scene> | preview|apply <scene> <edits.json>');
  const input = fileOption(options, 'authoring'), out = fileOption(options, 'out'),
    image = fileOption(options, 'image'), part = options.part;
  if (apply !== Boolean(out)) throw new Error(apply ? 'Apply needs --out snapshot.json' : 'Only apply accepts --out');
  if (image && !preview) throw new Error('Only preview accepts --image');
  if (part !== undefined && (!inspect || typeof part !== 'string' || !part))
    throw new Error('--part needs a part ID and is only available with inspect');

  const descriptor = scene(source);
  if (typeof descriptor.authoring !== 'function')
    throw new Error('This scene needs an authoring(seed, options) hook');
  const snapshot = input ? read(input) : undefined;
  const seed = options.seed === undefined ? snapshot?.seed ?? descriptor.seed : Number(options.seed);
  if (options.seed === true || !Number.isSafeInteger(seed)) throw new Error('Authoring needs an integer seed');
  if (snapshot && seed !== snapshot.seed) throw new Error('The authoring snapshot already has a seed');
  const controls = options.params === undefined ? undefined : JSON.parse(String(options.params));
  const { document, context, realize } = descriptor.authoring(seed, { controls, snapshot });

  try {
    context?.reconcile();
    const before = document.snapshot(), baseRevision = revision(descriptor.id, before);
    const previous = inspect ? undefined : describe(document, context);
    if (!inspect) edit(document, read(edits), baseRevision);
    const after = document.snapshot(), parts = describe(document, context, part);
    const { world, checks = [] } = await realize(after);
    const valid = checks.every(check => check.pass === true);
    if (valid && (!world || !Number.isSafeInteger(world.count)))
      throw new Error('Authoring realization needs a render world when validation passes');

    const report = { scene: descriptor.id, revision: revision(descriptor.id, after), valid, checks };
    if (world) report.splatCount = world.count;
    if (inspect) report.parts = parts;
    else {
      report.baseRevision = baseRevision;
      report.changes = changes(previous, parts);
      const changed = new Set([...report.changes.added, ...report.changes.updated]);
      report.parts = parts.filter(part => changed.has(part.id));
    }
    if (valid && image) {
      writeNew(image, render(world));
      report.image = image;
    }
    if (valid && apply) {
      writeNew(out, JSON.stringify(after, null, 2) + '\n');
      report.snapshot = out;
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!valid) process.exitCode = 2;
  } finally {
    context?.dispose();
  }
};
