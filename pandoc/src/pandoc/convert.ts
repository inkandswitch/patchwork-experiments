import {loadEngine} from "./engine"
import {typstToPdf} from "./typst"
import {
	autoOutputFormat,
	binaryFormats,
	detectFormat,
	extensionByFormat,
	htmlPreviewFormats,
} from "./formats"

export type LoadedInput = {
	name: string
	content: string | Uint8Array
}

export type ConversionRequest = {
	inputs: LoadedInput[]
	mainIndex: number
	from: string // reader name (or "auto" for legacy docs)
	to: string // writer name (or "auto" for legacy docs)
	standalone: boolean
}

export type ConversionResult = {
	/** the writer that was actually used */
	to: string
	/** suggested output file name, e.g. "paper.html" */
	filename: string
	kind: "text" | "binary"
	text?: string
	blob?: Blob
	htmlPreview: boolean
	pdfPreview: boolean
	warnings: string[]
}

export class ConversionError extends Error {}

function baseName(name: string): string {
	const base = name.split("/").pop() || name
	const i = base.lastIndexOf(".")
	return i > 0 ? base.slice(0, i) : base
}

/** Best-effort UI language for the `lang` metadata default. */
function defaultLang(): string {
	try {
		return (typeof navigator !== "undefined" && navigator.language) || "en"
	} catch {
		return "en"
	}
}

/**
 * Whether the main input already declares a document language, so we don't
 * clobber it with the default. Covers HTML `lang=` and YAML/pandoc metadata
 * `lang:` — enough to silence pandoc's "No value for 'lang'" warning without
 * overriding an author's explicit choice.
 */
function hasExplicitLang(
	input: LoadedInput | undefined,
	from: string | null
): boolean {
	if (!input || typeof input.content !== "string") return false
	const content = input.content
	if (from && from.includes("html")) return /<html[^>]*\slang=/i.test(content)
	return /^-{3,}[\s\S]*?^lang\s*:/m.test(content) || /^lang\s*:/m.test(content)
}

/** Whether the main input already declares a title (frontmatter / % / <title>). */
function hasExplicitTitle(
	input: LoadedInput | undefined,
	from: string | null
): boolean {
	if (!input || typeof input.content !== "string") return false
	const content = input.content
	if (from && from.includes("html")) return /<title[\s>]/i.test(content)
	return (
		/^-{3,}[\s\S]*?^title\s*:/m.test(content) ||
		/^title\s*:/m.test(content) ||
		/^%\s+\S/.test(content)
	)
}

/**
 * Fill in default metadata for standalone output so pandoc doesn't emit
 * `lang`/`title` warnings that would clutter the UI, without changing what the
 * document actually shows:
 *   - `lang` metadata: invisible, set for every standalone render.
 *   - `pagetitle` *variable* (HTML family only): sets the head `<title>` and
 *     silences the "nonempty <title>" warning. We deliberately do NOT set the
 *     `title` metadata, which pandoc renders as a visible `<h1 class="title">`.
 */
function applyMetadataDefaults(
	options: Record<string, unknown>,
	main: LoadedInput | undefined,
	from: string | null,
	to: string
): void {
	const metadata = {...((options.metadata as Record<string, unknown>) ?? {})}
	if (!metadata.lang && !hasExplicitLang(main, from)) metadata.lang = defaultLang()
	options.metadata = metadata

	if (htmlPreviewFormats.has(to) && main && !hasExplicitTitle(main, from)) {
		const variables = {
			...((options.variables as Record<string, unknown>) ?? {}),
		}
		if (!variables.pagetitle) variables.pagetitle = baseName(main.name)
		options.variables = variables
	}
}

export function resolveFromFormat(
	req: Pick<ConversionRequest, "inputs" | "mainIndex" | "from">
): string | null {
	if (req.from && req.from !== "auto") return req.from
	const main = req.inputs[req.mainIndex]
	return main ? detectFormat(main.name) : null
}

export function resolveToFormat(
	req: Pick<ConversionRequest, "inputs" | "mainIndex" | "from" | "to">
): string {
	if (req.to && req.to !== "auto") return req.to
	return autoOutputFormat(resolveFromFormat(req) || "markdown")
}

function collectWarnings(result: {
	warnings: {verbosity?: string; pretty?: string; message?: string}[]
}): string[] {
	return (result.warnings || []).map(
		w => w.pretty || w.message || JSON.stringify(w)
	)
}

export async function runConversion(
	req: ConversionRequest
): Promise<ConversionResult> {
	const main = req.inputs[req.mainIndex]
	if (!main) throw new ConversionError("No input document selected")

	const engine = await loadEngine()

	const from = resolveFromFormat(req)
	const to = resolveToFormat(req)

	const files: Record<string, Blob | string> = {}
	for (const input of req.inputs) {
		files[input.name] =
			typeof input.content === "string"
				? input.content
				: new Blob([input.content as BlobPart])
	}

	// PDF can't be produced by pandoc.wasm directly (needs an external
	// engine), so convert to Typst and compile that to PDF in the browser.
	if (to === "pdf") {
		const options: Record<string, unknown> = {
			to: "typst",
			standalone: true,
			"input-files": [main.name],
		}
		if (from) options.from = from
		applyMetadataDefaults(options, main, from, "typst")

		const result = await engine.convert(options, null, files)
		if (result.stderr && result.stderr.includes("ERROR")) {
			throw new ConversionError(result.stderr)
		}

		const pdf = await typstToPdf(result.stdout, req.inputs)
		return {
			to: "pdf",
			filename: `${baseName(main.name)}.pdf`,
			kind: "binary",
			blob: new Blob([pdf as BlobPart], {type: "application/pdf"}),
			htmlPreview: false,
			pdfPreview: true,
			warnings: collectWarnings(result),
		}
	}

	const outputFile = `${baseName(main.name)}.${extensionByFormat[to] || to}`

	const options: Record<string, unknown> = {
		to,
		"output-file": outputFile,
		"input-files": [main.name],
	}
	if (from) options.from = from
	if (req.standalone) {
		options.standalone = true
		// Missing `lang`/`title` otherwise surface as pandoc warnings.
		applyMetadataDefaults(options, main, from, to)
	}
	// Inline images/css provided as resources so the HTML preview is self-contained
	if (htmlPreviewFormats.has(to)) options["embed-resources"] = true

	const result = await engine.convert(options, null, files)

	if (result.stderr && result.stderr.includes("ERROR")) {
		throw new ConversionError(result.stderr)
	}

	const warnings = collectWarnings(result)

	const output = result.files[outputFile]
	if (output === undefined && !result.stdout) {
		throw new ConversionError(result.stderr || "Pandoc produced no output")
	}

	if (binaryFormats.has(to)) {
		const blob =
			output instanceof Blob ? output : new Blob([(output as string) ?? ""])
		return {
			to,
			filename: outputFile,
			kind: "binary",
			blob,
			htmlPreview: false,
			pdfPreview: false,
			warnings,
		}
	}

	const text =
		output instanceof Blob
			? await output.text()
			: typeof output === "string"
				? output
				: result.stdout
	return {
		to,
		filename: outputFile,
		kind: "text",
		text,
		htmlPreview: htmlPreviewFormats.has(to),
		pdfPreview: false,
		warnings,
	}
}
