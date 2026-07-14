// Turns whatever document the user currently has focused into a single pandoc
// input. Focused docs are rarely tidy files with extensions, so this applies a
// few heuristics (and honours stored per-source overrides) to pick the content
// and the source format. A manual `from` override always wins.

import type {FileDocShape, PandocSourceSettings} from "./types"
import type {LoadedInput} from "./pandoc/convert"
import {asContent, guessExtensionForValue, isFileLikeDoc, valueAtPath} from "./files"
import {detectFormat, formatByExtension} from "./pandoc/formats"

/** Fields, in priority order, that commonly hold a doc's primary text. */
const CONTENT_FIELDS = [
	"content",
	"text",
	"body",
	"source",
	"markdown",
	"md",
	"value",
]

/** Map known Patchwork datatypes to a likely pandoc reader. */
const TYPE_TO_FORMAT: Record<string, string> = {
	markdown: "markdown",
	md: "markdown",
	essay: "markdown",
	notes: "markdown",
	note: "markdown",
	text: "markdown",
	paper: "markdown",
	document: "markdown",
	prosemirror: "markdown",
	html: "html",
	latex: "latex",
	tex: "latex",
	typst: "typst",
}

export type FocusResolution =
	| {status: "empty"}
	| {status: "ok"; input: LoadedInput; from: string; fieldLabel: string}
	/** doc has no obvious text field — let the user pick one (or whole JSON). */
	| {status: "pick"}

export function docTypeOf(doc: FileDocShape | undefined): string | undefined {
	return doc?.["@patchwork"]?.type
}

/** A pandoc-friendly base name for the focused doc (may lack an extension). */
export function focusName(doc: FileDocShape | undefined, fallback: string): string {
	const raw =
		(typeof doc?.name === "string" && doc.name) ||
		(typeof doc?.title === "string" && doc.title) ||
		fallback
	return raw
}

function ensureExtension(name: string, ext: string): string {
	return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.${ext}`
}

function guessFrom(
	name: string,
	content: string | Uint8Array,
	docType: string | undefined
): string {
	const byName = detectFormat(name)
	if (byName) return byName
	if (docType && TYPE_TO_FORMAT[docType]) return TYPE_TO_FORMAT[docType]
	const ext = guessExtensionForValue(content)
	return formatByExtension[ext] || "markdown"
}

function firstContentField(
	doc: FileDocShape
): {path: string[]; value: string} | null {
	for (const key of CONTENT_FIELDS) {
		const c = asContent((doc as Record<string, unknown>)[key])
		if (typeof c === "string" && c.trim()) return {path: [key], value: c}
	}
	return null
}

export function resolveFocused(
	doc: FileDocShape | undefined,
	opts: {name: string; settings?: PandocSourceSettings}
): FocusResolution {
	if (!doc) return {status: "empty"}
	const type = docTypeOf(doc)
	const settings = opts.settings ?? {}
	const from = settings.from

	// whole-doc-as-JSON override
	if (settings.whole) {
		const stripped: Record<string, unknown> = {...(doc as Record<string, unknown>)}
		delete stripped["@patchwork"]
		const content = JSON.stringify(stripped, null, 2)
		return {
			status: "ok",
			input: {name: ensureExtension(opts.name, "json"), content},
			from: from || "json",
			fieldLabel: "whole document (JSON)",
		}
	}

	// explicit stored field path override
	if (settings.path) {
		const value = valueAtPath(doc, settings.path)
		const content = asContent(value) ?? JSON.stringify(value ?? null, null, 2)
		return {
			status: "ok",
			input: {name: opts.name, content},
			from: from || guessFrom(opts.name, content, type),
			fieldLabel: `.${settings.path.join(".")}`,
		}
	}

	// plain file doc → use its content directly
	if (isFileLikeDoc(doc)) {
		const content = asContent(doc.content)!
		return {
			status: "ok",
			input: {name: opts.name, content},
			from: from || guessFrom(opts.name, content, type),
			fieldLabel: "file contents",
		}
	}

	// known text field on a structured doc
	const field = firstContentField(doc)
	if (field) {
		return {
			status: "ok",
			input: {name: opts.name, content: field.value},
			from: from || guessFrom(opts.name, field.value, type),
			fieldLabel: `.${field.path.join(".")}`,
		}
	}

	// nothing obvious — the UI offers a field picker
	return {status: "pick"}
}
