import {describe, expect, it} from "vitest"
import {keptLogs, lastRunFrom, MAX_LINES, saveLastRun, worthSaving} from "./lastRun"

const run = (over: Partial<Parameters<typeof lastRunFrom>[0]> = {}) =>
	lastRunFrom({heads: ["h1"], source: "echo(cad_pack_volume_L = 42.5); cube(1);", imports: {a: 1}, ok: true, logs: ["ECHO: cad_pack_volume_L = 42.5"], at: new Date(0), ...over})

describe("the last run kept in the document", () => {
	it("keeps the console without the engine's start-up noise, capped", () => {
		expect(keptLogs(["Could not initialize localization (bad locale)", "ECHO: x_y = 1\nWARNING: z", ""])).toEqual(["ECHO: x_y = 1", "WARNING: z"])
		const many = keptLogs(Array.from({length: MAX_LINES + 5}, (_, i) => `ECHO: ${i}`))
		expect(many).toHaveLength(MAX_LINES + 1)
		expect(many.at(-1)).toBe("… 5 more lines not kept")
	})

	it("is saved exactly when the input, the outcome or the output differs, never for the time or heads alone", () => {
		const base = run()
		// Every combination of the four things that can differ.
		const changes = {
			source: {source: "echo(cad_pack_volume_L = 43); cube(1);"},
			imports: {imports: {a: 2}},
			ok: {ok: false},
			logs: {logs: ["ECHO: cad_pack_volume_L = 43"]},
		}
		const names = Object.keys(changes) as (keyof typeof changes)[]
		for (let mask = 0; mask < 1 << names.length; mask++) {
			const chosen = names.filter((_, i) => mask & (1 << i))
			const next = run(Object.assign({heads: ["h2"], at: new Date(1000)}, ...chosen.map(n => changes[n])))
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
