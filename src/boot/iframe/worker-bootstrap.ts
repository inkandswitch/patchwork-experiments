/**
 * The bootstrap that runs INSIDE a tool-spawned Web Worker.
 *
 * A tool in the isolated iframe may construct a Web Worker (e.g.
 * `@chee/patchwork-llm`'s model worker). The iframe's opaque origin means a
 * worker can't load host-origin scripts, and even a same-origin blob worker has
 * none of the iframe's module-loading machinery. This bootstrap re-establishes
 * it *inside the worker*: es-module-shims with a `source` hook that relays
 * host-origin module/resource loads back to the iframe (never to the host
 * directly), so the worker can load nothing the iframe couldn't. External (CDN)
 * modules are fetched directly by the worker. See `./worker-shim.ts` for the
 * iframe side that builds and wires this.
 *
 * Serialized with `.toString()` (by `./worker-shim.ts`) into the worker blob, so
 * it must not reference module-scope bindings — everything is a parameter, a
 * local, or a global.
 *
 * **Ordering.** es-module-shims reads `self.esmsInitOptions` synchronously when
 * its source evaluates, so the blob runs in three parts: (1) this function,
 * which installs `esmsInitOptions` and stashes `self.__isolationWorkerStart`;
 * (2) the es-module-shims source; (3) `__isolationWorkerStart()`.
 *
 * The worker's own application protocol uses `self.postMessage`/`onmessage`; the
 * iframe relay is a separate, transferred `MessagePort`.
 */

import type { ImportMap } from "../host/import-map.js";

export interface WorkerBootstrapParams {
  /** The host's import map, resolved to absolute URLs (same as the iframe's). */
  importMap: ImportMap;
  /** Host origin — module/resource URLs under it relay to the iframe. */
  hostOrigin: string;
}

/** What the iframe delivers to boot the worker (relay port + entry to run). */
interface RelayInit {
  port: MessagePort;
  /** Entry module URL, used as its base so relative imports resolve. */
  entryUrl: string;
  /**
   * Entry source, supplied ONLY for a `blob:` entry (the worker can't fetch the
   * iframe's blob URL). Host-origin entries are loaded via the relay like any
   * other module, so this is undefined for them.
   */
  entrySource?: string;
}

