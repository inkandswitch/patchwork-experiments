// Where this package comes from, for the die docs it makes whole (a part
// dropped into a scene makes one): each carries it as
// `@patchwork.suggestedImportUrl`, so a viewer with nothing installed who
// opens the die is offered this package (scene/STAGE.md, "Packages": the
// documents objects are made from are opened by their own tools, through
// Patchwork's own suggested import). Read at runtime from the plugin
// registry: the registered "die" datatype's (else tool's) importUrl.
//
// The URL rule is the scene's own (scene/src/packages.js packageUrl), copied
// as tabletop/src/scene-package.js copies it: packages don't import each
// other. This package makes no scene docs, only die docs, so it names itself
// here and never the scene package.

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
 * → bare; `https:` on a public host → itself, without its fragment; anything
 * else (`http:`, localhost or a private address, `blob:`, `data:`, a relative
 * path) → null.
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
 * A new die doc's `@patchwork`: its type, and where this package comes from
 * when that can be shared.
 * @param {unknown} importUrl  this package's importUrl, as registered
 */
export function diePatchwork(importUrl) {
  const url = shareableImportUrl(importUrl);
  return url ? { type: "die", suggestedImportUrl: url } : { type: "die" };
}

/** This package's importUrl as registered (its datatype's, else its tool's), or null. */
export async function ownImportUrl() {
  try {
    const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
    for (const type of ["patchwork:datatype", "patchwork:tool"]) {
      const p = getRegistry(type)?.filter?.((x) => x?.id === "die")?.[0];
      if (typeof p?.importUrl === "string") return p.importUrl;
    }
  } catch {
    // no registry: nothing to say
  }
  return null;
}
