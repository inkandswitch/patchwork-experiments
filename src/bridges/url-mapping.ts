/**
 * URL translation, resolution, and filtering for the isolation boundary — the
 * naming/addressing layer that both the resource bridge and the registry bridge
 * build on.
 *
 *  - `PackagesUrlMapper`: bidirectional mapping between automerge URL segments
 *    and opaque `pkg:` URLs, so real document IDs never reach the iframe.
 *  - `resolvePackageEntryUrl` / `resolveUrl`: turn an importUrl (or an incoming
 *    iframe request) into a concrete fetchable URL.
 *  - `containsAutomergeUrl`: the security filter that rejects raw automerge IDs
 *    smuggled into fetch-proxy requests.
 */

import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import {
  getImportableUrlFromAutomergeUrl,
  resolvePackageExport,
} from "@inkandswitch/patchwork-filesystem";

// ---------------------------------------------------------------------------
// Automerge URL segment scanning (shared helpers)
// ---------------------------------------------------------------------------

/**
 * Split a path segment into its automerge base and trailing heads (version)
 * suffix. Automerge URLs may be pinned to specific heads as
 * `automerge:<id>#<heads>`; `isValidAutomergeUrl` only recognizes the base, so
 * callers strip the heads before validating and restore them afterwards.
 */
function stripHeads(segment: string): { base: string; heads: string } {
  const hashIdx = segment.indexOf("#");
  return hashIdx >= 0
    ? { base: segment.slice(0, hashIdx), heads: segment.slice(hashIdx + 1) }
    : { base: segment, heads: "" };
}

/**
 * Scan a URL's path for segments that decode to a valid automerge URL.
 * Returns one entry per matching segment, preserving the raw segment (for
 * string replacement) alongside its decoded base/heads. Used by both the
 * pkg:-URL mapper and the fetch-proxy automerge filter so the two share one
 * notion of "where the automerge IDs are in a URL".
 *
 * Falls back to a raw "/"-split when the input isn't URL-parseable, so bare
 * `automerge:...` strings are still scanned.
 */
function findAutomergeSegments(
  url: string
): Array<{ segment: string; base: string; heads: string }> {
  let segments: string[];
  try {
    segments = new URL(url, window.location.origin).pathname
      .split("/")
      .filter(Boolean);
  } catch {
    segments = url.split("/").filter(Boolean);
  }

  const matches: Array<{ segment: string; base: string; heads: string }> = [];
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      decoded = segment;
    }
    const { base, heads } = stripHeads(decoded);
    if (isValidAutomergeUrl(base)) matches.push({ segment, base, heads });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// PackagesUrlMapper
// ---------------------------------------------------------------------------

/**
 * Maps between automerge document IDs in URLs and opaque package names.
 *
 * Tool code inside the iframe sees `pkg:@patchwork--codemirror-base/dist/index.js`
 * instead of real automerge URLs. This:
 *  - Prevents automerge document IDs from leaking to untrusted code
 *  - Provides a hierarchical URL scheme for relative import resolution
 *  - Makes fetch proxy rules simple: only `pkg:` URLs get proxied
 */
export class PackagesUrlMapper {
  #counter = 0;
  // Raw automerge URL → package name (e.g., "automerge:3Dz..." → "@patchwork--folder")
  #automergeToPackage = new Map<string, string>();
  // Package name → raw automerge URL
  #packageToAutomerge = new Map<string, string>();

  /**
   * Sanitize a package name for use as a URL path segment.
   * "@patchwork/folder" -> "@patchwork--folder"
   */
  #sanitizeName(name: string): string {
    return name.replace(/\//g, "--");
  }

