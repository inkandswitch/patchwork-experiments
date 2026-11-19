// The X-ray's panel models (PLANS.md section 4, "Visible gears"): pure
// functions from a gears value (gears.js) and a few reads the graph doesn't
// hold (the routes, who's on the channel, how people are named) to what the
// panel and the world show. The DOM (xray.js) only draws what these say:
//
//   a section  { id, title, note?, rows?: Row[], table?: { head, rows, more } }
//   a row      { text, sub?, ext?, object?, state?, chips?: Chip[], lines?: string[], older? }
//   a chip     { text, state?: "on" | "off" | "far" | "took", title? }
//   a cell     { text, state?, title? }
//   a badge    { key, on, text, kind }          a label on an object, for the layers
//   an outline { key, id, role: "focus" | "chain" | "trait", index? }
//
// `ext` on a row picks that extension, `object` pins that object.

import { TOO_FAR } from "../parts/toolbar-commands.js";
import { gearsOfExtension, gearsOfObject } from "./gears.js";

/** The layers, in the panel's order; `on` by default. */
export const LAYERS = Object.freeze([
  { id: "claims", name: "Claims", on: true },
  { id: "poses", name: "Poses", on: true },
  { id: "clock", name: "Clock", on: false },
  { id: "display", name: "Display", on: false },
  { id: "route", name: "Input route", on: true },
  { id: "links", name: "Links", on: false },
  { id: "people", name: "People", on: false },
  { id: "visibility", name: "Visibility", on: false },
]);
/** Most rows a long list shows before "and n more". */
export const MOST = 30;

const ids = LAYERS.map((l) => l.id);
/** The layers on, from the pref's value (a list of ids; anything else is the default). */
export const layersOn = (pref) => (Array.isArray(pref) ? ids.filter((id) => pref.includes(id)) : LAYERS.filter((l) => l.on).map((l) => l.id));
/** The pref's value with one layer turned on or off. */
export const toggleLayer = (pref, id, on) => {
  const now = layersOn(pref);
  return ids.filter((x) => (x === id ? on : now.includes(x)));
};

