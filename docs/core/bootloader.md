# Bootloader

**Package:** `@inkandswitch/patchwork-bootloader`  
**Source:** `core/bootloader/`

The bootloader handles two concerns: registering the Service Worker that intercepts `automerge:` URL requests, and injecting an import map so shared dependencies are available as singletons.

## Service Worker registration

The main entry point is `setupServiceWorker`:

```ts
import setup from "@inkandswitch/patchwork-bootloader";
import { createFilesystemHandoffHandler } from "@inkandswitch/patchwork-filesystem";

setup(createFilesystemHandoffHandler(repo));
```

`setupServiceWorker(handler, options?)` does the following:

1. Registers `/service-worker.js` (or a custom path via `options.path`) as a module-type Service Worker.
2. Listens for `message` events from the SW. When the SW posts a `{type: "request"}` message for an `automerge:` URL, it calls `handler(url, request)`, encodes the response body as a `Transferable` `Uint8Array`, and posts `{type: "response", ...}` back.
3. On first install (no existing active SW), bumps the cache version and reloads the page so the SW takes control immediately.

### Cache versioning

The SW uses a named cache derived from a version string stored in `localStorage` under `"patchworkServiceWorkerCacheVersion"`. This is set once on first install. The helper `bumpServiceWorkerCache()` increments the version and notifies the SW, which clears old cache entries. It is also exposed as `window.bumpServiceWorkerCache()` for debugging from the console.

## The handoff protocol

The Service Worker cannot access the Automerge repo (it runs in a separate global). When it intercepts a request for an `automerge:` URL — formatted as `/<URI-encoded-automerge-url>/<path>` — it holds the `FetchEvent` open and posts a request message to the controlling window client.

```
SW                                Main Thread
─────────────────────────────────────────────
fetch /automerge%3AXXX/index.js
  → decode → "automerge:XXX/index.js"
  → postMessage {type:"request", id:42, url:...}
                                  handler(url) called
                                  → walk FolderDoc tree
                                  → read file content
                                  postMessage {type:"response", id:42, body:Uint8Array}
  resolve(response)
  → new Response(body, headers)
```

The `id` field correlates requests to responses. Each in-flight request has a `Promise.withResolvers()` entry stored in a `Map`; the response message resolves the matching promise.

Responses also flow via a `BroadcastChannel("@patchwork/handoff")` as a fallback for cases where `event.source` is not a window client (e.g. SharedWorker navigations).

### Caching strategy

- **Handoff (automerge:) requests:** cache-first. Once cached, a URL-pinned response (one with `#heads`) is served entirely from cache and never re-fetched. Unpinned URLs are redirected (307) to the current heads by the filesystem handler before being cached, ensuring deterministic cache keys.
- **External requests:** network-first with a stale fallback.

## Import map

The `importmap-plugin` Vite plugin (exported from `@inkandswitch/patchwork-bootloader/vite`) pre-bundles each shared dependency as a separate ES module chunk under `/packages/<name>.js` and injects a `<script type="importmap">` into the HTML. Tool bundles import these dependencies by their bare name (e.g., `import { Repo } from "@automerge/automerge-repo"`) and the browser resolves them to the shared singleton via the import map.

This avoids shipping duplicate copies of Automerge, React, and other heavy shared libraries in every tool bundle.

The canonical list of shared packages is in `core/bootloader/src/externals.ts` and includes automerge, automerge-repo, all patchwork core packages, CodeMirror, and Solid JS.

## Vite plugins

The `vite` export from this package exposes three Vite plugins for use in `vite.config.ts`:

- **`patchworkPlugin()`** — meta-plugin that applies all three below in the right order
- **`importmapPlugin(externals)`** — bundles externals and injects the import map
- **`serviceWorkerPlugin()`** — emits `service-worker.js` as a separate build artifact

## Package exports

| Export | Description |
|---|---|
| `.` (default) | `setupServiceWorker(handler, options?)` |
| `./service-worker` | The Service Worker script (for Vite to emit) |
| `./vite` | Vite plugin helpers |
| `./externals` | The shared externals list |
| `./types` | `HandoffHandler`, `HandoffRequest`, `HandoffResponse` types |

## Types

```ts
type HandoffHandler = (
  href: string,
  request: HandoffRequest
) => Promise<HandoffResponse | void | string | Uint8Array>;

type HandoffRequest = {
  url: string;
  headers: Record<string, string>;
  method: string;
  destination: string;
  referrer: string;
};

type HandoffResponse = {
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  status?: number;
  cache?: boolean;
};
```

Returning `void` or `undefined` results in a 418 response from the SW. Returning a plain `string` or `Uint8Array` is a shorthand for a 200 response with no special headers.
