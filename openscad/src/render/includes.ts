// How linked documents reach `include <x.scad>` / `use <x.scad>`, and what to
// say when one can't. Pure, so it runs in the worker and in node tests.
//
// The engine's working directory is `/`, where `/input.scad` lives, so an
// include path resolves to `/<path>`. A linked doc with OpenSCAD source is
// written there under its import name (`/<name>.scad`), and under its file
// name too when it is a file document named something else.

import type {RenderImportInput} from "./engine"

type Source = Pick<RenderImportInput, "name" | "scad" | "scadFile">

/** The files to write next to /input.scad. A name wins over a file name that equals it. */
export function sourceFiles(imports: readonly Source[]): {path: string; text: string}[] {
	const files = new Map<string, string>()
	for (const imp of imports) if (imp.scad !== undefined && imp.scadFile) files.set(baseName(imp.scadFile), imp.scad)
	for (const imp of imports) if (imp.scad !== undefined) files.set(`${imp.name}.scad`, imp.scad)
	return [...files].map(([path, text]) => ({path, text}))
}

/**
 * The generated `<name> = import("imports/<name>.json");` bindings, joined
 * onto the source's first line rather than put on a line of their own, so a
 * reported line number is the line in the source.
 */
export function withBindings(source: string, imports: readonly Pick<RenderImportInput, "name">[]): string {
	if (imports.length === 0) return source
	return imports.map(imp => `${imp.name} = import("imports/${imp.name}.json");`).join(" ") + " " + source
}

export type MissingInclude = {kind: "include" | "use"; path: string}

/** The includes the engine said it could not find (it warns and carries on). */
export function missingIncludes(logs: readonly string[]): MissingInclude[] {
	const out: MissingInclude[] = []
	for (const line of logs) {
		const include = /Can't find include file '([^']*)'/.exec(line)
		if (include) out.push({kind: "include", path: include[1]})
		const use = /Can't open library '([^']*)'/.exec(line)
		if (use) out.push({kind: "use", path: use[1]})
	}
	return out
}

/** The import an include path names: by import name (`x.scad` -> `x`) or by a file document's name. */
export function importFor<T extends Pick<RenderImportInput, "name" | "scadFile">>(
	path: string,
	imports: readonly T[],
): T | undefined {
	const file = baseName(path)
	return imports.find(imp => `${imp.name}.scad` === file) ?? imports.find(imp => imp.scadFile && baseName(imp.scadFile) === file)
}

/** An actionable message for every include that found nothing, or null when none failed. */
export function explainMissingIncludes(logs: readonly string[], imports: readonly RenderImportInput[]): string | null {
	const seen = new Set<string>()
	const lines: string[] = []
	for (const {kind, path} of missingIncludes(logs)) {
		if (seen.has(`${kind} ${path}`)) continue
		seen.add(`${kind} ${path}`)
		const imp = importFor(path, imports)
		if (imp) {
			lines.push(
				`${kind} <${path}> is attached as "${imp.label ?? imp.name}" but has no OpenSCAD source: ${imp.noScad ?? "it gave none"}`,
			)
		} else {
			const name = baseName(path).replace(/\.scad$/i, "")
			lines.push(
				`${kind} <${path}> matches no attached document. Attach it as "${name}": drag the document onto the Imports bar above the editor ` +
					`(a file document named "${baseName(path)}" also works). Agents: add {name: "${name}", docUrl, label} to this document's imports with doc_edit.`,
			)
		}
	}
	return lines.length ? lines.join("\n") : null
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1)
}
