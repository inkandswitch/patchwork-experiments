import {describe, expect, it} from "vitest"
import {openscadArgs} from "./args"

describe("openscadArgs", () => {
	it("renders with the Manifold backend to binary STL", () => {
		expect(openscadArgs({input: "/input.scad", output: "/model.stl", hasImports: false})).toEqual([
			"/input.scad",
			"--backend=manifold",
			"--export-format=binstl",
			"-o",
			"/model.stl",
		])
	})

	it("enables import-function only when imports are bound", () => {
		const args = openscadArgs({input: "/input.scad", output: "/model.stl", hasImports: true})
		expect(args).toContain("--enable=import-function")
		expect(args).toContain("--backend=manifold")
		expect(args).not.toContain("--enable=manifold") // not a feature in this OpenSCAD; ignored with a warning
	})
})
