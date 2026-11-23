import {describe, expect, it} from "vitest"
import {OpenscadDatatype} from "./datatype"
import type {OpenscadDoc} from "./types"

const doc = (source: unknown) => ({title: "Lib", source}) as unknown as OpenscadDoc

describe("OpenscadDatatype.asSource", () => {
	it("gives its OpenSCAD text for scad", () => {
		expect(OpenscadDatatype.asSource(doc("module m() cube(1);"), "scad")).toBe("module m() cube(1);")
	})

	it("reads an ImmutableString-shaped source", () => {
		expect(OpenscadDatatype.asSource(doc({val: "x = 2;"}), "scad")).toBe("x = 2;")
	})

	it("gives nothing for any other format", () => {
		for (const format of ["py", "json", "txt", ""]) expect(OpenscadDatatype.asSource(doc("x = 1;"), format)).toBeNull()
	})

	it("gives nothing when there is no source text", () => {
		for (const source of [undefined, null, 3, {val: 4}]) expect(OpenscadDatatype.asSource(doc(source), "scad")).toBeNull()
	})
})
