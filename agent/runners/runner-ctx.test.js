/**
 * What a plugin tool's ctx holds in a page (runners/page.js pageContext):
 * the page's plugin registry (`ctx.plugins`) and its automerge, initialised
 * (`ctx.automerge`). A burst in a pool's worker imports no plugin code: its
 * plugin calls park for a page (runners/placement.test.js).
 */
import { describe, it, expect } from "vitest"
import { join } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge/slim"
import { setHostUrls } from "../host/urls.js"
import { initSession } from "../session/schema.js"
import { pageContext } from "./page.js"

await initSubduction()

// The page's registry module, standing in for @inkandswitch/patchwork-plugins.
const pluginsFile = join(process.cwd(), "fixtures", "fake-plugins.js")

describe("a plugin tool's ctx in a page", () => {
  it("holds the page's registry module and its automerge, and reads the session's subject and where tools mount afresh", async () => {
    setHostUrls({ "@inkandswitch/patchwork-plugins": pluginsFile })
    try {
      const repo = new Repo({ network: [] })
      const handle = repo.create({})
      handle.change((d) => initSession(d, { title: "t", subject: "automerge:first" }))
      const view = { element: null }
      const ctx = await pageContext(handle, { repo, view })
      expect(ctx.plugins.marker).toBe("the page's registry")
      expect(ctx.plugins.getRegistry("patchwork:datatype").type).toBe("patchwork:datatype")
      // The host's automerge — the module documents are made with — not a copy.
      expect(ctx.automerge.getHeads).toBe(Automerge.getHeads)
      expect(ctx.splice).toBe(ctx.automerge.splice)
      expect(ctx.repo).toBe(repo)
      // Getters: each call reads them as they are then.
      expect([ctx.subject, ctx.element]).toEqual(["automerge:first", null])
      handle.change((d) => (d.subject = "automerge:second"))
      view.element = "an element"
      expect([ctx.subject, ctx.element]).toEqual(["automerge:second", "an element"])
    } finally {
      setHostUrls(null)
    }
  })
})
