// PDF support: pandoc.wasm can't produce PDFs itself (that needs an external
// engine), so we follow the official pandoc-wasm demo: convert to Typst
// markup with pandoc, then compile it to PDF with the Typst WASM compiler,
// lazy-loaded from a CDN only when PDF output is requested.

import type {LoadedInput} from "./convert"

const TYPST_BUNDLE_URL =
	"https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-all-in-one.ts@0.7.0-rc2/dist/esm/index.js"

type TypstApi = {
	resetShadow(): void
	mapShadow(path: string, data: Uint8Array): void
	pdf(options: {mainFilePath: string}): Promise<Uint8Array>
}

declare global {
	// provided by the typst-all-in-one bundle once loaded
	var $typst: TypstApi | undefined
}

let typstPromise: Promise<TypstApi> | null = null

export function loadTypst(): Promise<TypstApi> {
	if (typstPromise) return typstPromise

	typstPromise = new Promise<TypstApi>((resolve, reject) => {
		if (globalThis.$typst) {
			resolve(globalThis.$typst)
			return
		}
		const script = document.createElement("script")
		script.type = "module"
		script.src = TYPST_BUNDLE_URL
		script.onload = () => {
			// the bundle sets the $typst global; give module evaluation a moment
			const startedAt = Date.now()
			const poll = () => {
				if (globalThis.$typst) resolve(globalThis.$typst)
				else if (Date.now() - startedAt > 10_000)
					reject(new Error("Typst library loaded but $typst is unavailable"))
				else setTimeout(poll, 50)
			}
			poll()
		}
		script.onerror = () => reject(new Error("Failed to load the Typst library"))
		document.head.appendChild(script)
	})

	typstPromise.catch(() => {
		typstPromise = null
	})
	return typstPromise
}

/** Compile Typst markup (plus resource files) to a PDF. */
export async function typstToPdf(
	typstSource: string,
	resources: LoadedInput[]
): Promise<Uint8Array> {
	const $typst = await loadTypst()
	const encoder = new TextEncoder()

	$typst.resetShadow()
	for (const resource of resources) {
		const bytes =
			typeof resource.content === "string"
				? encoder.encode(resource.content)
				: resource.content
		$typst.mapShadow(`/${resource.name}`, bytes)
	}
	$typst.mapShadow("/main.typ", encoder.encode(typstSource))

	const pdf = await $typst.pdf({mainFilePath: "/main.typ"})
	if (!pdf || pdf.length === 0) {
		throw new Error("Typst produced empty PDF output")
	}
	return pdf
}
