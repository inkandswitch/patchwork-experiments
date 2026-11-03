// Matching a mod's asset URLs to Tabletop Simulator's local cache. Pure.
//
// TTS keeps every asset it has downloaded under Mods/: Models/*.obj,
// Images/*.png|jpg, PDF/*.pdf, Assetbundles/*.unity3d (and Workshop/*.json for
// the mods themselves). A cached file is named after its URL with every
// character that isn't a letter or a digit removed, plus an extension:
//
//   https://steamusercontent-a.akamaihd.net/ugc/1994…/63973E…/
//   → Models/httpssteamusercontentaakamaihdnetugc1994…63973E….obj
//
// Checked against a real cache (Earthborne Rangers: 36 of its 47 URLs found by
// that rule alone). Old saves still name Steam's retired cloud host
// (http://cloud-3.steamusercontent.com/ugc/…); TTS fetches those from the new
// CDN and caches them under the NEW url's name (Earthborne Rangers Demo: 17
// URLs found only that way), so that rewrite is tried too.

/** The cache file's name (without extension) for a URL. */
export function cacheName(url) {
  return String(url ?? "").trim().replace(/[^A-Za-z0-9]/g, "");
}

const REWRITES = [
  // Steam retired cloud-3 for steamusercontent-a.akamaihd.net (2024); TTS rewrites on load
  [/^https?:\/\/cloud-3\.steamusercontent\.com\//i, "https://steamusercontent-a.akamaihd.net/"],
  [/^https?:\/\/cloud\.steamusercontent\.com\//i, "https://steamusercontent-a.akamaihd.net/"],
];

/** Every URL TTS may have fetched (and cached) a URL as, the URL itself first. */
export function urlVariants(url) {
  const u = String(url ?? "").trim();
  if (!u) return [];
  const out = [u];
  for (const [re, to] of REWRITES) if (re.test(u)) out.push(u.replace(re, to));
  for (const v of [...out]) {
    if (/^http:\/\//i.test(v)) out.push(v.replace(/^http:/i, "https:"));
    else if (/^https:\/\//i.test(v)) out.push(v.replace(/^https:/i, "http:"));
  }
  return [...new Set(out)];
}

/** Cache names to look for, best first. */
export function cacheCandidates(url) {
  return [...new Set(urlVariants(url).map(cacheName))].filter(Boolean);
}

/** A file name's stem: no directories, no last extension. */
export function fileStem(name) {
  const base = String(name ?? "").split(/[\\/]/).pop();
  return base.replace(/\.[^.]*$/, "");
}

/** Extensions worth indexing: what the importer can use. (.rawt/.rawm are TTS's own formats.) */
export const USEFUL_EXTENSIONS = new Set(["obj", "png", "jpg", "jpeg", "gif", "webp", "bmp", "pdf"]);

export const extensionOf = (name) => (/\.([^./\\]+)$/.exec(String(name ?? ""))?.[1] ?? "").toLowerCase();

/**
 * Dropped files, indexed by cache name. Values are whatever the caller gives
 * (a File, a zip entry…); only the path's name is read.
 */
export class AssetIndex {
  constructor() {
    this.byStem = new Map();
    this.size = 0;
  }
  /** Add a file at `path`. Returns false (and ignores it) if it isn't a usable asset. */
  add(path, value) {
    if (!USEFUL_EXTENSIONS.has(extensionOf(path))) return false;
    const stem = fileStem(path);
    if (!stem) return false;
    // a stem can appear twice (Images and Images Raw…); the first usable one wins
    if (!this.byStem.has(stem)) {
      this.byStem.set(stem, { path, value });
      this.size++;
    }
    return true;
  }
  /** The cached file for a URL, or null. Also accepts a file named exactly like the URL's last segment. */
  find(url) {
    for (const name of cacheCandidates(url)) {
      const hit = this.byStem.get(name);
      if (hit) return { ...hit, name };
    }
    // a hand-made folder of assets: "https://i.imgur.com/abc.png" as abc.png
    const tail = fileStem(String(url ?? "").trim().replace(/[?#].*$/, "").replace(/\/+$/, ""));
    if (tail && tail.length >= 4) {
      const hit = this.byStem.get(tail);
      if (hit) return { ...hit, name: tail };
    }
    return null;
  }
}
