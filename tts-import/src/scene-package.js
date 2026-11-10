// Where the scene package comes from, for the scene docs this package makes
// whole: every scene doc carries it as `@patchwork.suggestedImportUrl`, so a
// viewer with nothing installed is offered the scene tool (scene/STAGE.md,
// "Packages"). Read at runtime from the plugin registry: the registered
// "scene" datatype's (else tool's) importUrl. No build-time tie to the scene
// package; without it registered there is nothing to say, and the stage
// fills the field in when someone who has it opens the doc.
//
// tabletop and tts-import each carry a copy of this file (packages don't
// import each other); keep the copies the same. The URL rule is the scene's
// own (scene/src/packages.js packageUrl).

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
 * A new scene doc's `@patchwork`: its type, and where the scene package
 * comes from when that can be shared.
 * @param {unknown} importUrl  the scene package's importUrl, as registered
 */
export function scenePatchwork(importUrl) {
  const url = shareableImportUrl(importUrl);
  return url ? { type: "scene", suggestedImportUrl: url } : { type: "scene" };
}

/** The registered scene package's importUrl (its datatype's, else its tool's), or null. */
export async function sceneImportUrl() {
  try {
    const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
    for (const type of ["patchwork:datatype", "patchwork:tool"]) {
      const p = getRegistry(type)?.filter?.((x) => x?.id === "scene")?.[0];
      if (typeof p?.importUrl === "string") return p.importUrl;
    }
  } catch {
    // no registry: nothing to say
  }
  return null;
}
