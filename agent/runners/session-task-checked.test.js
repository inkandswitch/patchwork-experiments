// @vitest-environment node
/**
 * A checker's tests of steps 2b and 3b (notes/SPEC-AGENT.md): what the
 * session task may import and touch where it runs, and what an agent tool
 * reads of a session's task.
 */
import { describe, it, expect } from "vitest"
import { build } from "esbuild"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { kernelRepo, TASK_REFUSAL } from "../kernel/kernel-repo.js"
import { askOf, needsApproval } from "../session/grants.js"
import { docRead } from "../tools/docs.js"

await initSubduction()

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("what runners/session-task.js imports", () => {
  it("names no bare module but Node's own, and those only from net/node-fetch.mjs, imported where `process` says Node", async () => {
    const result = await build({
      entryPoints: [join(ROOT, "runners/session-task.js")],
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "neutral",
      absWorkingDir: ROOT,
      logLevel: "silent",
      plugins: [{ name: "bare", setup: (b) => b.onResolve({ filter: /^[^./]/ }, (a) => ({ path: a.path, external: true })) }],
    })
    const bare = []
    for (const [file, info] of Object.entries(result.metafile.inputs)) for (const imp of info.imports) if (imp.external) bare.push({ file, path: imp.path, kind: imp.kind })
    // Automerge comes through host/modules.js's importSpecifier, never by a bare import.
    expect(bare).toEqual([{ file: "net/node-fetch.mjs", path: "node:dns/promises", kind: "import-statement" }])
    const nodeFetchFrom = Object.entries(result.metafile.inputs).flatMap(([file, info]) => info.imports.filter((imp) => imp.path === "net/node-fetch.mjs").map((imp) => ({ file, kind: imp.kind })))
    expect(nodeFetchFrom).toEqual([{ file: "runners/session-task.js", kind: "dynamic-import" }])
  })

  it("touches no window, document or storage as it loads", async () => {
    const names = ["window", "document", "localStorage", "sessionStorage", "indexedDB", "location", "customElements", "HTMLElement"]
    const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
    const touched = []
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get: () => (touched.push(name), undefined) })
    try {
      const mod = await import("./session-task.js")
      expect(typeof mod.default).toBe("function")
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    }
    expect(touched).toEqual([])
  })
})

describe("doc_read through the repo a session's tools are handed", () => {
  const KEY = "made-up-model-key-checked"
  function world() {
    const repo = new Repo({ network: [] })
    const session = repo.create({ title: "a session", config: {}, grants: {} })
    const task = repo.create({ importUrl: "data:text/javascript,", input: { session: session.url, keys: { model: KEY } }, key: `agent:${session.url}`, runs: [] })
    const plain = repo.create({ title: "an ordinary document" })
    return { repo, ctx: { repo: kernelRepo(repo), session: { url: session.url, doc: () => session.doc() } }, session, task, plain }
  }

  it("of a session's task is refused, and nothing of its input is in the error", async () => {
    const { ctx, task } = world()
    const read = docRead.execute({ url: task.url }, ctx)
    await expect(read).rejects.toThrow(TASK_REFUSAL)
    await expect(docRead.execute({ url: task.url, path: ["input", "keys"] }, ctx)).rejects.not.toThrow(KEY)
  })

  it("of an ordinary document runs without asking and reads it", async () => {
    const { ctx, session, plain } = world()
    const ask = askOf(docRead, { url: plain.url }, { sensitive: [] })
    expect(needsApproval(session.doc(), docRead, { url: plain.url }, ask)).toBe(false)
    expect(JSON.stringify(await docRead.execute({ url: plain.url }, ctx))).toContain("an ordinary document")
  })
})