/** A package URL as a person scans it: a doc's first characters, or a URL's last part. */
export function shortPackage(url) {
  if (typeof url !== "string" || !url) return "this scene";
  if (url.startsWith("automerge:")) return `${url.slice(0, 18)}…`;
  const parts = url.replace(/\/+$/, "").split("/");
  return parts.slice(-2).join("/");
}
const shortVersion = (v) => (typeof v === "string" && v ? v.split(",")[0].slice(0, 7) : null);
/** A value as one short line. */
export function brief(v, most = 40) {
  let s;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  s = s ?? "—";
  return s.length > most ? `${s.slice(0, most - 1)}…` : s;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const more = (list, most = MOST) => ({ shown: list.slice(0, most), more: Math.max(0, list.length - most) });

/** A verb as a chip: enabled, disabled with why, or out of reach; its label for this target and its key. */
export function verbChip(v) {
  const state = v.enabled ? "on" : v.reason === TOO_FAR ? "far" : "off";
  const key = v.keys?.[0] ? ` (${v.keys[0].length === 1 ? v.keys[0].toUpperCase() : v.keys[0]})` : "";
  const why = state === "far" ? "out of reach" : state === "off" ? `disabled${v.reason ? `: ${v.reason}` : ""}` : "enabled";
  return { text: `${v.label ?? v.name}${key}`, state, title: why };
}

/** The reads the graph doesn't hold. */
const ctxOf = (ctx = {}) => ({
  who: typeof ctx.who === "function" ? ctx.who : (viewer, mine) => (mine ? "you" : (viewer ?? "someone")),
  viewer: ctx.viewer ?? null,
  ...ctx,
});
/** An object's name as the panel says it: the doc's, with its id where another has the same name. */
const objectName = (g) => {
  const count = new Map();
  for (const o of g.objects) count.set(o.name, (count.get(o.name) ?? 0) + 1);
  const names = new Map(g.objects.map((o) => [o.id, count.get(o.name) > 1 ? `${o.name} ${o.id}` : o.name]));
  return (id) => (id == null ? "the scene" : (names.get(id) ?? id));
};
/** A holder with nothing for this object: it holds the scene, and takes, offers and draws nothing here. */
export const quietHolder = (h) => h.via == null && !h.verbs.length && !h.events.length && !h.draws.labels.length && !h.draws.overrides.length;
const extName = (g) => {
  const names = new Map(g.extensions.map((e) => [e.id, e.name]));
  return (id) => names.get(id) ?? id;
};

/** One extension's part in one object, as a row: package and version, how it holds it, verbs, events, drawing, services. */
function entryRow(g, h, nameOf) {
  const e = g.extensions.find((x) => x.id === h.ext);
  const version = shortVersion(h.version);
  const how = h.kind === "holder" ? (h.via == null ? "holds the scene" : h.depth === 0 ? "holds it" : `holds ${nameOf(h.via)}`) : h.kind === "view" ? "view plugin" : "a verb for it";
  const draws = [...h.draws.labels.map((l) => `label “${brief(l.text, 24)}”`), ...h.draws.overrides.map((o) => `display ${o.fields.join(", ")}`)];
  const lines = [
    ...(h.events.length ? [`takes ${h.events.join(", ")}`] : []),
    ...(draws.length ? [`draws here: ${draws.join("; ")}`] : []),
    ...(h.services.provides.length || h.services.uses.length
      ? [[h.services.provides.length ? `provides ${h.services.provides.join(", ")}` : "", h.services.uses.length ? `uses ${h.services.uses.join(", ")}` : ""].filter(Boolean).join(" · ")]
      : []),
  ];
  return {
    text: e?.name ?? h.ext,
    sub: `${h.ext} · ${shortPackage(h.package)}${version ? `@${version}` : ""} · ${how}`,
    ext: h.ext,
    chips: h.verbs.map(verbChip),
    lines,
  };
}

/**
 * The object lens (gearsOfObject), as sections: its traits, its holders in
 * input order, the view plugins with something for it, others with a verb
 * for it, what holds it now, who last wrote its fields. Null for an object
 * the stage doesn't have.
 * @param {object} g  buildGears
 * @param {string} id
 * @param {{ who?: (viewer, mine) => string }} [ctx]
 */
export function objectSections(g, id, ctx) {
  const o = gearsOfObject(g, id);
  if (!o) return null;
  const { who } = ctxOf(ctx);
  const nameOf = objectName(g);
  const ext = extName(g);
  const busy = (h) => h.verbs.length || h.draws.labels.length || h.draws.overrides.length;
  const views = o.views.filter(busy);
  const quiet = o.views.length - views.length;
  const now = [
    ...o.claims.map((c) => ({ text: `claim ${c.kind}`, sub: `${who(c.viewer, c.mine)}${c.ext ? ` · ${ext(c.ext)}` : ""}${c.lapsing ? " · lapsing" : ""}`, state: c.lapsing ? "off" : "on" })),
    ...o.poses.map((p) => ({ text: `pose held by ${who(p.viewer, p.mine)}`, sub: `rank ${p.rank}${p.rank === 0 ? " (counts)" : ""}${p.yields ? " · yielding" : ""}${p.landed ? " · landed" : ""}${p.ext ? ` · ${ext(p.ext)}` : ""}`, state: p.rank === 0 ? "on" : "off" })),
    ...o.overrides.map((x) => ({ text: `display ${x.fields.join(", ")}`, sub: `layer ${x.layer} · ${ext(x.ext)}`, ext: x.ext })),
  ];
  const wrote = g.provenance.filter((p) => p.path[0] === "objects" && p.path[1] === id && p.path.length >= 3);
  const loud = o.holders.filter((h) => !quietHolder(h));
  const hush = o.holders.filter(quietHolder).map((h) => ext(h.ext));
  return [
    {
      id: "object",
      title: nameOf(id),
      note: o.traits.length ? o.traits.map((t) => `${t.trait}${t.by.length ? "" : " (nothing here declares it)"}`).join(" · ") : "no traits",
      rows: [],
    },
    {
      id: "holders",
      title: `Holders, in input order (${o.holders.length})`,
      rows: loud.map((h) => entryRow(g, h, nameOf)),
      ...(o.holders.length ? (hush.length ? { note: `and, holding the scene with nothing for it: ${hush.join(", ")}` } : {}) : { note: "nothing holds it: its presses go to the view plugins" }),
    },
    ...(views.length || quiet ? [{ id: "views", title: "View plugins", rows: views.map((h) => entryRow(g, h, nameOf)), note: quiet ? `${plural(quiet, "other")} with nothing here` : undefined }] : []),
    ...(o.others.length ? [{ id: "others", title: "Other verbs for it", rows: o.others.map((h) => entryRow(g, h, nameOf)) }] : []),
    ...(now.length ? [{ id: "now", title: "Holding it now", rows: now }] : []),
    ...(wrote.length ? [{ id: "wrote", title: "Last written by", rows: wrote.map((p) => ({ text: p.path.slice(2).join("."), sub: p.ext ? ext(p.ext) : p.kernel ? `the kernel (${p.kernel})` : "unstamped", ...(p.ext ? { ext: p.ext } : {}) })) }] : []),
  ];
}

/** What to outline for an object: it, and the links of its chain it is held through (what it hangs on, its groups). */
export function objectOutline(g, id) {
  if (!g.objects.some((o) => o.id === id)) return [];
  const chain = [...new Set((g.chains[id] ?? []).map((h) => h.via).filter((v) => v != null && v !== id))];
  return [{ key: `focus:${id}`, id, role: "focus" }, ...chain.map((c) => ({ key: `chain:${c}`, id: c, role: "chain" }))];
}

/**
 * Is a running extension lingering? Nothing here calls for it: it runs for
 * traits (not every doc's "*"), and none of them sits anywhere.
 */
export function lingering(g, e) {
  if (e.kind !== "extension" || e.state !== "running" || !e.traits.length || e.traits.includes("*")) return false;
  return !g.carries.some((c) => e.traits.includes(c.trait));
}

/**
 * The scene's running list (running order, scope, provides and uses,
 * busy or lingering) with the view plugins after, and what isn't running:
 * traits nothing here declares, packages not here, failures with errors.
 * @param {object} g
 * @param {{ body?: { ext? }, hands?: { ext? }[] }} [view]  the view's value (a body or tool an extension holds makes it busy)
 */
export function runningSections(g, view = null) {
  const holding = new Set([view?.body?.ext, ...(view?.hands ?? []).map((h) => h?.ext)].filter(Boolean));
  const busy = (e) => holding.has(e.id) || g.poses.some((p) => p.ext === e.id && p.mine);
  const ext = extName(g);
  const running = g.extensions.filter((e) => e.kind === "extension" && e.state === "running");
  const views = g.extensions.filter((e) => e.kind === "view" && e.state === "running");
  const nr = g.notRunning;
  const not = [
    ...nr.failed.map((f) => ({ text: ext(f.id), sub: `failed: ${f.error}`, ext: f.id, state: "off" })),
    ...nr.packages.map((p) => ({ text: shortPackage(p), sub: "package not loaded here", state: "off" })),
    ...nr.traits.map((t) => ({ text: t.trait, sub: `on ${t.on.length === 1 ? (t.on[0] == null ? "the scene" : "1 object") : plural(t.on.length, "object")}: nothing here declares it`, state: "off" })),
  ];
  return [
    {
      id: "running",
      title: `Running (${running.length})`,
      rows: running.map((e) => {
        const tags = [lingering(g, e) ? "lingering" : null, busy(e) ? "busy" : null].filter(Boolean);
        const svc = [e.provides.length ? `provides ${e.provides.join(", ")}` : "", e.uses.length ? `uses ${e.uses.join(", ")}` : ""].filter(Boolean);
        return { text: e.name, sub: [e.id, e.scope, ...svc, ...tags].join(" · "), ext: e.id, ...(tags.length ? { state: tags.includes("lingering") ? "off" : "on" } : {}) };
      }),
    },
    { id: "views", title: `View plugins (${views.length})`, rows: views.map((e) => ({ text: e.name, sub: e.id, ext: e.id })) },
    { id: "not-running", title: "Not running", rows: not, ...(not.length ? {} : { note: "everything the doc calls for runs" }) },
  ];
}

/** A trait's values as a table: a column per key its values have (the first six), a row per object. */
function traitTable(g, trait, rows) {
  const nameOf = objectName(g);
  const keys = [];
  for (const r of rows) if (r.value && typeof r.value === "object" && !Array.isArray(r.value)) for (const k of Object.keys(r.value)) if (!keys.includes(k)) keys.push(k);
  const cols = keys.slice(0, 6);
  const { shown, more: n } = more(rows);
  return {
    head: [trait, ...(cols.length ? cols : ["value"])],
    rows: shown.map((r) => [{ text: nameOf(r.id), object: r.id ?? undefined }, ...(cols.length ? cols.map((k) => ({ text: r.value?.[k] === undefined ? "" : brief(r.value[k], 18) })) : [{ text: brief(r.value) }])]),
    more: n,
  };
}

/**
 * The extension lens (gearsOfExtension), as sections: what it is, the
 * objects carrying its traits with their values, the objects × verbs grid,
 * what it holds now, its services, what it wrote last; a view plugin's
 * verbs by surface and its hands instead of the holdings. Null for an id
 * nothing knows.
 * @param {object} g
 * @param {string} extId
 * @param {{ who?, hands?: { ext, kind, name }[] }} [ctx]
 */
export function extensionSections(g, extId, ctx) {
  const x = gearsOfExtension(g, extId);
  if (!x) return null;
  const { who, hands = [] } = ctxOf(ctx);
  const nameOf = objectName(g);
  const version = shortVersion(x.version);
  const head = {
    id: "extension",
    title: x.name,
    note: [x.id, `${shortPackage(x.package)}${version ? `@${version}` : ""}`, x.kind === "view" ? "view plugin" : x.scope ? `scope ${x.scope}` : null, x.state === "running" ? (lingering(g, x) ? "lingering" : "running") : x.state, x.error ? `error: ${x.error}` : null].filter(Boolean).join(" · "),
    rows: [],
  };
  const traits = x.traits.filter((t) => t !== "*");
  // (a marker trait, every value empty, is a count: a table of nothing says nothing)
  const empty = (v) => v == null || v === true || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
  const byTrait = traits.map((t) => ({
    id: `trait:${t}`,
    title: `${t} on ${t === "*" ? "every doc" : plural(x.objects[t].length, "object")}${x.describes.includes(t) ? "" : " (undescribed)"}`,
    ...(x.objects[t].every((r) => empty(r.value)) ? { note: x.objects[t].length ? "no fields" : "nothing carries it here" } : { table: traitTable(g, t, x.objects[t]) }),
  }));
  const verbName = new Map(g.verbs.filter((v) => v.ext === extId).map((v) => [v.command, v.name]));
  const rows = more(x.grid.rows);
  const grid = x.grid.commands.length
    ? [
        {
          id: "grid",
          title: `Verbs × ${x.kind === "view" ? "targets" : "what it holds"}`,
          table: {
            head: ["", ...x.grid.commands.map((c) => verbName.get(c) ?? c)],
            rows: rows.shown.map((r) => [{ text: nameOf(r.id), object: r.id ?? undefined }, ...x.grid.commands.map((c) => (r.cells[c] ? cellOf(r.cells[c]) : { text: "·", title: "not for it" }))]),
            more: rows.more,
          },
        },
      ]
    : [];
  const n = x.now;
  const now = [
    ...n.claims.map((c) => ({ text: `claim ${c.kind} on ${nameOf(c.object)}`, sub: `${who(c.viewer, c.mine)}${c.lapsing ? " · lapsing" : ""}`, ...(c.object ? { object: c.object } : {}) })),
    ...n.poses.map((p) => ({ text: `pose on ${nameOf(p.object)}`, sub: `rank ${p.rank}${p.yields ? " · yielding" : ""}${p.landed ? " · landed" : ""}`, object: p.object })),
    ...n.overrides.map((o) => ({ text: `display ${o.fields.join(", ")} on ${nameOf(o.object)}`, sub: `layer ${o.layer}`, object: o.object })),
    ...n.processes.map((p) => ({ text: plural(p.count, "process", "processes"), sub: "stepped by the clock" })),
    ...n.layers.map((l) => ({ text: `world layer: ${plural(l.meshes, "mesh", "meshes")}`, sub: l.onTop ? "on top" : "in the scene" })),
    ...(n.labels.length ? [{ text: plural(n.labels.length, "label"), sub: n.labels.slice(0, 4).map((l) => `“${brief(l.text, 16)}”${l.on ? ` on ${nameOf(l.on)}` : ""}`).join(", ") }] : []),
    ...hands.filter((h) => h.ext === extId).map((h) => ({ text: `${h.kind === "tool" ? "the held tool" : `a ${h.kind}`}: ${h.name}` })),
  ];
  const svc = [
    ...x.services.provides.map((s) => ({ text: `provides ${s.name}`, sub: s.serving ? (s.users.length ? `to ${s.users.join(", ")}` : "nobody uses it here") : "another provider serves it" })),
    ...x.services.uses.map((s) => ({ text: `uses ${s.name}`, sub: s.provider ? `from ${s.provider}` : "nobody provides it here", ...(s.provider ? { ext: s.provider } : {}) })),
  ];
  const surfaces = x.surfaces ? Object.entries(x.surfaces).map(([s, cs]) => ({ text: s, sub: cs.map((c) => verbName.get(c) ?? c).join(", ") })) : [];
  const wrote = more(x.wrote, 12);
  return [
    head,
    ...byTrait,
    ...grid,
    ...(surfaces.length ? [{ id: "surfaces", title: "Verbs by surface", rows: surfaces }] : []),
    { id: "now", title: "Holds now", rows: now, ...(now.length ? {} : { note: "nothing" }) },
    ...(svc.length ? [{ id: "services", title: "Services", rows: svc }] : []),
    { id: "wrote", title: "Last writer of", rows: wrote.shown.map((p) => ({ text: p.join("."), ...(p[0] === "objects" && typeof p[1] === "string" ? { object: p[1] } : {}) })), ...(x.wrote.length ? {} : { note: "nothing it shows here" }), ...(wrote.more ? { more: wrote.more } : {}) },
  ];
}

/** A grid cell: a verb's state for one target. */
const cellOf = (v) => {
  const c = verbChip(v);
  return { text: c.state === "on" ? "✓" : c.state === "far" ? "far" : "✗", state: c.state, title: `${c.text}: ${c.title}` };
};

/** What to outline for an extension: every object carrying one of its traits, by trait (index: the trait's). */
export function extensionOutline(g, extId) {
  const e = g.extensions.find((x) => x.id === extId);
  if (!e) return [];
  const out = [];
  e.traits.filter((t) => t !== "*").forEach((t, index) => {
    for (const c of g.carries) if (c.trait === t && c.object != null && !out.some((o) => o.id === c.object)) out.push({ key: `trait:${c.object}`, id: c.object, role: "trait", index });
  });
  return out;
}

const inspectOf = (g, id) => g.extensions.find((e) => e.id === id)?.inspect ?? null;
const whoList = (v, who, viewer) => (v === "all" ? "everyone" : Array.isArray(v) ? (v.length ? v.map((x) => who(x, x === viewer)).join(", ") : "nobody") : "unknown yet");

/** A route as a row: its type and target, each step a chip, the one that took it marked. */
function routeRow(r, nameOf, ext, older = false) {
  const on = Array.isArray(r.path) && r.path.length ? r.path.map(nameOf).join(" › ") : "nothing";
  return {
    text: `${r.type} on ${on}`,
    sub: r.took < 0 ? "nobody took it" : `taken by ${ext(r.steps[r.took]?.ext ?? "the view")} (${r.steps[r.took]?.step})`,
    chips: r.steps.reduce((out, s, i) => {
      const name = s.ext ? ext(s.ext) : (s.body ?? "");
      const last = out.at(-1);
      // a run of view plugins passed over is one chip
      if (s.step === "plugin" && i !== r.took && last?.plugins) last.plugins.push(name);
      else out.push(s.step === "plugin" && i !== r.took ? { plugins: [name] } : { text: `${s.step} ${name}`.trim(), ...(i === r.took ? { state: "took" } : {}), ...(s.holder ? { title: `holder ${nameOf(s.holder)}` } : {}) });
      return out;
    }, []).map((c) => (c.plugins ? (c.plugins.length === 1 ? { text: `plugin ${c.plugins[0]}` } : { text: `${c.plugins.length} view plugins`, title: c.plugins.join(", ") }) : c)),
    ...(older ? { older: true } : {}),
  };
}

/**
 * The layers on, as panel sections and world badges.
 * @param {object} g
 * @param {string[]} on  layersOn()
 * @param {{ who?, viewer?, routes?: object[], peers?: object, session?: string | null, view?: { body?, hands? } }} [ctx]
 * @returns {{ sections: object[], badges: object[] }}
 */
export function layerSections(g, on, ctx) {
  const { who, viewer, routes = [], peers = {}, session = null, view = null } = ctxOf(ctx);
  const nameOf = objectName(g);
  const ext = extName(g);
  const sections = [];
  const badges = [];
  const has = (id) => id != null && g.objects.some((o) => o.id === id);
  for (const layer of on) {
    if (layer === "claims") {
      sections.push({ id: "claims", title: "Claims", rows: g.claims.map((c) => ({ text: `${c.kind} on ${nameOf(c.object)}`, sub: `${who(c.viewer, c.mine)}${c.ext ? ` · ${ext(c.ext)}` : ""}${c.lapsing ? " · lapsing" : ""}`, state: c.lapsing ? "off" : "on", ...(c.object ? { object: c.object } : {}) })), ...(g.claims.length ? {} : { note: "no claims" }) });
      for (const c of g.claims) if (has(c.object)) badges.push({ key: `claim:${c.object}:${c.kind}`, on: c.object, text: `${c.kind}: ${who(c.viewer, c.mine)}${c.lapsing ? " (lapsing)" : ""}`, kind: "claim" });
    } else if (layer === "poses") {
      sections.push({ id: "poses", title: "Poses", rows: g.poses.map((p) => ({ text: `${nameOf(p.object)}: ${who(p.viewer, p.mine)}`, sub: `rank ${p.rank}${p.yields ? " · yielding" : ""}${p.landed ? " · landed" : ""}${p.ext ? ` · ${ext(p.ext)}` : ""}`, state: p.rank === 0 ? "on" : "off", object: p.object })), ...(g.poses.length ? {} : { note: "nothing held" }) });
      for (const p of g.poses) if (p.rank === 0 && has(p.object)) badges.push({ key: `pose:${p.object}`, on: p.object, text: `held: ${who(p.viewer, p.mine)}${p.yields ? " (yielding)" : ""}`, kind: "pose" });
    } else if (layer === "clock") {
      const c = inspectOf(g, "scene.clock");
      const rows = c
        ? [
            { text: c.running ? "running" : "paused", sub: `t = ${Number(c.t ?? 0).toFixed(1)} s` },
            { text: `computed by ${c.computer ? who(c.computer.viewer, c.computer.mine) : "nobody"}`, sub: c.computing ? "here" : "not here" },
            ...g.processes.map((p) => ({ text: ext(p.ext), sub: plural(p.count, "process", "processes"), ext: p.ext })),
          ]
        : [];
      sections.push({ id: "clock", title: "Clock", rows, ...(c ? {} : { note: "no clock here" }) });
    } else if (layer === "display") {
      const by = new Map();
      for (const o of g.overrides) by.set(o.object, [...(by.get(o.object) ?? []), o]);
      sections.push({ id: "display", title: "Display overrides", rows: [...by].map(([id, os]) => ({ text: nameOf(id), sub: os.map((o) => `${ext(o.ext)} (${o.fields.join(", ")})`).join(" › "), object: id })), ...(by.size ? {} : { note: "nothing shown otherwise" }) });
      for (const [id, os] of by) if (has(id)) badges.push({ key: `display:${id}`, on: id, text: `shown by ${os.map((o) => ext(o.ext)).join(" › ")}`, kind: "display" });
    } else if (layer === "route") {
      const last = routes.at(-1);
      const older = routes.slice(-9, -1).reverse();
      sections.push({ id: "route", title: "Input route", rows: last ? [routeRow(last, nameOf, ext), ...older.map((r) => routeRow(r, nameOf, ext, true))] : [], ...(last ? {} : { note: "no event yet" }) });
    } else if (layer === "links") {
      const l = inspectOf(g, "scene.links");
      const rows = (l?.stages ?? []).map((s) => ({ text: s.path.map(nameOf).join(" › ") || "this scene", sub: `${s.role}${s.open ? " · open" : ` · closed${s.reason ? `: ${s.reason}` : ""}`}`, state: s.open ? "on" : "off", ...(s.path.length === 1 ? { object: s.path[0] } : {}) }));
      sections.push({ id: "links", title: "Links", rows, ...(rows.length ? {} : { note: "no links" }) });
    } else if (layer === "people") {
      const rows = [
        { text: "you", sub: [view?.body?.label ?? "Look", view?.hands?.filter((h) => h.kind !== "popover").at(-1)?.name].filter(Boolean).join(" · ") },
        ...Object.entries(peers)
          .filter(([s]) => s !== session)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([s, p]) => ({ text: who(p?.viewer ?? null, false), sub: [p?.body?.label ?? "Look", p?.held?.name ?? null, `session ${String(s).slice(0, 6)}`].filter(Boolean).join(" · ") })),
      ];
      sections.push({ id: "people", title: "People", rows });
    } else if (layer === "visibility") {
      const a = inspectOf(g, "scene.audience");
      const objs = more(a?.objects ?? []);
      sections.push({ id: "visibility", title: "Visibility (who, never what)", rows: objs.shown.map((o) => ({ text: nameOf(o.id), sub: `may see: ${whoList(o.audience, who, viewer)} · turned toward: ${whoList(o.shown, who, viewer)}${o.veiled ? " · veiled here" : ""}`, object: o.id })), ...(objs.shown.length ? {} : { note: "no policy answers for anything" }), ...(objs.more ? { more: objs.more } : {}) });
      for (const o of a?.objects ?? []) if (has(o.id)) badges.push({ key: `visibility:${o.id}`, on: o.id, text: `sees: ${whoList(o.audience, who, viewer)}`, kind: "visibility" });
    }
  }
  // one badge per object: its layers' texts, in the panel's order
  const merged = new Map();
  for (const b of badges) merged.set(b.on, merged.has(b.on) ? { ...merged.get(b.on), text: `${merged.get(b.on).text} · ${b.text}` } : { ...b, key: `xray:${b.on}` });
  return { sections, badges: [...merged.values()] };
}
