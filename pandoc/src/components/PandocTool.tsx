import {
	For,
	Show,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	untrack,
} from "solid-js"
import type {AutomergeUrl, Doc, DocHandle, Repo} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {FileDocShape, PandocDoc, PandocInput} from "../types"
import {styles} from "../styles"
import {
	PANDOC_VERSION,
	loadEngine,
	onLoadProgress,
	type LoadProgress,
} from "../pandoc/engine"
import {runConversion, type ConversionResult} from "../pandoc/convert"
import {
	FALLBACK_INPUT_FORMATS,
	FALLBACK_OUTPUT_FORMATS,
	autoOutputFormat,
	detectFormat,
	formatLabel,
	isConvertibleDocument,
	mimeByExtension,
} from "../pandoc/formats"
import {
	collectDroppedFiles,
	createFileDoc,
	guessExtensionForValue,
	hasFileDrop,
	hasPatchworkDrop,
	isFileLikeDoc,
	loadInputContents,
	parsePatchworkDrop,
	resolveDocName,
	type DroppedFile,
} from "../files"
import {DocPicker, type DocPickSelection} from "./DocPicker"

type PendingPick = {
	url: AutomergeUrl
	title: string
	doc: FileDocShape
}

export function PandocEditor(props: {
	handle: DocHandle<PandocDoc>
	element: PatchworkViewElement
}) {
	// patchwork-elements pins an older automerge-repo, so the types disagree
	const repo = props.element.repo as unknown as Repo

	// ─── reactive automerge doc ───
	const [doc, setDoc] = createSignal<Doc<PandocDoc> | undefined>(
		props.handle.doc() as Doc<PandocDoc> | undefined
	)
	const onChange = () => {
		const d = props.handle.doc() as Doc<PandocDoc> | undefined
		if (d) setDoc(() => d)
	}
	if (!doc()) {
		repo
			.find<PandocDoc>(props.handle.url)
			.then(h => {
				const d = h.doc() as Doc<PandocDoc> | undefined
				if (d) setDoc(() => d)
			})
			.catch(() => {})
	}
	props.handle.on("change", onChange)
	onCleanup(() => props.handle.off("change", onChange))

	const change = (fn: (d: PandocDoc) => void) => props.handle.change(fn)

	// ─── engine ───
	const [engine, setEngine] = createSignal<"loading" | "ready" | "error">("loading")
	const [engineError, setEngineError] = createSignal("")
	const [progress, setProgress] = createSignal<LoadProgress | null>(null)
	const [version, setVersion] = createSignal(PANDOC_VERSION)
	const [inputFormats, setInputFormats] = createSignal<string[]>(FALLBACK_INPUT_FORMATS)
	const [outputFormats, setOutputFormats] = createSignal<string[]>(FALLBACK_OUTPUT_FORMATS)

	onMount(() => {
		const unsubscribe = onLoadProgress(setProgress)
		onCleanup(unsubscribe)
		loadEngine()
			.then(engine => {
				if (engine.info.version) setVersion(engine.info.version)
				if (engine.info.inputFormats.length > 0)
					setInputFormats(engine.info.inputFormats)
				if (engine.info.outputFormats.length > 0) {
					const outputs = engine.info.outputFormats
					// pdf is implemented via the Typst pipeline; make sure it's offered
					setOutputFormats(outputs.includes("pdf") ? outputs : [...outputs, "pdf"])
				}
				setEngine("ready")
			})
			.catch(err => {
				setEngineError(String((err as Error)?.message ?? err))
				setEngine("error")
			})
	})

	// ─── format resolution ───
	function mainIndex(d: PandocDoc): number {
		const inputs = d.inputs ?? []
		if (inputs.length === 0) return -1
		const main = d.mainInput
		if (typeof main === "number" && main >= 0 && main < inputs.length) return main
		const idx = inputs.findIndex(i => isConvertibleDocument(i.name))
		return idx >= 0 ? idx : 0
	}

	// "auto" never appears in the dropdowns: formats are detected once when an
	// input is added and written into the doc. These memos also resolve legacy
	// docs that still have "auto" stored.
	const effectiveFrom = createMemo(() => {
		const d = doc()
		if (!d) return "markdown"
		if (d.from && d.from !== "auto") return d.from
		const main = d.inputs?.[mainIndex(d)]
		return (main && detectFormat(main.name)) || "markdown"
	})

	const effectiveTo = createMemo(() => {
		const d = doc()
		if (!d) return "html"
		if (d.to && d.to !== "auto") return d.to
		return autoOutputFormat(effectiveFrom())
	})

	// ─── conversion ───
	const [busy, setBusy] = createSignal(false)
	const [result, setResult] = createSignal<ConversionResult | null>(null)
	const [convError, setConvError] = createSignal("")
	const [tab, setTab] = createSignal<"preview" | "source">("preview")

	let runId = 0
	async function convertNow() {
		const d = doc()
		const idx = d ? mainIndex(d) : -1
		if (!d || idx < 0) {
			setResult(null)
			setConvError("")
			return
		}
		const id = ++runId
		setBusy(true)
		try {
			const inputs = await loadInputContents(repo, [...d.inputs])
			const res = await runConversion({
				inputs,
				mainIndex: idx,
				from: effectiveFrom(),
				to: effectiveTo(),
				standalone: d.standalone ?? true,
			})
			if (id !== runId) return
			setResult(res)
			setConvError("")
		} catch (err) {
			if (id !== runId) return
			setConvError(String((err as Error)?.message ?? err))
		} finally {
			if (id === runId) setBusy(false)
		}
	}

	// auto-convert (debounced) whenever inputs or settings change
	const convKey = createMemo(() => {
		const d = doc()
		if (!d) return null
		return JSON.stringify([d.inputs, d.mainInput, d.from, d.to, d.standalone])
	})
	let debounce: ReturnType<typeof setTimeout> | undefined
	createEffect(() => {
		if (engine() !== "ready") return
		if (convKey() === null) return
		clearTimeout(debounce)
		debounce = setTimeout(() => void convertNow(), 300)
	})
	onCleanup(() => clearTimeout(debounce))

	// object URL for the inline PDF preview
	const [pdfUrl, setPdfUrl] = createSignal<string | undefined>()
	createEffect(() => {
		const res = result()
		const prev = untrack(pdfUrl)
		if (prev) URL.revokeObjectURL(prev)
		setPdfUrl(
			res?.pdfPreview && res.blob ? URL.createObjectURL(res.blob) : undefined
		)
	})
	onCleanup(() => {
		const url = pdfUrl()
		if (url) URL.revokeObjectURL(url)
	})

	// ─── adding inputs ───
	function ensureMain(d: PandocDoc) {
		const main = d.mainInput
		if (typeof main === "number" && main >= 0 && main < d.inputs.length) return
		const idx = d.inputs.findIndex(i => isConvertibleDocument(i.name))
		d.mainInput = idx >= 0 ? idx : 0
	}

	/** Detect formats from the main input; runs when inputs are added or the main changes. */
	function applyDetection(d: PandocDoc, opts: {firstAdd: boolean}) {
		const main = d.inputs[mainIndex(d)]
		if (!main) return
		const detected = detectFormat(main.name)
		if (!detected) return
		d.from = detected
		if (opts.firstAdd || !d.to || d.to === "auto") {
			d.to = autoOutputFormat(detected)
		}
	}

	function addInputs(created: PandocInput[]) {
		if (created.length === 0) return
		change(d => {
			if (!d.inputs) d.inputs = []
			const firstAdd = d.inputs.length === 0
			const prevMain = d.inputs[mainIndex(d)]?.name
			for (const input of created) {
				const existing = d.inputs.findIndex(i => i.name === input.name)
				if (existing >= 0) d.inputs[existing] = input
				else d.inputs.push(input)
			}
			ensureMain(d)
			const newMain = d.inputs[mainIndex(d)]?.name
			if (firstAdd || newMain !== prevMain) {
				applyDetection(d, {firstAdd})
			}
		})
	}

	function setMain(index: number) {
		change(d => {
			if (d.mainInput === index) return
			d.mainInput = index
			applyDetection(d, {firstAdd: false})
		})
	}

	async function addOsFiles(files: DroppedFile[]) {
		const created: PandocInput[] = []
		for (const {file, path} of files) {
			try {
				const url = await createFileDoc(repo, file, path)
				created.push({name: path, url})
			} catch (err) {
				console.warn(`failed to import ${path}:`, err)
			}
		}
		addInputs(created)
	}

	// ─── dropped Patchwork docs ───
	const [pendingPicks, setPendingPicks] = createSignal<PendingPick[]>([])

	async function addPatchworkDocs(items: {url: AutomergeUrl; name?: string}[]) {
		const direct: PandocInput[] = []
		const picks: PendingPick[] = []
		for (const item of items) {
			try {
				const handle = await repo.find<FileDocShape>(item.url)
				const d = handle.doc()
				if (!d) continue
				if (isFileLikeDoc(d)) {
					const name = await resolveDocName(repo, item.url, item.name)
					direct.push({name, url: item.url})
				} else {
					// not a file doc: let the user pick which value to use
					picks.push({
						url: item.url,
						title: item.name || d.title || d.name || "document",
						doc: d,
					})
				}
			} catch (err) {
				console.warn(`failed to load dropped doc ${item.url}:`, err)
			}
		}
		addInputs(direct)
		if (picks.length > 0) setPendingPicks(prev => [...prev, ...picks])
	}

	function safeTitle(title: string): string {
		return title.replace(/[\\/:]+/g, "-").replace(/\.[A-Za-z0-9]+$/, "") || "document"
	}

	function resolvePick(selection: DocPickSelection | null) {
		const pick = pendingPicks()[0]
		setPendingPicks(prev => prev.slice(1))
		if (!pick || !selection) return
		const base = safeTitle(pick.title)
		if (selection.kind === "whole") {
			addInputs([{name: `${base}.json`, url: pick.url}])
		} else {
			const ext = guessExtensionForValue(selection.value, pick.doc)
			const lastKey = selection.path[selection.path.length - 1]
			const name =
				lastKey === "content" ? `${base}.${ext}` : `${base}-${lastKey}.${ext}`
			addInputs([{name, url: pick.url, path: selection.path}])
		}
	}

	function removeInput(index: number) {
		change(d => {
			d.inputs.splice(index, 1)
			const main = d.mainInput
			if (typeof main === "number") {
				if (main === index) {
					const idx = d.inputs.findIndex(i => isConvertibleDocument(i.name))
					d.mainInput = idx >= 0 ? idx : 0
					applyDetection(d, {firstAdd: false})
				} else if (main > index) {
					d.mainInput = main - 1
				}
			}
		})
	}

	// ─── drag & drop ───
	const [dragOver, setDragOver] = createSignal(false)
	let dragDepth = 0

	function relevantDrag(e: DragEvent) {
		return hasFileDrop(e.dataTransfer) || hasPatchworkDrop(e.dataTransfer)
	}

	function onDragEnter(e: DragEvent) {
		if (!relevantDrag(e)) return
		e.preventDefault()
		dragDepth++
		setDragOver(true)
	}

	function onDragOver(e: DragEvent) {
		if (relevantDrag(e)) e.preventDefault()
	}

	function onDragLeave(e: DragEvent) {
		if (!relevantDrag(e)) return
		dragDepth = Math.max(0, dragDepth - 1)
		if (dragDepth === 0) setDragOver(false)
	}

	function onDrop(e: DragEvent) {
		dragDepth = 0
		setDragOver(false)
		const dt = e.dataTransfer
		if (!dt) return
		e.preventDefault()
		e.stopPropagation()
		// getData is only readable synchronously during the drop event
		const patchworkItems = parsePatchworkDrop(dt)
		if (patchworkItems.length > 0) {
			void addPatchworkDocs(patchworkItems)
			return
		}
		void collectDroppedFiles(dt).then(addOsFiles)
	}

	// ─── upload buttons ───
	let fileInput: HTMLInputElement | undefined
	let folderInput: HTMLInputElement | undefined

	function onPickedFiles(input: HTMLInputElement) {
		const files = Array.from(input.files ?? [])
		input.value = ""
		void addOsFiles(
			files.map(file => {
				// strip the top-level folder from webkitRelativePath so documents
				// can reference sibling resources by relative path
				const rel = file.webkitRelativePath
				const path = rel ? rel.split("/").slice(1).join("/") || file.name : file.name
				return {file, path}
			})
		)
	}

	// ─── output actions ───
	async function resultBlob(res: ConversionResult): Promise<Blob> {
		if (res.kind === "binary") return res.blob!
		const ext = res.filename.split(".").pop() ?? ""
		const mime = mimeByExtension[ext] || "text/plain"
		return new Blob([res.text ?? ""], {type: `${mime};charset=utf-8`})
	}

	async function downloadResult() {
		const res = result()
		if (!res) return
		const a = document.createElement("a")
		a.href = URL.createObjectURL(await resultBlob(res))
		a.download = res.filename
		a.click()
		setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
	}

	async function saveResultToPatchwork() {
		const res = result()
		if (!res) return
		const content =
			res.kind === "binary"
				? new Uint8Array(await res.blob!.arrayBuffer())
				: (res.text ?? "")
		const ext = res.filename.split(".").pop() ?? ""
		const fileHandle = repo.create<FileDocShape>({
			"@patchwork": {type: "file"},
			name: res.filename,
			extension: ext,
			mimeType:
				mimeByExtension[ext] ||
				(res.kind === "binary" ? "application/octet-stream" : "text/plain"),
			content,
		})
		change(d => {
			if (!d.outputs) d.outputs = []
			d.outputs.push({name: res.filename, url: fileHandle.url})
		})
	}

	function removeOutput(index: number) {
		change(d => d.outputs?.splice(index, 1))
	}

	// ─── preview helpers ───
	function previewHtml(res: ConversionResult): string {
		const text = res.text ?? ""
		if (/<html[\s>]/i.test(text)) return text
		return `<!doctype html><html><head><meta charset="utf-8"><style>
			body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
				max-width: 720px; margin: 2.5rem auto; padding: 0 1.25rem;
				line-height: 1.6; color: #1c1c1e; }
			img { max-width: 100%; }
			pre { background: #f4f4f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
			code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
			blockquote { border-left: 3px solid #d4d4d8; margin-left: 0; padding-left: 1em; color: #52525b; }
			table { border-collapse: collapse; } td, th { border: 1px solid #e4e4e7; padding: 4px 10px; }
		</style></head><body>${text}</body></html>`
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	}

	function engineStatusText(): string {
		if (engine() === "error") return `engine failed: ${engineError()}`
		if (engine() === "ready") return `pandoc ${version()} · running locally`
		const p = progress()
		if (!p) return "checking cache…"
		if (p.phase === "starting") {
			return p.fromCache ? "starting engine (cached)…" : "starting engine…"
		}
		const loaded = formatBytes(p.loaded)
		return p.total
			? `downloading pandoc engine… ${loaded} / ${formatBytes(p.total)}`
			: `downloading pandoc engine… ${loaded}`
	}

	const sortedInputFormats = createMemo(() => [...inputFormats()].sort())
	const sortedOutputFormats = createMemo(() => [...outputFormats()].sort())

	const inputs = () => doc()?.inputs ?? []
	const outputs = () => doc()?.outputs ?? []

	return (
		<div
			class="pandoc-tool"
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<style>{styles}</style>

			{/* ─── header ─── */}
			<header class="pandoc-header">
				<div class="pandoc-field">
					<label>From</label>
					<select
						class="pandoc-select"
						disabled={inputs().length === 0}
						onChange={e => {
							const value = e.currentTarget.value
							change(d => (d.from = value))
						}}
					>
						<For each={sortedInputFormats()}>
							{f => (
								<option value={f} selected={effectiveFrom() === f}>
									{formatLabel(f)}
								</option>
							)}
						</For>
					</select>
				</div>

				<span class="pandoc-arrow">→</span>

				<div class="pandoc-field">
					<label>To</label>
					<select
						class="pandoc-select"
						disabled={inputs().length === 0}
						onChange={e => {
							const value = e.currentTarget.value
							change(d => (d.to = value))
						}}
					>
						<For each={sortedOutputFormats()}>
							{f => (
								<option value={f} selected={effectiveTo() === f}>
									{formatLabel(f)}
								</option>
							)}
						</For>
					</select>
				</div>

				<label class="pandoc-check">
					<input
						type="checkbox"
						checked={doc()?.standalone ?? true}
						onChange={e => {
							const value = e.currentTarget.checked
							change(d => (d.standalone = value))
						}}
					/>
					Standalone
				</label>

				<div class="pandoc-header-spacer" />

				<button
					class="pandoc-btn primary"
					disabled={engine() !== "ready" || busy() || inputs().length === 0}
					onClick={() => void convertNow()}
				>
					<Show when={busy()} fallback={"Convert"}>
						<span class="pandoc-spinner" /> Converting
					</Show>
				</button>
			</header>

			{/* ─── body ─── */}
			<div class="pandoc-body">
				<aside class="pandoc-inputs">
					<div class="pandoc-inputs-header">
						<h2>Inputs</h2>
						<div class="pandoc-icon-btns">
							<button class="pandoc-btn small" onClick={() => fileInput?.click()}>
								+ Files
							</button>
							<button class="pandoc-btn small" onClick={() => folderInput?.click()}>
								+ Folder
							</button>
						</div>
					</div>

					<Show
						when={inputs().length > 0}
						fallback={
							<div class="pandoc-empty">
								<div class="big">⇣</div>
								<div>
									Drop files, folders, or
									<br />
									Patchwork documents here
								</div>
							</div>
						}
					>
						<ul class="pandoc-input-list">
							<For each={inputs()}>
								{(input, i) => (
									<li
										class="pandoc-input-item"
										classList={{main: mainIndex(doc()!) === i()}}
										title={`${input.name}${input.path ? ` ← .${input.path.join(".")}` : ""}${
											mainIndex(doc()!) === i()
												? " (document to convert)"
												: " (resource)"
										}`}
										onClick={() => setMain(i())}
									>
										<span class="marker">
											{mainIndex(doc()!) === i() ? "▶" : ""}
										</span>
										<span class="name">{input.name}</span>
										<button
											class="remove"
											title="Remove"
											onClick={e => {
												e.stopPropagation()
												removeInput(i())
											}}
										>
											×
										</button>
									</li>
								)}
							</For>
						</ul>
					</Show>

					<Show when={outputs().length > 0}>
						<div class="pandoc-outputs">
							<span class="label">Saved</span>
							<For each={outputs()}>
								{(output, i) => (
									<span
										class="pandoc-chip"
										draggable={true}
										title="Drag into Patchwork"
										onDragStart={e => {
											e.dataTransfer?.setData(
												"text/x-patchwork-urls",
												JSON.stringify([output.url])
											)
										}}
									>
										{output.name}
										<button
											class="chip-remove"
											title="Remove from list"
											onClick={() => removeOutput(i())}
										>
											×
										</button>
									</span>
								)}
							</For>
						</div>
					</Show>
				</aside>

				{/* ─── preview ─── */}
				<section class="pandoc-preview">
					<div class="pandoc-preview-bar">
						<Show when={result()?.htmlPreview}>
							<div class="pandoc-tabs">
								<button
									class="pandoc-tab"
									classList={{active: tab() === "preview"}}
									onClick={() => setTab("preview")}
								>
									Preview
								</button>
								<button
									class="pandoc-tab"
									classList={{active: tab() === "source"}}
									onClick={() => setTab("source")}
								>
									Source
								</button>
							</div>
						</Show>
						<Show when={result()}>
							{r => <span class="pandoc-resolved">{r().filename}</span>}
						</Show>
						<div class="pandoc-preview-spacer" />
						<Show when={result()}>
							<button class="pandoc-btn small" onClick={() => void downloadResult()}>
								Download
							</button>
							<button
								class="pandoc-btn small"
								onClick={() => void saveResultToPatchwork()}
							>
								Save to Patchwork
							</button>
						</Show>
					</div>

					<div class="pandoc-preview-main">
						<Show
							when={!convError()}
							fallback={<div class="pandoc-error">{convError()}</div>}
						>
							<Show
								when={result()}
								fallback={
									<div class="pandoc-placeholder">
										<Show
											when={engine() === "ready"}
											fallback={
												<>
													<span class="pandoc-spinner dark" />
													<div>{engineStatusText()}</div>
													<Show
														when={
															progress()?.phase === "downloading" &&
															progress()?.total
														}
													>
														<div class="pandoc-progress">
															<div
																style={{
																	width: `${Math.round((progress()!.loaded / progress()!.total!) * 100)}%`,
																}}
															/>
														</div>
													</Show>
												</>
											}
										>
											<Show
												when={inputs().length > 0}
												fallback={<div>Add a file to convert it</div>}
											>
												<Show when={busy()} fallback={<div>Ready</div>}>
													<span class="pandoc-spinner dark" />
													<div>Converting…</div>
												</Show>
											</Show>
										</Show>
									</div>
								}
							>
								{r => (
									<Show
										when={r().kind === "text"}
										fallback={
											<Show
												when={r().pdfPreview && pdfUrl()}
												fallback={
													<div style="display:flex;height:100%;">
														<div class="pandoc-binary-card">
															<div class="icon">📦</div>
															<div class="filename">{r().filename}</div>
															<div class="size">
																{formatBytes(r().blob?.size ?? 0)} ·{" "}
																{formatLabel(r().to)}
															</div>
															<div style="display:flex;gap:8px;">
																<button
																	class="pandoc-btn primary"
																	onClick={() => void downloadResult()}
																>
																	Download
																</button>
																<button
																	class="pandoc-btn"
																	onClick={() => void saveResultToPatchwork()}
																>
																	Save to Patchwork
																</button>
															</div>
														</div>
													</div>
												}
											>
												<iframe class="pandoc-preview-frame" src={pdfUrl()} />
											</Show>
										}
									>
										<Show
											when={r().htmlPreview && tab() === "preview"}
											fallback={<pre class="pandoc-source">{r().text}</pre>}
										>
											<iframe
												class="pandoc-preview-frame"
												sandbox="allow-same-origin"
												srcdoc={previewHtml(r())}
											/>
										</Show>
									</Show>
								)}
							</Show>
						</Show>

						<Show when={busy() && result() && !convError()}>
							<div class="pandoc-converting-badge">
								<span class="pandoc-spinner dark" /> Converting…
							</div>
						</Show>
					</div>

					<Show when={(result()?.warnings.length ?? 0) > 0}>
						<div class="pandoc-warnings">
							<For each={result()!.warnings}>{w => <div>{w}</div>}</For>
						</div>
					</Show>
				</section>
			</div>

			{/* ─── status bar ─── */}
			<footer class="pandoc-status">
				<span
					class="dot"
					classList={{
						ready: engine() === "ready",
						loading: engine() === "loading",
						error: engine() === "error",
					}}
				/>
				<span>{engineStatusText()}</span>
				<span class="spacer" />
				<Show
					when={
						engine() === "loading" &&
						progress()?.phase === "downloading" &&
						progress()?.total
					}
				>
					<div class="pandoc-progress">
						<div
							style={{
								width: `${Math.round((progress()!.loaded / progress()!.total!) * 100)}%`,
							}}
						/>
					</div>
				</Show>
			</footer>

			{/* hidden upload inputs */}
			<input
				type="file"
				multiple
				style="display:none"
				ref={fileInput}
				onChange={e => onPickedFiles(e.currentTarget)}
			/>
			<input
				type="file"
				style="display:none"
				ref={el => {
					folderInput = el
					el.setAttribute("webkitdirectory", "")
				}}
				onChange={e => onPickedFiles(e.currentTarget)}
			/>

			<Show when={pendingPicks()[0]}>
				{pick => (
					<DocPicker
						title={pick().title}
						doc={pick().doc}
						onPick={selection => resolvePick(selection)}
						onCancel={() => resolvePick(null)}
					/>
				)}
			</Show>

			<Show when={dragOver()}>
				<div class="pandoc-drop-overlay">
					<span>Drop to add inputs</span>
				</div>
			</Show>
		</div>
	)
}
