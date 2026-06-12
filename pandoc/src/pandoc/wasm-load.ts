// Downloads the official pandoc WASM binary from a CDN on first use, caches
// it in the Cache API, and instantiates the pandoc-wasm core with it.
// Runs either inside the engine worker or (as a fallback) on the main thread.

import {createPandocInstance, type RawPandocInstance} from "pandoc-wasm-core"

/** pandoc-wasm npm version we pin; ships pandoc 3.9 */
const PANDOC_WASM_VERSION = "1.0.1"
export const PANDOC_VERSION = "3.9"

const WASM_URLS = [
	`https://unpkg.com/pandoc-wasm@${PANDOC_WASM_VERSION}/src/pandoc.wasm`,
	// fallback mirror (tracks latest release rather than a pinned version)
	"https://pandoc.github.io/pandoc-wasm/pandoc.wasm",
]

const CACHE_NAME = "pandoc-wasm"

export type LoadProgress = {
	phase: "downloading" | "starting"
	/** bytes downloaded so far (over the wire) */
	loaded: number
	/** total bytes if known */
	total: number | null
	/** true when the binary came from the local cache (no download needed) */
	fromCache: boolean
}

export type EngineInfo = {
	version: string
	inputFormats: string[]
	outputFormats: string[]
}

async function openCache(): Promise<Cache | null> {
	try {
		return await caches.open(CACHE_NAME)
	} catch {
		// Cache API unavailable (e.g. insecure context) - just skip caching
		return null
	}
}

async function download(
	url: string,
	onProgress: (p: LoadProgress) => void
): Promise<ArrayBuffer> {
	const response = await fetch(url)
	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status}`)
	}

	// content-length is the compressed size when the CDN serves gzip/brotli,
	// which still gives a meaningful progress fraction
	const total = Number(response.headers.get("content-length")) || null
	let loaded = 0
	const chunks: Uint8Array[] = []
	const reader = response.body.getReader()
	for (;;) {
		const {done, value} = await reader.read()
		if (done) break
		chunks.push(value)
		loaded += value.byteLength
		onProgress({phase: "downloading", loaded, total, fromCache: false})
	}
	return new Blob(chunks as BlobPart[]).arrayBuffer()
}

async function fetchWasm(
	onProgress: (p: LoadProgress) => void
): Promise<{binary: ArrayBuffer; fromCache: boolean}> {
	const cache = await openCache()
	if (cache) {
		for (const url of WASM_URLS) {
			const hit = await cache.match(url)
			if (hit) return {binary: await hit.arrayBuffer(), fromCache: true}
		}
	}

	let lastError: unknown = null
	for (const url of WASM_URLS) {
		try {
			const binary = await download(url, onProgress)
			if (cache) {
				try {
					await cache.put(
						url,
						new Response(binary, {
							headers: {"Content-Type": "application/wasm"},
						})
					)
				} catch {
					// quota exceeded etc - cache is best-effort
				}
			}
			return {binary, fromCache: false}
		} catch (err) {
			lastError = err
		}
	}
	throw new Error(`Failed to download pandoc.wasm: ${lastError}`)
}

export async function loadPandoc(
	onProgress: (p: LoadProgress) => void
): Promise<{instance: RawPandocInstance; info: EngineInfo}> {
	const {binary, fromCache} = await fetchWasm(onProgress)
	onProgress({phase: "starting", loaded: 0, total: null, fromCache})
	const instance = await createPandocInstance(binary)

	const info: EngineInfo = {
		version: PANDOC_VERSION,
		inputFormats: [],
		outputFormats: [],
	}
	try {
		const version = instance.query({query: "version"})
		if (typeof version === "string" && version) info.version = version
		const inputs = instance.query({query: "input-formats"})
		if (Array.isArray(inputs)) info.inputFormats = inputs
		const outputs = instance.query({query: "output-formats"})
		if (Array.isArray(outputs)) info.outputFormats = outputs
	} catch (err) {
		console.warn("pandoc format query failed:", err)
	}

	return {instance, info}
}
