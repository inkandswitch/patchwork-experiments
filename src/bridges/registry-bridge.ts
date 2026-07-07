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
 *    serializable `RegistryEntry`s with `importUrl` mapped to a marker. A single
 *    `mapper.resolvePackage` per package (memoized) reads its `package.json` once
 *    to resolve the entry + name AND register its baked automerge dependencies.
 *  - **serve** — `resolvePackageRequest` maps a marker request back to a fetchable
 *    URL; `rewriteServedSource` hides a tool's baked automerge dependency URLs
 *    behind markers in served source, but only for packages that declared such
 *    deps at registration (a per-package check, no per-module source scan).
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
 * baked-dependency request form) as one segment — see `#markerSegmentFor`.
 */
export const REGISTRY_MARKER_PREFIX = "registry--";

/**
 * The result of resolving a package's `importUrl` (once, at registration),
 * discriminated by how the package is hosted so the caller can mint its marker
 * without re-scanning a URL:
 *  - **automerge** — the bare `automergeUrl` (the location to hide) plus the
 *    entry point's `subpath` beneath the package folder (e.g. `dist/index.js`).
 *  - **external** — the already-resolved `entryUrl` (a plain HTTP(S) URL).
 *
 * Both carry the package `name` (best-effort, for the marker) and whether the
 * `package.json` declared any `automerge:` dependencies (the serve path uses this
 * to decide whether to rewrite the package's served source).
 */
type ResolvedPackage = { packageName?: string; hasAutomergeDeps: boolean } & (
  | { hosting: "automerge"; automergeUrl: string; subpath: string }
  | { hosting: "external"; entryUrl: string }
);

/** The subset of a tool package's `package.json` this module reads. */
interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Split an automerge URL into its base and trailing heads (version) suffix.
 * Automerge URLs may be pinned to specific heads as `automerge:<id>#<heads>`;
 * `isValidAutomergeUrl` only recognizes the base, so callers strip the heads
 * before validating and restore them afterwards.
 */
function stripHeads(segment: string): { base: string; heads: string } {
  const hashIdx = segment.indexOf("#");
  return hashIdx >= 0
    ? { base: segment.slice(0, hashIdx), heads: segment.slice(hashIdx + 1) }
    : { base: segment, heads: "" };
}

/**
 * Split a marker name-part (`<name>` or `<name><suffix><heads>`) into its package
 * key and heads. The heads suffix arrives as `#` in the chunk/entry form but as
 * `%23` in the double-encoded baked-dependency form (both after one decode by
 * `splitFirstSegment`); a sanitized package name contains neither `#` nor `%`, so
 * splitting on whichever appears first recovers the key unambiguously. Returns
 * `heads` without its marker (empty if unpinned).
 */
function splitMarkerHeads(namepart: string): { pkg: string; heads: string } {
  // Find the heads marker: `#` (chunk/entry form) or `%23` (baked-dep form),
  // whichever occurs first.
  const hashIdx = namepart.indexOf("#");
  const pctIdx = namepart.indexOf("%23");
  let idx = -1;
  let markerLen = 0;
  if (hashIdx >= 0 && (pctIdx < 0 || hashIdx < pctIdx)) {
    idx = hashIdx;
    markerLen = 1;
  } else if (pctIdx >= 0) {
    idx = pctIdx;
    markerLen = 3;
  }
  return idx < 0
    ? { pkg: namepart, heads: "" }
    : { pkg: namepart.slice(0, idx), heads: namepart.slice(idx + markerLen) };
}

/**
 * Split a URL into its decoded first path segment and the raw remaining path
 * (everything after that segment's slash, still percent-encoded). Resolves the
 * URL against the host origin and normalizes it with the WHATWG `URL` parser
 * FIRST — so `..`/`.` are collapsed before inspection and a traversal like
 * `<origin>/assets/../automerge:<id>/x` presents `automerge:<id>` as `first`
 * (never a sanctioned prefix), rather than sneaking past a raw prefix check.
 *
 * The one place both bridges read "what package/prefix is this request for":
 * `classify` (platform/registry/blocked), `markerNameFromUrl`, and
 * `resolvePackageRequest` all build on it. Returns `{ first: "", rest: "" }` if
 * the URL can't be parsed.
 */
