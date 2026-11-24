// The gears graph (PLANS.md section 4, "Visible gears"): what runs in a
// stage, what each piece contributes and how the pieces meet, as one plain
// value. Pure: a function of the registry's metadata, the stage's scene
// snapshot, its running list, what its instances contribute (commands,
// inputs, `inspect` snapshots: CONVENTIONS.md, "Inspect") and the kernel's
// reads (`owners()`, `settled()`, provenance). Built on the kernel's own pure
// helpers (stage/public.js) for who holds what (the chain's order) and whether a
// command applies (stage/commands.js), so it can't disagree with them.
//
//   extensions ↔ traits ↔ objects ↔ verbs (state per object) ↔ services
//   ↔ claims, poses, display overrides ↔ layers and labels; and what isn't
//   running: traits nothing here declares, packages not here, failures.
//
// Two lenses read it: gearsOfObject (an object's holders in input order,
// each with its verbs, events, drawing and services) and gearsOfExtension
// (the objects carrying its traits, their values, the objects × verbs grid,
// what it holds now, its services, what it last wrote). The X-ray draws them.

import { chainOrder, commandState, flatCommands, hitChain, holdersFor } from "../stage/public.js";

/** The input events an `input` may take (STAGE.md, "The input chain"). */
export const EVENTS = ["press", "click", "menu", "key", "keyup", "wheel", "widgetAt", "cursor"];

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const traitKeys = (o) => (o?.traits && typeof o.traits === "object" ? Object.keys(o.traits) : []);
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
/** A plugin's package and version, from where it was registered (`importUrl`: url#heads). */
const sourceOf = (meta) => {
  const u = typeof meta?.importUrl === "string" ? meta.importUrl : null;
  return u ? { package: u.split("#")[0], version: u.split("#")[1] ?? null } : { package: null, version: null };
};
/** A command's state as the graph keeps it: enabled, or disabled with why; its label, checked, value. */
const verbState = (s) =>
  s && {
    enabled: !s.disabled,
    ...(s.disabled ? { reason: s.title ?? null } : {}),
    ...(s.label != null ? { label: String(s.label) } : {}),
    ...(s.checked != null ? { checked: !!s.checked } : {}),
    ...(s.value !== undefined && (typeof s.value !== "object" || s.value === null) ? { value: s.value } : {}),
  };

/**
 * @param {{
 *   metas: object[],                       // registry metadata, scene:extension and scene:view (type tells)
 *   scene: { d: object, objects: object, ids?: string[], parents: Map, groups: Map },  // api.scene()
 *   running: { id: string, scope: string }[],  // local.running, in running order
 *   views?: string[],                      // the view plugins running here (the focus's), in order
 *   settled?: { missing?: string[], failed?: string[], errors?: object },
 *   commands?: { id: string, value: any }[],   // collect("commands"), the stage's and (at the focus) its view plugins'
 *   inputs?: { id: string, value: any }[],     // collect("input")
 *   inspect?: { id: string, value: any }[],    // each instance's inspect() snapshot
 *   context?: object,                      // api.context(): what a command's state() is asked in
 *   owners?: { layers, labels, display },  // api.owners()
 *   provenance?: { path: (string|number)[], by: { ext?, kernel? } | null }[],
 *   targets?: (string | null)[],           // whose verbs to work out (default: the scene and every object)
 * }} o
 */
