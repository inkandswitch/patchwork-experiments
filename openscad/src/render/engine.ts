// Main-thread facade for the OpenSCAD render worker. Keeps a single worker
// alive across renders (loading the engine is the expensive part) and
// multiplexes concurrent render requests by id.

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

let worker: Worker | null = null
const pending = new Map<number, Pending>()
let nextId = 1

function getWorker(): Worker {
	if (worker) return worker
	worker = new Worker(new URL("./worker.ts", import.meta.url), {type: "module"})
	worker.onmessage = (event: MessageEvent) => {
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
	worker.onerror = event => {
		const err = new Error(event.message || "OpenSCAD worker crashed")
		for (const entry of pending.values()) entry.reject(err)
		pending.clear()
		worker?.terminate()
		worker = null
	}
	return worker
}

export function renderScad(source: string): Promise<RenderResult> {
	return new Promise((resolve, reject) => {
		const id = nextId++
		pending.set(id, {resolve, reject})
		getWorker().postMessage({id, type: "render", source})
	})
}
