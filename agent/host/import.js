/**
 * Importing the host's modules, lazily and survivably.
 *
 * Patchwork provides automerge and the plugin registry through an importmap,
 * which exists in the browser and nowhere else. Two consequences shape this
 * file:
 *
 *   - These must be *dynamic* imports. A static `import` of a bare specifier
 *     would also break the plugin entry module, which Patchwork evaluates in a
 *     worker that has no importmap (patchwork-skill §2).
 *   - The specifier has to be opaque to bundlers. Vite resolves dynamic import
 *     specifiers at build time and fails the build when it cannot find one, so
 *     a literal string here breaks `vitest` even inside a try/catch. Passing a
 *     variable with `@vite-ignore` leaves the import alone, which is what we
 *     want: in the browser it resolves through the importmap, and in node it
 *     throws and callers fall back.
 */

// The table of absolute URLs a worker imports by (host/urls.js), kept apart
// so that what imports automerge through it does not import this module.
import { setHostUrls, hostUrls, importSpecifier } from "./urls.js"

export { setHostUrls, hostUrls, importSpecifier }

const SPECIFIERS = {
  plugins: "@inkandswitch/patchwork-plugins",
  automerge: "@automerge/automerge/slim",
  filesystem: "@inkandswitch/patchwork-filesystem",
  elements: "@inkandswitch/patchwork-elements",
  repo: "@automerge/automerge-repo",
  messagechannel: "@automerge/automerge-repo-network-messagechannel",
}

/** Import a host module by nickname. Rejects outside Patchwork. */
export function hostImport(name) {
  const specifier = SPECIFIERS[name]
  if (!specifier) return Promise.reject(new Error(`Unknown host module: ${name}`))
  return importSpecifier(specifier)
}

let client = null
let libraries = null

/**
 * The task client (tasks/README.md, "Using it from another package"): the
 * Tasks package's library `tasks-next` in this realm's plugin registry, asked
 * for the same way in a page and in a pool's worker, on every call, so an
 * update is had the next time. Resolves once the package is installed here,
 * at once where it is, and tells `onMissing` first when it is not yet.
 * Rejects where there is no registry (tests, a plain Node program).
 */
export function taskClient(onMissing = null) {
  libraries ??= hostImport("plugins").then(({ getRegistry }) => getRegistry("patchwork:library"))
  return libraries
    .then((registry) => {
      if (!registry.has("tasks-next")) onMissing?.()
      return registry.loadWhenReady("tasks-next")
    })
    .then(({ module }) => (client = module))
}

/** The task client last had, or null. */
export const clientHere = () => client

/** Tests: a registry that gives `stand` as the task client; null gives none, and asks the real one afresh. */
export function _holdClient(stand) {
  client = stand
  libraries = stand ? Promise.resolve({ has: () => true, loadWhenReady: async () => ({ module: stand }) }) : null
}

/** Import a host module, or null when it is not available (tests, node). */
export async function tryHostImport(name) {
  try {
    return await hostImport(name)
  } catch {
    return null
  }
}

const AUTOMERGE_SLIM = "@automerge/automerge/slim"
const AUTOMERGE_WASM = /\/automerge[^/]*\.wasm(\?|$)/

/**
 * What a fresh worker needs before automerge works in it as it does in the
 * page — package_test's worker (tools/test-worker.js). Patchwork's importmap serves automerge's slim
 * build, which the page's boot initialises with its wasm (initializeWasm); a
 * worker gets the module uninitialised, and the first Repo dies with
 * "Automerge.use() not called".
 * So the worker initialises it the same way, from the wasm this page loaded
 * (its resource timings name the build's own hashed copy).
 *
 * @returns {{ automerge: string, wasm: string } | null}
 */
export function workerPreparation(importMap, { resources = pageResources(), origin = pageOrigin() } = {}) {
  const automerge = importMap?.[AUTOMERGE_SLIM]
  if (!automerge) return null
  const loaded = resources.find((name) => AUTOMERGE_WASM.test(new URL(name, "http://x").pathname))
  const wasm = loaded ?? (origin ? new URL("/automerge.wasm", origin).href : null)
  return wasm ? { automerge, wasm } : null
}

function pageResources() {
  try {
    return globalThis.performance?.getEntriesByType?.("resource").map((e) => e.name) ?? []
  } catch {
    return []
  }
}

function pageOrigin() {
  try {
    return new URL(globalThis.document.baseURI).origin
  } catch {
    return null
  }
}

/**
 * Initialise automerge's wasm in this worker, from what `workerPreparation`
 * named. Nothing to do when it was not given (outside Patchwork) or when the
 * module is already initialised.
 */
export async function initAutomergeHere(prepare) {
  if (!prepare?.automerge) return false
  const automerge = await import(/* @vite-ignore */ prepare.automerge)
  if (automerge.isWasmInitialized?.()) return false
  await automerge.initializeWasm(new Request(prepare.wasm))
  return true
}
