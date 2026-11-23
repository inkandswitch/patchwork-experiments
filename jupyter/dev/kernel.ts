// Starts the native tool's Pyodide kernel on its own, without any notebook UI,
// and runs a little Python. dev/e2e.mjs reads `window.kernelCheck`.
import { PyodideKernelClient } from "../native/src/kernel/pyodide"

declare global {
  interface Window {
    kernelCheck: Promise<Record<string, unknown>>
  }
}

const PYODIDE_URL = new URL(/* @vite-ignore */ "./native/pyodide/pyodide.mjs", import.meta.url).href

window.kernelCheck = (async () => {
  const kernel = new PyodideKernelClient({ pyodideUrl: PYODIDE_URL })
  const statuses: string[] = []
  kernel.onStatus(status => statuses.push(status))
  const run = async (code: string) => {
    const messages: unknown[] = []
    const reply = await kernel.execute(code, message => messages.push({ type: message.header.msg_type, content: message.content }))
    return { reply, messages }
  }
  const sum = await run("1 + 1")
  const printed = await run("print('hello')")
  const patchwork = await run("import piplite\nawait piplite.install('patchwork')\nimport patchwork\nprint(patchwork.__name__)")
  const completion = await kernel.complete("import o", 8)
  kernel.dispose()
  return { sum, printed, patchwork, completion, statuses }
})()
