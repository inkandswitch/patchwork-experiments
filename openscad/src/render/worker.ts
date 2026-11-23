/// <reference lib="webworker" />
// Runs OpenSCAD (compiled to WebAssembly) off the main thread. The engine is
// vendored into this package (dist/<ENGINE_DIR>/, see engineFiles.ts); the
// main thread resolves its URLs against the package bundle and sends them
// with each render. The wasm is fetched and compiled once per worker, and
// every render instantiates that compiled module afresh.

import {openscadArgs} from "./args"
import {parseOFF, type Model} from "./model"
import {explainMissingIncludes, sourceFiles, withBindings} from "./includes"
import type {RenderImportInput as ImportInput} from "./engine"
import {buildSourceMap, labelAll, type SourceMap} from "./sourceMap"

declare const self: DedicatedWorkerGlobalScope

export type LoadProgress = {
	phase: "downloading" | "starting"
	loaded: number
	total: number | null
}

export type EngineUrls = {
	/** the Emscripten ES module; its default export makes an engine instance */
	js: string
	wasm: string
}


type RenderRequest = {
	id: number
	type: "render"
	source: string
	imports?: ImportInput[]
	engine: EngineUrls
}

type OutgoingMessage =
	| {type: "progress"; progress: LoadProgress}
	| {type: "result"; id: number; ok: true; model: Model; logs: string[]; elapsedMillis: number}
	| {type: "result"; id: number; ok: false; error: string; logs: string[]}
	// after an ok result, from a second, labelled render (render/sourceMap.ts); null if that failed
	| {type: "sourcemap"; id: number; map: SourceMap | null; error?: string}

function post(msg: OutgoingMessage, transfer?: Transferable[]) {
	// @ts-expect-error structured-clone postMessage overload
	self.postMessage(msg, transfer)
}

/** Fetch the wasm, reporting progress, without needing an application/wasm content type. */
async function downloadWasm(url: string): Promise<ArrayBuffer> {
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
		post({type: "progress", progress: {phase: "downloading", loaded, total}})
	}
	return new Blob(chunks as BlobPart[]).arrayBuffer()
}

type EngineModule = {
	FS: any
	callMain(args: string[]): number
}

type Factory = (opts: Record<string, unknown>) => Promise<EngineModule>

let enginePromise: Promise<{factory: Factory; wasm: WebAssembly.Module}> | null = null

function loadEngine(urls: EngineUrls) {
	if (!enginePromise) {
		enginePromise = (async () => {
			const [wasm, mod] = await Promise.all([
				downloadWasm(urls.wasm).then(bytes => {
					post({type: "progress", progress: {phase: "starting", loaded: 0, total: null}})
					return WebAssembly.compile(bytes)
				}),
				import(/* @vite-ignore */ urls.js),
			])
			return {factory: mod.default as Factory, wasm}
		})().catch(err => {
			enginePromise = null
			throw new Error(`Failed to load the OpenSCAD engine: ${(err as Error)?.message ?? err}`)
		})
	}
	return enginePromise
}

type Run = {off: string; logs: string[]; elapsedMillis: number}

/**
 * One run of the engine: `source` as /input.scad, the imports' JSON under
 * /imports, and the linked docs' OpenSCAD source where include/use find it
 * (`files`, by default the imports' own: render/includes.ts sourceFiles).
 */
async function run(source: string, imports: ImportInput[], urls: EngineUrls, files = sourceFiles(imports)): Promise<Run> {
	const {factory, wasm} = await loadEngine(urls)
	const logs: string[] = []
	const start = performance.now()

	// A fresh instance per run: OpenSCAD's globals don't reset between
	// runs. Instantiating the already-compiled module is cheap.
	const instance = await factory({
		noInitialRun: true,
		print: (text: string) => logs.push(text),
		printErr: (text: string) => logs.push(text),
		instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
			WebAssembly.instantiate(wasm, imports).then(i => done(i, wasm))
			return {}
		},
	})

	// Imported docs are written as JSON files and bound to a variable of the
	// same name by a line joined onto the source's first line (so line numbers
	// stay exact). Linked docs with OpenSCAD source are also written where
	// include <name.scad> / use <name.scad> find them, next to /input.scad.
	if (imports.length > 0) {
		instance.FS.mkdir("/imports")
		for (const imp of imports) instance.FS.writeFile(`/imports/${imp.name}.json`, imp.json)
		for (const file of files) instance.FS.writeFile(`/${file.path}`, file.text)
	}
	instance.FS.writeFile("/input.scad", withBindings(source, imports))

	let exitCode: number
	try {
		exitCode = instance.callMain(openscadArgs({input: "/input.scad", output: "/model.off"}))
	} catch (e) {
		throw new Error([explainMissingIncludes(logs, imports), `${(e as Error)?.message ?? e}`, ...logs].filter(Boolean).join("\n"))
	}
	// OpenSCAD only warns about an include it can't find and carries on with
	// every name undefined; say what to do instead of rendering that.
	const missing = explainMissingIncludes(logs, imports)
	if (missing) throw new Error([missing, ...logs].join("\n"))
	if (exitCode !== 0) {
		throw new Error(logs.join("\n") || `OpenSCAD exited with code ${exitCode}`)
	}
	const off = instance.FS.readFile("/model.off", {encoding: "utf8"}) as string
	return {off, logs, elapsedMillis: performance.now() - start}
}

/**
 * Which source made which of `model`'s triangles: the same render again,
 * every file labelled (render/sourceMap.ts).
 */
async function sourceMapFor(model: Model, source: string, imports: ImportInput[], urls: EngineUrls): Promise<SourceMap> {
	const labelled = labelAll(source, sourceFiles(imports))
	const out = await run(labelled.source.text, imports, urls, labelled.files)
	return buildSourceMap(
		model.parts.map(p => p.positions),
		parseOFF(out.off),
		out.logs,
		[labelled.source, ...labelled.files],
	)
}

/** The newest request's id: a source map for an older one is skipped rather than make it wait. */
let latest = 0

self.addEventListener("message", async (e: MessageEvent<RenderRequest>) => {
	const {id, source, imports = [], engine} = e.data
	latest = Math.max(latest, id)
	let model: Model
	try {
		const out = await run(source, imports, engine)
		// parsed here, off the main thread; the editor and the scene both want the mesh
		model = parseOFF(out.off)
		// the buffers go to the page; the source map needs its own copy
		const kept: Model = {...model, parts: model.parts.map(p => ({...p, positions: p.positions.slice()}))}
		post({type: "result", id, ok: true, model, logs: out.logs, elapsedMillis: out.elapsedMillis}, model.parts.map(p => p.positions.buffer))
		model = kept
	} catch (err) {
		post({type: "result", id, ok: false, error: String((err as Error)?.message ?? err), logs: []})
		return
	}
	// Second: the source map. The model is already on its way, and this never
	// fails it. Let any request that came in meanwhile go first: someone typing
	// wants the next model, not this one's map.
	await new Promise(resolve => setTimeout(resolve, 0))
	if (latest > id) {
		post({type: "sourcemap", id, map: null, error: "superseded"})
		return
	}
	try {
		const map = await sourceMapFor(model, source, imports, engine)
		post({type: "sourcemap", id, map}, map.faces.map(f => f.buffer))
	} catch (err) {
		post({type: "sourcemap", id, map: null, error: String((err as Error)?.message ?? err)})
	}
})
