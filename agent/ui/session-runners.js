/**
 * The runners a session view keeps working on its session.
 *
 * Two of them, and that is deliberate. The SharedWorker runs the session —
 * one runner across every tab, surviving navigation. But a worker has no DOM
 * and no plugin registry, so host-tier calls (dom_snapshot, doc_create,
 * installing) park there; the in-tab runner exists to pick exactly those up.
 * `needsWork` is runner-aware, so each one only claims the lease for work it
 * can actually do, and the lease keeps them from colliding.
 *
 * Neither is owned by the view. Two views of one session share one runner,
 * and closing a view does not stop it: navigating away should never abort
 * work you asked for.
 *
 *   sessionRunners({ handle, store, repo, element, subject, onEvent })
 *     kind()          "worker" | "tab" | "pending" (until the worker is tried)
 *     kick()          nudge whoever should be working
 *     wake()          take host-tier work the worker parked
 *     elsewhere(doc)  another runner holds a live lease on the session
 *     stop()          interrupt the run, or stop waiting for the network
 *     setKey(key)     hand the worker a new model key
 *     dispose()       stop listening; the runners carry on
 */

import { heldElsewhere, needsWork } from "../kernel/runner.js"
import { stopReconnecting } from "../session/recovery.js"
import { attachView } from "../runners/registry.js"
import { startTabRunner, accountContext } from "../runners/tab.js"
import { connectWorkerRunner } from "../runners/worker-client.js"
import { readKey } from "../providers/keys.js"

const hostOnly = (where) => where === "host"

/**
 * Opt-in for now: `localStorage["patchwork-agent:worker"] = "on"`.
 *
 * The worker demonstrably boots, imports automerge, builds a repo over the
 * donated port, and finds and writes the page's documents
 * (probes/worker-repo.mjs, 8/8). What is not yet proven is *ongoing* sync:
 * when the page writes an approval into the session, the worker's copy does
 * not reliably see it, and the turn stalls. The page's `window.repo` is
 * itself a client of Patchwork's own automerge worker, so attaching another
 * network adapter to it may not relay changes the way a plain Repo would.
 * Until that is understood, the in-tab runner stays the default.
 */
function workerEnabled() {
  try {
    return globalThis.localStorage?.getItem("patchwork-agent:worker") === "on"
  } catch {
    return false
  }
}

export function sessionRunners({ handle, store, repo, element = null, subject = () => null, onEvent = () => {} }) {
  let runner = null
  let workerRunner = null
  let workerTried = false
  let detachView = null
  let disposed = false
  const providerId = () => handle.doc()?.config?.providerId ?? "openrouter"

  async function ensureWorkerRunner() {
    if (workerRunner || workerTried || disposed) return workerRunner
    workerTried = true
    if (!workerEnabled()) return null
    try {
      workerRunner = await connectWorkerRunner({
        repo,
        sessionUrl: handle.url,
        subject: subject(),
        key: readKey(providerId()),
        providerId: providerId(),
        account: accountContext(),
        onEvent,
      })
    } catch {
      workerRunner = null // the tab runner covers everything it would have done
    }
    return workerRunner
  }

  /** The tab's runner for this session, started once and shared. */
  async function ensureRunner() {
    if (runner || disposed) return runner
    // Snapshot the worker's presence now and hold it for this runner's life.
    const entry = await startTabRunner(handle, {
      repo,
      subject: subject(),
      element,
      canRun: workerRunner ? hostOnly : (where) => where === "worker" || where === "host",
    })
    runner = entry?.runner ?? null
    detachView = attachView(handle.url, { element, onEvent })
    return runner
  }

  /**
   * Nudge whoever should be working.
   *
   * The worker is preferred, so it gets first refusal; the tab is only woken
   * for host-tier work it alone can do. Kicking both indiscriminately means the
   * tab wins the race for the lease every time — it is already running, while
   * the worker still has to boot, resolve the importmap and shake hands — and
   * the SharedWorker would never actually be used.
   */
  async function kick() {
    const worker = await ensureWorkerRunner()
    if (worker) {
      worker.tick()
      if (needsWork(handle.doc(), hostOnly)) ensureRunner().then((r) => r?.tick())
      return
    }
    ensureRunner().then((r) => r?.tick())
  }

  return {
    kind: () => (workerRunner ? "worker" : workerTried ? "tab" : "pending"),
    kick,
    /**
     * The worker parks host-tier calls; this is how the tab notices and takes
     * them. Cheap — `needsWork` is a scan of the transcript, and `tick` is a
     * no-op when this runner has nothing it can do.
     */
    wake() {
      if (needsWork(handle.doc(), hostOnly)) ensureRunner().then((r) => r?.tick())
    },
    elsewhere: (doc) => heldElsewhere(doc, runner?.runnerUrl, runner?.live),
    stop() {
      runner?.interrupt()
      workerRunner?.interrupt()
      // Waiting for the network, no run is under way to interrupt: stopping is
      // a change to the session, so every runner stops trying.
      if (store.doc()?.reconnecting) store.change((d) => stopReconnecting(d))
    },
    // The worker cannot read this page's localStorage, so it is handed the key.
    setKey: (key) => workerRunner?.setKey(key),
    /**
     * Detach this view; deliberately NOT runner.stop(). Navigating away from a
     * session must not abort the work it is doing. The runner keeps its lease
     * and keeps writing to the document, so reopening the session — here or in
     * another tab — picks up whatever happened while you were gone.
     */
    dispose() {
      disposed = true
      detachView?.()
      workerRunner?.close()
    },
  }
}
