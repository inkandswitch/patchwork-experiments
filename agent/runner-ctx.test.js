/**
 * What a plugin tool's ctx holds in a tab: the page's plugin registry
 * (`ctx.plugins`) and its automerge, initialised (`ctx.automerge`). The
 * SharedWorker's ctx is checked in a real browser by
 * probes/worker-plugin-tool.mjs; its registry mirror in worker-plugins.test.js.
 */
import { describe, it, expect } from "vitest"
import { join } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge/slim"
import { setHostUrls } from "./host-urls.js"
import { initSession } from "./session.js"
import { startTabRunner } from "./tab-runner.js"
import { stopRunner } from "./runners.js"

await initSubduction()

// The page's registry module, standing in for @inkandswitch/patchwork-plugins.
const pluginsFile = join(import.meta.dirname ?? process.cwd(), "fixtures", "fake-plugins.js")

describe("a plugin tool's ctx in a tab", () => {
  it("holds the page's registry module and its automerge", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": pluginsFile })
    try {
      const repo = new Repo({ network: [] })
      const handle = repo.create({})
      handle.change((d) => initSession(d, { title: "t" }))
      const entry = await startTabRunner(handle, { repo, canRun: () => false })
      try {
        expect(entry.ctx.plugins.marker).toBe("the page's registry")
        expect(entry.ctx.plugins.getRegistry("patchwork:datatype").type).toBe("patchwork:datatype")
        // The host's automerge — the module documents are made with — not a copy.
        expect(entry.ctx.automerge.getHeads).toBe(Automerge.getHeads)
        expect(entry.ctx.splice).toBe(entry.ctx.automerge.splice)
      } finally {
        stopRunner(handle.url)
      }
    } finally {
      setHostUrls(null)
    }
  })
})