  /**
   * Register an automerge base ID under a package name (reusing an existing
   * mapping if present) and return the opaque `pkg:` segment for it, carrying
   * any heads as a `%23<heads>` version suffix.
   */
  #pkgSegmentFor(base: string, heads: string, name?: string): string {
    let pkg = this.#automergeToPackage.get(base);
    if (!pkg) {
      pkg = name ? this.#sanitizeName(name) : `unknown-${this.#counter++}`;
      this.#automergeToPackage.set(base, pkg);
      this.#packageToAutomerge.set(pkg, base);
    }
    return heads ? `pkg:${pkg}%23${heads}` : `pkg:${pkg}`;
  }

  /**
   * Has this automerge base ID been registered as a package (via `toPackageUrl`
   * / `toPackageFolderUrl`)? Used by the source rewrite as an allowlist: only
   * automerge URLs a registered package declared as a dependency are rewritten
   * to `pkg:`; anything else (a doc ID a tool fabricated) is left raw so the
   * `containsAutomergeUrl` filter blocks it.
   */
  hasAutomergeUrl(base: string): boolean {
    return this.#automergeToPackage.has(base);
  }

  /**
   * Replace the automerge URL segment in a full URL with a package name.
   * If the segment hasn't been seen before, registers a new mapping.
   * Returns the URL unchanged if no automerge segment is found.
   */
  toPackageUrl(url: string, name?: string): string {
    // Replace the first automerge segment found; leave non-automerge URLs as-is.
    const [match] = findAutomergeSegments(url);
    if (!match) return url;
    const { segment, base, heads } = match;
    const pkgSegment = this.#pkgSegmentFor(base, heads, name);
    return url.replace(`/${segment}/`, `/${pkgSegment}/`);
  }

  /**
   * Map a bare automerge folder URL (as it appears verbatim in tool source,
   * e.g. `automerge:HaCFn…#26oUrk…`) to its opaque bare `pkg:` folder URL
   * (`pkg:@chee--patchwork-llm%2326oUrk…`), registering the mapping if new.
   *
   * Unlike `toPackageUrl`, the input is not a path with the ID sitting between
   * slashes — it is the raw automerge string a `getImportableUrlFromAutomergeUrl`
   * call is about to resolve. Returning a bare `pkg:` URL lets that runtime call
   * append its subpath and origin-prefix it as usual; the resulting request
   * (`<origin>/pkg%3A…/subpath`, colon URL-encoded) round-trips back through
   * `toAutomergeUrl`, which decodes the segment before matching. Returns null if
   * `folderUrl` isn't a valid automerge URL.
   */
  toPackageFolderUrl(folderUrl: string, name?: string): string | null {
    const { base, heads } = stripHeads(folderUrl);
    if (!isValidAutomergeUrl(base)) return null;
    return this.#pkgSegmentFor(base, heads, name);
  }

  /**
   * Replace the package name in a URL with the real automerge URL segment
   * (URL-encoded). Restores heads from the pkg: URL version suffix.
   * Returns null if no package name segment is found.
   */
  toAutomergeUrl(url: string): string | null {
    for (const [pkg, automergeUrl] of this.#packageToAutomerge) {
      // Match pkg:name/ or pkg:name%23heads/
      const pkgPrefix = `pkg:${pkg}`;
      const idx = url.indexOf(pkgPrefix);
      if (idx < 0) continue;

      // Find the end of the pkg segment (next /)
      const afterPkg = idx + pkgPrefix.length;
      const slashIdx = url.indexOf("/", afterPkg);
      if (slashIdx < 0) continue;

      // Extract heads from %23... between pkg name and /
      const suffix = url.slice(afterPkg, slashIdx);
      const heads = suffix.startsWith("%23")
        ? decodeURIComponent(suffix)
        : "";
      const fullAutomerge = heads
        ? `${automergeUrl}${heads}`
        : automergeUrl;

      const pkgSegment = url.slice(idx, slashIdx + 1);
      return url.replace(
        pkgSegment,
        `${encodeURIComponent(fullAutomerge)}/`
      );
    }
    return null;
  }

}

// ---------------------------------------------------------------------------
// Automerge URL filtering
// ---------------------------------------------------------------------------

/**
 * Returns true if any path segment of `url` decodes to a valid automerge URL.
 *
 * Used to reject iframe fetch-proxy requests that smuggle a raw automerge
 * document ID into the host-origin fetch. Legitimate iframe URLs only ever use
 * the opaque `pkg:` scheme (automerge IDs never cross the boundary), so a raw
 * automerge ID in an incoming request can only come from a malicious tool
 * trying to load a document as source/bytes and bypass the sync allowlist.
 *
 * The only legitimate way an automerge-backed URL reaches the real `fetch()`
 * is via the mapper translating a known `pkg:` URL inside `resolveUrl` — those
 * are documents the isolation boundary registered in the `pkg:` registry. By
 * filtering the iframe's *input* (before resolution) and trusting the mapper's
 * output, we serve only registry-known documents.
 *
 * Heads-pinned `pkg:` URLs carry the heads as a `%23<heads>` suffix on the
 * package name (not an automerge ID), so they are unaffected.
 */
