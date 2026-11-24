// The X-ray's models (PLANS.md section 4, "Visible gears"): pure functions
// from a gears value (gears.js) and a few reads the graph doesn't hold (the
// routes, how people are named) to what the world and the panel show. The DOM
// (xray.js) only draws what these say.
//
//   colours(ids)               one colour per extension, stable and distinct
//   responders(g, id)          who responds to an object, in input order
//   lead(g, id)                the most specific of them: the one outline an object has
//   looks(g, colour, o)        how every object is drawn: { tint?, opacity, outline? }
//   glyphs(g, o)               the live state on objects: lock, hand, gear, eye, link
//   legend(g, colour, o)       the extensions by package, with what each holds
//   card(g, id, colour, o)     the hover card of one object
//   details(g, id, colour, o)  its details, folded per extension
//   strip(routes, o)           the last event's route as boxes

import { TOO_FAR } from "../stage/public.js";
import { gearsOfObject } from "./gears.js";

// ── colour ──

/** Twelve colours spread in hue and lightness that read on a light or a dark ground, in an order where neighbouring slots differ (a collision takes the next). */
export const PALETTE = Object.freeze([
  "hsl(215,78%,52%)", // blue
  "hsl(28,92%,50%)", // orange
  "hsl(135,58%,36%)", // green
  "hsl(325,72%,52%)", // pink
  "hsl(48,95%,44%)", // gold
  "hsl(272,62%,58%)", // purple
  "hsl(185,82%,34%)", // teal
  "hsl(0,74%,52%)", // red
  "hsl(245,58%,60%)", // indigo
  "hsl(78,70%,44%)", // lime
  "hsl(300,48%,52%)", // plum
  "hsl(18,52%,42%)", // brown
]);
/** What an extension holding no object is drawn in: no colour of its own, so a colour always means a holder. */
export const NEUTRAL = "hsl(220,9%,52%)";
/** The ghost an object is drawn in while the X-ray looks (a neutral that sits on either ground). */
export const GHOST = "#a4aab3";
/** How much of an object shows: ghosted, nothing responding or not in the lens, and lit. */
export const OPACITY = Object.freeze({ ghost: 0.42, faded: 0.12, lit: 1 });
/** Most bands an outline has (more holders are in the hover card). */
export const BANDS = 3;

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * A colour for each id: the palette's slot its hash says, the next free one
 * when that is taken (ids sorted first, so the same set always gets the same
 * colours, and no two share while the palette lasts); any other id is NEUTRAL.
 * Ask for the extensions that hold objects.
 * @param {string[]} ids
 * @returns {(id: string) => string}
 */
export function colours(ids) {
  const taken = new Set();
  const by = new Map();
  for (const id of [...new Set(ids)].sort()) {
    let k = hash(id) % PALETTE.length;
    for (let i = 0; i < PALETTE.length && taken.has(k); i++) k = (k + 1) % PALETTE.length;
    taken.add(k);
    by.set(id, PALETTE[k]);
  }
  return (id) => by.get(id) ?? NEUTRAL;
}

// ── who responds ──

/** The extensions that respond to an object, in input order: those holding it, not the ones holding only the scene. */
export const responders = (g, id) => (g.chains[id] ?? []).filter((h) => h.via != null).map((h) => h.ext);

/** A generic part: a native one of the scene (its id starts "scene.") or a keeper: they respond to many objects without saying what any of them is. */
export const isGeneric = (g, ext) => ext.startsWith("scene.") || !!g.extensions.find((e) => e.id === ext)?.keeper;

/**
 * The most specific responder to an object: the one that says what it is.
 * Rule: among those responding, a holder that is not a generic part (not a
 * native "scene." one, not a keeper) before one that is; then the nearer to
 * the object (holding it itself before holding what it hangs on or is filed
 * under); then input order. Tabletop for a Lost Cities card or deck (over
 * Carry and the keeper), Carry for a plain carryable. Null when none respond.
 * @param {object} g
 * @param {string} id
 * @returns {string | null}
 */