export function buildGears({ metas = [], scene, running = [], views = [], settled = {}, commands = [], inputs = [], inspect = [], context = null, owners = null, provenance = [], targets = null }) {
  const objects = scene?.objects ?? {};
  const ids = (scene?.ids ?? Object.keys(objects)).filter((id) => objects[id]);
  const metaOf = new Map(metas.filter((m) => typeof m?.id === "string").map((m) => [m.id, m]));
  const runningIds = running.map((r) => r.id);
  const failed = list(settled.failed);
  const errors = settled.errors ?? {};

  // ── extensions: running first (running order), then the view plugins, then the rest registered
  const inputOf = new Map(inputs.map((x) => [x.id, x.value]));
  const inspectOf = new Map(inspect.map((x) => [x.id, x.value]));
  const node = (id, kind, extra) => {
    const m = metaOf.get(id) ?? {};
    const input = inputOf.get(id);
    return {
      id,
      kind,
      name: typeof m.name === "string" ? m.name : id,
      ...sourceOf(m),
      traits: list(m.traits),
      ...(m.keeper ? { keeper: true } : {}),
      provides: list(m.provides),
      uses: list(m.uses),
      describes: Object.keys(m.describes ?? {}),
      events: input && typeof input === "object" ? EVENTS.filter((e) => typeof input[e] === "function") : [],
      inspect: inspectOf.has(id) ? plain(inspectOf.get(id)) : null,
      ...extra,
    };
  };
  const extensions = [
    ...running.map((r) => node(r.id, "extension", { scope: r.scope, state: "running" })),
    ...views.map((id) => node(id, "view", { scope: null, state: "running" })),
    ...metas
      .filter((m) => m?.id && !runningIds.includes(m.id) && !views.includes(m.id))
      .map((m) => node(m.id, m.type === "scene:view" ? "view" : "extension", { scope: null, state: failed.includes(m.id) ? "failed" : "idle", ...(failed.includes(m.id) ? { error: String(errors[m.id] ?? "failed") } : {}) })),
  ];

  // ── traits on objects (and the scene, id null): who declares each
  const declarers = (trait) => metas.filter((m) => m?.type !== "scene:view" && list(m?.traits).includes(trait)).map((m) => m.id);
  const carries = [];
  for (const [id, o] of [[null, scene?.d], ...ids.map((x) => [x, objects[x]])]) for (const trait of traitKeys(o).sort()) carries.push({ object: id, trait, value: plain(o.traits[trait]), by: declarers(trait) });

  // ── who holds what: for every object, the running extensions whose trait sits on its hit chain or the scene (stage/chain.js), nearest first
  const runningMetas = running.map((r) => ({ id: r.id, meta: metaOf.get(r.id) ?? {}, scope: r.scope }));
  const traitsAt = (id) => traitKeys(id == null ? scene?.d : objects[id]);
  const holds = [];
  const chainOf = new Map(); // object id → holders in input order
  for (const id of ids) {
    const hs = holdersFor(runningMetas, hitChain(id, scene.parents, scene.groups, objects), traitsAt);
    const order = chainOrder({ running: runningMetas, holders: hs });
    chainOf.set(id, order.map((ext) => ({ ext, via: hs.get(ext).id, depth: hs.get(ext).depth })));
    for (const ext of order) holds.push({ ext, object: id, via: hs.get(ext).id, depth: hs.get(ext).depth });
  }

  // ── verbs: each command's state for each target, as every surface asks it
  const flat = flatCommands(commands);
  const verbs = [];
  const want = targets ?? [null, ...ids];
  for (const { ext, command } of flat) {
    for (const target of want) {
      if (target != null && !objects[target]) continue;
      const st = verbState(commandState(command, target, context));
      if (!st) continue;
      verbs.push({ ext, command: String(command.id), name: String(command.name ?? command.id), target, keys: [command.key ?? []].flat().map(String), show: command.show === undefined ? null : [command.show].flat().map(String), ...st });
    }
  }

  // ── services: each name, who provides it (the first running provider serves) and who uses it
  const serviceNames = [...new Set(extensions.flatMap((e) => [...e.provides, ...e.uses]))].sort();
  const live = (e) => e.state === "running";
  const services = serviceNames.map((name) => {
    const providers = extensions.filter((e) => live(e) && e.provides.includes(name)).map((e) => e.id);
    return { name, provider: providers[0] ?? null, providers, users: extensions.filter((e) => live(e) && e.uses.includes(name)).map((e) => e.id) };
  });

  // ── what instances hold now, from their inspect snapshots (CONVENTIONS.md, "Inspect": claims, holds, processes)
  const claims = [];
  const poses = [];
  const processes = [];
  const drives = [];
  for (const { id: by, value } of inspect) {
    for (const c of Array.isArray(value?.claims) ? value.claims : []) claims.push({ object: c.id ?? null, kind: c.kind, ext: c.ext ?? null, viewer: c.viewer ?? null, session: c.session ?? null, mine: !!c.mine, lapsing: !!c.lapsing, from: by });
    for (const h of Array.isArray(value?.holds) ? value.holds : []) poses.push({ object: h.id, ext: h.ext ?? null, session: h.session ?? null, viewer: h.viewer ?? null, rank: h.rank ?? 0, yields: !!h.yields, since: h.since ?? null, landed: !!h.landed, mine: !!h.mine, from: by });
    for (const d of Array.isArray(value?.drives) ? value.drives : []) drives.push({ object: d.id, ext: d.ext ?? null, from: by });
    for (const [ext, n] of Object.entries(value?.processes && typeof value.processes === "object" ? value.processes : {})) processes.push({ ext, count: n, from: by });
  }

  // ── what is drawn, by whom (api.owners())
  const overrides = Object.entries(owners?.display ?? {}).flatMap(([object, by]) => by.map((o, layer) => ({ object, ext: o.ext, fields: [...o.fields], layer })));
  const layers = (owners?.layers ?? []).map((l) => ({ ...l }));
  const labels = (owners?.labels ?? []).map((l) => ({ ...l }));

  // ── what isn't running: traits nothing registered declares, packages not here, failures
  const unknown = new Map();
  for (const c of carries) if (!c.by.length) unknown.set(c.trait, [...(unknown.get(c.trait) ?? []), c.object]);
  const notRunning = {
    traits: [...unknown].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([trait, on]) => ({ trait, on })),
    packages: list(settled.missing),
    failed: failed.map((id) => ({ id, error: String(errors[id] ?? "failed") })),
  };

  return deepFreeze({
    extensions,
    objects: ids.map((id) => ({ id, name: objects[id].name ?? id, parent: scene.parents.get(id) ?? null, group: scene.groups.get(id) ?? null, traits: traitKeys(objects[id]) })),
    scene: { traits: traitKeys(scene?.d) },
    carries,
    holds,
    chains: Object.fromEntries(chainOf),
    verbs,
    services,
    claims,
    poses,
    processes,
    drives,
    overrides,
    layers,
    labels,
    provenance: provenance.map((p) => ({ path: [...p.path], ext: p.by?.ext ?? null, kernel: p.by?.kernel ?? null })),
    notRunning,
  });
}

function deepFreeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

/** What one extension contributes to one object, for a lens. */
function entry(g, ext, id, extra) {
  const e = g.extensions.find((x) => x.id === ext) ?? { id: ext, package: null, version: null, events: [], provides: [], uses: [] };
  return {
    ext,
    ...extra,
    package: e.package,
    version: e.version,
    verbs: g.verbs.filter((v) => v.ext === ext && v.target === id),
    events: e.events,
    draws: {
      labels: g.labels.filter((l) => l.ext === ext && l.on === id),
      overrides: g.overrides.filter((o) => o.ext === ext && o.object === id),
    },
    services: { provides: e.provides, uses: e.uses },
  };
}

/**
 * An object's gears: its holders in input order (nearest first, then the
 * scene's), then the view plugins, each with its verbs for it, the events
 * it takes, what it draws there and its services; any other running
 * extension with a verb for it after (`others`); its claims and poses.
 * Null for an object the stage doesn't have.
 */
export function gearsOfObject(g, id) {
  const o = g.objects.find((x) => x.id === id);
  if (!o) return null;
  const chain = g.chains[id] ?? [];
  const holders = chain.map((h) => entry(g, h.ext, id, { kind: "holder", via: h.via, depth: h.depth }));
  const views = g.extensions.filter((e) => e.kind === "view" && e.state === "running").map((e) => entry(g, e.id, id, { kind: "view" }));
  const listed = new Set([...holders, ...views].map((h) => h.ext));
  const others = [...new Set(g.verbs.filter((v) => v.target === id && !listed.has(v.ext)).map((v) => v.ext))].map((ext) => entry(g, ext, id, { kind: "verbs" }));
  return {
    id,
    name: o.name,
    traits: g.carries.filter((c) => c.object === id),
    holders,
    views,
    others,
    claims: g.claims.filter((c) => c.object === id),
    poses: g.poses.filter((p) => p.object === id),
    overrides: g.overrides.filter((x) => x.object === id),
  };
}

/**
 * An extension's gears: the objects carrying its traits (by trait, with
 * their values and what its `describes` names), every object it holds, the
 * grid of those objects (and the scene) × its verbs with each cell's state,
 * what it holds now (claims, poses, overrides, processes, layers, labels),
 * its service connections, what it wrote last, and its state (running,
 * failed with the error, idle). A view plugin's verbs by surface instead of
 * a grid of holdings. Null for an id nothing knows.
 */
export function gearsOfExtension(g, extId) {
  const e = g.extensions.find((x) => x.id === extId);
  if (!e) return null;
  const byTrait = Object.fromEntries(e.traits.map((t) => [t, g.carries.filter((c) => c.trait === t).map((c) => ({ id: c.object, value: c.value }))]));
  const held = g.holds.filter((h) => h.ext === extId).map((h) => h.object);
  const mine = g.verbs.filter((v) => v.ext === extId);
  const commands = [...new Set(mine.map((v) => v.command))];
  const grid = {
    commands,
    rows: [null, ...held].map((id) => ({ id, cells: Object.fromEntries(commands.map((c) => [c, mine.find((v) => v.command === c && v.target === id) ?? null])) })),
  };
  const surfaces = {};
  for (const v of mine) for (const s of v.show ?? ["(every surface but world)"]) (surfaces[s] ??= []).includes(v.command) || surfaces[s].push(v.command);
  return {
    ...e,
    objects: byTrait,
    held,
    grid,
    ...(e.kind === "view" ? { surfaces } : {}),
    now: {
      claims: g.claims.filter((c) => c.ext === extId),
      poses: g.poses.filter((p) => p.ext === extId),
      overrides: g.overrides.filter((o) => o.ext === extId),
      processes: g.processes.filter((p) => p.ext === extId),
      layers: g.layers.filter((l) => l.ext === extId),
      labels: g.labels.filter((l) => l.ext === extId),
    },
    services: {
      provides: g.services.filter((s) => e.provides.includes(s.name)).map((s) => ({ name: s.name, serving: s.provider === extId, users: s.users })),
      uses: g.services.filter((s) => e.uses.includes(s.name)).map((s) => ({ name: s.name, provider: s.provider })),
    },
    wrote: g.provenance.filter((p) => p.ext === extId).map((p) => p.path),
  };
}
