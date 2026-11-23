import {batch, createEffect, createSignal, For, onCleanup, onMount, Show} from "solid-js"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {OpenscadDoc, OpenscadImport} from "../types"
import {styles} from "../styles"
import {CodeEditor, type CodeEditorApi} from "./CodeEditor"
import {Viewer3D} from "./Viewer3D"
import {SourceTrail, type SourcePlace} from "./SourceTrail"
import {chainOf, recordsAt, summarize, type SourceMap} from "../render/sourceMap"
import {onLoadProgress, renderScad, RenderError, type LoadProgress} from "../render/engine"
import {to3MF, toBinarySTL, type Model} from "../render/model"
import {hasPatchworkDrop, parsePatchworkDrop, type PatchworkDropItem} from "../dnd"
import {sanitizeIdentifier, uniqueIdentifier} from "../imports"
import {createImportResolver} from "../importResolver"
import {lastRunFrom, saveLastRun} from "../lastRun"

const AUTO_RENDER_DELAY_MS = 700
/** Longest the editor holds a render for imports that are still loading (as the scene host does). */
const IMPORT_WAIT_MS = 5000

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function OpenscadEditor(props: {
	handle: DocHandle<OpenscadDoc>
	/** where its imports are found (`repo`); in Patchwork, the tool's element */
	element: Pick<PatchworkViewElement, "repo">
	/**
	 * Laid over a host's own 3D view (a scene: src/scene/editTool.tsx): no view
	 * of its own, the console under the code, and each render's model handed to
	 * the host (null when one fails, so the host keeps the last good one).
	 */
		hosted?: {
		onModel(model: Model | null): void
		/** which source made which triangle of the last model given, once known (null: not known) */
		onSourceMap?(map: SourceMap | null): void
		/** the picked part and the parts the code's cursor is in, for the host to highlight */
		onHighlight?(selected: number | null, lit: ReadonlySet<number>): void
		/** how the host picks a part: a click in its own view */
		connect?(controls: {pick(record: number | null): void}): void
	}
}) {
	const initialDoc = props.handle.doc()

	const [model, setModel] = createSignal<Model | null>(null)
	const [logs, setLogs] = createSignal<string[]>([])
	const [status, setStatus] = createSignal<"idle" | "rendering" | "ready" | "error">("idle")
	const [elapsedMillis, setElapsedMillis] = createSignal<number | null>(null)
	const [cached, setCached] = createSignal(false)
	const [waitingForImports, setWaitingForImports] = createSignal(false)
	const [engineProgress, setEngineProgress] = createSignal<LoadProgress | null>(null)
	const [imports, setImports] = createSignal<OpenscadImport[]>(initialDoc?.imports ?? [])
	const [dropActive, setDropActive] = createSignal(false)
	const [renamingUrl, setRenamingUrl] = createSignal<AutomergeUrl | null>(null)
		const [renameValue, setRenameValue] = createSignal("")
	// Which source made which triangle (render/sourceMap.ts), the part picked
	// in the view, and the parts the code's cursor is in.
	const [sourceMap, setSourceMap] = createSignal<SourceMap | null>(null)
	const [selected, setSelected] = createSignal<number | null>(null)
	const [lit, setLit] = createSignal<ReadonlySet<number>>(new Set())
	/** the source the shown model and its map were rendered from */
	let renderedSource = ""
	let code: CodeEditorApi | undefined

	// Docs referenced by `doc.imports`, resolved via the repo and kept live:
	// a change to one (or one finally arriving after a failed find, which is
	// retried with backoff) re-triggers a render.
	const resolver = createImportResolver({
		// `as any`: the host's automerge-repo copy doesn't always unify with ours
		find: url => props.element.repo.find(url) as any,
		// a render waiting in renderNow() reads the imports after it wakes,
		// so it already includes this change
		onChange: () => {
			if (!waitingForImports()) scheduleRender()
		},
		onError: (url, err, attempt) => {
			if (attempt === 1) console.warn("openscad: failed to resolve import, retrying", url, err)
		},
	})

	let runId = 0
	// What the last render was asked to draw: a change to the document that
	// leaves it alone (the run being saved, a rename) doesn't render again.
	let renderedInput = ""
	const inputOf = (doc: OpenscadDoc | undefined) => JSON.stringify([doc?.source ?? "", doc?.imports ?? []])
	async function renderNow() {
		const id = ++runId
		setStatus("rendering")
		// Don't render with an import that is still loading: it would bind {}
		// (usually an error) and render again a moment later. Imports that
		// failed, or are slower than this, bind {} and re-render on arrival.
		setWaitingForImports(resolver.pending())
		if (waitingForImports()) {
			await resolver.settled(IMPORT_WAIT_MS)
			if (id !== runId) return
			setWaitingForImports(false)
		}
		const doc = props.handle.doc()
		const source = doc?.source ?? ""
		const heads = [...((props.handle as any).heads?.() ?? [])] as string[]
		renderedInput = inputOf(doc)
		let importPayload: unknown = null
		try {
			importPayload = await resolver.payload(doc?.imports ?? [])
						const result = await renderScad(source, importPayload as any)
			if (id !== runId) return
			const keep = selectionKey()
			batch(() => {
				setSourceMap(null)
				setSelected(null)
				setLit(new Set<number>())
				setModel(result.model)
				setLogs(result.logs)
				setElapsedMillis(result.elapsedMillis)
				setCached(!!result.cached)
				setStatus("ready")
			})
			props.hosted?.onModel(result.model)
			props.hosted?.onSourceMap?.(null)
			// Then which source made what: a second render, after this one.
			const map = (await result.sourceMap) ?? null
			if (id !== runId) return
			renderedSource = source
			batch(() => {
				setSourceMap(map)
				setSelected(map && keep ? findByKey(map, keep) : null)
			})
			props.hosted?.onSourceMap?.(map)
			// The run goes in the document, so its console (echo() results above
			// all) and its parts can be read by other tools without running OpenSCAD.
			saveLastRun(
				props.handle,
				lastRunFrom({heads, source, imports: importPayload, ok: true, logs: result.logs, elapsedMillis: result.elapsedMillis, parts: map ? summarize(result.model, map) : null}),
			)
		} catch (err) {
			if (id !== runId) return
			const message = err instanceof RenderError ? err.message : String((err as Error)?.message ?? err)
			saveLastRun(props.handle, lastRunFrom({heads, source, imports: importPayload, ok: false, logs: message.split("\n")}))
			setLogs(message.split("\n"))
			setStatus("error")
			props.hosted?.onModel(null)
		}
	}

		// ─── from the model to its source, and back ───

	/** What a selection is, across renders: its chain by name and line, then by name alone. */
	function selectionKey(): {exact: string; names: string} | null {
		const map = sourceMap()
		const r = selected()
		if (!map || r == null) return null
		const chain = chainOf(map, r)
		return {exact: chain.map(s => `${s.file}:${s.name}:${s.line}`).join(">"), names: chain.map(s => `${s.file}:${s.name}`).join(">")}
	}
	function findByKey(map: SourceMap, key: {exact: string; names: string}): number | null {
		const keys = map.records.map((_, r) => chainOf(map, r))
		const exact = keys.findIndex(c => c.map(s => `${s.file}:${s.name}:${s.line}`).join(">") === key.exact)
		if (exact >= 0) return exact
		const byName = keys.findIndex(c => c.map(s => `${s.file}:${s.name}`).join(">") === key.names)
		return byName >= 0 ? byName : null
	}

	/** Show a call or definition in the code: exactly, or (the code changed since) at its line and column. */
	function reveal(place: SourcePlace) {
		if (!code || place.file !== "") return
		const text = code.text()
		if (text === renderedSource) return code.reveal(place.from, place.to)
		let start = 0
		for (let line = 1; line < place.line; line++) {
			const nl = text.indexOf("\n", start)
			if (nl === -1) break
			start = nl + 1
		}
		code.reveal(start + place.col, start + place.col + (place.to - place.from))
	}

	/** A part picked in a view (or nothing): select it, and show the call in this document that made it. */
	function pick(record: number | null) {
		setSelected(record)
		const map = sourceMap()
		if (record == null || !map) return
		const own = chainOf(map, record).filter(s => s.file === "")
		const site = own[own.length - 1]
		if (site) reveal(site)
	}

	/** The code's cursor moved: light the parts made by the call it's in. */
	function onCursor(offset: number) {
		const map = sourceMap()
		setLit(map && code?.text() === renderedSource ? recordsAt(map, offset) : new Set<number>())
	}

	createEffect(() => props.hosted?.onHighlight?.(selected(), lit()))

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
		resolver.sync(doc?.imports ?? [])
		if (inputOf(doc) === renderedInput) return
		scheduleRender()
	}

	onMount(() => {
		const unsubProgress = onLoadProgress(setEngineProgress)
		resolver.sync(props.handle.doc()?.imports ?? [])
		props.handle.on("change", onDocChange)
		// waits for the imports just requested before compiling (see renderNow)
				void renderNow()
		props.hosted?.connect?.({pick})
		onCleanup(() => {
			unsubProgress()
			props.handle.off("change", onDocChange)
			if (debounceTimer) clearTimeout(debounceTimer)
			runId++ // drop any render in flight
			resolver.dispose()
		})
	})

	function download(bytes: Uint8Array, type: string, extension: string) {
		const blob = new Blob([bytes as BlobPart], {type})
		const a = document.createElement("a")
		a.href = URL.createObjectURL(blob)
		a.download = `${props.handle.doc()?.title || "model"}.${extension}`
		a.click()
		setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
	}

	function download3mf() {
		const m = model()
		if (m) download(to3MF(m, props.handle.doc()?.title || undefined), "model/3mf", "3mf")
	}

	function downloadStl() {
		const m = model()
		if (m) download(toBinarySTL(m), "model/stl", "stl")
	}

	function statusText(): string {
		const p = engineProgress()
		if (p && status() === "rendering" && !model()) {
			if (p.phase === "downloading") {
				const loaded = formatBytes(p.loaded)
				return p.total
					? `downloading OpenSCAD engine… ${loaded} / ${formatBytes(p.total)}`
					: `downloading OpenSCAD engine… ${loaded}`
			}
			return "starting engine…"
		}
		if (status() === "rendering") return waitingForImports() ? "Loading imports…" : "Rendering…"
		if (status() === "error") return "Render failed"
		if (status() === "ready" && elapsedMillis() != null) {
			return cached()
				? `Rendered in ${Math.round(elapsedMillis()!)}ms (cached)`
				: `Rendered in ${Math.round(elapsedMillis()!)}ms`
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
		<div class="openscad-tool" classList={{"openscad-tool--hosted": !!props.hosted}}>
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
				<button class="openscad-btn" disabled={!model()} onClick={download3mf} title="With colours">
					Download 3MF
				</button>
				<button class="openscad-btn" disabled={!model()} onClick={downloadStl} title="Geometry only: STL has no colours">
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
									title={`Data: import("imports/${imp.name}.json"); OpenSCAD source, if it has some: include <${imp.name}.scad>. From: ${imp.label ?? imp.docUrl}. Click to rename.`}
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
							onReady={api => (code = api)}
							onCursor={onCursor}
						/>
				</div>
				<div class="openscad-pane-view">
					<Show when={!props.hosted}>
													<div
								class="openscad-view-stage"
								tabIndex={-1}
								onKeyDown={e => {
									if (e.key === "Escape" && selected() != null) {
										e.preventDefault()
										setSelected(null)
									}
								}}
							>
								<Viewer3D model={model()} sourceMap={sourceMap()} selected={selected()} lit={lit()} onPick={pick} />
							<Show when={!model()}>
								<div class="openscad-viewer-placeholder">
									{status() === "error" ? "Fix the error below and render again" : "Rendering your model…"}
								</div>
							</Show>
						</div>
					</Show>
											<Show when={sourceMap() && selected() != null ? sourceMap() : null}>
							{map => <SourceTrail map={map()} record={selected()!} onReveal={reveal} onClose={() => setSelected(null)} />}
						</Show>
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
