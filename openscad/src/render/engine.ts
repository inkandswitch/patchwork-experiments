// Main-thread facade for the OpenSCAD render worker. Keeps a single worker
// alive across renders (loading the engine is the expensive part),
// multiplexes concurrent render requests by id, and keeps the last few
// results in a cache shared by everything in this bundle: the editor and the
// scene:source provider both call renderScad(), so with both open the same
// source compiles once.

/// <reference types="vite/client" />
import workerUrl from "./worker.ts?worker&url"
import type {Model} from "./model"
import type {SourceMap} from "./sourceMap"
import type {EngineUrls, LoadProgress} from "./worker"
import {ENGINE_DIR} from "./engineFiles"

export type {LoadProgress}

export type RenderResult = {
	/** triangles grouped by colour; shared between callers through the cache, so treat it as read-only */
	model: Model
	logs: string[]
	/** how long OpenSCAD took when this result was rendered */
	elapsedMillis: number
	/** true when this came out of the cache without running OpenSCAD */
	cached?: boolean
	/**
	 * Which source made which triangle, from a second, labelled render that
	 * starts once this one is done (render/sourceMap.ts). Null when that render
	 * failed or was skipped for a newer request; never rejects.
	 */
	sourceMap?: Promise<SourceMap | null>
}

export type RenderImportInput = {
	name: string
	json: string
	/** the linked document as OpenSCAD source, for `include <name.scad>` / `use <name.scad>` */
	scad?: string
	/** the name a file document goes by (e.g. "assumptions.scad"), a second path `scad` is written at */
	scadFile?: string
	/** why there is no `scad`, said when something includes this import anyway */
	noScad?: string
	/** the document's display name, for messages */
	label?: string
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
	/** settles the result's sourceMap */
	map: (map: SourceMap | null) => void
}

let worker: Promise<Worker> | null = null
const pending = new Map<number, Pending>()
/** each request's sourceMap, from when it's sent until its map arrives */
const mapPromises = new Map<number, Promise<SourceMap | null>>()
let nextId = 1

// Resolved against this module's own URL (the package bundle), never the
// page, so the worker is found wherever the module is loaded from: the
// OpenSCAD tool, or another tool (the scene) calling the scene:source build.
// (`?worker&url` makes vite bundle the worker and give us its URL; with
// `base: "./"` that URL is emitted as new URL("assets/…", import.meta.url).)
const WORKER_URL = new URL(workerUrl, import.meta.url)

// The vendored engine sits next to the entry chunks (dist/<ENGINE_DIR>/),
// so it resolves against this module too. (`here` rather than a literal
// import.meta.url in new URL(), which vite would try to bundle.)
const here = import.meta.url
const ENGINE: EngineUrls = {
	js: new URL(`${ENGINE_DIR}/openscad.js`, here).href,
	wasm: new URL(`${ENGINE_DIR}/openscad.wasm`, here).href,
}

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
			if (!entry) return
			if (msg.ok) entry.resolve({model: msg.model, logs: msg.logs, elapsedMillis: msg.elapsedMillis, sourceMap: mapPromises.get(msg.id)})
			else {
				pending.delete(msg.id)
				mapPromises.delete(msg.id)
				entry.map(null)
				entry.reject(new RenderError(msg.error, msg.logs ?? []))
			}
		}
		if (msg?.type === "sourcemap") {
			const entry = pending.get(msg.id)
			pending.delete(msg.id)
			mapPromises.delete(msg.id)
			if (msg.error && msg.error !== "superseded") console.warn("openscad: no source map:", msg.error)
			entry?.map(msg.map ?? null)
		}
	}
	w.onerror = event => {
		const err = new Error(event.message || "OpenSCAD worker crashed")
		for (const entry of pending.values()) {
			entry.reject(err)
			entry.map(null)
		}
		pending.clear()
		mapPromises.clear()
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

export type Render = (source: string, imports?: RenderImportInput[]) => Promise<RenderResult>

/** Run one render in the worker, uncached. */
function renderInWorker(source: string, imports: RenderImportInput[] = []): Promise<RenderResult> {
	return new Promise((resolve, reject) => {
		const id = nextId++
		let map!: (m: SourceMap | null) => void
		mapPromises.set(id, new Promise<SourceMap | null>(r => (map = r)))
		pending.set(id, {resolve, reject, map})
		getWorker().then(
			w => w.postMessage({id, type: "render", source, imports, engine: ENGINE}),
			err => {
				pending.delete(id)
				mapPromises.delete(id)
				map(null)
				reject(err)
			},
		)
	})
}

/**
 * What a render's output depends on: the source text and the import bindings
 * (name, JSON, OpenSCAD source and file name, in binding order). Nothing else reaches the engine, so equal
 * keys give equal output.
 */
export function renderKey(source: string, imports: RenderImportInput[] = []): string {
	return JSON.stringify([source, imports.map(imp => [imp.name, imp.json, imp.scad ?? null, imp.scadFile ?? null, imp.noScad ?? null])])
}

/**
 * Wrap a renderer in an LRU cache of its last `size` results, keyed by
 * renderKey(). A request whose key is already rendering joins that render
 * rather than starting another. Failures are not cached (a worker crash or a
 * failed engine download is worth retrying); a hit comes back with
 * `cached: true`.
 */
export function createRenderCache(render: Render, size = 8): Render {
	const done = new Map<string, RenderResult>()
	const inflight = new Map<string, Promise<RenderResult>>()

	return (source, imports = []) => {
		const key = renderKey(source, imports)
		const hit = done.get(key)
		if (hit) {
			done.delete(key) // refresh its place in the LRU order
			done.set(key, hit)
			return Promise.resolve({...hit, cached: true})
		}
		const running = inflight.get(key)
		if (running) return running

		const promise = render(source, imports).then(
			result => {
				inflight.delete(key)
				done.set(key, result)
				while (done.size > size) done.delete(done.keys().next().value as string)
				return result
			},
			err => {
				inflight.delete(key)
				throw err
			},
		)
		inflight.set(key, promise)
		return promise
	}
}

/**
 * Render `source` with `imports` bound, through the shared cache. Everything
 * in this package renders through here.
 */
export const renderScad: Render = createRenderCache(renderInWorker)
