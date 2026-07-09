import {createSignal, onCleanup, onMount, Show} from "solid-js"
import type {DocHandle} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {OpenscadDoc} from "../types"
import {styles} from "../styles"
import {CodeEditor} from "./CodeEditor"
import {Viewer3D} from "./Viewer3D"
import {onLoadProgress, renderScad, RenderError, type LoadProgress} from "../render/engine"

const AUTO_RENDER_DELAY_MS = 700

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

	let runId = 0
	async function renderNow() {
		const doc = props.handle.doc()
		const source = doc?.source ?? ""
		const id = ++runId
		setStatus("rendering")
		try {
			const result = await renderScad(source)
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

	onMount(() => {
		const unsubProgress = onLoadProgress(setEngineProgress)
		props.handle.on("change", scheduleRender)
		void renderNow()
		onCleanup(() => {
			unsubProgress()
			props.handle.off("change", scheduleRender)
			if (debounceTimer) clearTimeout(debounceTimer)
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
