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
 * and traits, found above.
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
 * What a registry hands out: of the plugins in its list (registry order),
 * the last registered under each id. Two packages registering one id (a
 * retired package and the one that took its plugins over, both installed)
 * leave one plugin under it, the later; the earlier is shadowed: it is
 * installed here and runs nowhere. (Patchwork's registry lists one per id;
 * a list naming an id twice is read as registered in that order, as
 * activation reads it.)
 * @param {object[]} list
 * @returns {object[]}
 */
export function handedOut(list) {
  const metas = Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string") : [];
  const last = new Map(metas.map((p) => [p.id, p]));
  return metas.filter((p) => last.get(p.id) === p);
}

/**
 * The registered plugins that answer the doc's needs: `[{ type, id,
 * importUrl }]`, each once. Only what runs answers (handedOut): a source by
 * its id, the plugin the registry hands out under it; an extension when the
 * doc has one of its traits (every one that does: each runs). So of two
 * packages registering one id, only the one whose plugin runs answers, in
 * whichever order they registered. An extension of every doc
 * (`traits: ["*"]`) runs wherever it is installed and answers no need: no
 * doc calls for it by having it (STAGE.md, "Packages"). What isn't
 * registered answers nothing: only a viewer who has a plugin can say where
 * it comes from.
 * @param {object} doc
 * @param {{ [type: string]: object[] }} registries  each registry's metadata, registry order
 * @param {{ providerIds?: Iterable<string> }} [extra]
 * @returns {{ type: string, id: string, importUrl: string | null }[]}
 */
export function answeringPlugins(doc, registries, extra = {}) {
  const out = new Map();
  for (const need of neededPlugins(doc, extra)) for (const p of answersTo(need, registries)) {
    const importUrl = typeof p.importUrl === "string" ? p.importUrl : null;
    const key = `${need.type}\u0000${p.id}\u0000${importUrl}`;
    if (!out.has(key)) out.set(key, { type: need.type, id: p.id, importUrl });
  }
  return [...out.values()];
}

/** The registered plugins answering one need (answeringPlugins). */
function answersTo(need, registries) {
  const metas = handedOut(registries?.[need.type]);
  return need.type === "scene:source" ? metas.filter((p) => p.id === need.id) : metas.filter((p) => strings(p.traits).includes(need.trait));
}

/**
 * The doc's needs no plugin registered here answers (neededPlugins, each
 * with no answer in answeringPlugins' sense). While there is one, this
 * viewer can't tell what answers it elsewhere, so it prunes nothing.
 * @param {object} doc
 * @param {{ [type: string]: object[] }} registries
 * @param {{ providerIds?: Iterable<string> }} [extra]
 */