export function containsAutomergeUrl(url: string): boolean {
  return findAutomergeSegments(url).length > 0;
}

// ---------------------------------------------------------------------------
// Source rewriting
// ---------------------------------------------------------------------------

/**
 * Matches an `automerge:` URL embedded in served source text. The base ID is
 * `[A-Za-z0-9]+` and an optional `#<heads>` version suffix is `[A-Za-z0-9]+`;
 * this is the same alphabet `isValidAutomergeUrl` accepts, and it stops at the
 * closing quote/paren so it never swallows trailing source. Each match is
 * validated with `isValidAutomergeUrl` before use, so an over-match is harmless.
 */
const AUTOMERGE_URL_IN_SOURCE = /automerge:[A-Za-z0-9]+(?:#[A-Za-z0-9]+)?/g;

/**
 * Cheap check: does this module source contain any `automerge:` URL literal at
 * all? Used to skip the (network-bound) dependency resolution + rewrite for the
 * overwhelming majority of served modules — shared runtime packages and tool
 * chunks with no baked automerge deps — so only the few modules that actually
 * carry a dep literal pay for a `package.json` read.
 */
export function sourceHasAutomergeUrl(source: string): boolean {
  return source.includes("automerge:");
}

/**
 * Is this served-module request for shared platform / import-map runtime code
 * (`@automerge/*`, `solid-js`, `@codemirror/*`, `@inkandswitch/*`, and their
 * chunks) rather than registry-loaded tool code?
 *
 * es-module-shims applies the import map before the fetch hook, so those modules
 * arrive as plain host-origin URLs (`<origin>/packages/*`, `<origin>/assets/*`)
 * that are never `pkg:`. Registry tools arrive either non-host-origin (statically
 * hosted, e.g. netlify) or as `pkg:` URLs (automerge-hosted, mapped by
 * `resolveUrl`). Platform code carries no rewritable automerge deps, so the
 * resource bridge skips dependency resolution for it — avoiding a `package.json`
 * fetch per shared module, which dominated document-switch latency.
 */
export function isPlatformModuleUrl(url: string): boolean {
  const origin = window.location.origin;
  return url.startsWith(origin + "/") && !url.startsWith(origin + "/pkg:");
}

/**
 * Rewrite `automerge:` dependency URLs embedded in a served module's source to
 * their opaque `pkg:` folder URLs, before the source crosses into the iframe.
 *
 * Tools built with `@chee/patchwork-bundles` bake a dep's automerge URL into the
 * source as a literal handed to `getImportableUrlFromAutomergeUrl(...)`, which
 * resolves it to a fetchable URL at runtime. Left alone, that literal both leaks
 * a document ID into untrusted code and produces a request the
 * `containsAutomergeUrl` filter (correctly) blocks. Replacing the literal with a
 * bare `pkg:` URL removes the ID and lets the runtime call resolve to a `pkg:`
 * request that `resolveUrl` maps back (see `toPackageFolderUrl`).
 *
 * The **mapper is the allowlist**: a literal is rewritten only if its automerge
 * base is already registered (i.e. some registered package declared it as a
 * dependency — see `registerPackageDependencies`, called at plugin registration,
 * which necessarily runs before any of that package's code is served). An
 * automerge URL a tool hand-writes for some other document is not a registered
 * dependency, so it is left untouched and its request is blocked like any other
 * smuggled ID. This keying (rather than locating the serving package's automerge
 * folder from the served URL) is what makes the rewrite work for statically
 * hosted tools too, whose served URLs carry no automerge segment.
 */
export function rewriteAutomergeDepsInSource(
  source: string,
  mapper: PackagesUrlMapper
): string {
  return source.replace(AUTOMERGE_URL_IN_SOURCE, (match) => {
    const { base } = stripHeads(match);
    if (!mapper.hasAutomergeUrl(base)) return match;
    const pkgUrl = mapper.toPackageFolderUrl(match);
    return pkgUrl ?? match;
  });
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a plugin's importUrl to its package entry point URL and package name.
 *
 * Plugin source can be stored in two places, and the importUrl says which:
 *  - **Automerge URL** (`automerge:...`) — the package lives in a folder doc in
 *    the host repo. We resolve it the same way the host does: read the folder's
 *    `package.json` (via the service-worker-resolvable host-origin path) and
 *    resolve its export to the entry point. These get rewritten to opaque `pkg:`
 *    URLs by the caller so the automerge ID never reaches the iframe.
 *  - **Plain HTTP(S) URL** — the package is statically deployed elsewhere (e.g.
 *    a Netlify bundle listed in a static module manifest). The importUrl is
 *    already the resolved entry point (mirroring how `ModuleWatcher` does a
 *    bare `import(importName)` for non-automerge modules), so we pass it through
 *    unchanged. It carries no user data and is loaded directly, not via the
 *    host-origin/automerge path — routing it through the service worker is what
 *    produced the 35s "no reply from the automerge worker" hangs.
 */
export async function resolvePackageEntryUrl(
  importUrl: string
): Promise<{ entryUrl: string; packageName?: string } | undefined> {
  // Non-automerge importUrls are already-resolved entry points hosted wherever
  // they live; pass them through without the folder/package.json resolution.
  if (!isValidAutomergeUrl(importUrl)) {
    return { entryUrl: importUrl };
  }

  const folderPath = getImportableUrlFromAutomergeUrl(
    importUrl as AutomergeUrl
  );
  const base = new URL(folderPath, window.location.origin);
  const packageJsonUrl = new URL("package.json", base).href;

  const response = await fetch(packageJsonUrl);
  if (!response.ok) return undefined;

  const pkgJson = await response.json();
  const entryPoint = resolvePackageExport(pkgJson);
  if (!entryPoint) return undefined;

  return {
    entryUrl: new URL(entryPoint, base).href,
    packageName: pkgJson.name,
  };
}

/** Bundler output directory names an entry point commonly sits under. */
const BUNDLE_OUTPUT_DIRS = new Set(["dist", "build", "out", "lib"]);

/**
 * Derive the package-root directory URL for a served module URL, using the
 * publish convention: bundled tools serve their code under `<pkgroot>/dist/…`
 * (possibly nested, e.g. `dist/assets/chunk.js`) alongside
 * `<pkgroot>/package.json`. So the root is the parent of the nearest ancestor
 * directory named like a bundler output dir (`dist`/`build`/…); if there is no
 * such ancestor, it's the module's own directory. Returned as a normalized
 * absolute URL string (ends in "/"), suitable both as a per-package cache key
 * (stable across all of a package's chunks) and as the base to fetch
 * `package.json` from. Returns null if the URL can't be parsed.
 */
export function packageRootFromUrl(moduleUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(moduleUrl, window.location.origin);
  } catch {
    return null;
  }
  const segments = base.pathname.split("/").filter(Boolean);
  // Drop the filename; look for the nearest bundler-output dir among the path
  // dirs and treat its parent as the package root.
  const dirs = segments.slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (BUNDLE_OUTPUT_DIRS.has(dirs[i])) {
      const rootPath = dirs.slice(0, i).join("/");
      return new URL(`/${rootPath}${rootPath ? "/" : ""}`, base.origin).href;
    }
  }
  // No bundler dir in the path — the module's own directory is the root.
  return new URL(".", base).href;
}

