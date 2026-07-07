/**
 * Resource bridge — owns *resources*: the host-side `fetch-package` /
 * `fetch-resource` RPC and the allowlist that gates it.
 *
 * The sandboxed iframe has an opaque origin and can't reach the host's service
 * worker, so it can't load module source or static resources directly. This
 * bridge re-opens that channel over RPC: the iframe asks for a URL, the host
 * classifies it, resolves it, fetches it, and returns the bytes.
 *
 *  - `fetch-package`: returns module source text + a resolved `registry--` marker
 *    URL for es-module-shims
 *  - `fetch-resource`: returns an ArrayBuffer + content type for the iframe's
 *    fetch proxy
 *
 * Every incoming request is gated by `classify` (an allowlist) before resolution:
 * only `platform` (import-map runtime) and `registry` (tool code behind a
 * `registry--` marker) are served; everything else is blocked, so a tool can't
 * smuggle a raw automerge document ID through the proxy to bypass the sync
 * allowlist. This bridge is package-agnostic — anything package-specific (marker
 * resolution, dependency mapping, source rewriting) is delegated to the registry
 * bridge, which owns the mapper.
 */

import { log } from "../log.js";
import {
  type PackagesUrlMapper,
  REGISTRY_MARKER_PREFIX,
  packageRootFromUrl,
  registerPackageDependencies,
  resolvePackageRequest,
  rewriteAutomergeDepsInSource,
  sourceHasAutomergeUrl,
} from "./registry-bridge.js";

export interface ResourceBridgeOptions {
  port: MessagePort;
  mapper: PackagesUrlMapper;
}

// ---------------------------------------------------------------------------
// Request classification (allowlist)
// ---------------------------------------------------------------------------

/**
 * Host-origin path prefixes under which the platform (import-map) build serves
 * its runtime code. `builtins` in the bootloader's vite importmap plugin emit
 * every external to `/packages/<name>.js`, and Vite hoists their shared chunks
 * to a top-level `/assets/`. These are the same files for every user and carry
 * no user data, so they are served freely.
 *
 * Safe as a fixed allowlist precisely because the service worker only routes a
 * request to the automerge worker (i.e. loads a *document*) when the whole
 * decoded pathname parses as an absolute URL — which requires the encoded
 * automerge URL to be the *first* path segment. Anything under `/packages/` or
 * `/assets/` has a non-scheme first segment, so it can never resolve to a
 * document; it is a static file fetch.
 */
const PLATFORM_PATH_PREFIXES = ["/packages/", "/assets/"];

/**
 * How a served-resource request is handled at the isolation boundary:
 *  - `platform` — import-map runtime code; served straight through.
 *  - `registry` — registry tool code (a `registry--` marker URL); resolved via
 *    the registry bridge and served with its automerge deps rewritten.
 *  - `blocked`  — anything else; rejected before resolution or fetch.
 */
export type RequestClass = "platform" | "registry" | "blocked";

/**
 * The first path segment of a URL, resolved against the host origin and
 * URL-normalized, then percent-decoded. Returns "" if the URL can't be parsed.
 *
 * Normalization is the security-critical step: the WHATWG `URL` parser resolves
 * `..`/`.` segments *before* we inspect the path, so a traversal attempt like
 * `<origin>/assets/../automerge:<id>/x` normalizes to `/automerge:<id>/x` and
 * its first segment becomes the smuggled ID (→ not a sanctioned segment →
 * blocked), rather than passing a raw `startsWith("/assets/")` check.
 */
function firstPathSegment(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url, window.location.origin).pathname;
  } catch {
    return "";
  }
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Classify an inbound served-resource request as `platform`, `registry`, or
 * `blocked` — the allowlist that gates the fetch proxy. Only `platform` and
 * `registry` are served; everything else (a raw automerge ID, a traversal
 * escape, any unsanctioned host-origin path) is blocked.
 *
 * Every check runs against the *normalized* first path segment (see
 * `firstPathSegment` — `..`/`.` resolved by the URL parser before inspection),
 * so path traversal can't smuggle a document ID past the allowlist. There is no
 * ordering subtlety: `registry--` and the platform prefixes are all ordinary
 * path segments the service worker can never mistake for a document URL.
 */
export function classify(url: string): RequestClass {
  const origin = window.location.origin;

  // Non-host-origin: external tool code — a registration-time input (an external
  // importUrl), mapped to a `registry--` marker before any request is made, so it
  // is registry code. Inbound requests never legitimately arrive in this form.
  if (!url.startsWith(origin + "/")) return "registry";

  const firstSegment = firstPathSegment(url);

  // Registry: the decoded first segment is a `registry--` marker. It must NOT
  // contain a `/` — a legit marker is a single segment with no internal slash, so
  // a decoded segment containing `/` is an encoded-slash traversal attempt
  // (`registry--x%2F..%2Fautomerge:…`) and is rejected.
  if (
    firstSegment.startsWith(REGISTRY_MARKER_PREFIX) &&
    !firstSegment.includes("/")
  ) {
    return "registry";
  }

  // Platform: host-origin code under a sanctioned build prefix.
  let pathname: string;
  try {
    pathname = new URL(url, origin).pathname;
  } catch {
    return "blocked";
  }
  if (PLATFORM_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return "platform";
  }

  // Anything else (incl. `<origin>/automerge:…`, a normalized traversal escape).
  return "blocked";
}

