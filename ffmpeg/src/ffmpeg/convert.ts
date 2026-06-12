import {loadEngine, onLog} from "./engine"
import {OUTPUT_FORMATS, mimeByExtension, previewKind, type MediaKind} from "./formats"

export type LoadedInput = {
	name: string
	content: string | Uint8Array
}

export type ConversionRequest = {
	inputs: LoadedInput[]
	mainIndex: number
	/** target extension, e.g. "mp4" */
	to: string
	/** extra ffmpeg args (raw string, shell-ish quoting supported) */
	extraArgs?: string
	onProgress?: (ratio: number) => void
}

export type ConversionResult = {
	to: string
	filename: string
	blob: Blob
	/** how to preview the output; null falls back to a download card */
	preview: MediaKind | null
	/** the full ffmpeg command that was run (for display) */
	command: string
}

export class ConversionError extends Error {
	log: string[]
	constructor(message: string, log: string[] = []) {
		super(message)
		this.log = log
	}
}

function baseName(name: string): string {
	const base = name.split("/").pop() || name
	const i = base.lastIndexOf(".")
	return i > 0 ? base.slice(0, i) : base
}

/** Split an args string, honoring single/double quotes. */
export function parseArgs(s: string): string[] {
	const out: string[] = []
	for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
		out.push(m[1] ?? m[2] ?? m[3])
	}
	return out
}

export async function runConversion(
	req: ConversionRequest
): Promise<ConversionResult> {
	const main = req.inputs[req.mainIndex]
	if (!main) throw new ConversionError("No input file selected")

	const engine = await loadEngine()

	const encoder = new TextEncoder()
	const inputs = req.inputs.map(input => ({
		name: input.name,
		data:
			typeof input.content === "string"
				? encoder.encode(input.content)
				: input.content,
	}))

	const outputName = `${baseName(main.name)}.${req.to}`
	const kind = OUTPUT_FORMATS.find(f => f.ext === req.to)?.kind

	const args = ["-y", "-i", main.name]
	args.push(...parseArgs(req.extraArgs ?? ""))
	// image targets: emit a single frame instead of an image sequence
	if (kind === "image") args.push("-frames:v", "1", "-update", "1")
	args.push(outputName)

	// capture the log during this job so errors are actionable
	const log: string[] = []
	const unsubscribe = onLog(line => {
		log.push(line)
		if (log.length > 400) log.shift()
	})

	try {
		const data = await engine.run({
			args,
			inputs,
			outputName,
			onProgress: req.onProgress,
		})
		if (data.byteLength === 0) {
			throw new Error("ffmpeg produced an empty file")
		}
		return {
			to: req.to,
			filename: outputName,
			blob: new Blob([data as BlobPart], {
				type: mimeByExtension[req.to] || "application/octet-stream",
			}),
			preview: previewKind(req.to),
			command: `ffmpeg ${args.join(" ")}`,
		}
	} catch (err) {
		const tail = log.slice(-12)
		throw new ConversionError(
			String((err as Error)?.message ?? err) +
				(tail.length > 0 ? `\n\n${tail.join("\n")}` : ""),
			log
		)
	} finally {
		unsubscribe()
	}
}
