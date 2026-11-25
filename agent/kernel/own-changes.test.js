import { describe, it, expect } from "vitest"
import { rememberOwn, isOwn, addedHeads, OWN_KEPT } from "./own-changes.js"

describe("own changes", () => {
  it("the heads a mutation added are those after it that were not before", () => {
    expect(addedHeads(["a", "b"], ["b", "c"])).toEqual(["c"])
    expect(addedHeads(["a"], ["a"])).toEqual([])
    expect(addedHeads(null, ["x"])).toEqual(["x"])
  })

  it("are kept per session, and only the newest", () => {
    rememberOwn("s1", ["h0"])
    expect(isOwn("s1", "h0")).toBe(true)
    expect(isOwn("s2", "h0")).toBe(false)
    rememberOwn("s1", Array.from({ length: OWN_KEPT }, (_, i) => `n${i}`))
    expect(isOwn("s1", "h0")).toBe(false)
    expect(isOwn("s1", `n${OWN_KEPT - 1}`)).toBe(true)
  })
})
