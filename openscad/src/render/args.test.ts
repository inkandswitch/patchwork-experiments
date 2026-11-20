import {describe, expect, it} from "vitest"
import {openscadArgs} from "./args"

describe("openscadArgs", () => {
	it("renders with the Manifold backend to OFF, which keeps colours", () => {
		expect(openscadArgs({input: "/input.scad", output: "/model.off"})).toEqual([
			"/input.scad",
			"--backend=manifold",
			"--export-format=off",
			"-o",
			"/model.off",
		])
	})

	it("enables no experimental features (JSON import() is standard in this OpenSCAD)", () => {
		expect(openscadArgs({input: "/input.scad", output: "/model.off"}).some(a => a.startsWith("--enable"))).toBe(false)
	})
})
