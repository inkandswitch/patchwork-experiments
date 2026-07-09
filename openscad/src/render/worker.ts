/// <reference lib="webworker" />
// Runs OpenSCAD (compiled to WebAssembly) off the main thread. The engine
// itself is not bundled with this module: it's downloaded from a CDN on
// first use and cached via the Cache API, matching the pattern used by the
// pandoc and ffmpeg Patchwork tools for their own (much larger) WASM engines.

declare const self: DedicatedWorkerGlobalScope

/** openscad-wasm npm version we pin; a single ES module bundling engine + wasm */
const OPENSCAD_WASM_VERSION = "0.0.4"
const ENGINE_URLS = [
	`https://cdn.jsdelivr.net/npm/openscad-wasm@${OPENSCAD_WASM_VERSION}/openscad.js`,
	`https://unpkg.com/openscad-wasm@${OPENSCAD_WASM_VERSION}/openscad.js`,
]
const CACHE_NAME = "openscad-wasm"

export type LoadProgress = {
	phase: "downloading" | "starting"
	loaded: number
	total: number | null
	fromCache: boolean
}

type RenderRequest = {
	id: number
	type: "render"
	source: string
}

type OutgoingMessage =
	| {type: "progress"; progress: LoadProgress}
	| {type: "result"; id: number; ok: true; stl: Uint8Array; logs: string[]; elapsedMillis: number}
	| {type: "result"; id: number; ok: false; error: string; logs: string[]}

function post(msg: OutgoingMessage, transfer?: Transferable[]) {
	// @ts-expect-error structured-clone postMessage overload
	self.postMessage(msg, transfer)
}

async function openCache(): Promise<Cache | null> {
	try {
		return await caches.open(CACHE_NAME)
	} catch {
		return null
	}
}

async function downloadText(
	url: string,
	onProgress: (p: LoadProgress) => void,
): Promise<string> {
	const response = await fetch(url)
	if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

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
	return new Blob(chunks as BlobPart[]).text()
}

async function fetchEngineSource(
	onProgress: (p: LoadProgress) => void,
): Promise<{text: string; fromCache: boolean}> {
	const cache = await openCache()
	if (cache) {
		for (const url of ENGINE_URLS) {
			const hit = await cache.match(url)
			if (hit) return {text: await hit.text(), fromCache: true}
		}
	}

	let lastError: unknown = null
	for (const url of ENGINE_URLS) {
		try {
			const text = await downloadText(url, onProgress)
			if (cache) {
				try {
					await cache.put(
						url,
						new Response(text, {headers: {"Content-Type": "text/javascript"}}),
					)
				} catch {
					// quota exceeded etc - cache is best-effort
				}
			}
			return {text, fromCache: false}
		} catch (err) {
			lastError = err
		}
	}
	throw new Error(`Failed to download OpenSCAD engine: ${lastError}`)
}

type CreateOpenSCAD = (
	opts: Record<string, unknown>,
) => Promise<{getInstance(): any}>

let factoryPromise: Promise<CreateOpenSCAD> | null = null

function loadFactory(): Promise<CreateOpenSCAD> {
	if (!factoryPromise) {
		factoryPromise = (async () => {
			const {text, fromCache} = await fetchEngineSource(progress => post({type: "progress", progress}))
			post({type: "progress", progress: {phase: "starting", loaded: 0, total: null, fromCache}})
			const blobUrl = URL.createObjectURL(new Blob([text], {type: "text/javascript"}))
			try {
				const mod = await import(/* @vite-ignore */ blobUrl)
				return mod.createOpenSCAD as CreateOpenSCAD
			} finally {
				URL.revokeObjectURL(blobUrl)
			}
		})().catch(err => {
			factoryPromise = null
			throw err
		})
	}
	return factoryPromise
}

async function render(source: string): Promise<{stl: Uint8Array; logs: string[]; elapsedMillis: number}> {
	const createOpenSCAD = await loadFactory()
	const logs: string[] = []
	const start = performance.now()

	// A fresh instance per render: reusing one instance's filesystem/runtime
	// across multiple callMain() invocations is not reliable with this engine.
	const engine = await createOpenSCAD({
		print: (text: string) => logs.push(text),
		printErr: (text: string) => logs.push(text),
	})
	const instance = engine.getInstance()

	instance.FS.writeFile("/input.scad", source)

	let exitCode: number
	try {
		exitCode = instance.callMain(["/input.scad", "--export-format=binstl", "-o", "/model.stl"])
	} catch (e) {
		let message = `${e}`
		if (typeof e === "number" && instance.formatException) {
			message = instance.formatException(e)
		}
		throw new Error(`${message}\n${logs.join("\n")}`)
	}

	if (exitCode !== 0) {
		throw new Error(logs.join("\n") || `OpenSCAD exited with code ${exitCode}`)
	}

	const stl = instance.FS.readFile("/model.stl") as Uint8Array
	const elapsedMillis = performance.now() - start
	return {stl, logs, elapsedMillis}
}

self.addEventListener("message", async (e: MessageEvent<RenderRequest>) => {
	const {id, source} = e.data
	try {
		const {stl, logs, elapsedMillis} = await render(source)
		post({type: "result", id, ok: true, stl, logs, elapsedMillis}, [stl.buffer])
	} catch (err) {
		post({type: "result", id, ok: false, error: String((err as Error)?.message ?? err), logs: []})
	}
})
