// Loads ffmpeg.wasm: the ~31MB single-threaded @ffmpeg/core binary is
// downloaded from a CDN on first use (with progress), cached in the Cache
// API, and handed to @ffmpeg/ffmpeg via blob URLs. The FFmpeg wrapper runs
// everything in its own Web Worker, so conversions never block the UI.

import {FFmpeg} from "@ffmpeg/ffmpeg"

/** @ffmpeg/core version we pin on the CDN */
const CORE_VERSION = "0.12.10"

const CDN_BASES = [
	`https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
	`https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
]

const CACHE_NAME = "ffmpeg-wasm"

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
	/** e.g. "5.1.4" (probed via `ffmpeg -version`) */
	version: string
}

export type ConversionJob = {
	args: string[]
	inputs: {name: string; data: Uint8Array}[]
	outputName: string
	onProgress?: (ratio: number) => void
}

export type Engine = {
	info: EngineInfo
	run(job: ConversionJob): Promise<Uint8Array>
}

// ─── progress + log fanout ───

const progressListeners = new Set<(p: LoadProgress) => void>()

export function onLoadProgress(listener: (p: LoadProgress) => void): () => void {
	progressListeners.add(listener)
	return () => progressListeners.delete(listener)
}

function emit(progress: LoadProgress) {
	for (const listener of progressListeners) listener(progress)
}

const logListeners = new Set<(line: string) => void>()

/** Subscribe to ffmpeg's log output (every conversion appends here). */
export function onLog(listener: (line: string) => void): () => void {
	logListeners.add(listener)
	return () => logListeners.delete(listener)
}

// ─── core download + cache ───

async function openCache(): Promise<Cache | null> {
	try {
		return await caches.open(CACHE_NAME)
	} catch {
		return null
	}
}

async function download(
	url: string,
	onProgress?: (loaded: number, total: number | null) => void
): Promise<ArrayBuffer> {
	const response = await fetch(url)
	if (!response.ok || !response.body) {
		throw new Error(`HTTP ${response.status}`)
	}
	const total = Number(response.headers.get("content-length")) || null
	let loaded = 0
	const chunks: Uint8Array[] = []
	const reader = response.body.getReader()
	for (;;) {
		const {done, value} = await reader.read()
		if (done) break
		chunks.push(value)
		loaded += value.byteLength
		onProgress?.(loaded, total)
	}
	return new Blob(chunks as BlobPart[]).arrayBuffer()
}

async function fetchAsset(
	path: string,
	onProgress?: (loaded: number, total: number | null) => void
): Promise<{binary: ArrayBuffer; fromCache: boolean}> {
	const cache = await openCache()
	if (cache) {
		for (const base of CDN_BASES) {
			const hit = await cache.match(`${base}/${path}`)
			if (hit) return {binary: await hit.arrayBuffer(), fromCache: true}
		}
	}

	let lastError: unknown = null
	for (const base of CDN_BASES) {
		const url = `${base}/${path}`
		try {
			const binary = await download(url, onProgress)
			if (cache) {
				try {
					await cache.put(url, new Response(binary))
				} catch {
					// quota exceeded etc - cache is best-effort
				}
			}
			return {binary, fromCache: false}
		} catch (err) {
			lastError = err
		}
	}
	throw new Error(`Failed to download ${path}: ${lastError}`)
}

// ─── engine ───

async function start(): Promise<Engine> {
	// the JS glue is ~110KB; download it quietly, report progress on the wasm
	const coreJs = await fetchAsset("ffmpeg-core.js")
	const wasm = await fetchAsset("ffmpeg-core.wasm", (loaded, total) =>
		emit({phase: "downloading", loaded, total, fromCache: false})
	)
	emit({phase: "starting", loaded: 0, total: null, fromCache: wasm.fromCache})

	const coreURL = URL.createObjectURL(
		new Blob([coreJs.binary], {type: "text/javascript"})
	)
	const wasmURL = URL.createObjectURL(
		new Blob([wasm.binary], {type: "application/wasm"})
	)

	const ffmpeg = new FFmpeg()
	ffmpeg.on("log", ({message}) => {
		for (const listener of logListeners) listener(message)
	})

	try {
		await ffmpeg.load({coreURL, wasmURL})
	} finally {
		URL.revokeObjectURL(coreURL)
		URL.revokeObjectURL(wasmURL)
	}

	// probe the version from the banner of `ffmpeg -version`
	let version = "wasm"
	const probe = (line: string) => {
		const m = line.match(/^ffmpeg version (\S+)/)
		if (m) version = m[1]
	}
	const unprobe = onLog(probe)
	try {
		await ffmpeg.exec(["-version"])
	} catch {
		// version probe is cosmetic only
	}
	unprobe()

	// run one job at a time; queue the rest
	let queue: Promise<unknown> = Promise.resolve()

	async function runJob(job: ConversionJob): Promise<Uint8Array> {
		const onProgress = ({progress}: {progress: number}) => {
			if (Number.isFinite(progress) && progress >= 0 && progress <= 1) {
				job.onProgress?.(progress)
			}
		}
		ffmpeg.on("progress", onProgress)
		const written: string[] = []
		try {
			for (const input of job.inputs) {
				await ffmpeg.writeFile(input.name, input.data)
				written.push(input.name)
			}
			const code = await ffmpeg.exec(job.args)
			if (code !== 0) {
				throw new Error(`ffmpeg exited with code ${code}`)
			}
			const data = await ffmpeg.readFile(job.outputName)
			written.push(job.outputName)
			return typeof data === "string" ? new TextEncoder().encode(data) : data
		} finally {
			ffmpeg.off("progress", onProgress)
			for (const name of written) {
				try {
					await ffmpeg.deleteFile(name)
				} catch {
					// already gone (e.g. output never produced)
				}
			}
		}
	}

	return {
		info: {version},
		run(job) {
			const result = queue.then(() => runJob(job))
			queue = result.catch(() => {})
			return result
		},
	}
}

let enginePromise: Promise<Engine> | null = null

export function loadEngine(): Promise<Engine> {
	if (!enginePromise) {
		enginePromise = start()
		enginePromise.catch(() => {
			// allow a retry on a later call instead of caching the failure
			enginePromise = null
		})
	}
	return enginePromise
}
