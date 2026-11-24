// Where a doc's package comes from, for the docs this package makes whole:
// each carries it as `@patchwork.suggestedImportUrl`, so a viewer with
// nothing installed is offered its tool (scene/STAGE.md, "Packages"). A
// scene doc names the scene package; a die or a bag doc names this one.
// Read at runtime from the plugin registry: the registered datatype's (else
// tool's) importUrl. No build-time tie to the scene package. A scene doc
// falls back to where the scene is published (PUBLISHED, below), so one made
// with the scene not installed here still offers it; a die or bag doc
// without its package registered says only its type. The URL rule is the
// scene's own (scene/src/packages.js packageUrl).

/** A host only this machine or this network can reach. */
function isLocalHost(hostname) {
  const h = String(hostname ?? "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return !h.includes(".");
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The package an importUrl names, in the form a doc may carry; null when
 * another viewer couldn't load it. `automerge:<id>`, with or without heads
 * (the module watcher registers a package at the heads it loaded) → bare
 * (the version is not kept: no `frozenImportUrl`); `https:` on a public host
 * → itself, without its fragment; anything else (`http:`, localhost or a
 * private address, `blob:`, `data:`, a relative path) → null.
 * @param {unknown} url
 * @returns {string | null}
 */
export function shareableImportUrl(url) {
  if (typeof url !== "string") return null;
  const s = url.trim();
  const m = /^automerge:([1-9A-HJ-NP-Za-km-z]{20,60})(#[^/?\s]*)?$/.exec(s);
  if (m) return `automerge:${m[1]}`;
  if (/^automerge:/i.test(s)) return null;
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

/**
 * A new doc's `@patchwork`: its type, and where its package comes from when
 * that can be shared.
 * @param {string} type  @param {unknown} importUrl  its package's importUrl, as registered
 */
export function patchworkOf(type, importUrl) {
  const url = shareableImportUrl(importUrl);
  return url ? { type, suggestedImportUrl: url } : { type };
}
export const scenePatchwork = (importUrl) => patchworkOf("scene", importUrl);

/** The importUrl of the package that registered datatype `id` (else tool `id`), or null. */
export async function importUrlOf(id) {
  try {
    const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
    for (const type of ["patchwork:datatype", "patchwork:tool"]) {
      const p = getRegistry(type)?.filter?.((x) => x?.id === id)?.[0];
      if (typeof p?.importUrl === "string") return p.importUrl;
    }
  } catch {
    // no registry: nothing to say
  }
  return null;
}
export const sceneImportUrl = () => importUrlOf("scene");

// ─── the packages a scene doc made here lists ───────────────────────────────
//
// A scene doc this package writes whole (a session, a game part's own doc, a
// bag's new scene) or lays a table out in (a template) names the packages it
// needs in `packages` (scene/STAGE.md, "Packages") and the scene package as
// its suggested import, as the publishers' scenes do (probes/scene-packages.mjs),
// so a viewer with only this package installed is offered the scene, and the
// scene then offers the rest. The stage keeps the list after that.

/**
 * Where each package is published: its pushwork rootUrl (`rootUrl` in
 * <package>/.pushwork/config.json, what `pushwork url` prints there). Copied
 * here as data, since packages don't import each other: each must match the
 * URL that package is published at (scene-package.test.js checks them
 * against the configs when the siblings are checked out beside this one).
 * Used where the registry can't say: the package isn't installed here, or is
 * loaded from somewhere nobody else can reach (a dev server).
 */
export const PUBLISHED = Object.freeze({
  scene: "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F",
  seats: "automerge:2rZNSyrVf5YKPTGLAHuqso4BxoXJ",
  tabletop: "automerge:3uPxcveQxJkJ6D2GKPnrS7uTh2h2",
});

/**
 * Each package's URL as a doc made now should name it: where the registry
 * says it was loaded from, when another viewer could load that, else where
 * it is published. The scene's and this one's, always; the seats' owner's
 * when given (`seatsBy`, the `roster` plugin that laid a table's seats:
 * made-with.js prepareTable), which is whoever registered it, the seats
 * package's published URL only for the seats package itself (registered as
 * `seats`): a table meets seats through the convention, not by name.
 * @param {{ seatsBy?: { id?: string, importUrl?: string } | null }} [o]
 * @returns {Promise<{ scene: string, tabletop: string, seats?: string }>}
 */
export async function packageUrls({ seatsBy = null } = {}) {
  const out = {
    scene: shareableImportUrl(await importUrlOf("scene")) ?? PUBLISHED.scene,
    tabletop: shareableImportUrl(await importUrlOf("tabletop-game")) ?? PUBLISHED.tabletop,
  };
  const seats = seatsBy ? (shareableImportUrl(seatsBy.importUrl) ?? (seatsBy.id === "seats" ? PUBLISHED.seats : null)) : null;
  return seats ? { ...out, seats } : out;
}

// What this package answers in a scene doc: its traits (tabletop.*, dice.*,
// bag.*, keep.*, card-table.*) and its sources. scene-package.test.js checks
// every trait and source index.js registers is one of these.
const OWN_TRAIT = /^(tabletop|dice|bag|keep|card-table)\./;
export const OWN_SOURCES = Object.freeze(["die", "bag-sack"]);

const traitKeys = (o) => (o?.traits && typeof o.traits === "object" ? Object.keys(o.traits) : []);

/**
 * Whether a scene doc calls for this package (scene/src/packages.js
 * neededPlugins, answered by what it registers): the doc or an object has
 * one of its traits, or an object is built by one of its sources. Pure.
 * @param {object} doc
 */
export function callsForTabletop(doc) {
  const objects = Object.values(doc?.objects && typeof doc.objects === "object" ? doc.objects : {});
  return [doc, ...objects].some((o) => traitKeys(o).some((k) => OWN_TRAIT.test(k))) || objects.some((o) => OWN_SOURCES.includes(o?.providerId));
}

/**
 * Name the packages a scene doc (or a change's draft of one) needs, at these
 * URLs (packageUrls): the scene package as its suggested import where it has
 * none another viewer could load, and in `packages` the scene's, the seats'
 * owner's (given where it laid seats here), and this one's where the doc
 * calls for it (exactly what it calls for, since the stage takes a listed
 * package nothing calls for off the list), each appended unless an entry
 * names it already (at heads or not). Only a list the doc was made with is
 * touched (scene/CONVENTIONS.md, "Shared maps"); nothing is taken off.
 * @param {object} d  @param {{ scene?: string, seats?: string, tabletop?: string }} urls
 */
export function namePackages(d, urls) {
  const pw = d?.["@patchwork"];
  if (pw && typeof pw === "object" && !shareableImportUrl(pw.suggestedImportUrl) && urls.scene) pw.suggestedImportUrl = urls.scene;
  if (!Array.isArray(d?.packages)) return;
  for (const url of [urls.scene, urls.seats, callsForTabletop(d) ? urls.tabletop : null]) {
    if (url && !d.packages.some((e) => shareableImportUrl(e?.url) === url)) d.packages.push({ url });
  }
}
