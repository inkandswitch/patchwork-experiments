// A linked document as the render engine takes it: its JSON, plus its OpenSCAD
// source when it has one, so `include <x.scad>` and `use <x.scad>` can read it.
// The editor (importResolver.ts) and the scene source (scene/source.ts) both
// build their render inputs here, so they resolve the same way.
//
// OpenSCAD source comes from, in order:
//  1. the linked doc's datatype, looked up in the plugin registry by its
//     `@patchwork.type`: if the implementation has `asSource(doc, "scad")` and
//     it returns a string, that string. (null or undefined: on to the next.)
//     The third argument is `{for: <the including document's own URL>}`, so a
//     register can leave out results the including model computes itself.
//  2. a file document's text.
//  3. nothing, with the reason in `noScad`, for the error an include of it gets.

import {docToJsonString} from "./imports"
import type {OpenscadImport} from "./types"
import type {RenderImportInput} from "./render/engine"

/** Loads a datatype implementation by id; undefined when there is none. */
export type LoadDatatype = (type: string) => Promise<unknown>

/** The datatype implementations the host's plugin registry has, loaded on demand. */
export const registryDatatype: LoadDatatype = async type => {
	const {getRegistry} = await import("@inkandswitch/patchwork-plugins")
	const loaded = (await (getRegistry("patchwork:datatype") as any).load(type)) as {module?: unknown} | undefined
	return loaded?.module
}

type AsSource = {asSource?: (doc: unknown, format: string, options?: {for?: string}) => unknown}

export type LinkedSource = {scad?: string; scadFile?: string; noScad?: string}

export async function linkedSource(
	doc: unknown,
	loadDatatype: LoadDatatype = registryDatatype,
	forUrl?: string,
): Promise<LinkedSource> {
	if (doc === null || typeof doc !== "object") {
		return {noScad: "the document is not available (still loading, or not reachable)"}
	}
	const record = doc as Record<string, unknown>
	const type = (record["@patchwork"] as {type?: unknown} | undefined)?.type

	if (typeof type === "string") {
		let impl: AsSource | undefined
		try {
			impl = (await loadDatatype(type)) as AsSource | undefined
		} catch {
			impl = undefined
		}
		if (typeof impl?.asSource === "function") {
			try {
				const text = impl.asSource(doc, "scad", forUrl ? {for: forUrl} : {})
				if (typeof text === "string") return {scad: text}
			} catch (err) {
				return {noScad: `its "${type}" datatype's asSource(doc, "scad") failed: ${(err as Error)?.message ?? err}`}
			}
		}
	}

	const name = typeof record.name === "string" ? record.name : ""
	const isFile = type === "file" || /\.scad$/i.test(name)
	if (isFile && "content" in record) {
		const content = record.content
		if (content instanceof Uint8Array) return {noScad: "it is a binary file, not text"}
		if (content !== null && content !== undefined) {
			return {scad: String(content), ...(/\.scad$/i.test(name) ? {scadFile: name} : {})}
		}
	}

	const what = typeof type === "string" ? `a "${type}" document` : "a document with no type"
	return {noScad: `${what} has no OpenSCAD form: its datatype has no asSource(doc, "scad"), and it is not a text file`}
}

/** One import as the engine takes it: JSON always, OpenSCAD source when the doc has some. */
export async function importInput(
	imp: Pick<OpenscadImport, "name" | "label">,
	doc: unknown,
	loadDatatype?: LoadDatatype,
	/** the including OpenSCAD document's own URL, passed to asSource as `for` */
	forUrl?: string,
): Promise<RenderImportInput> {
	return {
		name: String(imp.name),
		json: docToJsonString(doc),
		...(imp.label ? {label: imp.label} : {}),
		...(await linkedSource(doc, loadDatatype, forUrl)),
	}
}
