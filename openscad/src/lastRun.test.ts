import {describe, expect, it} from "vitest"
import {keptLogs, lastRunFrom, MAX_LINES, saveLastRun, worthSaving} from "./lastRun"

const run = (over: Partial<Parameters<typeof lastRunFrom>[0]> = {}) =>
	lastRunFrom({heads: ["h1"], source: "echo(cad_pack_volume_L = 42.5); cube(1);", imports: {a: 1}, ok: true, logs: ["ECHO: cad_pack_volume_L = 42.5"], at: new Date(0), ...over})

describe("the last run kept in the document", () => {
	it("keeps the console without the engine's start-up noise, capped", () => {
		expect(keptLogs(["Could not initialize localization (bad locale)", "ECHO: x_y = 1\nWARNING: z", ""])).toEqual(["ECHO: x_y = 1", "WARNING: z"])
		// What a real run prints that changes by itself from one run to the next.
		const volatile = ["Geometries in cache: 64", "Geometry cache size in bytes: 102272", "CGAL Polyhedrons in cache: 60", "CGAL cache size in bytes: 3262250", "Total rendering time: 0:00:00.039"]
		expect(keptLogs([...volatile, "   Status:     NoError", "   Facets:        216"])).toEqual(["   Status:     NoError", "   Facets:        216"])
		const many = keptLogs(Array.from({length: MAX_LINES + 5}, (_, i) => `ECHO: ${i}`))
		expect(many).toHaveLength(MAX_LINES + 1)
		expect(many.at(-1)).toBe("… 5 more lines not kept")
	})

	it("is saved exactly when the source, the outcome or the output differs; never for the time, the heads, a linked document or timings alone", () => {
		const base = run()
		// Every combination of the four things that can differ.
		const changes = {
			source: {source: "echo(cad_pack_volume_L = 43); cube(1);"},
			ok: {ok: false},
			logs: {logs: ["ECHO: cad_pack_volume_L = 43"]},
		}
		const names = Object.keys(changes) as (keyof typeof changes)[]
		for (let mask = 0; mask < 1 << names.length; mask++) {
			const chosen = names.filter((_, i) => mask & (1 << i))
			// A linked document changed and the run timed differently every time: neither counts.
			const next = run(Object.assign({heads: ["h2"], at: new Date(1000), imports: {a: mask}, elapsedMillis: mask}, ...chosen.map(n => changes[n])))
			if (!chosen.includes("logs")) next.logs = keptLogs([...next.logs, `Total rendering time: 0:00:00.0${mask}`])
			expect(worthSaving(base, next), chosen.join("+") || "time and heads only").toBe(chosen.length > 0)
		}
		expect(worthSaving(undefined, base)).toBe(true)
	})

	it("writes once, however many editors render the same thing", () => {
		let doc: any = {source: ""}
		let writes = 0
		const handle = {doc: () => doc, change: (fn: (d: any) => void) => (writes++, fn(doc))}
		expect(saveLastRun(handle, run())).toBe(true)
		expect(saveLastRun(handle, run({heads: ["h9"], at: new Date(5000)}))).toBe(false)
		expect(saveLastRun(handle, run({logs: ["ECHO: cad_pack_volume_L = 44"]}))).toBe(true)
		expect(writes).toBe(2)
		expect(doc.lastRun.logs).toEqual(["ECHO: cad_pack_volume_L = 44"])
	})
})
