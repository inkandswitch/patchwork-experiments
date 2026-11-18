// Putting a part in, and a doc as an object, through a stage api alone
// (scene/EDITOR.md, "Parts"). The editor's part() is scene's source, which this
// package doesn't import; this does what it does, minus the undo step: load the
// scene:part from the stage's registry and run its create(ctx, at) with the
// drop context the part expects. `api` is a running extension's stage api.

const copy = (v) => JSON.parse(JSON.stringify(v));
const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** ctx.file(key, make): the scene's file doc for a versioned key, made once and kept in doc.assets. */
async function sceneFile(api, key, make) {
  const known = () => {
    const a = api.doc().assets?.[key];
    return typeof a?.url === "string" ? { url: a.url, hint: a.hint ? copy(a.hint) : null } : null;
  };
  if (known()) return known();
  const m = await make();
  const file = await api.repo.create2({ "@patchwork": { type: "file" }, name: String(m.name ?? key), extension: String(m.extension ?? ""), mimeType: String(m.mimeType ?? "application/octet-stream"), content: m.bytes });
  const hint = m.hint ? copy(m.hint) : null;
  api.change((d) => {
    if (!d.assets[key]?.url) d.assets[key] = hint ? { url: file.url, hint } : { url: file.url };
  });
  return known() ?? { url: file.url, hint };
}

/** Add a doc as an object (the stage's addObject). → its id */
export async function add(api, input, opts) {
  const write = await api.addObject(input, opts);
  api.change(write);
  return write.id;
}

/** Put part `partId` in at { parent, transform } (the parent's frame). → the id its create returns, selected, else null */
export async function part(api, partId, { parent = null, transform = IDENTITY } = {}) {
  const loaded = await (await api.registry("scene:part"))?.load(partId);
  const mod = loaded?.module?.default ?? loaded?.module;
  if (typeof mod?.create !== "function") return null;
  const t = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, ...copy(transform) };
  const ctx = Object.freeze({
    id: partId,
    repo: api.repo,
    handle: api.handle,
    url: api.url,
    viewer: api.channel.viewer,
    doc: api.doc,
    scene: api.scene,
    newId: api.newId,
    change: (fn) => api.change(fn),
    addObject: (input, opts) => add(api, input, opts),
    file: (key, make) => sceneFile(api, key, make),
    content: api.content,
    worldOf: api.worldOf,
    registry: api.registry,
    local: Object.freeze({ get: api.local.get, swap: api.local.swap }),
    select: (oid) => api.view.select(oid),
    notify: (text, kind) => api.use("notices")?.notify(text, kind),
  });
  // `world` (the same place in the world) is given at the root only: no part these probes put under a parent reads it
  const made = await mod.create(ctx, Object.freeze({ parent, transform: t, world: parent ? null : t }));
  const id = typeof made === "string" && api.doc().objects?.[made] ? made : null;
  if (id) api.view.select(id);
  return id;
}
