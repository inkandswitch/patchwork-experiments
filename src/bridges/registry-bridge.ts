/**
 * Registry bridge — owns *packages*: everything about what a registry (plugin)
 * package is and how it is named, located, loaded, and served.
 *
 * The opaque marker: a mapped package's URL segment is `registry--<sanitized-name>`
 * (one path segment), replacing the real automerge document ID or external
 * location so the tool code's location never crosses into the iframe. The
 * `PackagesUrlMapper` is registry-owned state (it mints markers at registration
 * and resolves them back at serve time); the resource bridge never touches it —
 * it calls `resolvePackageRequest(url, mapper)`.
 *
 * This module runs at two phases:
 *  - **boot / registration** — `getRegistries` / `watchRegistries` produce
 *    serializable `RegistryEntry`s with `importUrl` mapped to a marker.
 *  - **first serve** — `resolvePackageRequest` maps a marker request back to a
 *    fetchable URL; `registerPackageDependencies` + `rewriteAutomergeDepsInSource`
 *    hide a tool's baked automerge dependency URLs behind markers in served
 *    source.
 */

import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import {
  getImportableUrlFromAutomergeUrl,
  resolvePackageExport,
} from "@inkandswitch/patchwork-filesystem";
import { getAllRegistries } from "@inkandswitch/patchwork-plugins";
import type { RegistryEntry } from "../types.js";
import { log } from "../log.js";

/**
 * The opaque marker prefix for registry (plugin) tool code. A mapped package's
 * URL segment is `registry--<sanitized-name>` (one path segment). Chosen as a
 * single segment with no internal `/` so it survives `encodeURIComponent` (in the
 * baked-dependency request form) as one segment — see `#pkgSegmentFor`.
 */
export const REGISTRY_MARKER_PREFIX = "registry--";

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
 * Scan a URL's path for segments that decode to a valid automerge URL. Returns
 * one entry per matching segment, preserving the raw segment (for string
 * replacement) alongside its decoded base/heads.
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
 * Maps between real package locations (automerge document IDs or external URLs)
 * and opaque `registry--<name>` marker segments.
 *
 * Tool code inside the iframe sees
 * `registry--@patchwork--codemirror-base/dist/index.js` instead of a real
 * location. This:
 *  - Prevents automerge document IDs / external locations from leaking to
 *    untrusted code
 *  - Provides a hierarchical URL for relative import resolution
 *  - Makes fetch proxy rules simple: only `registry--` marker URLs get proxied
 */
export class PackagesUrlMapper {
  #counter = 0;
  // Raw automerge URL → package name (e.g., "automerge:3Dz..." → "@patchwork--folder")
  #automergeToPackage = new Map<string, string>();
  // Package name → raw automerge URL
  #packageToAutomerge = new Map<string, string>();
  // Package name → external package-root URL (statically-hosted tools, e.g. a
  // netlify bundle). Stored so an external tool's real location is hidden behind
  // the same `registry--<name>` marker as automerge tools — the code's location
  // never crosses into the iframe. The root ends in "/"; a request's subpath
  // after the marker is appended to it on the way back out (see `resolveMarker`).
  #packageToExternalRoot = new Map<string, string>();

  /**
   * Sanitize a package name for use as a URL path segment.
   * "@patchwork/folder" -> "@patchwork--folder"
   */
  #sanitizeName(name: string): string {
    return name.replace(/\//g, "--");
  }

