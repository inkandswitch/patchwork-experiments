import {describe, expect, it} from "vitest"
import {createHash} from "node:crypto"
import {readFileSync, readdirSync} from "node:fs"
import {ENGINE_DIR, ENGINE_FILES} from "./engineFiles"

describe("the vendored engine", () => {
	const dir = new URL(`../../vendor/${ENGINE_DIR}/`, import.meta.url)

	it("matches its SHA256SUMS", () => {
		const sums = Object.fromEntries(
			readFileSync(new URL("SHA256SUMS", dir), "utf8")
				.trim()
				.split("\n")
				.map(line => line.trim().split(/\s+/).reverse()),
		)
		for (const file of ENGINE_FILES) {
			expect(createHash("sha256").update(readFileSync(new URL(file, dir))).digest("hex"), file).toBe(sums[file])
		}
	})

	it("is the only engine vendored", () => {
		expect(readdirSync(new URL("../../vendor/", import.meta.url)).filter(f => f !== "README.md")).toEqual([ENGINE_DIR])
	})
})
