/**
 * Iframe-side Web Worker shim. Injected into `boot()` and serialized into the
 * srcdoc by ../host/srcdoc.ts (see ./main.ts), like `installFetchProxy`.
 *
 * A tool in the sandbox may construct a Web Worker (e.g. `@chee/patchwork-llm`'s
 * model worker). The opaque origin blocks it: a host-origin worker script can't
 * be loaded cross-origin, and even a same-origin blob worker can't load its own
 * modules (which resolve to host-origin URLs it can't fetch). The shim patches
 * `self.Worker` so that, for a module worker whose script is host-origin or a
 * `blob:` (a tool that fetched the script text itself), we instead build a
 * same-origin blob worker running es-module-shims + `workerBootstrap`, and hand
 * it a `MessagePort` back to the iframe. The worker's module/resource loads are
 * relayed over that port to the iframe's existing `fetchModule`/`fetchResource`
 * RPC — so the host sees only the iframe, and the worker gets no sync port and no
 * capability the iframe lacks. Other workers use the native `Worker`.
 */

import type { IframeLog } from "./types.js";
import type { FetchModuleResult, FetchResourceResult } from "./rpc.js";
import type { ImportMap } from "../host/import-map.js";

export interface WorkerShimDeps {
  fetchModule: (url: string) => Promise<FetchModuleResult>;
  fetchResource: (url: string) => Promise<FetchResourceResult>;
  /** es-module-shims source (same variant the iframe inlines). */
  esmsSource: string;
  /**
   * `workerBootstrap` serialized to source — injected, not imported, because
   * this shim is itself serialized into the srcdoc and can't reference another
   * module binding. Assembled in ../host/srcdoc.ts where both are in scope.
   */
  workerBootstrapSource: string;
  /** Host import map, resolved to absolute URLs. */
  importMap: ImportMap;
  /** Host origin — decides which worker scripts to intercept. */
  hostOrigin: string;
  log: IframeLog;
}

export function installWorkerShim(deps: WorkerShimDeps): void {
  const {
    fetchModule,
    fetchResource,
    esmsSource,
    workerBootstrapSource,
    importMap,
    hostOrigin,
    log,
  } = deps;
  const OriginalWorker = self.Worker;

  // Intercept module workers whose script is host-origin (needs our relay) or a
  // `blob:` (a tool that fetched the worker text and made its own blob — still
  // can't load its modules from the sandbox). Others use the native constructor.
  function shouldIntercept(url: string, isModule: boolean): boolean {
    return (
      isModule && (url.startsWith(hostOrigin + "/") || url.startsWith("blob:"))
    );
  }

  (self as any).Worker = function PatchedWorker(
    scriptURL: string | URL,
    options?: WorkerOptions
  ): Worker {
    const url =
      typeof scriptURL === "string" ? scriptURL : scriptURL.toString();
    if (!shouldIntercept(url, options?.type === "module")) {
      return new OriginalWorker(scriptURL, options);
    }
    log("worker shim: intercepting", url.slice(0, 80));

    // Relay: forward the worker's module/resource requests to the iframe's RPC.
    const channel = new MessageChannel();
    channel.port1.addEventListener("message", (event: MessageEvent) => {
      const m = event.data;
      if (m?.type === "fetch-package")
        relay(fetchModule(m.url), "fetch-package", m.id);
      else if (m?.type === "fetch-resource")
        relay(fetchResource(m.url), "fetch-resource", m.id);
      // Other message types are ignored — the relay exposes only fetch.
    });
    channel.port1.start();
    function relay(work: Promise<any>, type: string, id: number) {
      work.then(
        (r) => {
          const transfer = type === "fetch-resource" ? [r.body] : [];
          channel.port1.postMessage(
            { type: `${type}-response`, id, ...r },
            transfer
          );
        },
        (err) =>
          channel.port1.postMessage({
            type: `${type}-error`,
            id,
            error: err instanceof Error ? err.message : String(err),
          })
      );
    }

    // Construct the harness synchronously (tools do `new Worker(...)` then
    // `postMessage(...)`). It waits for the relay port; we fetch the entry (only
    // a blob's source must be delivered — host entries load via the relay) and
    // send it with the port. Failures surface as a worker error, not a hang.
    const worker = buildHarnessWorker();
    resolveEntry(url).then(
      (entrySource) =>
        worker.postMessage(
          { type: "isolation-relay-port", entryUrl: url, entrySource },
          [channel.port2]
        ),
      (err) => {
        log("worker shim: failed to load entry source", err);
        worker.postMessage({
          type: "isolation-relay-error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    );
    return worker;
  } as unknown as typeof Worker;

  // A `blob:` entry can't be fetched by the worker, so read its text here (the
  // blob is same-origin to the iframe) and deliver it. A host-origin entry is
  // loaded by the worker's source hook via the relay, so no source is delivered.
  async function resolveEntry(url: string): Promise<string | undefined> {
    if (!url.startsWith("blob:")) return undefined;
    return (await fetch(url)).text();
  }

  /**
   * Build the harness worker from a blob of three parts (order matters:
   * es-module-shims reads `esmsInitOptions` synchronously when it evaluates):
   *   1. `workerBootstrap(params)` — installs the relay-backed `source` hook.
   *   2. es-module-shims source.
   *   3. `__isolationWorkerStart()` — runs the entry.
   *
   * A CLASSIC worker (not `{type:"module"}`): the blob has no top-level
   * import/export (es-module-shims is an IIFE; the bootstrap uses only dynamic
   * `importShim`), and a classic worker's top-level script is exempt from the
   * "module worker can't follow a cross-origin redirect" restriction. All real
   * ESM inside runs through es-module-shims.
   */
  function buildHarnessWorker(): Worker {
    const params = { importMap, hostOrigin };
    const blobSource = [
      `(${workerBootstrapSource})(${JSON.stringify(params)});`,
      esmsSource,
      `self.__isolationWorkerStart().catch((e) => { throw e; });`,
    ].join("\n");
    const blobUrl = URL.createObjectURL(
      new Blob([blobSource], { type: "text/javascript" })
    );
    const worker = new OriginalWorker(blobUrl);
    // Revoke on a later turn: the worker fetches its blob asynchronously, and
    // revoking synchronously would fail the load.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    return worker;
  }
}
