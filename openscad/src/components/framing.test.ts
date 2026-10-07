import {describe, it, expect} from "vitest"
import {needsReframe} from "./framing"

describe("viewer framing", () => {
	it("keeps the camera across ordinary edits", () => {
		expect(needsReframe(10, 12)).toBe(false)
		expect(needsReframe(10, 5)).toBe(false)
	})
	it("re-frames when the part is a very different size", () => {
		expect(needsReframe(1, 14)).toBe(true) // a placeholder, then the imported size arrives
		expect(needsReframe(100, 2)).toBe(true)
		expect(needsReframe(0, 3)).toBe(true) // never framed
	})
	it("ignores empty or broken geometry", () => {
		expect(needsReframe(10, 0)).toBe(false)
		expect(needsReframe(10, NaN)).toBe(false)
	})
})