export function workerBootstrap(params: WorkerBootstrapParams): void {
  // ── App-message buffering ────────────────────────────────────────────────
  // The tool posts app messages (e.g. `{type:"generate"}`) on the worker's
  // global channel before the real worker installs `self.onmessage` (its module
  // loads asynchronously over the relay). Buffer non-relay messages and replay
  // them once the handler is set. The target workers use `self.onmessage = …`
  // (assignment), so intercepting that property suffices.
  let appHandler: ((ev: MessageEvent) => void) | null = null;
  const appBuffer: MessageEvent[] = [];
  try {
    Object.defineProperty(self, "onmessage", {
      configurable: true,
      get: () => appHandler,
      set(fn: ((ev: MessageEvent) => void) | null) {
        appHandler = fn;
        if (fn) for (const ev of appBuffer.splice(0)) fn(ev);
      },
    });
  } catch {
    // If onmessage can't be redefined, fall back to no buffering (best effort).
  }

  // ── Relay to the iframe (request/reply over a MessagePort) ───────────────
  let relayPort: MessagePort | undefined;
  let reqId = 0;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();

  // One persistent global listener: claim the iframe's relay-init/-error control
  // messages; route everything else (tool app messages) through the buffer.
  const relayReady = new Promise<RelayInit>((resolve, reject) => {
    self.addEventListener("message", (event: MessageEvent) => {
      const m = event.data;
      if (m && m.type === "isolation-relay-port") {
        resolve({
          port: event.ports[0],
          entryUrl: m.entryUrl,
          entrySource: m.entrySource,
        });
      } else if (m && m.type === "isolation-relay-error") {
        reject(new Error(m.error));
      } else if (appHandler) {
        appHandler(event);
      } else {
        appBuffer.push(event);
      }
    });
  });

  // Generic request/reply. `type` is "fetch-package" | "fetch-resource"; the
  // reply is `<type>-response` (resolve) or `<type>-error` (reject).
  function request<T>(type: string, url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++reqId;
      pending.set(id, { resolve, reject });
      relayPort!.postMessage({ type, id, url });
    });
  }
  function onRelayMessage(event: MessageEvent) {
    const m = event.data;
    if (!m || typeof m.id !== "number") return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === "fetch-package-response")
      p.resolve({ source: m.source, resolvedUrl: m.resolvedUrl });
    else if (m.type === "fetch-resource-response")
      p.resolve({ body: m.body, contentType: m.contentType });
    else if (m.type.endsWith("-error")) p.reject(new Error(m.error));
  }

  // Bracket a class method literally named `import` — es-module-shims' lexer
  // misreads it as a dynamic import. Only relayed host modules need this (e.g.
  // @automerge/automerge-repo's `Repo.import()`); it matches ../es-module-shims.ts.
  function fixImportMethod(src: string): string {
    return src.replace(
      /^(\s+)import\s*\(([^)]*)\)\s*\{/gm,
      '$1["import"]($2) {'
    );
  }

  // A `blob:` entry can't be fetched by the worker, so its source is delivered in
  // the relay-init message; phase 2 records it here for the source hook to serve
  // (host-origin entries are undefined here and load via the relay like any
  // other module). Set before `importShim(entry)` runs, so the hook sees it.
  let blobEntry: { url: string; source: string } | undefined;

  // Install the source hook BEFORE the shim source runs (see Ordering above).
  // Host-origin modules relay to the iframe (same allowlist + marker resolution);
  // external modules are fetched directly by the worker (its `fetch` follows
  // redirects and returns final text, so a CDN import that would fail as a
  // module-worker cross-origin redirect works here).
  (self as any).esmsInitOptions = {
    shimMode: true,
    async source(url: string) {
      if (blobEntry && url === blobEntry.url) {
        return {
          source: fixImportMethod(blobEntry.source),
          url: blobEntry.url,
          type: "js" as const,
        };
      }
      if (url.startsWith(params.hostOrigin + "/")) {
        const r = await request<{ source: string; resolvedUrl: string }>(
          "fetch-package",
          url
        );
        return {
          source: fixImportMethod(r.source),
          url: r.resolvedUrl,
          type: "js" as const,
        };
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`worker source ${url}: HTTP ${res.status}`);
      return {
        source: await res.text(),
        url: res.url || url,
        type: "js" as const,
      };
    },
  };

  // Phase 2: the blob calls this after the shim source has evaluated. The name
  // is inlined (not a module-scope const) so it survives `.toString()`.
  (self as any).__isolationWorkerStart = async function start() {
    const importShim = (self as any).importShim as
      | ((specifier: string) => Promise<any>)
      | undefined;
    if (!importShim)
      throw new Error("worker: es-module-shims failed to initialize");

    const init = await relayReady;
    relayPort = init.port;
    relayPort.addEventListener("message", onRelayMessage);
    relayPort.start();

    if (params.importMap) importShim.addImportMap(params.importMap);

    // Route the worker's own host-origin fetch(es) through the relay too
    // (mirrors ../fetch-proxy.ts); non-host fetches use native fetch.
    const nativeFetch = self.fetch;
    (self as any).fetch = async (
      input: RequestInfo | URL,
      fetchInit?: RequestInit
    ) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.startsWith(params.hostOrigin)) {
        const r = await request<{ body: ArrayBuffer; contentType: string }>(
          "fetch-resource",
          u
        );
        return new Response(r.body, {
          status: 200,
          headers: { "Content-Type": r.contentType },
        });
      }
      return nativeFetch(input, fetchInit);
    };

    // Record a blob entry's delivered source for the source hook (see above).
    if (init.entrySource !== undefined) {
      blobEntry = { url: init.entryUrl, source: init.entrySource };
    }

    await importShim(init.entryUrl);
  };
}