  /**
   * Register an automerge base ID under a package name (reusing an existing
   * mapping if present) and return the opaque marker segment for it, carrying
   * any heads as a `%23<heads>` version suffix.
   *
   * The marker is a SINGLE path segment `registry--<name>` (the literal prefix
   * `registry--` fused to the sanitized name), not a `registry/<name>` path and
   * not a `pkg:` scheme. Single-segment is required: the source-baked dependency
   * form is handed to `getImportableUrlFromAutomergeUrl`, which
   * `encodeURIComponent`s the whole marker — a segment with no internal `/` stays
   * one segment (only `@`→`%40`, `#`→`%23`), so both the chunk form and the
   * dependency form present the marker as one first path segment. That is what
   * lets `classify` / `resolveMarker` treat every request uniformly.
   */
  #markerSegmentFor(base: string, heads: string, name?: string): string {
    let pkg = this.#automergeToPackage.get(base);
    if (!pkg) {
      pkg = name ? this.#sanitizeName(name) : `unknown-${this.#counter++}`;
      this.#automergeToPackage.set(base, pkg);
      this.#packageToAutomerge.set(pkg, base);
    }
    const marker = `${REGISTRY_MARKER_PREFIX}${pkg}`;
    return heads ? `${marker}%23${heads}` : marker;
  }

  /**
   * Has this automerge base ID been registered as a package dependency (via
   * `encodePath` / `encodeSegment`)? Used by the source rewrite as an allowlist:
   * only automerge URLs a registered package declared as a dependency are
   * rewritten to a marker; anything else (a doc ID a tool fabricated) is left raw,
   * so its request stays a raw automerge path that `classify` blocks.
   */
  isRegisteredDependency(base: string): boolean {
    return this.#automergeToPackage.has(base);
  }

  /**
   * ENCODE (automerge, full URL). Replace the automerge URL segment in a full URL
   * with the opaque marker segment, registering a new mapping if the segment
   * hasn't been seen. Returns the URL unchanged if no automerge segment is found.
   * Idempotent — used both at registration and (via `encodeServed`) at serve time.
   */
  encodePath(url: string, name?: string): string {
    // Replace the first automerge segment found; leave non-automerge URLs as-is.
    const [match] = findAutomergeSegments(url);
    if (!match) return url;
    const { segment, base, heads } = match;
    const markerSegment = this.#markerSegmentFor(base, heads, name);
    return url.replace(`/${segment}/`, `/${markerSegment}/`);
  }

  /**
   * ENCODE (automerge, bare string). Map a bare automerge folder URL (as it
   * appears verbatim in tool source, e.g. `automerge:HaCFn…#26oUrk…`) to its
   * opaque bare marker segment (`registry--@chee--patchwork-llm%2326oUrk…`),
   * registering the mapping if new.
   *
   * Unlike `encodePath`, the input is not a path with the ID sitting between
   * slashes — it is the raw automerge string a `getImportableUrlFromAutomergeUrl`
   * call is about to resolve. Returning a bare marker segment lets that runtime
   * call append its subpath and origin-prefix it as usual; the resulting request
   * (`<origin>/<encoded-marker>/subpath`) round-trips back through `resolveMarker`,
   * which decodes the first segment before matching. Because the marker is one
   * segment with no internal `/`, `encodeURIComponent` keeps it one segment.
   * Returns null if `folderUrl` isn't a valid automerge URL.
   */
  encodeSegment(folderUrl: string, name?: string): string | null {
    const { base, heads } = stripHeads(folderUrl);
    if (!isValidAutomergeUrl(base)) return null;
    return this.#markerSegmentFor(base, heads, name);
  }

  /**
   * ENCODE (external, registration). Map a statically-hosted (external, e.g.
   * netlify) package entry URL to a host-origin `registry--<name>` marker URL,
   * registering the mapping if new, so the external location never crosses into
   * the iframe. `name` is the package name (see `processRegistryPlugin`), so all
   * of a package's plugins share one marker; it keys both this mapping and the
   * reverse `resolveMarker` lookup.
   *
   * The marker replaces the package *root* (derived from the entry URL via
   * `packageRootFromUrl`), preserving the subpath, so
   * `https://netlify.app/tool/dist/index.js` →
   * `<origin>/registry--<name>/dist/index.js`. Later chunk requests under that
   * marker map back to the external root by `resolveMarker`. Returns the original
   * `entryUrl` unchanged if its root can't be derived.
   */
  encodeExternal(entryUrl: string, name: string): string {
    const root = packageRootFromUrl(entryUrl);
    if (!root) return entryUrl;

    const pkg = this.#sanitizeName(name);
    if (!this.#packageToExternalRoot.has(pkg)) {
      this.#packageToExternalRoot.set(pkg, root);
    }
    const marker = `${REGISTRY_MARKER_PREFIX}${pkg}`;
    const origin = window.location.origin;
    // Replace the external root prefix with a host-origin marker URL, keeping the
    // subpath. entryUrl starts with root (root came from it), so this is a plain
    // prefix swap.
    const subpath = entryUrl.startsWith(root) ? entryUrl.slice(root.length) : "";
    return `${origin}/${marker}/${subpath}`;
  }

  /**
   * Shared skeleton for the two reverse (marker → real location) lookups. Scans
   * `map` for a registered package whose `registry--<pkg>` marker appears as a
   * segment in `url`; on the first hit, delegates the actual string assembly to
   * `rebuild`, passing the mapped value, the raw segment suffix between the name
   * and the next `/` (carries a `%23<heads>` for automerge, empty for external),
   * and the subpath after that `/`. Returns null if no registered marker matches.
   */
  #reverseLookup(
    url: string,
    map: Map<string, string>,
    rebuild: (
      value: string,
      suffix: string,
      subpath: string,
      markerSegment: string
    ) => string
  ): string | null {
    for (const [pkg, value] of map) {
      const markerPrefix = `${REGISTRY_MARKER_PREFIX}${pkg}`;
      const idx = url.indexOf(markerPrefix);
      if (idx < 0) continue;

      const afterMarker = idx + markerPrefix.length;
      const slashIdx = url.indexOf("/", afterMarker);
      if (slashIdx < 0) continue;

      const suffix = url.slice(afterMarker, slashIdx);
      const subpath = url.slice(slashIdx + 1);
      const markerSegment = url.slice(idx, slashIdx + 1);
      return rebuild(value, suffix, subpath, markerSegment);
    }
    return null;
  }

  /**
   * RESOLVE (marker → real location). The single reverse entry point: turn an
   * inbound `registry--<name>` marker request into the real fetchable location —
   * an automerge path (SW-resolvable) or an external URL (fetched directly).
   * Returns null if the URL carries no known marker.
   *
   * The caller (`resolvePackageRequest`) hands a URL in which the marker appears
   * literally as `registry--<name>` (chunk form) or `registry--<name>%23<heads>`
   * (heads-pinned); the baked-dependency form's `%40`/`%23` percent-encoding has
   * already been decoded there. Automerge is tried before external (a package is
   * one or the other; the order just fixes precedence).
   */
  resolveMarker(url: string): string | null {
    // Automerge: swap the marker segment for the URL-encoded real automerge URL,
    // restoring heads from a `%23<heads>` suffix on the marker segment.
    const automerge = this.#reverseLookup(
      url,
      this.#packageToAutomerge,
      (automergeUrl, suffix, _subpath, markerSegment) => {
        const heads = suffix.startsWith("%23") ? decodeURIComponent(suffix) : "";
        const fullAutomerge = heads ? `${automergeUrl}${heads}` : automergeUrl;
        return url.replace(
          markerSegment,
          `${encodeURIComponent(fullAutomerge)}/`
        );
      }
    );
    if (automerge) return automerge;

    // External: swap the marker segment for the registered external root (ends in
    // "/"), appending the subpath. Fetched directly, never via the SW.
    return this.#reverseLookup(
      url,
      this.#packageToExternalRoot,
      (root, _suffix, subpath) => `${root}${subpath}`
    );
  }

  /**
   * ENCODE (serve time, either hosting). Given a just-fetched module URL, return
   * the origin-prefixed `registry--` marker URL to hand es-module-shims, so esms
   * resolves the module's relative chunk imports against the marker rather than
   * the real location. The single serve-time forward entry point — the resource
   * bridge calls only this, staying package-agnostic.
   *
   *  - **automerge** — `encodePath` swaps the automerge segment for a marker. If
   *    it returns a *bare* marker segment (no surrounding path), origin-prefix it
   *    so it is a valid hierarchical URL; if it rewrote in place, it is already an
   *    absolute URL, so pass through.
   *  - **external** — `encodePath` leaves the URL unchanged (no automerge
   *    segment); swap the registered external-root prefix for an origin-prefixed
   *    marker (`#encodeExternalServed`). The entry and all its code-split chunks
   *    live under the same root, so chunks map too.
   *  - **neither** (e.g. a host-origin platform asset) — pass through unchanged.
   */
  encodeServed(servedUrl: string): string {
    const encoded = this.encodePath(servedUrl);
    if (encoded.startsWith(REGISTRY_MARKER_PREFIX)) {
      return `${window.location.origin}/${encoded}`;
    }
    if (encoded !== servedUrl) return encoded;
    return this.#encodeExternalServed(servedUrl) ?? servedUrl;
  }

  /**
   * Serve-path forward map for external tools: swap a served external URL's
   * registered package-root prefix for its `<origin>/registry--<name>/` marker
   * URL, preserving the subpath. Returns null if `url` isn't under any registered
   * external root. The external half of `encodeServed`.
   */
  #encodeExternalServed(url: string): string | null {
    const origin = window.location.origin;
    for (const [pkg, root] of this.#packageToExternalRoot) {
      if (!url.startsWith(root)) continue;
      const subpath = url.slice(root.length);
      return `${origin}/${REGISTRY_MARKER_PREFIX}${pkg}/${subpath}`;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Package entry resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a plugin's importUrl to its package entry point URL and package name.
 * Both paths return `packageName` (best-effort) so the caller can key the
 * package's opaque marker on it — one marker per package, shared across all the
 * package's plugins.
 *
 * Plugin source can be stored in two places, and the importUrl says which:
 *  - **Automerge URL** (`automerge:...`) — the package lives in a folder doc in
 *    the host repo. We resolve it the same way the host does: read the folder's
 *    `package.json` (via the service-worker-resolvable host-origin path) and
 *    resolve its export to the entry point. These get mapped to opaque markers by
 *    the caller so the automerge ID never reaches the iframe.
 *  - **Plain HTTP(S) URL** — the package is statically deployed elsewhere (e.g.
 *    a Netlify bundle listed in a static module manifest). The importUrl is
 *    already the resolved entry point (mirroring how `ModuleWatcher` does a
 *    bare `import(importName)` for non-automerge modules), so the entry passes
 *    through unchanged — but we still read the package's `package.json` (at the
 *    convention-derived root) for its `name`, so the caller (`encodeExternal`)
 *    can hide its location behind a per-package marker. Best-effort: a missing
 *    root or package.json just yields no name (the caller falls back).
 */
