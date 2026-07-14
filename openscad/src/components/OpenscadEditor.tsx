import {createSignal, For, onCleanup, onMount, Show} from "solid-js"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {OpenscadDoc, OpenscadImport} from "../types"
import {styles} from "../styles"
import {CodeEditor} from "./CodeEditor"
import {Viewer3D} from "./Viewer3D"
import {onLoadProgress, renderScad, RenderError, type LoadProgress, type RenderImportInput} from "../render/engine"
import {hasPatchworkDrop, parsePatchworkDrop, type PatchworkDropItem} from "../dnd"
import {docToJsonString, sanitizeIdentifier, uniqueIdentifier} from "../imports"

const AUTO_RENDER_DELAY_MS = 700

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// `handle` is loosely typed: it comes from `element.repo.find()`, and the
// host app's `@automerge/automerge-repo` copy doesn't always structurally
// unify with this package's own (pnpm can end up with two copies whose
// private class fields make TS treat them as distinct nominal types even
// though they're identical at runtime).
type ResolvedImport = {
	name: string
	handle: {doc(): Record<string, unknown> | undefined; on: DocHandle<any>["on"]; off: DocHandle<any>["off"]} | null
}

export function OpenscadEditor(props: {
	handle: DocHandle<OpenscadDoc>
	element: PatchworkViewElement
}) {
	const initialDoc = props.handle.doc()

	const [stl, setStl] = createSignal<Uint8Array | null>(null)
	const [logs, setLogs] = createSignal<string[]>([])
	const [status, setStatus] = createSignal<"idle" | "rendering" | "ready" | "error">("idle")
	const [elapsedMillis, setElapsedMillis] = createSignal<number | null>(null)
	const [engineProgress, setEngineProgress] = createSignal<LoadProgress | null>(null)
	const [imports, setImports] = createSignal<OpenscadImport[]>(initialDoc?.imports ?? [])
	const [dropActive, setDropActive] = createSignal(false)
	const [renamingUrl, setRenamingUrl] = createSignal<AutomergeUrl | null>(null)
	const [renameValue, setRenameValue] = createSignal("")

	// Docs referenced by `doc.imports`, resolved via the repo and kept live:
	// any change to a referenced doc re-triggers a render. Keyed by docUrl.
	const resolvedImports = new Map<AutomergeUrl, ResolvedImport>()

	function onImportDocChange() {
		scheduleRender()
	}

	function syncImports(doc: OpenscadDoc | undefined) {
		const wanted = doc?.imports ?? []
		const wantedUrls = new Set(wanted.map(imp => imp.docUrl))

		for (const [url, entry] of resolvedImports) {
			if (!wantedUrls.has(url)) {
				entry.handle?.off("change", onImportDocChange)
				resolvedImports.delete(url)
			}
		}

		for (const imp of wanted) {
			const existing = resolvedImports.get(imp.docUrl)
			if (existing) {
				existing.name = imp.name
				continue
			}
			const entry: ResolvedImport = {name: imp.name, handle: null}
			resolvedImports.set(imp.docUrl, entry)
			props.element.repo
				.find<Record<string, unknown>>(imp.docUrl)
				.then((handle: any) => {
					if (resolvedImports.get(imp.docUrl) !== entry) return // superseded meanwhile
					entry.handle = handle
					handle.on("change", onImportDocChange)
					scheduleRender()
				})
				.catch(err => {
					console.warn("openscad: failed to resolve import", imp.docUrl, err)
				})
		}
	}

	let runId = 0
	async function renderNow() {
		const doc = props.handle.doc()
		const source = doc?.source ?? ""
		const importList = doc?.imports ?? []
		const importPayload: RenderImportInput[] = importList.map(imp => {
			const resolved = resolvedImports.get(imp.docUrl)
			return {name: imp.name, json: docToJsonString(resolved?.handle?.doc())}
		})
		const id = ++runId
		setStatus("rendering")
		try {
			const result = await renderScad(source, importPayload)
			if (id !== runId) return
			setStl(result.stl)
			setLogs(result.logs)
			setElapsedMillis(result.elapsedMillis)
			setStatus("ready")
		} catch (err) {
			if (id !== runId) return
			const message = err instanceof RenderError ? err.message : String((err as Error)?.message ?? err)
			setLogs(message.split("\n"))
			setStatus("error")
		}
	}

	let debounceTimer: ReturnType<typeof setTimeout> | undefined
	function scheduleRender() {
		if (debounceTimer) clearTimeout(debounceTimer)
		debounceTimer = setTimeout(renderNow, AUTO_RENDER_DELAY_MS)
	}

	function renderImmediately() {
		if (debounceTimer) clearTimeout(debounceTimer)
		void renderNow()
	}

	function onDocChange() {
		const doc = props.handle.doc()
		setImports(doc?.imports ?? [])
		syncImports(doc)
		scheduleRender()
	}

	onMount(() => {
		const unsubProgress = onLoadProgress(setEngineProgress)
		syncImports(props.handle.doc())
		props.handle.on("change", onDocChange)
		void renderNow()
		onCleanup(() => {
			unsubProgress()
			props.handle.off("change", onDocChange)
			if (debounceTimer) clearTimeout(debounceTimer)
			for (const entry of resolvedImports.values()) entry.handle?.off("change", onImportDocChange)
			resolvedImports.clear()
		})
	})

	function downloadStl() {
		const bytes = stl()
		if (!bytes) return
		const blob = new Blob([bytes as BlobPart], {type: "model/stl"})
		const a = document.createElement("a")
		a.href = URL.createObjectURL(blob)
		a.download = `${props.handle.doc()?.title || "model"}.stl`
		a.click()
		setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
	}

	function statusText(): string {
		const p = engineProgress()
		if (p && status() === "rendering" && !stl()) {
			if (p.phase === "downloading") {
				const loaded = formatBytes(p.loaded)
				return p.total
					? `downloading OpenSCAD engine… ${loaded} / ${formatBytes(p.total)}`
					: `downloading OpenSCAD engine… ${loaded}`
			}
			return p.fromCache ? "starting engine (cached)…" : "starting engine…"
		}
		if (status() === "rendering") return "Rendering…"
		if (status() === "error") return "Render failed"
		if (status() === "ready" && elapsedMillis() != null) {
			return `Rendered in ${Math.round(elapsedMillis()!)}ms`
		}
		return "Idle"
	}

	function existingImportNames(exclude?: AutomergeUrl): string[] {
		return (props.handle.doc()?.imports ?? [])
			.filter(imp => imp.docUrl !== exclude)
			.map(imp => imp.name)
	}

	function addImport(item: PatchworkDropItem) {
		const name = uniqueIdentifier(sanitizeIdentifier(item.name), existingImportNames())
		props.handle.change(doc => {
			if (!doc.imports) doc.imports = []
			doc.imports.push({name, docUrl: item.url, label: item.name})
		})
	}

	function removeImport(docUrl: AutomergeUrl) {
		props.handle.change(doc => {
			const idx = doc.imports?.findIndex(imp => imp.docUrl === docUrl) ?? -1
			if (idx !== -1) doc.imports!.splice(idx, 1)
		})
	}

	function startRename(imp: OpenscadImport) {
		setRenamingUrl(imp.docUrl)
		setRenameValue(imp.name)
	}

	function commitRename(docUrl: AutomergeUrl) {
		const name = uniqueIdentifier(sanitizeIdentifier(renameValue()), existingImportNames(docUrl))
		props.handle.change(doc => {
			const imp = doc.imports?.find(i => i.docUrl === docUrl)
			if (imp) imp.name = name
		})
		setRenamingUrl(null)
	}

	function onImportsDragEnter(e: DragEvent) {
		if (!hasPatchworkDrop(e.dataTransfer)) return
		e.preventDefault()
		setDropActive(true)
	}

	function onImportsDragOver(e: DragEvent) {
		if (!hasPatchworkDrop(e.dataTransfer)) return
		e.preventDefault()
	}

	function onImportsDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null
		if (!related || !(e.currentTarget as Node).contains(related)) {
			setDropActive(false)
		}
	}

	function onImportsDrop(e: DragEvent) {
		e.preventDefault()
		setDropActive(false)
		if (!e.dataTransfer) return
		for (const item of parsePatchworkDrop(e.dataTransfer)) addImport(item)
	}

	return (
		<div class="openscad-tool">
			<style>{styles}</style>

			<div class="openscad-toolbar">
				<button class="openscad-btn primary" onClick={renderImmediately}>
					▶ Render
				</button>
				<span
					class="openscad-status"
					classList={{error: status() === "error"}}
				>
					<Show when={status() === "rendering"}>
						<span class="openscad-spinner" />
					</Show>
					{statusText()}
				</span>
				<div class="openscad-toolbar-spacer" />
				<button class="openscad-btn" disabled={!stl()} onClick={downloadStl}>
					Download STL
				</button>
			</div>

			<div
				class="openscad-imports-bar"
				data-drop-active={dropActive() ? "" : undefined}
				onDragEnter={onImportsDragEnter}
				onDragOver={onImportsDragOver}
				onDragLeave={onImportsDragLeave}
				onDrop={onImportsDrop}
			>
				<span class="openscad-imports-label">Imports</span>
				<For each={imports()}>
					{imp => (
						<span class="openscad-import-chip">
							<Show
								when={renamingUrl() !== imp.docUrl}
								fallback={
									<input
										class="openscad-import-rename"
										value={renameValue()}
										onInput={e => setRenameValue(e.currentTarget.value)}
										onBlur={() => commitRename(imp.docUrl)}
										onKeyDown={e => {
											if (e.key === "Enter") commitRename(imp.docUrl)
											if (e.key === "Escape") setRenamingUrl(null)
										}}
										ref={el => setTimeout(() => el.select(), 0)}
									/>
								}
							>
								<button
									class="openscad-import-name"
									onClick={() => startRename(imp)}
									title={`Bound as import("imports/${imp.name}.json"). Source: ${imp.label ?? imp.docUrl}. Click to rename.`}
								>
									{imp.name}
								</button>
							</Show>
							<span class="openscad-import-source">{imp.label ?? "doc"}</span>
							<button
								class="openscad-import-remove"
								onClick={() => removeImport(imp.docUrl)}
								title="Remove import"
							>
								×
							</button>
						</span>
					)}
				</For>
				<Show when={imports().length === 0}>
					<span class="openscad-imports-placeholder">
						Drag a document here to make its data available as JSON via <code>import()</code>
					</span>
				</Show>
			</div>

			<div class="openscad-body">
				<div class="openscad-pane-editor">
					<CodeEditor
						source={initialDoc?.source ?? ""}
						handle={props.handle}
						onRenderRequested={renderImmediately}
					/>
				</div>
				<div class="openscad-pane-view">
					<div class="openscad-view-stage">
						<Viewer3D stl={stl()} />
						<Show when={!stl()}>
							<div class="openscad-viewer-placeholder">
								{status() === "error" ? "Fix the error below and render again" : "Rendering your model…"}
							</div>
						</Show>
					</div>
					<div
						class="openscad-console"
						data-state={status() === "error" ? "error" : undefined}
						data-empty={logs().length === 0 ? "" : undefined}
					>
						<pre>{logs().join("\n")}</pre>
					</div>
				</div>
			</div>
		</div>
	)
}
