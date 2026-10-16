import {describe, expect, it} from "vitest"
import {plugins} from "./index"

describe("plugin metadata", () => {
	const source = plugins.find(p => p.type === "scene:source") as Record<string, any>

	it("declares the scene provider's cost and an integer version", () => {
		expect(source.id).toBe("openscad-model")
		expect(source.cost).toBe("expensive")
		expect(Number.isInteger(source.version)).toBe(true)
		expect(source.version).toBeGreaterThanOrEqual(1)
	})

	it("is plain data apart from load(), so the host can read it in a worker", () => {
		for (const plugin of plugins) {
			const {load, ...meta} = plugin
			expect(typeof load).toBe("function")
			expect(structuredClone(meta)).toEqual(meta)
		}
	})
})