export function unansweredNeeds(doc, registries, extra = {}) {
  return neededPlugins(doc, extra).filter((need) => answersTo(need, registries).length === 0);
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
 * The reconcile rule's first half: the package URLs to add to the doc's
 * list now (packagesToPrune, below, is the other). Every package a
 * registered plugin answering the doc's needs comes from, that can be
 * shared and isn't listed. Parts and templates count by what they make:
 * objects and traits, which are needs like any other. Empty when the doc
 * has no list: the list is made with the doc, never here (CONVENTIONS.md,
 * "Shared maps").
 * @param {{ doc: object, registries: object, providerIds?: Iterable<string> }} o
 * @returns {string[]}
 */
export function packagesToList({ doc, registries, providerIds = [] }) {
  if (!Array.isArray(doc?.packages)) return [];
  const listed = new Set(listedPackages(doc));
  return packagesOf(answeringPlugins(doc, registries, { providerIds })).filter((url) => !listed.has(url));
}

/**
 * The prune rule, reconcile's other half: the listed packages to take off
 * the doc's list now, in list order. The list names the packages whose
 * plugins run for the doc (answeringPlugins: of two answering one need by
 * one id, only the one handed out). Nothing goes while any need of the
 * doc's is answered by nothing here (unansweredNeeds): a package listed
 * for it may be what answers it elsewhere (another version of a package,
 * or one this viewer lacks under the URL listed). Otherwise a listed
 * package goes when:
 *   1. none of its plugins answers a need of the doc's here (answeringPlugins,
 *      with the providers render docs asked for), and either
 *      a. it is registered here (registeredPackages, shadowed or not), or
 *      b. it isn't, and every need is answered here by a package that can be
 *         named (packageUrl), and every render doc has said which provider it
 *         names: whatever it was listed for, another listed package answers
 *         now (a retired package listed by a viewer who had it running, its
 *         plugins since taken over). A need answered from a dev server's
 *         copy names nothing, so then the listed one may be the same
 *         package, published: it stays;
 *   2. it isn't the scene package (scenePackage), nor the doc's suggested
 *      import (`@patchwork.suggestedImportUrl`): the stage itself;
 *   3. while some render doc built here hasn't said which provider it names
 *      (`rendersKnown` false), it registers no source: a render doc may
 *      name any provider, its object's field notwithstanding.
 * So it never drops one that answers a need, nor one missing here while
 * this viewer can't say what answers each need in its place, and it is a
 * function of the doc and this viewer's registry alone. Each doc lists
 * only its own packages, so its own needs are the whole question. Empty
 * when the doc has no list.
 * @param {{ doc: object, registries: object, providerIds?: Iterable<string>, rendersKnown?: boolean }} o
 * @returns {string[]}
 */
export function packagesToPrune({ doc, registries, providerIds = [], rendersKnown = true }) {
  if (!Array.isArray(doc?.packages)) return [];
  const ids = [...providerIds];
  if (unansweredNeeds(doc, registries, { providerIds: ids }).length) return [];
  const registered = registeredPackages(registries);
  const answering = answeringPlugins(doc, registries, { providerIds: ids });
  const keep = new Set([...packagesOf(answering), ...[scenePackage(registries), packageUrl(doc?.["@patchwork"]?.suggestedImportUrl)].filter(Boolean)]);
  if (!rendersKnown) for (const url of packagesOf(Array.isArray(registries?.["scene:source"]) ? registries["scene:source"] : [])) keep.add(url);
  // (1b) every need answered by a plugin from a package that can be named
  const named = rendersKnown && neededPlugins(doc, { providerIds: ids }).every((need) => answersTo(need, registries).some((p) => packageUrl(p.importUrl)));
  return listedPackages(doc).filter((url) => !keep.has(url) && (registered.has(url) || named));
}

/**
 * One reconcile pass: what to write to the doc's list now. `prune: false`
 * (before the registry has gone quiet) only adds. A function of the doc and
 * this viewer's registry: at its fixed point the list is
 *   answering ∪ (listed ∩ ({scene package, suggested import} ∪ kept)),
 * where kept is every listed package while a need goes unanswered here,
 * the source packages while a render doc hasn't reported, and the
 * unregistered ones while either of those holds or a need is answered only
 * by a package that can't be named (packagesToPrune).
 * @param {{ doc: object, registries: object, providerIds?: Iterable<string>, rendersKnown?: boolean, prune?: boolean }} o
 * @returns {{ add: string[], prune: string[] }}
 */
export function reconcileList({ doc, registries, providerIds = [], rendersKnown = true, prune = true }) {
  const ids = [...providerIds];
  return {
    add: packagesToList({ doc, registries, providerIds: ids }),
    prune: prune ? packagesToPrune({ doc, registries, providerIds: ids, rendersKnown }) : [],
  };
}

/**
 * Reconcile's write, inside a change of the doc (`d`, the draft): every
 * entry naming a package in `prune` removed, however it names it (twice, at
 * heads), then `{ url }` appended for each in `add` that no entry names as
 * it is. Only a list the doc was made with is touched (STAGE.md, "Shared
 * maps"). The two never meet: `add` is what isn't listed, `prune` what is.
 * @param {object} d
 * @param {{ add?: string[], prune?: string[] }} o
 */
export function changeList(d, { add = [], prune = [] }) {
  if (!Array.isArray(d?.packages)) return;
  const gone = new Set(prune);
  for (let i = d.packages.length - 1; i >= 0; i--) if (gone.has(packageUrl(d.packages[i]?.url))) d.packages.splice(i, 1);
  for (const url of add) if (!d.packages.some((e) => e?.url === url)) d.packages.push({ url });
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
