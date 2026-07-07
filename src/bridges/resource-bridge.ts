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
  resolvePackageRequest,
  rewriteServedSource,
  splitFirstSegment,
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
const PLATFORM_FIRST_SEGMENTS = new Set(["packages", "assets"]);

/**
 * How a served-resource request is handled at the isolation boundary:
 *  - `platform` — import-map runtime code; served straight through.
 *  - `registry` — registry tool code (a `registry--` marker URL); resolved via
 *    the registry bridge and served with its automerge deps rewritten.
 *  - `blocked`  — anything else; rejected before resolution or fetch.
 */
export type RequestClass = "platform" | "registry" | "blocked";

/**
 * Classify an inbound served-resource request as `platform`, `registry`, or
 * `blocked` — the allowlist that gates the fetch proxy. Only `platform` and
 * `registry` are served; everything else (a raw automerge ID, a traversal
 * escape, any unsanctioned host-origin path) is blocked.
 *
 * The verdict is decided entirely by the request's FIRST path segment, parsed by
 * `splitFirstSegment` — which normalizes `..`/`.` via the URL parser BEFORE
 * inspection, so a traversal like `<origin>/assets/../automerge:<id>/x` presents
 * `automerge:<id>` as the first segment (blocked), never sneaking past a raw
 * prefix check. `registry--` and the platform prefixes are ordinary path segments
 * the service worker can never mistake for a document URL, so there is no ordering
 * subtlety.
 */
export function classify(url: string): RequestClass {
  // Non-host-origin: external tool code — a registration-time input (an external
  // importUrl), mapped to a `registry--` marker before any request is made, so it
  // is registry code. Inbound requests never legitimately arrive in this form.
  if (!url.startsWith(window.location.origin + "/")) return "registry";

  const { first } = splitFirstSegment(url);

  // Registry: the decoded first segment is a `registry--` marker. It must NOT
  // contain a `/` — a legit marker is a single segment with no internal slash, so
  // a decoded segment containing `/` is an encoded-slash traversal attempt
  // (`registry--x%2F..%2Fautomerge:…`) and is rejected.
  if (first.startsWith(REGISTRY_MARKER_PREFIX) && !first.includes("/")) {
    return "registry";
  }

  // Platform: host-origin code under a sanctioned build prefix.
  if (PLATFORM_FIRST_SEGMENTS.has(first)) return "platform";

  // Anything else (incl. `<origin>/automerge:…`, a normalized traversal escape).
  return "blocked";
}

/**
 * Shared skeleton for the two fetch-proxy RPC handlers. Both follow the same
 * path: classify the request once, reject anything the allowlist doesn't admit,
 * resolve the requested URL, fetch it, and post an error on failure. Only the
 * success handling differs (module source text + marker resolvedUrl vs. resource
 * bytes + content type), so that is passed in as `onResponse` — which receives the
 * `RequestClass` (computed once here) and is responsible for posting the success
 * message (the resource handler needs to transfer its ArrayBuffer).
 */
async function handleFetchRpc(
  msg: { id: number; url: string },
  type: "fetch-package" | "fetch-resource",
  port: MessagePort,
  mapper: PackagesUrlMapper,
  onResponse: (
    response: Response,
    requestClass: RequestClass,
    id: number
  ) => Promise<void> | void
): Promise<void> {
  const errorType = `${type}-error` as const;
  const { id, url } = msg;

  // Classify once: `blocked` is rejected here before any resolution/fetch; the
  // admitted verdict (`platform`/`registry`) is passed on to `onResponse`.
  const requestClass = classify(url);
  if (requestClass === "blocked") {
    const error = `blocked: request not allowed by the isolation allowlist (${url})`;
    log(`${type} blocked ${url}`);
    port.postMessage({ type: errorType, id, error });
    return;
  }

  try {
    const fetchUrl = resolvePackageRequest(url, mapper);
    log(fetchUrl !== url ? `${type} ${url} → ${fetchUrl}` : `${type} ${url}`);

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText} (${fetchUrl})`;
      log(`${type} error ${url}: ${error}`);
      port.postMessage({ type: errorType, id, error });
      return;
    }
    // Awaited so a failure reading the body is caught by the catch below.
    await onResponse(response, requestClass, id);
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

  const onMessage = async (event: MessageEvent) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === "fetch-package") {
      await handleFetchRpc(msg, "fetch-package", port, mapper, async (response, requestClass, id) => {
        const rawSource = await response.text();

        // Hide baked automerge dep URLs behind `registry--` markers before the
        // source crosses into the iframe. Only `registry` tool code can carry
        // such deps; the registry bridge rewrites only for packages that declared
        // automerge deps at registration (a per-package check — no source scan for
        // the rest). Package deps were already read + registered at registration.
        const source =
          requestClass === "registry"
            ? rewriteServedSource(rawSource, msg.url, mapper)
            : rawSource;

        // Hand es-module-shims the URL the iframe requested (`msg.url`) as the
        // resolved URL, so it resolves the module's relative chunk imports against
        // that — never the real location. For a registry module that's already the
        // `registry--<name>/…` marker (keeping the location hidden); for platform
        // code it's the host-origin path. Deliberately NOT `response.url`: we don't
        // follow a fetch redirect to a real (possibly location-leaking) URL — the
        // iframe stays on the requested marker/path regardless of redirects.
        port.postMessage({
          type: "fetch-package-response",
          id,
          source,
          resolvedUrl: msg.url,
        });
      });
      return;
    }

    if (msg.type === "fetch-resource") {
      await handleFetchRpc(msg, "fetch-resource", port, mapper, async (response, _requestClass, id) => {
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
