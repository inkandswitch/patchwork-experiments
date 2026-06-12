import {
	For,
	Show,
	createEffect,
	createSignal,
	onCleanup,
	onMount,
	untrack,
} from "solid-js"
import type {AutomergeUrl, Doc, DocHandle, Repo} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {FileDocShape, FfmpegDoc, FfmpegInput} from "../types"
import {styles} from "../styles"
import {loadEngine, onLoadProgress, onLog, type LoadProgress} from "../ffmpeg/engine"
import {runConversion, type ConversionResult} from "../ffmpeg/convert"
import {
	OUTPUT_FORMATS,
	autoOutputFormat,
	formatLabel,
	isMediaName,
	mimeFor,
} from "../ffmpeg/formats"
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

export function FfmpegEditor(props: {
	handle: DocHandle<FfmpegDoc>
	element: PatchworkViewElement
}) {
	// patchwork-elements pins an older automerge-repo, so the types disagree
	const repo = props.element.repo as unknown as Repo

	// ─── reactive automerge doc ───
	const [doc, setDoc] = createSignal<Doc<FfmpegDoc> | undefined>(
		props.handle.doc() as Doc<FfmpegDoc> | undefined
	)
	const onChange = () => {
		const d = props.handle.doc() as Doc<FfmpegDoc> | undefined
		if (d) setDoc(() => d)
	}
	if (!doc()) {
		repo
			.find<FfmpegDoc>(props.handle.url)
			.then(h => {
				const d = h.doc() as Doc<FfmpegDoc> | undefined
				if (d) setDoc(() => d)
			})
			.catch(() => {})
	}
	props.handle.on("change", onChange)
	onCleanup(() => props.handle.off("change", onChange))

	const change = (fn: (d: FfmpegDoc) => void) => props.handle.change(fn)

	// ─── engine ───
	const [engine, setEngine] = createSignal<"loading" | "ready" | "error">("loading")
	const [engineError, setEngineError] = createSignal("")
	const [progress, setProgress] = createSignal<LoadProgress | null>(null)
	const [version, setVersion] = createSignal("")
	const [log, setLog] = createSignal<string[]>([])

	onMount(() => {
		const unsubProgress = onLoadProgress(setProgress)
		const unsubLog = onLog(line =>
			setLog(prev => {
				const next = [...prev, line]
				return next.length > 500 ? next.slice(-500) : next
			})
		)
		onCleanup(() => {
			unsubProgress()
			unsubLog()
		})
		loadEngine()
			.then(engine => {
				setVersion(engine.info.version)
				setEngine("ready")
			})
			.catch(err => {
				setEngineError(String((err as Error)?.message ?? err))
				setEngine("error")
			})
	})

	function mainIndex(d: FfmpegDoc): number {
		const inputs = d.inputs ?? []
		if (inputs.length === 0) return -1
		const main = d.mainInput
		if (typeof main === "number" && main >= 0 && main < inputs.length) return main
		const idx = inputs.findIndex(i => isMediaName(i.name))
		return idx >= 0 ? idx : 0
	}

	// ─── conversion ───
	const [busy, setBusy] = createSignal(false)
	const [jobProgress, setJobProgress] = createSignal<number | null>(null)
	const [result, setResult] = createSignal<ConversionResult | null>(null)
	const [convError, setConvError] = createSignal("")
	const [tab, setTab] = createSignal<"preview" | "log">("preview")

	let runId = 0
	async function convertNow() {
		const d = doc()
		const idx = d ? mainIndex(d) : -1
		if (!d || idx < 0) return
		const id = ++runId
		setBusy(true)
		setJobProgress(null)
		try {
			const inputs = await loadInputContents(repo, [...d.inputs])
			const res = await runConversion({
				inputs,
				mainIndex: idx,
				to: d.to || "mp4",
				extraArgs: d.args,
				onProgress: ratio => {
					if (id === runId) setJobProgress(ratio)
				},
			})
			if (id !== runId) return
			setResult(res)
			setConvError("")
			setTab("preview")
		} catch (err) {
			if (id !== runId) return
			setConvError(String((err as Error)?.message ?? err))
		} finally {
			if (id === runId) {
				setBusy(false)
				setJobProgress(null)
			}
		}
	}

	// object URL for the media preview
	const [mediaUrl, setMediaUrl] = createSignal<string | undefined>()
	createEffect(() => {
		const res = result()
		const prev = untrack(mediaUrl)
		if (prev) URL.revokeObjectURL(prev)
		setMediaUrl(res?.preview ? URL.createObjectURL(res.blob) : undefined)
	})
	onCleanup(() => {
		const url = mediaUrl()
		if (url) URL.revokeObjectURL(url)
	})

	// ─── adding inputs ───
	function ensureMain(d: FfmpegDoc) {
		const main = d.mainInput
		if (typeof main === "number" && main >= 0 && main < d.inputs.length) return
		const idx = d.inputs.findIndex(i => isMediaName(i.name))
		d.mainInput = idx >= 0 ? idx : 0
	}

	/** Pick a default output format from the main input; runs on add/main change. */
	function applyDetection(d: FfmpegDoc) {
		const main = d.inputs[mainIndex(d)]
		if (main) d.to = autoOutputFormat(main.name)
	}

	function addInputs(created: FfmpegInput[]) {
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
			if (firstAdd || newMain !== prevMain) applyDetection(d)
		})
	}

	function setMain(index: number) {
		change(d => {
			if (d.mainInput === index) return
			d.mainInput = index
			applyDetection(d)
		})
	}

	function removeInput(index: number) {
		change(d => {
			d.inputs.splice(index, 1)
			const main = d.mainInput
			if (typeof main === "number") {
				if (main === index) {
					const idx = d.inputs.findIndex(i => isMediaName(i.name))
					d.mainInput = idx >= 0 ? idx : 0
					applyDetection(d)
				} else if (main > index) {
					d.mainInput = main - 1
				}
			}
		})
	}

	async function addOsFiles(files: DroppedFile[]) {
		const created: FfmpegInput[] = []
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
		const direct: FfmpegInput[] = []
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
		return title.replace(/[\\/:]+/g, "-").replace(/\.[A-Za-z0-9]+$/, "") || "media"
	}

	function resolvePick(selection: DocPickSelection | null) {
		const pick = pendingPicks()[0]
		setPendingPicks(prev => prev.slice(1))
		if (!pick || !selection) return
		const ext = guessExtensionForValue(selection.value, pick.doc)
		const lastKey = selection.path[selection.path.length - 1]
		const base = safeTitle(pick.title)
		const name =
			lastKey === "content" ? `${base}.${ext}` : `${base}-${lastKey}.${ext}`
		addInputs([{name, url: pick.url, path: selection.path}])
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
				const rel = file.webkitRelativePath
				const path = rel ? rel.split("/").slice(1).join("/") || file.name : file.name
				return {file, path}
			})
		)
	}

	// ─── output actions ───
	function downloadResult() {
		const res = result()
		if (!res) return
		const a = document.createElement("a")
		a.href = URL.createObjectURL(res.blob)
		a.download = res.filename
		a.click()
		setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
	}

	async function saveResultToPatchwork() {
		const res = result()
		if (!res) return
		const content = new Uint8Array(await res.blob.arrayBuffer())
		const ext = res.filename.split(".").pop() ?? ""
		const fileHandle = repo.create<FileDocShape>({
			"@patchwork": {type: "file"},
			name: res.filename,
			extension: ext,
			mimeType: mimeFor(res.filename),
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

	// ─── status helpers ───
	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	}

	function engineStatusText(): string {
		if (engine() === "error") return `engine failed: ${engineError()}`
		if (engine() === "ready")
			return `ffmpeg ${version() || "wasm"} · running locally`
		const p = progress()
		if (!p) return "checking cache…"
		if (p.phase === "starting") {
			return p.fromCache ? "starting engine (cached)…" : "starting engine…"
		}
		const loaded = formatBytes(p.loaded)
		return p.total
			? `downloading ffmpeg engine… ${loaded} / ${formatBytes(p.total)}`
			: `downloading ffmpeg engine… ${loaded}`
	}

	const inputs = () => doc()?.inputs ?? []
	const outputs = () => doc()?.outputs ?? []
	const percent = () => {
		const r = jobProgress()
		return r === null ? null : Math.round(r * 100)
	}

	return (
		<div
			class="ffmpeg-tool"
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<style>{styles}</style>

			{/* ─── header ─── */}
			<header class="ffmpeg-header">
				<div class="ffmpeg-field">
					<label>To</label>
					<select
						class="ffmpeg-select"
						disabled={inputs().length === 0}
						onChange={e => {
							const value = e.currentTarget.value
							change(d => (d.to = value))
						}}
					>
						<optgroup label="Video">
							<For each={OUTPUT_FORMATS.filter(f => f.kind === "video")}>
								{f => (
									<option value={f.ext} selected={(doc()?.to || "mp4") === f.ext}>
										{f.label}
									</option>
								)}
							</For>
						</optgroup>
						<optgroup label="Audio">
							<For each={OUTPUT_FORMATS.filter(f => f.kind === "audio")}>
								{f => (
									<option value={f.ext} selected={doc()?.to === f.ext}>
										{f.label}
									</option>
								)}
							</For>
						</optgroup>
						<optgroup label="Image">
							<For each={OUTPUT_FORMATS.filter(f => f.kind === "image")}>
								{f => (
									<option value={f.ext} selected={doc()?.to === f.ext}>
										{f.label}
									</option>
								)}
							</For>
						</optgroup>
					</select>
				</div>

				<input
					class="ffmpeg-args"
					type="text"
					placeholder="extra args, e.g. -vf scale=640:-2 -an"
					value={doc()?.args ?? ""}
					onChange={e => {
						const value = e.currentTarget.value
						change(d => (d.args = value))
					}}
				/>

				<div class="ffmpeg-header-spacer" />

				<button
					class="ffmpeg-btn primary"
					disabled={engine() !== "ready" || busy() || inputs().length === 0}
					onClick={() => void convertNow()}
				>
					<Show when={busy()} fallback={"Convert"}>
						<span class="ffmpeg-spinner" />{" "}
						{percent() === null ? "Converting" : `${percent()}%`}
					</Show>
				</button>
			</header>

			{/* ─── body ─── */}
			<div class="ffmpeg-body">
				<aside class="ffmpeg-inputs">
					<div class="ffmpeg-inputs-header">
						<h2>Inputs</h2>
						<div class="ffmpeg-icon-btns">
							<button class="ffmpeg-btn small" onClick={() => fileInput?.click()}>
								+ Files
							</button>
							<button class="ffmpeg-btn small" onClick={() => folderInput?.click()}>
								+ Folder
							</button>
						</div>
					</div>

					<Show
						when={inputs().length > 0}
						fallback={
							<div class="ffmpeg-empty">
								<div class="big">⇣</div>
								<div>
									Drop media files, folders, or
									<br />
									Patchwork documents here
								</div>
							</div>
						}
					>
						<ul class="ffmpeg-input-list">
							<For each={inputs()}>
								{(input, i) => (
									<li
										class="ffmpeg-input-item"
										classList={{main: mainIndex(doc()!) === i()}}
										title={`${input.name}${input.path ? ` ← .${input.path.join(".")}` : ""}${
											mainIndex(doc()!) === i()
												? " (file to convert)"
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
						<div class="ffmpeg-outputs">
							<span class="label">Saved</span>
							<For each={outputs()}>
								{(output, i) => (
									<span
										class="ffmpeg-chip"
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
				<section class="ffmpeg-preview">
					<div class="ffmpeg-preview-bar">
						<div class="ffmpeg-tabs">
							<button
								class="ffmpeg-tab"
								classList={{active: tab() === "preview"}}
								onClick={() => setTab("preview")}
							>
								Preview
							</button>
							<button
								class="ffmpeg-tab"
								classList={{active: tab() === "log"}}
								onClick={() => setTab("log")}
							>
								Log
							</button>
						</div>
						<Show when={result()}>
							{r => <span class="ffmpeg-resolved">{r().filename}</span>}
						</Show>
						<div class="ffmpeg-preview-spacer" />
						<Show when={result()}>
							{r => <span class="ffmpeg-command" title={r().command}>{r().command}</span>}
						</Show>
						<Show when={result()}>
							<button class="ffmpeg-btn small" onClick={downloadResult}>
								Download
							</button>
							<button
								class="ffmpeg-btn small"
								onClick={() => void saveResultToPatchwork()}
							>
								Save to Patchwork
							</button>
						</Show>
					</div>

					<div class="ffmpeg-preview-main">
						<Show
							when={tab() === "preview"}
							fallback={<pre class="ffmpeg-log">{log().join("\n")}</pre>}
						>
							<Show
								when={!convError()}
								fallback={<div class="ffmpeg-error">{convError()}</div>}
							>
								<Show
									when={result()}
									fallback={
										<div class="ffmpeg-placeholder">
											<Show
												when={engine() === "ready"}
												fallback={
													<>
														<span class="ffmpeg-spinner dark" />
														<div>{engineStatusText()}</div>
														<Show
															when={
																progress()?.phase === "downloading" &&
																progress()?.total
															}
														>
															<div class="ffmpeg-progress">
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
													fallback={<div>Add a media file to convert it</div>}
												>
													<Show
														when={busy()}
														fallback={<div>Press Convert to run ffmpeg</div>}
													>
														<span class="ffmpeg-spinner dark" />
														<div class="ffmpeg-job-progress">
															Converting…
															<Show when={percent() !== null}>
																<span>{percent()}%</span>
															</Show>
														</div>
														<Show when={percent() !== null}>
															<div class="ffmpeg-progress">
																<div style={{width: `${percent()}%`}} />
															</div>
														</Show>
													</Show>
												</Show>
											</Show>
										</div>
									}
								>
									{r => (
										<Show
											when={r().preview && mediaUrl()}
											fallback={
												<div style="display:flex;height:100%;">
													<div class="ffmpeg-binary-card">
														<div class="icon">🎞️</div>
														<div class="filename">{r().filename}</div>
														<div class="size">
															{formatBytes(r().blob.size)} · {formatLabel(r().to)}
														</div>
														<div style="display:flex;gap:8px;">
															<button
																class="ffmpeg-btn primary"
																onClick={downloadResult}
															>
																Download
															</button>
															<button
																class="ffmpeg-btn"
																onClick={() => void saveResultToPatchwork()}
															>
																Save to Patchwork
															</button>
														</div>
													</div>
												</div>
											}
										>
											<Show
												when={r().preview === "video"}
												fallback={
													<Show
														when={r().preview === "audio"}
														fallback={
															<div class="ffmpeg-media">
																<img src={mediaUrl()} alt={r().filename} />
															</div>
														}
													>
														<div class="ffmpeg-media audio">
															<audio controls src={mediaUrl()} />
														</div>
													</Show>
												}
											>
												<div class="ffmpeg-media">
													<video controls src={mediaUrl()} />
												</div>
											</Show>
										</Show>
									)}
								</Show>
							</Show>
						</Show>

						<Show when={busy() && result() && !convError() && tab() === "preview"}>
							<div class="ffmpeg-converting-badge">
								<span class="ffmpeg-spinner dark" />{" "}
								{percent() === null ? "Converting…" : `Converting… ${percent()}%`}
							</div>
						</Show>
					</div>
				</section>
			</div>

			{/* ─── status bar ─── */}
			<footer class="ffmpeg-status">
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
					<div class="ffmpeg-progress">
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
				<div class="ffmpeg-drop-overlay">
					<span>Drop to add inputs</span>
				</div>
			</Show>
		</div>
	)
}