export function splitFirstSegment(url: string): { first: string; rest: string } {
  let pathname: string;
  try {
    pathname = new URL(url, window.location.origin).pathname;
  } catch {
    return { first: "", rest: "" };
  }
  const trimmed = pathname.replace(/^\/+/, "");
  const slashIdx = trimmed.indexOf("/");
  const rawFirst = slashIdx < 0 ? trimmed : trimmed.slice(0, slashIdx);
  const rest = slashIdx < 0 ? "" : trimmed.slice(slashIdx + 1);
  let first: string;
  try {
    first = decodeURIComponent(rawFirst);
  } catch {
    first = rawFirst;
  }
  return { first, rest };
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
  // importUrl → in-flight/settled promise of that package's one-time resolution:
  // read package.json once, resolve entry + name, and register its automerge
  // deps. Keyed by importUrl (shared across all a package's plugins) so the read
  // happens once per package, not once per plugin, across boot and live updates.
  #packageResolution = new Map<
    string,
    Promise<ResolvedPackage | undefined>
  >();
  // Marker names (`registry--<name>`) of packages that DECLARED automerge deps in
  // their package.json. The serve path rewrites baked dep literals only for these
  // packages; every other package's modules are served without a source scan.
  #packagesWithAutomergeDeps = new Set<string>();

  /**
   * Sanitize a package name for use as a URL path segment.
   * "@patchwork/folder" -> "@patchwork--folder"
   */
  #sanitizeName(name: string): string {
    return name.replace(/\//g, "--");
  }

  /**
   * Resolve a package's `importUrl` — ONCE per package — reading its
   * `package.json` a single time to (a) find the entry point + name and (b) scan
   * its `dependencies` for `automerge:` URLs, registering each as a dep→marker
   * mapping (`encodeSegment`) and reporting whether any were found. Memoized by
   * `importUrl` (shared across a package's plugins), so N plugins of one package
   * cost one fetch, across both boot (`getRegistries`) and live (`watchRegistries`)
   * registration.
   *
   * Two hosting kinds (the importUrl says which):
   *  - **automerge** (`automerge:…`) — read the folder's `package.json` (via the
   *    service-worker-resolvable host-origin path) and resolve its export to the
   *    entry point. Returns undefined if the package.json or export is unreachable.
   *  - **external** (plain HTTP(S)) — the importUrl is already the resolved entry;
   *    read `package.json` at the convention-derived package root for the name +
   *    deps (best-effort — a missing one just yields no name / no deps).
   *
   * The caller mints the package's own marker from the returned entry+name and, if
   * `hasAutomergeDeps`, records that marker via `markPackageHasDeps`.
   */
  resolvePackage(importUrl: string): Promise<ResolvedPackage | undefined> {
    let pending = this.#packageResolution.get(importUrl);
    if (!pending) {
      pending = this.#resolvePackageUncached(importUrl);
      this.#packageResolution.set(importUrl, pending);
    }
    return pending;
  }

  async #resolvePackageUncached(
    importUrl: string
  ): Promise<ResolvedPackage | undefined> {
    // External: importUrl is already the entry point; read package.json at the
    // package root (best-effort) for name + deps.
    if (!isValidAutomergeUrl(importUrl)) {
      const root = packageRootFromUrl(importUrl);
      const pkgJson = root ? await fetchPackageJson(root) : undefined;
      const hasAutomergeDeps = this.#registerAutomergeDeps(pkgJson);
      return {
        hosting: "external",
        entryUrl: importUrl,
        packageName: pkgJson?.name,
        hasAutomergeDeps,
      };
    }

    // Automerge: read the folder's package.json and resolve its export to the
    // entry point. Return the bare automerge URL + entry subpath (the part after
    // the folder), so the caller mints the marker from the bare URL directly —
    // never embedding it in a URL just to scan it back out.
    const folderPath = getImportableUrlFromAutomergeUrl(importUrl as AutomergeUrl);
    const base = new URL(folderPath, window.location.origin);
    const pkgJson = await fetchPackageJson(base.href);
    if (!pkgJson) return undefined;

    const entryPoint = resolvePackageExport(pkgJson);
    if (!entryPoint) return undefined;

    // base.href ends in "/<encoded-automerge>/"; the entry resolved against it,
    // minus that prefix, is the subpath (e.g. "dist/index.js") — resolves "./".
    const subpath = new URL(entryPoint, base).href.slice(base.href.length);
    const hasAutomergeDeps = this.#registerAutomergeDeps(pkgJson);
    return {
      hosting: "automerge",
      automergeUrl: importUrl,
      subpath,
      packageName: pkgJson.name,
      hasAutomergeDeps,
    };
  }

  /**
   * Register every `automerge:`-valued dependency in `pkgJson` as a dep→marker
   * mapping (so the source rewrite can later replace those literals), and return
   * whether any were found. See `rewriteAutomergeDepsInSource`.
   */
  #registerAutomergeDeps(pkgJson: PackageJson | undefined): boolean {
    let found = false;
    for (const [name, version] of Object.entries(pkgJson?.dependencies ?? {})) {
      const { base } = stripHeads(version);
      if (isValidAutomergeUrl(base)) {
        // Registers the dep base→marker mapping, named after the dep (heads
        // irrelevant to registration).
        this.encodeSegment(version, name);
        found = true;
      }
    }
    return found;
  }

  /**
   * Record that the package with marker name `markerName` declared automerge
   * deps, so the serve path rewrites its baked dep literals. Called by the
   * registration flow once the package's own marker is minted.
   */
  markPackageHasDeps(markerName: string): void {
    this.#packagesWithAutomergeDeps.add(markerName);
  }

  /**
   * Does the package identified by `markerName` (`registry--<name>`) need its
   * served source rewritten? True only if it declared automerge deps at
   * registration. The serve path extracts the marker name from the request URL
   * and consults this — replacing the old per-module source text scan.
   */
  packageNeedsRewrite(markerName: string): boolean {
    return this.#packagesWithAutomergeDeps.has(markerName);
  }

  /**
   * The marker name (`registry--<sanitized-name>`) a package is mapped under,
   * given its package name. The stable per-package key the iframe requests all of
   * the package's modules under; used to record/look up `packageNeedsRewrite`.
   */
  markerNameFor(name: string): string {
    return `${REGISTRY_MARKER_PREFIX}${this.#sanitizeName(name)}`;
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
   * `encodeSegment`)? Used by the source rewrite as an allowlist: only automerge
   * URLs a registered package declared as a dependency are rewritten to a marker;
   * anything else (a doc ID a tool fabricated) is left raw, so its request stays a
   * raw automerge path that `classify` blocks.
   */
  isRegisteredDependency(base: string): boolean {
    return this.#automergeToPackage.has(base);
  }

  /**
   * ENCODE (automerge → marker). Map a bare automerge URL (e.g.
   * `automerge:HaCFn…#26oUrk…`) to its opaque bare marker segment
   * (`registry--@chee--patchwork-llm%2326oUrk…`), registering the mapping if new.
   * The single automerge-encoding primitive — used for package entries (the
   * caller appends the entry subpath and origin-prefixes it) and for baked
   * `package.json` dependency URLs alike.
   *
   * The input is the raw automerge string; a returned bare marker segment lets
   * a `getImportableUrlFromAutomergeUrl` call (or the caller) append a subpath and
   * origin-prefix it; the resulting request (`<origin>/<encoded-marker>/subpath`)
   * round-trips back through `resolveMarker`, which decodes the first segment
   * before matching. Because the marker is one segment with no internal `/`,
   * `encodeURIComponent` keeps it one segment. Returns null if `folderUrl` isn't a
   * valid automerge URL.
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
   * RESOLVE (marker → real location). The single reverse entry point: turn an
   * inbound `registry--<name>` marker request into the real fetchable location —
   * an automerge path (SW-resolvable) or an external URL (fetched directly).
   * Returns null if the URL carries no known marker.
   *
   * The marker is always the request's FIRST path segment
   * (`registry--<name>` or `registry--<name>#<heads>`), so we parse that segment
   * and look the package up by its exact name — no scan over registered packages.
   * `splitFirstSegment` has already decoded the baked-dependency form's
   * `%40`/`%23` percent-encoding (so a heads `%23` reads back as `#` here). A
   * package is in exactly one map; automerge is checked first only for precedence.
   */
  resolveMarker(url: string): string | null {
    const { first, rest } = splitFirstSegment(url);
    if (!first.startsWith(REGISTRY_MARKER_PREFIX)) return null;

    // Split `registry--<name>[<heads-suffix>]` → package key + heads. Strip the
    // LEADING prefix (sanitized names themselves contain `--`), then split the
    // heads suffix. The suffix marker is `#` in the chunk/entry form but `%23` in
    // the double-encoded baked-dependency form (both arrive here after one decode
    // by `splitFirstSegment`); a sanitized package name contains neither, so
    // splitting on whichever appears first is unambiguous.
    const { pkg, heads } = splitMarkerHeads(
      first.slice(REGISTRY_MARKER_PREFIX.length)
    );

    // Automerge: real automerge URL (+ restored heads), URL-encoded as the first
    // path segment, then the subpath — the SW-resolvable form.
    const automergeUrl = this.#packageToAutomerge.get(pkg);
    if (automergeUrl !== undefined) {
      const full = heads ? `${automergeUrl}#${heads}` : automergeUrl;
      return `${encodeURIComponent(full)}/${rest}`;
    }

    // External: the registered root (ends in "/") + the subpath. Fetched directly.
    const root = this.#packageToExternalRoot.get(pkg);
    if (root !== undefined) return `${root}${rest}`;

    return null;
  }

}