/**
 * Fetch a package's `package.json` (given the resolved URL of one of its
 * modules) and register every `automerge:`-valued dependency in the mapper, so
 * the source rewrite can later replace those literals with `pkg:` URLs (see
 * `rewriteAutomergeDepsInSource`).
 *
 * Tools built with `@chee/patchwork-bundles` (e.g. `patchwork-base/chat`) name
 * their patchwork-package deps by automerge URL:
 *
 *   "dependencies": { "@chee/patchwork-llm": "automerge:HaCFn…#26oUrk…" }
 *
 * The plugin bakes each such URL into the built source as a literal; registering
 * the dep lets the rewrite recognize it as legitimate and remap it, for both
 * automerge- and statically-hosted tools. Called lazily by the resource bridge
 * the first time one of a package's modules is served (NOT at plugin
 * registration — that would fetch every plugin's package.json on the iframe-boot
 * critical path). Never throws; a package with no reachable `package.json` or no
 * automerge deps simply registers nothing.
 */
export async function registerPackageDependencies(
  moduleUrl: string,
  mapper: PackagesUrlMapper
): Promise<void> {
  const pkgJson = await fetchPackageJsonFromEntry(moduleUrl);
  if (!pkgJson) return;

  for (const [name, version] of Object.entries(pkgJson.dependencies ?? {})) {
    const { base } = stripHeads(version);
    if (isValidAutomergeUrl(base)) {
      // Registers the base→pkg name mapping (heads irrelevant to registration).
      mapper.toPackageFolderUrl(version, name);
    }
  }
}

