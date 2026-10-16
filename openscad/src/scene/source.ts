// scene:source "openscad-model": compile an OpenSCAD doc with the same engine
// the editor uses, and hand the scene a GLB (Y-up, metres, flat normals).
//
// Loaded on the main thread by the scene host via the plugin's load(). The
// engine starts its own worker; its URL is resolved against this package's
// bundle (import.meta.url in render/engine.ts), not against the page.
//
// Renders go through the engine's shared cache (render/engine.ts), the same
// one the editor uses: with the editor and a scene both open on a doc, the
// source compiles once, and a unit change only re-encodes the cached STL.

import type {AutomergeUrl} from "@automerge/automerge-repo"
import type {OpenscadDoc} from "../types"
import {docToJsonString} from "../imports"
import type {Render, RenderImportInput} from "../render/engine"
import {computeBounds, computeNormals, encodeGLB} from "./glb.js"
import {parseSTL, zUpToYUpMeters, UNIT_METERS, type Unit} from "./stl"

export type BuildParams = {unit?: Unit}

export type BuildResult = {
	kind: "glb"
	glb: Uint8Array
	meta?: {bounds?: {min: number[]; max: number[]}; notes?: string}
}

type RepoLike = {find(url: AutomergeUrl): Promise<{doc(): unknown}>}

export type BuildArgs = {
	doc: OpenscadDoc
	params?: BuildParams
	repo?: RepoLike
	handle?: unknown
	url?: string
}

/** 53-bit string hash (cyrb53), as 14 hex digits. Not cryptographic; just a change detector. */
export function hash53(str: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed
	let h2 = 0x41c6ce57 ^ seed
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i)
		h1 = Math.imul(h1 ^ ch, 2654435761)
		h2 = Math.imul(h2 ^ ch, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0")
}

/**
 * Everything build() reads from the OpenSCAD doc itself: the source text and
 * the import bindings, in order (name -> doc url; the order is the order the
 * engine binds them in). build() does not read the title (the GLB mesh has a
 * fixed name) or an import's display label, so neither ever rebuilds.
 *
 * The *content* of imported docs is deliberately not in here: fingerprint()
 * only sees this doc, and the scene host covers the imported docs itself by
 * recording the heads of every doc dependencies() lists (scene contract v2,
 * "Provider dependencies").
 *
 * It describes the *inputs* only. When build() starts making different output
 * from the same inputs (a new engine flag, a changed transform), bump the
 * provider's `version` in src/index.ts rather than the `scad1:` prefix: the
 * host restales every render built by an older version, once, and a render
 * built by a newer version is never stale to an older one.
 */
export function fingerprint(doc: OpenscadDoc | undefined): string {
	const source = String(doc?.source ?? "")
	const imports = (doc?.imports ?? []).map(imp => [String(imp.name), String(imp.docUrl)])
	return `scad1:${hash53(JSON.stringify([source, imports]))}`
}

/**
 * The other docs build() reads: every imported doc, once each, in binding
 * order. Not transitive, because build() isn't: each import is read once with
 * repo.find() and bound as that doc's JSON, and any urls inside it are just
 * data to OpenSCAD. The host subscribes to these and rebuilds when their heads
 * move; one that can't be loaded binds to {} (see resolveImports).
 */
export function dependencies(doc: OpenscadDoc | undefined): AutomergeUrl[] {
	const urls = (doc?.imports ?? []).map(imp => imp?.docUrl).filter((u): u is AutomergeUrl => typeof u === "string" && u !== "")
	return [...new Set(urls)]
}

/** Resolve doc.imports to the JSON the engine binds, the same way the editor does. */
export async function resolveImports(
	doc: OpenscadDoc,
	repo: RepoLike | undefined,
): Promise<{imports: RenderImportInput[]; missing: string[]}> {
	const missing: string[] = []
	const imports = await Promise.all(
		(doc.imports ?? []).map(async imp => {
			let content: unknown = undefined
			try {
				if (!repo) throw new Error("no repo")
				content = (await repo.find(imp.docUrl)).doc()
			} catch {
				missing.push(imp.name)
			}
			// Same fallback as the editor: an unavailable import binds to {}.
			return {name: String(imp.name), json: docToJsonString(content)}
		}),
	)
	return {imports, missing}
}

/** OpenSCAD STL (Z-up, `unit`) -> GLB (Y-up, metres) with flat per-face normals. */
export function stlToGLB(stlBytes: Uint8Array, unit: Unit = "mm", name = "OpenSCAD"): BuildResult & {triangles: number} {
	const stl = parseSTL(stlBytes)
	const positions = zUpToYUpMeters(stl.positions, unit)
	const normals = computeNormals(positions)
	const glb = encodeGLB({meshes: [{name, positions, normals}]})
	const bounds = computeBounds(positions)
	return {kind: "glb", glb, triangles: stl.triangles, meta: bounds ? {bounds} : {}}
}

/** openscad-wasm prints this on every run; it is not part of any error. */
const NOISE = /^Could not initialize localization.*$/gm

/** An engine error with the engine's start-up noise removed, for the render doc's `error`. */
export function cleanError(err: unknown): Error {
	const message = String((err as Error)?.message ?? err).replace(NOISE, "").replace(/\n{2,}/g, "\n").trim()
	return new Error(message || "OpenSCAD failed without a message")
}

function countWarnings(logs: string[]): number {
	return logs.filter(line => /^\s*WARNING:/i.test(line)).length
}

/**
 * Build a SourceImpl around a renderer. This keeps no cache of its own: the
 * default export passes the engine's shared renderScad, whose cache is keyed
 * by source + import JSON, so changing only the unit re-encodes without
 * running OpenSCAD again (and a render the editor already did is reused).
 */
export function createOpenscadSource(render: () => Promise<Render>) {
	return {
		fingerprint,
		dependencies,

		async build({doc, params, repo}: BuildArgs): Promise<BuildResult> {
			if (!doc) throw new Error("OpenSCAD document is not available")
			const unit: Unit = params?.unit && params.unit in UNIT_METERS ? params.unit : "mm"
			const source = String(doc.source ?? "")
			const {imports, missing} = await resolveImports(doc, repo)

			let result
			try {
				result = await (await render())(source, imports)
			} catch (err) {
				throw cleanError(err)
			}

			// A fixed mesh name: the title is not in the fingerprint, so a name
			// taken from it would go stale on rename. The scene outline shows
			// the scene object's own name anyway.
			const {triangles, ...out} = stlToGLB(result.stl, unit)
			const notes = [`${triangles} triangles`]
			if (!result.cached) notes.push(`rendered in ${(result.elapsedMillis / 1000).toFixed(1)} s`)
			const warnings = countWarnings(result.logs)
			if (warnings) notes.push(`${warnings} warning${warnings === 1 ? "" : "s"}`)
			if (missing.length) notes.push(`import${missing.length === 1 ? "" : "s"} unavailable: ${missing.join(", ")}`)
			if (triangles === 0) notes.push("no geometry")
			return {...out, meta: {...out.meta, notes: notes.join(", ")}}
		},
	}
}

export default createOpenscadSource(async () => (await import("../render/engine")).renderScad)