export function lead(g, id) {
  const hs = (g.chains[id] ?? []).filter((h) => h.via != null);
  const rank = (h) => [isGeneric(g, h.ext) ? 1 : 0, h.depth ?? 0];
  let best = null;
  for (const h of hs) {
    const a = rank(h);
    const b = best && rank(best);
    if (!best || a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best = h;
  }
  return best?.ext ?? null;
}

/**
 * How every object is drawn. Ghosted and outlined once, in the colour of its
 * most specific responder (`lead`); an object nothing responds to fades
 * further; the objects looked at are lit, and those in `banded` (the one
 * hovered) are outlined in the whole chain's colours (up to BANDS, in input
 * order). With an extension isolated, its objects are lit in its colour and
 * everything else is faded.
 * @param {object} g
 * @param {(id: string) => string} colour
 * @param {{ isolated?: string | null, focus?: string | string[] | null, banded?: string | string[] | null }} [o]
 * @returns {{ [id: string]: { tint?: string, opacity: number, outline?: string[] } }}
 */
export function looks(g, colour, { isolated = null, focus = [], banded = [] } = {}) {
  const lit = new Set([focus].flat().filter(Boolean));
  const chain = new Set([banded].flat().filter(Boolean));
  const out = {};
  for (const { id } of g.objects) {
    const by = responders(g, id);
    const first = lead(g, id);
    const bands = (isolated ? by.filter((e) => e === isolated) : chain.has(id) ? by : first ? [first] : []).slice(0, BANDS).map(colour);
    if (lit.has(id)) out[id] = { opacity: OPACITY.lit, ...(bands.length ? { outline: bands } : {}) };
    else if (isolated) out[id] = by.includes(isolated) ? { opacity: OPACITY.lit, outline: bands } : { tint: GHOST, opacity: OPACITY.faded };
    else out[id] = by.length ? { tint: GHOST, opacity: OPACITY.ghost, outline: bands } : { tint: GHOST, opacity: OPACITY.faded };
  }
  return out;
}

// ── live state ──

/** The glyphs, by kind: what they look like, their words. */
export const GLYPHS = Object.freeze({
  lock: { text: "🔒", name: "claimed" },
  hand: { text: "✋", name: "held by someone" },
  gear: { text: "⚙️", name: "driven by a process" },
  eye: { text: "👁", name: "its look is overridden" },
  link: { text: "⛓", name: "a linked scene" },
});
const KINDS = Object.keys(GLYPHS);

/**
 * What is live on each object: a lock (claimed, by whom), a hand (someone
 * holds it), a gear (a process drives it), an eye (its look is overridden by
 * someone other than `self`); and a link drawn as a box.
 * @param {object} g
 * @param {{ who?: (viewer, mine) => string, self?: string, links?: object[] }} [o]  `links`: the links inspect's stages
 * @returns {Map<string | null, { kind: string, title: string }[]>} id → glyphs, in KINDS order; objects with none are absent; null: the scene's own claims
 */
export function glyphs(g, { who = (viewer, mine) => (mine ? "you" : (viewer ?? "someone")), self = null, links = [] } = {}) {
  const out = new Map();
  const add = (id, kind, title) => {
    // (id null: the scene's own, a seat's claim)
    if (id != null && !g.objects.some((o) => o.id === id)) return;
    if (!out.has(id)) out.set(id, []);
    if (!out.get(id).some((x) => x.kind === kind && x.title === title)) out.get(id).push({ kind, title });
  };
  const name = extName(g);
  for (const c of g.claims) add(c.object, "lock", `${c.kind} claimed by ${who(c.viewer, c.mine)}${c.lapsing ? " (lapsing)" : ""}`);
  for (const p of g.poses) if (p.rank === 0) add(p.object, "hand", `held by ${who(p.viewer, p.mine)}${p.yields ? " (yielding)" : ""}`);
  for (const d of g.drives) add(d.object, "gear", `driven by a process of ${name(d.ext)}`);
  for (const o of g.overrides) if (o.ext !== self && o.object != null) add(o.object, "eye", `shown otherwise by ${name(o.ext)} (${o.fields.join(", ")})`);
  const stages = links.filter((s) => s.path?.length === 1);
  for (const s of stages) add(s.path[0], "link", `${s.role}${s.open ? "" : `, closed${s.reason ? `: ${s.reason}` : ""}`}`);
  for (const [id, list] of out) out.set(id, list.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)));
  return out;
}

