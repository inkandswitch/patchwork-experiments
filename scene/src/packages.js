// The packages a scene's contents come from (STAGE.md, "Packages"): the list
// on the doc (`doc.packages`), what the doc calls for in the plugin registry,
// which of the registered plugins answer that, and which listed packages
// this viewer doesn't have. Pure. The stage's side is src/stage/packages.js.

import { parseAutomergeLink } from "./dnd.js";
import { traitKeys } from "./stage/activation.js";

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);

// ─── which URLs may be listed, and loaded ───────────────────────────────────

/** A host only this machine or this network can reach: nothing to share. */
export function isLocalHost(hostname) {
  const h = String(hostname ?? "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10)
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return !h.includes("."); // a bare machine name ("devbox") is this network's
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The package a plugin's importUrl (or a list entry's url) names, in the one
 * form the list holds and everything is compared in; null when it names
 * nothing another viewer could load. The rule (STAGE.md, "Packages"):
 *   - `automerge:<id>`, with or without heads (`#h1|h2`: the module watcher
 *     registers a package at the heads it loaded) → `automerge:<id>`, bare;
 *   - `https://host/path` on a host that isn't local → itself, without its
 *     fragment;
 *   - everything else is null: `http:` (a dev server, or code anyone on the
 *     way could swap), `https:` on localhost or a private address, `blob:`,
 *     `data:`, `javascript:`, a relative path, anything that isn't a string.
 * @param {unknown} url
 * @returns {string | null}
 */
export function packageUrl(url) {
  if (typeof url !== "string") return null;
  const s = url.trim();
  if (!s) return null;
  if (/^automerge:/i.test(s)) {
    // only the plain form: `automerge:<id>`, an optional `#heads`, nothing else
    const link = /^automerge:[^/?#\s]+(#[^/?\s]*)?$/.test(s) ? parseAutomergeLink(s) : null;
    return link?.url ?? null;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || isLocalHost(u.hostname)) return null;
  u.hash = "";
  return u.href;
}

// ─── the list ───────────────────────────────────────────────────────────────

/**
 * The packages the doc lists: each entry's package URL, once, in the order
 * first listed. Two peers adding the same package at once leave it listed
 * twice, so every reader reads through this; an entry that names nothing
 * loadable (above) is not there. A doc without the list has none.
 * @param {object} doc
 * @returns {string[]}
 */
export function listedPackages(doc) {
  const out = [];
  for (const e of Array.isArray(doc?.packages) ? doc.packages : []) {
    const url = packageUrl(e?.url);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

// ─── what the doc calls for ─────────────────────────────────────────────────

/**
 * Everything in the doc that is answered by looking in the plugin registry,
 * each once, in a fixed order:
 *   - `{ type: "scene:source", id }`: an object's `providerId` (the render
 *     manager loads it to build the object; the handles part reads it). Any
 *     id in `extra.providerIds` too: the providers the stage has been asked
 *     for by render docs themselves, which hold their own copy.
 *   - `{ type: "scene:extension", trait }`: a trait key on the scene or on an
 *     object (activation: an extension runs when the doc has one of its
 *     traits). Where the doc starts people (`view.start`) needs nothing of
 *     its own: a start body's place carries the trait its package reads (a
 *     spawn point's `walk.spawn`, a table's `seats`).
 * Parts and templates leave no mark of their own: what they make is objects
 * and traits, found above (the stage notes the part or template itself when
 * one is run: src/stage/packages.js).
 * @param {object} doc
 * @param {{ providerIds?: Iterable<string> }} [extra]
 * @returns {({ type: "scene:source", id: string } | { type: "scene:extension", trait: string })[]}
 */
export function neededPlugins(doc, extra = {}) {
  const sources = new Set();
  const traits = new Set();
  for (const k of traitKeys(doc)) traits.add(k);
  for (const o of Object.values(doc?.objects && typeof doc.objects === "object" ? doc.objects : {})) {
    if (!o || typeof o !== "object") continue;
    if (typeof o.providerId === "string" && o.providerId) sources.add(o.providerId);
    for (const k of traitKeys(o)) traits.add(k);
  }
  for (const id of extra.providerIds ?? []) if (typeof id === "string" && id) sources.add(id);
  const out = [];
  for (const id of [...sources].sort()) out.push({ type: "scene:source", id });
  for (const trait of [...traits].sort()) out.push({ type: "scene:extension", trait });
  return out;
}

/**
 * The registered plugins that answer the doc's needs: `[{ type, id,
 * importUrl }]`, each once. A source by its id; an extension when the doc
 * has one of its traits (what activation's docReason asks). What isn't
 * registered answers nothing: only a viewer who has a plugin can say where
 * it comes from.
 * @param {object} doc
 * @param {{ [type: string]: object[] }} registries  each registry's metadata, registry order
 * @param {{ providerIds?: Iterable<string> }} [extra]
 * @returns {{ type: string, id: string, importUrl: string | null }[]}
 */
export function answeringPlugins(doc, registries, extra = {}) {
  const metasOf = (type) => (Array.isArray(registries?.[type]) ? registries[type].filter((p) => p && typeof p.id === "string") : []);
  const sources = new Map(metasOf("scene:source").map((p) => [p.id, p]));
  const extensions = metasOf("scene:extension");
  const out = new Map();
  const add = (type, p) => {
    const key = `${type}\u0000${p.id}`;
    if (!out.has(key)) out.set(key, { type, id: p.id, importUrl: typeof p.importUrl === "string" ? p.importUrl : null });
  };
  for (const need of neededPlugins(doc, extra)) {
    if (need.type === "scene:source") {
      if (sources.has(need.id)) add(need.type, sources.get(need.id));
    } else {
      for (const p of extensions) if (strings(p.traits).includes(need.trait)) add(need.type, p);
    }
  }
  return [...out.values()];
}

/** The packages these plugins come from: each plugin's package URL (packageUrl of its importUrl), once. */
export function packagesOf(plugins) {
  const out = [];
  for (const p of plugins ?? []) {
    const url = packageUrl(p?.importUrl);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The reconcile rule: the package URLs to add to the doc's list now. Every
 * package a registered plugin answering the doc's needs comes from (and
 * every one in `used`: the parts and templates run in this view), that can
 * be shared and isn't listed. Empty when the doc has no list: the list is
 * made with the doc, never here (STAGE.md, "Shared maps").
 * @param {{ doc: object, registries: object, used?: Iterable<string>, providerIds?: Iterable<string> }} o
 * @returns {string[]}
 */
export function packagesToList({ doc, registries, used = [], providerIds = [] }) {
  if (!Array.isArray(doc?.packages)) return [];
  const listed = new Set(listedPackages(doc));
  const out = [];
  const want = [...packagesOf(answeringPlugins(doc, registries, { providerIds })), ...packagesOf([...used].map((importUrl) => ({ importUrl })))];
  for (const url of want) if (!listed.has(url) && !out.includes(url)) out.push(url);
  return out;
}

// ─── the scene package itself ───────────────────────────────────────────────

/**
 * Where the scene package comes from here: the package URL of the registered
 * "scene" datatype (else the "scene" tool), or null when it can't be shared
 * (a dev server's copy) or isn't registered with one.
 * @param {{ [type: string]: object[] }} registries
 * @returns {string | null}
 */
export function scenePackage(registries) {
  for (const type of ["patchwork:datatype", "patchwork:tool"]) {
    const list = Array.isArray(registries?.[type]) ? registries[type] : [];
    const url = packageUrl(list.find((p) => p?.id === "scene")?.importUrl);
    if (url) return url;
  }
  return null;
}

/**
 * The `@patchwork.suggestedImportUrl` to write on this scene doc now, or
 * null. A scene's suggested import is the scene package (it is how a viewer
 * with nothing installed gets the stage, which gets them the rest), bare.
 * It's written when the doc has an `@patchwork` map and names nothing
 * loadable there (no field, or a dev server's URL), and the scene package
 * here can be shared. One that names something loadable is never replaced,
 * so two viewers with the scene package from different places don't take
 * turns.
 * @param {object} doc
 * @param {{ [type: string]: object[] }} registries
 * @returns {string | null}
 */
export function suggestedImportToSet(doc, registries) {
  const meta = doc?.["@patchwork"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  if (packageUrl(meta.suggestedImportUrl)) return null;
  return scenePackage(registries);
}

// ─── what this viewer doesn't have ──────────────────────────────────────────

/**
 * The packages registered here: the package URL of every plugin in every
 * registry, as a set.
 * @param {{ [type: string]: object[] }} registries
 * @returns {Set<string>}
 */
export function registeredPackages(registries) {
  const out = new Set();
  for (const list of Object.values(registries ?? {})) for (const url of packagesOf(Array.isArray(list) ? list : [])) out.add(url);
  return out;
}

/**
 * The listed packages none of whose plugins is registered here, in list order.
 * @param {object} doc
 * @param {Set<string>} registered  registeredPackages(…)
 * @returns {string[]}
 */
export function missingPackages(doc, registered) {
  return listedPackages(doc).filter((url) => !registered.has(url));
}

/**
 * What to do about each missing package, by what this view knows of it. Each
 * url lands in exactly one list:
 *   loading  it's being loaded now (here, or by another scene on the page);
 *   failed   its last load failed (shown with the error until tried again);
 *   load     the viewer accepted it before (remembered): load it, unasked;
 *   quiet    the viewer said "Not now" in this view: not asked again until the scene is opened again;
 *   ask      none of those: the prompt.
 * @param {string[]} missing
 * @param {{ loading?: Set<string>, failed?: Map<string, string> | Set<string>, accepted?: Set<string>, declined?: Set<string> }} known
 */
export function triage(missing, { loading = new Set(), failed = new Set(), accepted = new Set(), declined = new Set() } = {}) {
  const out = { loading: [], failed: [], load: [], quiet: [], ask: [] };
  for (const url of missing) {
    const where = loading.has(url) ? "loading" : failed.has(url) ? "failed" : accepted.has(url) ? "load" : declined.has(url) ? "quiet" : "ask";
    out[where].push(url);
  }
  return out;
}

// ─── naming a package for a person ──────────────────────────────────────────

/** A package.json's name for a person: its `title`, else its `name`; null if it has neither. Never trusted: shown beside the URL. */
export function packageTitle(json) {
  let p = json;
  if (typeof json === "string") {
    try {
      p = JSON.parse(json);
    } catch {
      return null;
    }
  }
  for (const k of ["title", "name"]) if (typeof p?.[k] === "string" && p[k].trim()) return p[k].trim().slice(0, 80);
  return null;
}

/** A URL short enough to read: `automerge:2zt6Lbn…R85F`, `https://host/…/last`. The full one goes in a title. */
export function shortUrl(url) {
  const s = String(url ?? "");
  const m = /^automerge:(.+)$/.exec(s);
  if (m) return m[1].length > 14 ? `automerge:${m[1].slice(0, 7)}…${m[1].slice(-4)}` : s;
  return s.length > 48 ? `${s.slice(0, 30)}…${s.slice(-14)}` : s;
}

/** The prompt's sentence. */
export function promptText(n) {
  return n === 1 ? "This scene uses a package you don't have." : `This scene uses ${n} packages you don't have.`;
}

/**
 * Every open doc's packages as one prompt (STAGE.md, "Packages"): the union
 * of the stages' `local.packages`, each URL once, in the order the lists
 * first name it (the view gives them outermost first, by path). A URL any
 * stage asks about is asked about; else one that failed anywhere has
 * failed (the first error said); else it is loading. Its name is the first
 * any stage has. `missing`: some stage misses one. Pure.
 * @param {({ ask?: object[], loading?: object[], failed?: object[], missing?: boolean } | null | undefined)[]} lists
 * @returns {{ ask: object[], loading: object[], failed: object[], missing: boolean }}
 */
export function unionPackages(lists) {
  const RANK = { ask: 0, failed: 1, loading: 2 };
  const by = new Map(); // url → { state, entry }
  let missing = false;
  for (const p of lists) {
    if (!p) continue;
    if (p.missing) missing = true;
    for (const state of ["ask", "failed", "loading"])
      for (const e of p[state] ?? []) {
        if (typeof e?.url !== "string") continue;
        const was = by.get(e.url);
        if (!was) by.set(e.url, { state, entry: e });
        else {
          const name = was.entry.name ?? e.name ?? null;
          const entry = RANK[state] < RANK[was.state] ? e : was.entry;
          by.set(e.url, { state: RANK[state] < RANK[was.state] ? state : was.state, entry: { ...entry, name } });
        }
      }
  }
  const out = { ask: [], loading: [], failed: [] };
  for (const { state, entry } of by.values()) out[state].push(Object.freeze({ ...entry, name: entry.name ?? null }));
  return Object.freeze({ ask: Object.freeze(out.ask), loading: Object.freeze(out.loading), failed: Object.freeze(out.failed), missing: missing || by.size > 0 });
}