/**
 * Reject a fetch-proxy request the allowlist does not admit. Only `platform`
 * (import-map runtime) and `registry` (tool code behind a `registry--` marker)
 * requests are served; everything else — a raw automerge document ID, a path
 * traversal escape, any unsanctioned host-origin path — is `blocked` here, before
 * resolution or fetch. Posts the error back to the iframe and logs host-side.
 * Returns true if the request was blocked (caller should return early).
 */
function rejectIfNotAllowed(
  port: MessagePort,
  id: number,
  url: string,
  errorType: "fetch-package-error" | "fetch-resource-error"
): boolean {
  if (classify(url) !== "blocked") return false;
  const error = `blocked: request not allowed by the isolation allowlist (${url})`;
  log(`${errorType.replace("-error", "")} blocked ${url}`);
  port.postMessage({ type: errorType, id, error });
  return true;
}

/**
 * Shared skeleton for the two fetch-proxy RPC handlers. Both follow the same
 * path: reject requests the allowlist doesn't admit, resolve the requested URL,
 * fetch it, and post an error on failure. Only the success handling differs
 * (module source text + marker resolvedUrl vs. resource bytes + content type),
 * so that is passed in as `onResponse`, which is responsible for posting the
 * success message (the resource handler needs to transfer its ArrayBuffer).
 */
async function handleFetchRpc(
  msg: { id: number; url: string },
  type: "fetch-package" | "fetch-resource",
  port: MessagePort,
  mapper: PackagesUrlMapper,
  onResponse: (
    response: Response,
    fetchUrl: string,
    id: number
  ) => Promise<void> | void
): Promise<void> {
  const errorType = `${type}-error` as const;
  const { id, url } = msg;
  if (rejectIfNotAllowed(port, id, url, errorType)) return;
  try {
    const fetchUrl = await resolvePackageRequest(url, mapper);
    log(fetchUrl !== url ? `${type} ${url} → ${fetchUrl}` : `${type} ${url}`);

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText} (${fetchUrl})`;
      log(`${type} error ${url}: ${error}`);
      port.postMessage({ type: errorType, id, error });
      return;
    }
    // Awaited so a failure reading the body is caught by the catch below.
    await onResponse(response, fetchUrl, id);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`${type} error ${url}: ${error}`);
    port.postMessage({ type: errorType, id, error });
  }
}

/**
 * Start the host-side resource bridge — the RPC handler for module and resource
 * loading.
 *
 * Handles two message types:
 *  - `fetch-package`: returns source text + resolved URL (for es-module-shims)
 *  - `fetch-resource`: returns ArrayBuffer + content type (for fetch proxy)
 */
export function startResourceBridge(options: ResourceBridgeOptions): () => void {
  const { port, mapper } = options;

  // A package's automerge deps are registered lazily, the first time one of its
  // modules is served — NOT at plugin registration (that would fetch every
  // plugin's package.json on the iframe-boot critical path, on every document
  // switch). Keyed by package root so it runs once per package, and the promise
  // is cached so concurrent chunk fetches from the same package share one read.
  const depsByPackageRoot = new Map<string, Promise<void>>();
  function ensurePackageDependencies(moduleUrl: string): Promise<void> {
    const root = packageRootFromUrl(moduleUrl);
    if (!root) return Promise.resolve();
    let pending = depsByPackageRoot.get(root);
    if (!pending) {
      pending = registerPackageDependencies(root, mapper);
      depsByPackageRoot.set(root, pending);
    }
    return pending;
  }

  const onMessage = async (event: MessageEvent) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === "fetch-package") {
      await handleFetchRpc(msg, "fetch-package", port, mapper, async (response, fetchUrl, id) => {
        let source = await response.text();

        // Rewrite automerge dependency URLs baked into the source (by
        // @chee/patchwork-bundles) to opaque `registry--` markers *before* the
        // source crosses into the iframe, so the document IDs never leak. Only
        // automerge URLs already registered in the mapper — declared as deps by
        // the serving package — are rewritten; anything else stays a raw automerge
        // path that `classify` blocks.
        //
        // Gate the work to registry tool modules that actually carry a dep
        // literal: only `registry` requests (tool code) can carry baked automerge
        // deps — platform/import-map runtime does not — and only source with an
        // `automerge:` literal at all needs a rewrite. This avoids a package.json
        // fetch per shared module, the bulk of document-switch latency.
        if (sourceHasAutomergeUrl(source) && classify(msg.url) === "registry") {
          // Register this package's declared automerge deps (once, cached) before
          // rewriting, so the mapper knows which literals are legitimate deps.
          await ensurePackageDependencies(response.url || fetchUrl);
          source = rewriteAutomergeDepsInSource(source, mapper);
        }

        // Map the served URL back to a `registry--` marker URL (hiding the real
        // location) before handing it to es-module-shims, so esms resolves the
        // module's relative chunk imports against the marker, not the real
        // location. The mapper owns the automerge/external/passthrough dispatch.
        const resolvedUrl = mapper.encodeServed(response.url || fetchUrl);
        port.postMessage({ type: "fetch-package-response", id, source, resolvedUrl });
      });
      return;
    }

    if (msg.type === "fetch-resource") {
      await handleFetchRpc(msg, "fetch-resource", port, mapper, async (response, _fetchUrl, id) => {
        const body = await response.arrayBuffer();
        const contentType =
          response.headers.get("content-type") || "application/octet-stream";
        // Transfer (not copy) the ArrayBuffer for efficiency.
        port.postMessage(
          { type: "fetch-resource-response", id, body, contentType },
          [body]
        );
      });
      return;
    }
  };

  port.addEventListener("message", onMessage);
  port.start();

  return () => {
    port.removeEventListener("message", onMessage);
  };
}