// ── names ──

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
const extName = (g) => {
  const names = new Map(g.extensions.map((e) => [e.id, e.name]));
  return (id) => names.get(id) ?? id;
};
const objectName = (g) => {
  const count = new Map();
  for (const o of g.objects) count.set(o.name, (count.get(o.name) ?? 0) + 1);
  const names = new Map(g.objects.map((o) => [o.id, count.get(o.name) > 1 ? `${o.name} ${o.id}` : o.name]));
  return (id) => (id == null ? "the scene" : (names.get(id) ?? id));
};

/** A verb as a keycap: its label, its key, enabled, disabled with why, or out of reach. */
export function verbChip(v) {
  const state = v.enabled ? "on" : v.reason === TOO_FAR ? "far" : "off";
  const key = v.keys?.[0] ? (v.keys[0].length === 1 ? v.keys[0].toUpperCase() : v.keys[0]) : null;
  const why = state === "far" ? "out of reach" : state === "off" ? `disabled${v.reason ? `: ${v.reason}` : ""}` : "enabled";
  return { text: v.label ?? v.name, key, state, title: why };
}

// ── the legend ──

/**
 * The running extensions by package, each with a colour and how many objects
 * it holds; the ones holding nothing folded into `idle`; what failed or is
 * missing, to show first. A row is `on` while it is the isolated one.
 * @param {object} g
 * @param {(id: string) => string} colour
 * @param {{ isolated?: string | null }} [o]
 */
export function legend(g, colour, { isolated = null } = {}) {
  const count = new Map();
  for (const h of g.holds) if (h.via != null) count.set(h.ext, (count.get(h.ext) ?? 0) + 1);
  const exts = g.extensions.filter((e) => e.kind === "extension" && e.state === "running");
  const row = (e) => ({ ext: e.id, name: e.name, colour: colour(e.id), count: count.get(e.id) ?? 0, on: e.id === isolated });
  const groups = [];
  for (const e of exts.filter((x) => count.has(x.id))) {
    const label = shortPackage(e.package);
    let grp = groups.find((x) => x.label === label);
    if (!grp) groups.push((grp = { label, rows: [] }));
    grp.rows.push(row(e));
  }
  const nr = g.notRunning;
  return {
    problems: [
      ...nr.failed.map((f) => ({ text: extName(g)(f.id), why: `failed: ${f.error}` })),
      ...nr.packages.map((p) => ({ text: shortPackage(p), why: "package not loaded here" })),
    ],
    groups,
    idle: exts.filter((x) => !count.has(x.id)).map((e) => ({ ext: e.id, name: e.name, colour: colour(e.id) })),
  };
}

// ── the hover card and the details ──

/**
 * What an object is and who acts on it: its traits as chips (coloured as the
 * extension declaring one), the responding chain in input order each with its
 * verbs, the view plugins with a verb for it, and what is live on it. Nothing
 * that doesn't act on it. Null for an object the stage doesn't have.
 * @param {object} g
 * @param {string} id
 * @param {(id: string) => string} colour
 * @param {{ who?, self?, links? }} [o]  as glyphs
 */
export function card(g, id, colour, o = {}) {
  const x = gearsOfObject(g, id);
  if (!x) return null;
  const name = extName(g);
  const chainOf = (list) => list.map((h) => ({ ext: h.ext, name: name(h.ext), colour: colour(h.ext), verbs: h.verbs.map(verbChip) }));
  return {
    id,
    title: objectName(g)(id),
    traits: x.traits.map((t) => ({ text: t.trait, ...(t.by[0] && g.extensions.some((e) => e.id === t.by[0] && e.state === "running") ? { colour: colour(t.by[0]) } : {}) })),
    chain: chainOf(x.holders.filter((h) => h.via != null)),
    plugins: chainOf(x.views.filter((h) => h.verbs.length)),
    live: glyphs(g, o).get(id) ?? [],
  };
}

/**
 * An object's details, folded per extension: how each holds it (package,
 * version, verbs, events, drawing, services), and what holds it now and who
 * last wrote its fields.
 * @param {object} g
 * @param {string} id
 * @param {(id: string) => string} colour
 * @param {{ who? }} [o]
 */
