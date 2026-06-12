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
	if (req.standalone) options.standalone = true
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
