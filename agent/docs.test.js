import { describe, it, expect } from "vitest"
import { docRead } from "./tools/docs.js"

describe("reading a long string in ranges", () => {
  const body = Array.from({ length: 30000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("")

  function pageRepo() {
    const doc = { name: "Page.md", content: body, "@patchwork": { type: "file" } }
    return { async find() { return { url: "automerge:page", doc: () => doc } } }
  }
  const ctx = () => ({ repo: pageRepo(), subject: "automerge:page" })

  it("summarizes the string when no range is asked for", async () => {
    const out = await docRead.execute({ url: "automerge:page", path: ["content"] }, ctx())
    expect(out).toContain("more chars]")
    expect(out.length).toBeLessThan(3000)
  })

  it("returns the slice asked for, and says where it is", async () => {
    const out = await docRead.execute(
      { url: "automerge:page", path: ["content"], offset: 8000, limit: 100 },
      ctx()
    )
    expect(out).toContain("characters 8000–8100 of 30000")
    expect(out).toContain("21900 remaining (read on with offset: 8100)")
    expect(out.endsWith(body.slice(8000, 8100))).toBe(true)
  })

  it("says when it has reached the end", async () => {
    const out = await docRead.execute(
      { url: "automerge:page", path: ["content"], offset: 29900 },
      ctx()
    )
    expect(out).toContain("characters 29900–30000 of 30000, to the end")
    expect(out).not.toContain("remaining")
  })

  it("clamps a range that runs off either end", async () => {
    const past = await docRead.execute({ url: "automerge:page", path: ["content"], offset: 99999 }, ctx())
    expect(past).toContain("characters 30000–30000 of 30000, to the end")

    const negative = await docRead.execute(
      { url: "automerge:page", path: ["content"], offset: -50, limit: 10 },
      ctx()
    )
    expect(negative).toContain("characters 0–10 of 30000")
  })

  it("pages through the whole string without gaps or overlaps", async () => {
    let offset = 0
    let assembled = ""
    while (offset < body.length) {
      const out = await docRead.execute(
        { url: "automerge:page", path: ["content"], offset, limit: 9000 },
        ctx()
      )
      assembled += out.slice(out.indexOf("\n\n") + 2)
      const next = out.match(/offset: (\d+)/)
      if (!next) break
      offset = Number(next[1])
    }
    expect(assembled).toBe(body)
  })
})