export function details(g, id, colour, { who = (viewer, mine) => (mine ? "you" : (viewer ?? "someone")) } = {}) {
  const x = gearsOfObject(g, id);
  if (!x) return null;
  const name = extName(g);
  const nameOf = objectName(g);
  const fold = (h) => {
    const e = g.extensions.find((y) => y.id === h.ext);
    const version = shortVersion(h.version);
    const how = h.kind === "holder" ? (h.depth === 0 ? "holds it" : `holds ${nameOf(h.via)}`) : h.kind === "view" ? "view plugin" : "a verb for it";
    const draws = [...h.draws.labels.map((l) => `label “${brief(l.text, 24)}”`), ...h.draws.overrides.map((d) => `display ${d.fields.join(", ")}`)];
    return {
      ext: h.ext,
      name: e?.name ?? h.ext,
      colour: colour(h.ext),
      sub: `${how} · ${shortPackage(h.package)}${version ? `@${version}` : ""}`,
      verbs: h.verbs.map(verbChip),
      lines: [
        ...(h.events.length ? [`takes ${h.events.join(", ")}`] : []),
        ...(draws.length ? [`draws here: ${draws.join("; ")}`] : []),
        ...(h.services.provides.length ? [`provides ${h.services.provides.join(", ")}`] : []),
        ...(h.services.uses.length ? [`uses ${h.services.uses.join(", ")}`] : []),
      ],
    };
  };
  const now = [
    ...x.claims.map((c) => `claim ${c.kind}: ${who(c.viewer, c.mine)}${c.lapsing ? " (lapsing)" : ""}`),
    ...x.poses.map((p) => `pose held by ${who(p.viewer, p.mine)}, rank ${p.rank}${p.rank === 0 ? " (counts)" : ""}${p.yields ? ", yielding" : ""}${p.landed ? ", landed" : ""}`),
    ...x.overrides.map((d) => `display ${d.fields.join(", ")}: ${name(d.ext)}`),
  ];
  const wrote = g.provenance.filter((p) => p.path[0] === "objects" && p.path[1] === id && p.path.length >= 3).map((p) => `${p.path.slice(2).join(".")}: ${p.ext ? name(p.ext) : p.kernel ? `the kernel (${p.kernel})` : "unstamped"}`);
  return {
    id,
    title: nameOf(id),
    folds: [...x.holders.filter((h) => h.via != null), ...x.views.filter((h) => h.verbs.length || h.draws.labels.length || h.draws.overrides.length), ...x.others].map(fold),
    now,
    wrote,
  };
}

// ── the route strip ──

const BOX = [
  ["hand", "Tools"],
  ["widget", "Widget"],
  ["holder", "Holders"],
  ["plugin", "View plugins"],
  ["body", "Body"],
  ["default", "Default"],
];
const boxOf = (step) => (step === "gesture" || step === "hand" ? "hand" : step === "widget" ? "widget" : step === "plugin" ? "plugin" : step === "holder" ? "holder" : step === "default" ? "default" : "body");

/**
 * An event's route as boxes in the chain's order (Tools, Widget, the holders,
 * View plugins, Body), each with who was offered it, the one that took it
 * marked (and in its colour).
 * @param {{ type, path, steps, took }} r  api.routes()'s
 * @param {{ g: object, colour: (id: string) => string }} o
 */
export function routeBoxes(r, { g, colour }) {
  const ext = extName(g);
  const nameOf = objectName(g);
  const names = (s) => (s.ext ? ext(s.ext) : (s.name ?? s.body ?? s.step));
  const boxes = BOX.map(([kind, label]) => ({ kind, label, names: [], took: null }));
  r.steps.forEach((s, i) => {
    const b = boxes.find((x) => x.kind === boxOf(s.step));
    b.names.push(names(s));
    if (i === r.took) b.took = { name: names(s), ...(s.ext ? { colour: colour(s.ext) } : {}) };
  });
  const on = Array.isArray(r.path) && r.path.length ? r.path.map(nameOf).join(" › ") : "nothing";
  return { type: r.type, on, took: r.took >= 0, boxes: boxes.filter((b) => b.names.length) };
}

/** The latest route (taken or not), and up to five earlier ones something took, newest first. */
export function strip(routes, o) {
  const taken = routes.slice(0, -1).filter((r) => r.took >= 0);
  return { last: routes.length ? routeBoxes(routes[routes.length - 1], o) : null, older: taken.slice(-5).reverse().map((r) => routeBoxes(r, o)) };
}