// ---------------------------------------------------------------------------
// Package entry resolution
// ---------------------------------------------------------------------------

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
function packageRootFromUrl(moduleUrl: string): string | null {
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
// Source rewriting
// ---------------------------------------------------------------------------

/**
 * Fetch and parse `package.json` from an already-derived package-root URL.
 * Returns undefined if none is found or on any error.
 */
async function fetchPackageJson(
  packageRoot: string
): Promise<PackageJson | undefined> {
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
 * Prepare a served registry module's source for the iframe: if the package that
 * owns this request declared automerge deps at registration, rewrite the baked
 * `automerge:` dep literals to `registry--` markers; otherwise return the source
 * untouched. The single serve-time source entry point the resource bridge calls
 * (it stays package-agnostic apart from its `classify` gate).
 *
 * `requestUrl` is the iframe's `registry--<name>/…` request (already classified
 * `registry`); its marker name identifies the owning package. Only packages
 * recorded via `markPackageHasDeps` (i.e. that declared automerge deps) are
 * rewritten — so the overwhelming majority of served modules (no automerge deps)
 * skip the source scan entirely.
 */
export function rewriteServedSource(
  source: string,
  requestUrl: string,
  mapper: PackagesUrlMapper
): string {
  const markerName = markerNameFromUrl(requestUrl);
  if (!markerName || !mapper.packageNeedsRewrite(markerName)) return source;
  return rewriteAutomergeDepsInSource(source, mapper);
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
 * dependency at registration, which necessarily runs before any of that
 * package's code is served). An automerge URL a tool hand-writes for some other
 * document is not a registered dependency, so it is left untouched and its
 * request is blocked like any other smuggled ID.
 */
function rewriteAutomergeDepsInSource(
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

/**
 * Extract the `registry--<name>` marker name (decoded first path segment) from a
 * request URL, or null if it has none. Identifies the package that owns a served
 * module.
 */
function markerNameFromUrl(url: string): string | null {
  const { first } = splitFirstSegment(url);
  return first.startsWith(REGISTRY_MARKER_PREFIX) ? first : null;
}

// ---------------------------------------------------------------------------
// Request resolution (the interface the resource bridge calls)
// ---------------------------------------------------------------------------

/**
 * Resolve an inbound `registry` request (a `registry--` marker URL) to a
 * concrete fetchable URL. The read side of the mapper — the single
 * package-resolution entry point the resource bridge calls after `classify` has
 * admitted the request.
 *
 * A `registry--` marker reaches the host in two shapes, both with the marker as
 * the first path segment (which `resolveMarker` parses uniformly):
 *  - **chunk / entry form** — `<origin>/registry--@scope--name/dist/chunk.js`.
 *  - **baked-dependency form** — `getImportableUrlFromAutomergeUrl` percent-encodes
 *    the bare marker into the path (`<origin>/registry--%40scope--name%2523h/sub`);
 *    the marker has no internal `/`, so it stays one segment.
 *
 * Resolves to the real automerge path (SW-resolvable) or external URL (fetched
 * directly). A non-marker URL (a platform asset admitted by `classify`) is
 * returned unchanged.
 */
export function resolvePackageRequest(
  url: string,
  mapper: PackagesUrlMapper
): string {
  return mapper.resolveMarker(url) ?? url;
}

// ---------------------------------------------------------------------------
// Registry population (boot + live updates)
// ---------------------------------------------------------------------------

/**
 * Convert a host registry plugin into a serializable `RegistryEntry` for the
 * iframe:
 *  - resolve its `importUrl` (via `mapper.resolvePackage`), then map that package
 *    to a `registry--` marker URL so the real location (automerge ID or external
 *    URL) never leaks: automerge packages via `encodeSegment` (marker built from
 *    the bare automerge URL + entry subpath), statically-hosted via
 *    `encodeExternal` (both keyed by the package name, so a package's plugins
 *    share one marker);
 *  - strip non-cloneable fields (`load`, `module`) and deep-copy the rest so it
 *    survives `postMessage`.
 *
 * A package's `automerge:` dependencies are resolved here too, from the same
 * `package.json` read (see `mapper.resolvePackage`), memoized once per package —
 * so an N-plugin package costs one fetch, not N, and the serve path needs no
 * further package.json read. Packages that declared automerge deps are recorded
 * (by marker name) so only their served modules get source-rewritten.
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
    // One package.json read per package (memoized by importUrl): resolves the
    // entry + name and registers the package's automerge deps in one pass.
    const resolved = await mapper.resolvePackage(importUrl);
    if (!resolved) {
      importUrl = undefined;
    } else {
      // Both hosting kinds key the marker on the package name (so all of a
      // package's plugins share one marker), falling back to the plugin id only
      // when the package.json had no name.
      const name = resolved.packageName ?? plugin.id;
      if (resolved.hosting === "automerge") {
        // Mint the marker from the bare automerge URL, then origin-prefix it and
        // append the entry subpath: `<origin>/registry--<name>/<subpath>`.
        const marker = mapper.encodeSegment(resolved.automergeUrl, name);
        importUrl = marker
          ? `${window.location.origin}/${marker}/${resolved.subpath}`
          : undefined;
      } else {
        // Statically-hosted: map the external entry URL to a marker so the tool's
        // location is hidden behind the boundary like any other.
        importUrl = mapper.encodeExternal(resolved.entryUrl, name);
      }
      // Record the package's own marker name so the serve path rewrites its
      // baked dep literals. Uses the same name the marker was minted from, so it
      // matches the marker the iframe requests its modules under.
      if (resolved.hasAutomergeDeps) {
        mapper.markPackageHasDeps(mapper.markerNameFor(name));
      }
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
