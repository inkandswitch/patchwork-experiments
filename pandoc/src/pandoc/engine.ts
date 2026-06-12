// Main-thread facade for the pandoc engine. Prefers running everything in a
// Web Worker (so conversions never block the UI); falls back to running on
// the main thread if the worker can't be created in the current environment.

import type {EngineInfo, LoadProgress} from "./wasm-load"
import type {PandocConvertResult} from "pandoc-wasm-core"

export {PANDOC_VERSION} from "./wasm-load"
export type {EngineInfo, LoadProgress} from "./wasm-load"
export type ConvertResult = PandocConvertResult

export type Engine = {
	info: EngineInfo
	convert(
		options: Record<string, unknown>,
		stdin: string | null,
		files: Record<string, Blob | string>
	): Promise<ConvertResult>
}

const progressListeners = new Set<(p: LoadProgress) => void>()

export function onLoadProgress(listener: (p: LoadProgress) => void): () => void {
	progressListeners.add(listener)
	return () => progressListeners.delete(listener)
}

function emit(progress: LoadProgress) {
	for (const listener of progressListeners) listener(progress)
}

function startWorker(): Promise<Engine> {
	return new Promise((resolve, reject) => {
		let worker: Worker
		try {
			worker = new Worker(new URL("./worker.ts", import.meta.url), {
				type: "module",
			})
		} catch (err) {
			reject(err)
			return
		}

		type Pending = {
			resolve: (value: ConvertResult) => void
			reject: (err: Error) => void
		}
		const pending = new Map<number, Pending>()
		let nextId = 1
		let ready = false

		worker.onerror = event => {
			if (!ready) {
				worker.terminate()
				reject(new Error(event.message || "pandoc worker failed to start"))
			}
		}

		worker.onmessage = event => {
			const msg = event.data
			switch (msg?.type) {
				case "progress":
					emit(msg.progress)
					break
				case "ready":
					ready = true
					resolve({
						info: msg.info,
						convert: (options, stdin, files) =>
							new Promise((res, rej) => {
								const id = nextId++
								pending.set(id, {resolve: res, reject: rej})
								worker.postMessage({id, type: "convert", options, stdin, files})
							}),
					})
					break
				case "init-error":
					worker.terminate()
					reject(new Error(msg.error))
					break
				case "result": {
					const entry = pending.get(msg.id)
					pending.delete(msg.id)
					if (!entry) break
					if (msg.ok) entry.resolve(msg.value)
					else entry.reject(new Error(msg.error))
					break
				}
			}
		}
	})
}

async function startMainThread(): Promise<Engine> {
	const {loadPandoc} = await import("./wasm-load")
	const {instance, info} = await loadPandoc(emit)
	return {
		info,
		convert: (options, stdin, files) => instance.convert(options, stdin, files),
	}
}

let enginePromise: Promise<Engine> | null = null

export function loadEngine(): Promise<Engine> {
	if (!enginePromise) {
		enginePromise = startWorker().catch(err => {
			console.warn("pandoc worker unavailable, running on main thread:", err)
			return startMainThread()
		})
		enginePromise.catch(() => {
			// allow a retry on a later call instead of caching the failure
			enginePromise = null
		})
	}
	return enginePromise
}
