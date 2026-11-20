/// <reference lib="webworker" />
// Runs OpenSCAD (compiled to WebAssembly) off the main thread. The engine is
// vendored into this package (dist/<ENGINE_DIR>/, see engineFiles.ts); the
// main thread resolves its URLs against the package bundle and sends them
// with each render. The wasm is fetched and compiled once per worker, and
// every render instantiates that compiled module afresh.

import {openscadArgs} from "./args"
import {parseOFF, type Model} from "./model"

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

type ImportInput = {
	/** valid OpenSCAD identifier, bound to `import("imports/<name>.json")` */
	name: string
	/** JSON text for that document's content */
	json: string
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

async function render(
	source: string,
	imports: ImportInput[] = [],
	urls: EngineUrls,
): Promise<{model: Model; logs: string[]; elapsedMillis: number}> {
	const {factory, wasm} = await loadEngine(urls)
	const logs: string[] = []
	const start = performance.now()

	// A fresh instance per render: OpenSCAD's globals don't reset between
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
	// same name via a single generated line prepended to the source (so the
	// offset is a constant +1, not +N, when at least one import is present).
	// import() of a .json file returns its parsed data.
	let finalSource = source
	if (imports.length > 0) {
		instance.FS.mkdir("/imports")
		const bindings: string[] = []
		for (const imp of imports) {
			instance.FS.writeFile(`/imports/${imp.name}.json`, imp.json)
			bindings.push(`${imp.name} = import("imports/${imp.name}.json");`)
		}
		finalSource = `${bindings.join(" ")}\n${source}`
	}

	instance.FS.writeFile("/input.scad", finalSource)

	let exitCode: number
	try {
		exitCode = instance.callMain(openscadArgs({input: "/input.scad", output: "/model.off"}))
	} catch (e) {
		throw new Error(`${(e as Error)?.message ?? e}\n${logs.join("\n")}`)
	}
	if (exitCode !== 0) {
		throw new Error(logs.join("\n") || `OpenSCAD exited with code ${exitCode}`)
	}

	// parsed here, off the main thread; the editor and the scene both want the mesh
	const model = parseOFF(instance.FS.readFile("/model.off", {encoding: "utf8"}) as string)
	const elapsedMillis = performance.now() - start
	return {model, logs, elapsedMillis}
}

self.addEventListener("message", async (e: MessageEvent<RenderRequest>) => {
	const {id, source, imports, engine} = e.data
	try {
		const {model, logs, elapsedMillis} = await render(source, imports, engine)
		post({type: "result", id, ok: true, model, logs, elapsedMillis}, model.parts.map(p => p.positions.buffer))
	} catch (err) {
		post({type: "result", id, ok: false, error: String((err as Error)?.message ?? err), logs: []})
	}
})
