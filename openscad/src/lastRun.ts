/**
 * The document's last run, kept in the document so other tools can read what
 * it printed without running OpenSCAD themselves. An assumptions register,
 * for one, reads `echo(name = value)` lines as the model's results.
 *
 *   at             when it ran (ISO)
 *   heads          the document's heads it rendered: its source and imports then
 *   ok             whether it rendered
 *   logs           OpenSCAD's console: what the model printed (ECHO, WARNING,
 *                  ERROR…) and the shape of what it made, without the engine's
 *                  start-up noise or anything that changes from run to run by
 *                  itself (timings, cache sizes); at most MAX_LINES
 *   elapsedMillis  how long OpenSCAD took
 *   input          a fingerprint of the source it rendered
 *
 * Written only when the source, whether it worked, or what it printed
 * changed. Not when only a linked document changed and the model printed the
 * same: a model that imports a document it also feeds (an assumptions
 * register, say) would otherwise write on every change to it, and the two
 * would answer each other forever. Every open editor renders the same thing,
 * and only the first to finish writes.
 */

export type LastRun = {
	at: string
	heads: string[]
	ok: boolean
	logs: string[]
	elapsedMillis: number | null
	input: string
}

export const MAX_LINES = 2000
const MAX_LINE = 500

/** Lines that are nobody's output: start-up noise, and what differs from one run of the same thing to the next. */
const NOISE = /^\s*(Could not initialize localization|Geometries in cache|Geometry cache size|CGAL Polyhedrons in cache|CGAL cache size|Total rendering time|Compiling design|Rendering Polygon Mesh|Rendering finished|Normalized tree|Rendering cancelled)/

/** A short, stable hash (FNV-1a, 32-bit), as hex. */
export function fingerprint(text: string): string {
	let h = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, "0")
}

/** The console as it is kept: noise out, each line and the whole capped. */
export function keptLogs(logs: readonly string[]): string[] {
	const lines = logs.flatMap(l => String(l).split("\n")).filter(l => l.trim() && !NOISE.test(l))
	const kept = lines.slice(0, MAX_LINES).map(l => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l))
	if (lines.length > MAX_LINES) kept.push(`… ${lines.length - MAX_LINES} more lines not kept`)
	return kept
}

/** The run to keep, from what a render was given and what it did. */
export function lastRunFrom(args: {heads: readonly string[]; source: string; imports: unknown; ok: boolean; logs: readonly string[]; elapsedMillis?: number | null; at?: Date}): LastRun {
	return {
		at: (args.at ?? new Date()).toISOString(),
		heads: [...args.heads],
		ok: args.ok,
		logs: keptLogs(args.logs),
		elapsedMillis: args.elapsedMillis ?? null,
		input: fingerprint(args.source),
	}
}

/** Whether `next` says anything `prev` doesn't: a different input, outcome or output. */
export function worthSaving(prev: Partial<LastRun> | null | undefined, next: LastRun): boolean {
	if (!prev) return true
	if (prev.input !== next.input || prev.ok !== next.ok) return true
	const before = prev.logs ?? []
	return before.length !== next.logs.length || before.some((line, i) => String(line) !== next.logs[i])
}

/** Save a run in the document if it says something new. Returns whether it wrote. */
export function saveLastRun(handle: {doc(): any; change(fn: (d: any) => void, opts?: {message?: string}): void}, run: LastRun): boolean {
	if (!worthSaving(handle.doc()?.lastRun, run)) return false
	handle.change(
		d => {
			d.lastRun = JSON.parse(JSON.stringify(run))
		},
		{message: run.ok ? "openscad: keep the last run's console" : "openscad: keep the last run's error"},
	)
	return true
}
