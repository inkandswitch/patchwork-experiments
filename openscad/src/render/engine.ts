// Main-thread facade for the OpenSCAD render worker. Keeps a single worker
// alive across renders (loading the engine is the expensive part) and
// multiplexes concurrent render requests by id.

/// <reference types="vite/client" />
import workerUrl from "./worker.ts?worker&url"

export type LoadProgress = {
	phase: "downloading" | "starting"
	loaded: number
	total: number | null
	fromCache: boolean
}

export type RenderResult = {
	stl: Uint8Array
	logs: string[]
	elapsedMillis: number
}

export type RenderImportInput = {
	name: string
	json: string
}

export class RenderError extends Error {
	logs: string[]
	constructor(message: string, logs: string[] = []) {
		super(message)
		this.logs = logs
	}
}

const progressListeners = new Set<(p: LoadProgress) => void>()

export function onLoadProgress(listener: (p: LoadProgress) => void): () => void {
	progressListeners.add(listener)
	return () => progressListeners.delete(listener)
}

function emitProgress(p: LoadProgress) {
	for (const listener of progressListeners) listener(p)
}

type Pending = {
	resolve: (value: RenderResult) => void
	reject: (err: Error) => void
}

let worker: Promise<Worker> | null = null
const pending = new Map<number, Pending>()
let nextId = 1

// Resolved against this module's own URL (the package bundle), never the
// page, so the worker is found wherever the module is loaded from: the
// OpenSCAD tool, or another tool (the scene) calling the scene:source build.
// (`?worker&url` makes vite bundle the worker and give us its URL; with
// `base: "./"` that URL is emitted as new URL("assets/…", import.meta.url).)
const WORKER_URL = new URL(workerUrl, import.meta.url)

/**
 * `new Worker()` only accepts a same-origin script. When this bundle is served
 * from somewhere other than the page (a dev server, a CDN), fetch the worker
 * and start it from a blob URL instead. The worker bundle has no imports of
 * its own, so it runs unchanged from a blob.
 */
async function spawnWorker(): Promise<Worker> {
	const sameOrigin = typeof location === "undefined" || WORKER_URL.origin === location.origin
	if (sameOrigin || WORKER_URL.protocol === "blob:" || WORKER_URL.protocol === "data:") {
		try {
			return new Worker(WORKER_URL, {type: "module"})
		} catch (err) {
			if (sameOrigin) throw err
		}
	}
	const response = await fetch(WORKER_URL)
	if (!response.ok) throw new Error(`Failed to load OpenSCAD worker: HTTP ${response.status}`)
	const blobUrl = URL.createObjectURL(new Blob([await response.text()], {type: "text/javascript"}))
	return new Worker(blobUrl, {type: "module"})
}

function attach(w: Worker): Worker {
	w.onmessage = (event: MessageEvent) => {
		const msg = event.data
		if (msg?.type === "progress") {
			emitProgress(msg.progress)
			return
		}
		if (msg?.type === "result") {
			const entry = pending.get(msg.id)
			pending.delete(msg.id)
			if (!entry) return
			if (msg.ok) entry.resolve({stl: msg.stl, logs: msg.logs, elapsedMillis: msg.elapsedMillis})
			else entry.reject(new RenderError(msg.error, msg.logs ?? []))
		}
	}
	w.onerror = event => {
		const err = new Error(event.message || "OpenSCAD worker crashed")
		for (const entry of pending.values()) entry.reject(err)
		pending.clear()
		w.terminate()
		worker = null
	}
	return w
}

function getWorker(): Promise<Worker> {
	if (!worker) {
		worker = spawnWorker().then(attach)
		worker.catch(() => {
			worker = null
		})
	}
	return worker
}

export function renderScad(source: string, imports: RenderImportInput[] = []): Promise<RenderResult> {
	return new Promise((resolve, reject) => {
		const id = nextId++
		pending.set(id, {resolve, reject})
		getWorker().then(
			w => w.postMessage({id, type: "render", source, imports}),
			err => {
				pending.delete(id)
				reject(err)
			},
		)
	})
}
