/**
 * package_test's worker host: runs one bundled test file with no DOM.
 *
 * The tab builds the bundle, with Patchwork's importmap already applied — a
 * module worker has no importmap, so the externals arrive as absolute URLs
 * (the same table worker-client.js hands the shared runner). This side only
 * imports it under the runtime and posts the report back. One worker per
 * file, so a file that never finishes can be terminated without taking the
 * tab with it.
 *
 * What the page set up before any package ran, the worker sets up itself:
 * `options.prepare` names Patchwork's slim automerge and its wasm, which the
 * page's boot initialised and a fresh worker hasn't (testing.js,
 * workerPreparation).
 *
 *   in:  { file, code, options: { prepare?, ...runFile's options } }
 *   out: { results, error?, unhandled, logged }
 */

import * as engine from "./vendor/vitest-engine.js"
import { createRuntime, captureConsole } from "./vitest-runtime.js"

async function prepareHost(prepare) {
  if (!prepare?.automerge) return
  const automerge = await import(/* @vite-ignore */ prepare.automerge)
  if (automerge.isWasmInitialized?.()) return
  await automerge.initializeWasm(new Request(prepare.wasm))
}

self.onmessage = async ({ data: { file, code, options } }) => {
  try {
    await prepareHost(options?.prepare)
  } catch (err) {
    self.postMessage({ error: `could not initialise automerge's wasm in the worker: ${err?.message ?? err}`, logged: [] })
    return
  }
  const runtime = createRuntime(engine)
  globalThis.__patchworkVitest = runtime.api
  const consoled = captureConsole()
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
  try {
    const report = await runtime.runFile(file, () => import(/* @vite-ignore */ url), options)
    self.postMessage({ ...report, logged: consoled.lines })
  } catch (err) {
    self.postMessage({ error: String(err?.message ?? err), logged: consoled.lines })
  } finally {
    consoled.stop()
    URL.revokeObjectURL(url)
  }
}
