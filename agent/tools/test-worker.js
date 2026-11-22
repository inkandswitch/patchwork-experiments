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
 *   in:  { file, code, options }
 *   out: { results, error?, unhandled, logged }
 */

import * as engine from "./vendor/vitest-engine.js"
import { createRuntime, captureConsole } from "./vitest-runtime.js"

self.onmessage = async ({ data: { file, code, options } }) => {
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