/**
 * Fetch and parse the `package.json` for a package given the resolved URL of one
 * of its modules. Tries the convention-derived package root first
 * (`packageRootFromUrl`), then the module's own directory as the sole fallback,
 * so a package that isn't laid out as expected costs 1–2 probes rather than a
 * walk-up storm of 404s. Returns undefined if none is found or on any error.
 */
async function fetchPackageJsonFromEntry(
  entryUrl: string
): Promise<{ dependencies?: Record<string, string> } | undefined> {
  let base: URL;
  try {
    base = new URL(entryUrl, window.location.origin);
  } catch {
    return undefined;
  }

  const candidateRoots: string[] = [];
  const root = packageRootFromUrl(entryUrl);
  if (root) candidateRoots.push(root);
  const ownDir = new URL(".", base).href; // fallback for unexpected layouts
  if (!candidateRoots.includes(ownDir)) candidateRoots.push(ownDir);

  for (const root of candidateRoots) {
    const candidate = new URL("package.json", root).href;
    try {
      const response = await fetch(candidate);
      if (response.ok) return await response.json();
    } catch {
      // ignore and try the next candidate
    }
  }
  return undefined;
}

/**
 * Resolve a URL for fetching:
 *  - host-origin-prefixed pkg: URLs → strip prefix, then convert via mapper
 *  - bare pkg: URLs → convert to real automerge path via mapper
 *  - automerge: URLs → resolve to package entry point
 *  - Other URLs → pass through
 *
 * Chunk URLs from code-split packages arrive as host-origin-prefixed pkg: URLs
 * (e.g., `https://host/pkg:@scope--name/dist/assets/chunk.js`) because the
 * resolved module URL returned to es-module-shims is host-origin-prefixed to
 * enable relative URL resolution against pkg: paths.
 *
 * A dependency rewritten by `toPackageFolderUrl` arrives in a URL-encoded form
 * instead: the tool source holds a bare `pkg:` folder URL, which its
 * `getImportableUrlFromAutomergeUrl(...)` call percent-encodes into the request
 * path (`<origin>/pkg%3A…%2523heads/subpath`). We recognize that shape by
 * decoding the first path segment before matching, so the same `pkg:` mapping
 * resolves it.
 */
export async function resolveUrl(
  url: string,
  mapper: PackagesUrlMapper
): Promise<string> {
  // Strip host origin prefix if present — chunk URLs arrive this way
  // because resolved module URLs are prefixed for relative URL resolution.
  const origin = window.location.origin;
  let lookupUrl = url;
  if (url.startsWith(origin + "/pkg:")) {
    lookupUrl = url.slice(origin.length + 1);
  } else if (url.startsWith(origin + "/")) {
    // A `toPackageFolderUrl` dependency: its first path segment is a
    // percent-encoded `pkg:` URL (the runtime resolver encoded it). Decode just
    // that segment; if it reveals a `pkg:` URL, use it as the lookup so the
    // mapper matches. Leaves genuine automerge-segment requests untouched (they
    // decode to `automerge:…`, not `pkg:`, and are handled by the filter/branch
    // below).
    const rest = url.slice(origin.length + 1);
    const slashIdx = rest.indexOf("/");
    const firstSegment = slashIdx < 0 ? rest : rest.slice(0, slashIdx);
    let decoded: string;
    try {
      decoded = decodeURIComponent(firstSegment);
    } catch {
      decoded = firstSegment;
    }
    if (decoded.startsWith("pkg:")) {
      lookupUrl = slashIdx < 0 ? decoded : decoded + rest.slice(slashIdx);
    }
  }

  const realUrl = mapper.toAutomergeUrl(lookupUrl);
  if (realUrl) return realUrl;

  if (isValidAutomergeUrl(lookupUrl)) {
    const resolved = await resolvePackageEntryUrl(lookupUrl);
    if (resolved) return resolved.entryUrl;
    throw new Error(`Failed to resolve automerge URL: ${lookupUrl}`);
  }

  return url;
}