export async function resolvePackageEntryUrl(
  importUrl: string
): Promise<{ entryUrl: string; packageName?: string } | undefined> {
  // Non-automerge importUrls are already-resolved entry points hosted wherever
  // they live; the entry passes through, but read package.json for the name.
  if (!isValidAutomergeUrl(importUrl)) {
    const root = packageRootFromUrl(importUrl);
    const pkgJson = root ? await fetchPackageJson(root) : undefined;
    return { entryUrl: importUrl, packageName: pkgJson?.name };
  }

  const folderPath = getImportableUrlFromAutomergeUrl(importUrl as AutomergeUrl);
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

// ---------------------------------------------------------------------------
// Dependency registration + source rewriting
// ---------------------------------------------------------------------------

/**
 * Fetch a package's `package.json` (given its already-derived package-root URL)
 * and register every `automerge:`-valued dependency in the mapper, so the source
 * rewrite can later replace those literals with markers (see
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
 *
 * `packageRoot` is the value the caller already computed with `packageRootFromUrl`
 * (the resource bridge keys its per-package cache on it), so this does not
 * recompute it — it fetches `package.json` from that root directly.
 */
export async function registerPackageDependencies(
  packageRoot: string,
  mapper: PackagesUrlMapper
): Promise<void> {
  const pkgJson = await fetchPackageJson(packageRoot);
  if (!pkgJson) return;

  for (const [name, version] of Object.entries(pkgJson.dependencies ?? {})) {
    const { base } = stripHeads(version);
    if (isValidAutomergeUrl(base)) {
      // Registers the base→pkg name mapping (heads irrelevant to registration).
      mapper.encodeSegment(version, name);
    }
  }
}

/**
 * Fetch and parse `package.json` from an already-derived package-root URL.
 * Returns undefined if none is found or on any error.
 */
async function fetchPackageJson(
  packageRoot: string
): Promise<
  { name?: string; dependencies?: Record<string, string> } | undefined
> {
  let candidate: string;
  try {
    candidate = new URL("package.json", packageRoot).href;
  } catch {
    return undefined;
  }
  try {
    const response = await fetch(candidate);
    if (response.ok) return await response.json();
  } catch {
    // ignore
  }
  return undefined;
}

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
 * overwhelming majority of served modules, so only the few modules that actually
 * carry a dep literal pay for a `package.json` read.
 */
export function sourceHasAutomergeUrl(source: string): boolean {
  return source.includes("automerge:");
}

/**
 * Rewrite `automerge:` dependency URLs embedded in a served module's source to
 * their opaque `registry--<name>` marker segments, before the source crosses
 * into the iframe.
 *
 * Tools built with `@chee/patchwork-bundles` bake a dep's automerge URL into the
 * source as a literal handed to `getImportableUrlFromAutomergeUrl(...)`, which
 * resolves it to a fetchable URL at runtime. Left alone, that literal both leaks
 * a document ID into untrusted code and produces a raw-automerge request that
 * `classify` (correctly) blocks. Replacing the literal with a bare marker removes
 * the ID and lets the runtime call resolve to a marker request that
 * `resolveMarker` maps back (see `encodeSegment`).
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
    if (!mapper.isRegisteredDependency(base)) return match;
    const marker = mapper.encodeSegment(match);
    return marker ?? match;
  });
}

// ---------------------------------------------------------------------------
// Request resolution (the interface the resource bridge calls)
// ---------------------------------------------------------------------------

/**
 * Resolve an inbound `registry` request (a `registry--` marker URL) to a
 * concrete fetchable URL. This is the read side of the mapper — the single
 * package-resolution entry point the resource bridge calls after `classify` has
 * admitted the request.
 *
 * A `registry--` marker reaches the host in two shapes, both with the marker as
 * the first path segment — so decoding that one segment handles both:
 *  - **chunk / entry form** — `<origin>/registry--@scope--name/dist/chunk.js`.
 *    The resolved module URL returned to es-module-shims is host-origin-prefixed
 *    so relative chunk imports resolve against it; the marker segment is literal.
 *  - **baked-dependency form** — the tool source holds a bare marker segment,
 *    which its `getImportableUrlFromAutomergeUrl(...)` call percent-encodes into
 *    the request path (`<origin>/registry--%40scope--name%2523heads/subpath`).
 *    The marker has no internal `/`, so it stays one segment; decoding it yields
 *    the same `registry--…` lookup.
 *
 * Resolves to either the real automerge path (automerge-hosted, SW-resolvable) or
 * the real external URL (statically-hosted, fetched directly). A non-marker URL
 * (a platform asset admitted by `classify`) is returned unchanged.
 */
export async function resolvePackageRequest(
  url: string,
  mapper: PackagesUrlMapper
): Promise<string> {
  const origin = window.location.origin;
  let lookupUrl = url;

  if (url.startsWith(origin + "/")) {
    // Decode the first path segment. For both marker shapes this reveals the
    // literal `registry--…` marker; substituting the decoded segment back gives a
    // URL the mapper matches.
    const rest = url.slice(origin.length + 1);
    const slashIdx = rest.indexOf("/");
    const firstSegment = slashIdx < 0 ? rest : rest.slice(0, slashIdx);
    let decoded: string;
    try {
      decoded = decodeURIComponent(firstSegment);
    } catch {
      decoded = firstSegment;
    }
    if (decoded.startsWith(REGISTRY_MARKER_PREFIX)) {
      lookupUrl = slashIdx < 0 ? decoded : decoded + rest.slice(slashIdx);
    }
  }

  // Marker → real location (automerge path, SW-resolvable; or external URL,
  // fetched directly). A non-marker URL (a platform asset) resolves to null.
  return mapper.resolveMarker(lookupUrl) ?? url;
}

// ---------------------------------------------------------------------------
// Registry population (boot + live updates)
// ---------------------------------------------------------------------------

/**
 * Convert a host registry plugin into a serializable `RegistryEntry` for the
 * iframe:
 *  - resolve its `importUrl` to a package entry point, then map that entry to a
 *    `registry--` marker URL so the real location (automerge ID or external URL)
 *    never leaks: automerge entries via `encodePath`, statically-hosted entries
 *    via `encodeExternal` (both keyed by the package name, so a package's plugins
 *    share one marker);
 *  - strip non-cloneable fields (`load`, `module`) and deep-copy the rest so it
 *    survives `postMessage`.
 *
 * Note: a package's `automerge:` dependencies are NOT resolved here. Doing so
 * would block iframe boot (this runs for every plugin on the boot critical path,
 * once per document switch) on a `package.json` fetch per plugin. Instead the
 * resource bridge registers a package's deps lazily, the first time one of its
 * modules is served (see `registerPackageDependencies`).
 *
 * Returns `undefined` (and logs) if the plugin can't be cloned. Shared by the
 * initial collection (`getRegistries`) and the live update watcher
 * (`watchRegistries`) so both produce entries identically.
 */
async function processRegistryPlugin(
  plugin: any,
  mapper: PackagesUrlMapper
): Promise<RegistryEntry | undefined> {
  let importUrl = plugin.importUrl as string | undefined;
  if (importUrl) {
    const resolved = await resolvePackageEntryUrl(importUrl);
    if (!resolved) {
      importUrl = undefined;
    } else {
      // Both hosting kinds key the marker on the package name (so all of a
      // package's plugins share one marker), falling back to the plugin id only
      // when the package.json had no name.
      const name = resolved.packageName ?? plugin.id;
      // Automerge-hosted entries carry an automerge segment `encodePath` maps to a
      // `registry--` marker. Statically-hosted (external) entries have no such
      // segment — `encodePath` returns them unchanged — so map them explicitly to
      // a marker too, so an external tool's location is hidden behind the boundary
      // like any other.
      const mapped = mapper.encodePath(resolved.entryUrl, name);
      importUrl =
        mapped === resolved.entryUrl
          ? mapper.encodeExternal(resolved.entryUrl, name)
          : mapped;
    }
  }

  const { load, module, ...rest } = plugin;
  let entry: RegistryEntry;
  try {
    entry = structuredClone(rest);
  } catch (err) {
    log(`skipping non-cloneable plugin: ${rest.id}`, err);
    return undefined;
  }
  entry.importUrl = importUrl;
  return entry;
}

/**
 * Collect registry entries from all plugin registries (with importUrls mapped to
 * `registry--` marker URLs) for the iframe's initial registry population.
 */
export async function getRegistries(
  mapper: PackagesUrlMapper
): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  for (const [, registry] of getAllRegistries()) {
    for (const plugin of registry.all()) {
      const entry = await processRegistryPlugin(plugin, mapper);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/**
 * Watch all host registries for new plugin registrations and push each (as a
 * mapped, serializable entry) to the iframe via the RPC port.
 *
 * Returns a cleanup function that unsubscribes from all registries.
 */
export function watchRegistries(
  port: MessagePort,
  mapper: PackagesUrlMapper
): () => void {
  const unsubs: Array<() => void> = [];

  for (const [, registry] of getAllRegistries()) {
    const unsub = registry.on("registered", async (plugin: any) => {
      const entry = await processRegistryPlugin(plugin, mapper);
      if (!entry) return;
      log(`pushing registry update: ${entry.id}`);
      port.postMessage({ type: "plugin-registered", entry });
    });
    unsubs.push(unsub);
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
