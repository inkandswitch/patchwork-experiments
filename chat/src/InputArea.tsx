import {Show, For, createSignal, createEffect, onMount, onCleanup} from "solid-js"
import {useChatContext} from "./context"
import {SVG_ICONS} from "./icons"
import {formatTextPreview, formatDuration} from "./helpers"

export function InputArea(props: {
	inputRef: (el: HTMLTextAreaElement) => void
	replyText: string
	startGifCamera: () => Promise<void>
	stopGifCamera: () => void
}) {
	const ctx = useChatContext()
	let inputEl: HTMLTextAreaElement | undefined
	let previewEl: HTMLDivElement | undefined
	let gifVideoEl: HTMLVideoElement | undefined

	function updatePreview() {
		if (!inputEl || !previewEl) return
		const val = inputEl.value
		if (!val || !/[_*`|<>%~^.]/.test(val)) {
			inputEl.classList.remove("chat-input-editing")
			previewEl.innerHTML = ""
			return
		}
		inputEl.classList.add("chat-input-editing")
		previewEl.innerHTML = formatTextPreview(val)
		previewEl.style.fontFamily = inputEl.style.fontFamily || ""
		previewEl.scrollTop = inputEl.scrollTop
	}

	function handleInput() {
		if (!inputEl) return
		inputEl.style.height = "auto"
		inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px"
		if (previewEl) previewEl.style.height = inputEl.style.height
		updatePreview()
		ctx.broadcastPresence(true)
		ctx.scheduleDraftSync()
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault()
			ctx.sendMessage()
		}
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items
		if (!items) return
		let handled = false
		for (const item of Array.from(items)) {
			const file = item.getAsFile()
			if (file) {
				if (!handled) {
					e.preventDefault()
					handled = true
				}
				ctx.addPendingFile(
					file,
					file.name ||
						(item.type.split("/")[0] +
							"-" +
							Date.now() +
							"." +
							(item.type.split("/")[1] || "bin")),
					file.type || item.type || "application/octet-stream"
				)
			}
		}
	}

	function toggleGif() {
		const enabled = !ctx.gifModeEnabled()
		ctx.setGifModeEnabled(enabled)
		if (enabled) props.startGifCamera()
		else props.stopGifCamera()
	}

	return (
		<div class="chat-input-wrapper">
			{/* Reply bar */}
			<Show when={ctx.replyToId()}>
				<div class="chat-reply-bar show">
					<span>Replying to </span>
					<span class="chat-reply-bar-text">{props.replyText}</span>
					<button
						class="chat-reply-bar-close"
						innerHTML={SVG_ICONS.close}
						on:click={() => ctx.setReplyToId(null)}
					/>
				</div>
			</Show>

			{/* Paste preview */}
			<Show when={ctx.pendingFiles().length > 0}>
				<div class="chat-paste-preview show">
					<div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;align-items:center">
						<For each={ctx.pendingFiles()}>
							{(f, i) => {
								if (f.mimeType.startsWith("image/") && f.dataUrl) {
									return <img src={f.dataUrl} title={f.name} />
								}
								if (f.mimeType.startsWith("video/") && f.dataUrl) {
									return <video src={f.dataUrl} title={f.name} muted />
								}
								return (
									<div class="chat-paste-file">
										<span class="chat-msg-file-icon" innerHTML={SVG_ICONS.file} />
										<span class="chat-paste-file-name">{f.name}</span>
										<button
											class="chat-paste-file-remove"
											innerHTML={SVG_ICONS.close}
											on:click={(e) => {
												e.stopPropagation()
												ctx.removePendingFile(i())
											}}
										/>
									</div>
								)
							}}
						</For>
					</div>
					<button
						class="chat-paste-preview-close"
						innerHTML={SVG_ICONS.close}
						on:click={() => ctx.clearPaste()}
					/>
				</div>
			</Show>

			{/* Recording bar */}
			<Show when={ctx.isRecording()}>
				<RecordingBar />
			</Show>

			{/* Input row */}
			<Show when={!ctx.isRecording()}>
				<div class="chat-input-row">
					{/* GIF toggle */}
					<button
						class={"chat-gif-toggle" + (ctx.gifModeEnabled() ? " active" : "")}
						title="Toggle GIF selfie mode"
						on:click={toggleGif}
					>
						<span class="chat-gif-icon" innerHTML={SVG_ICONS.camera} />
						<video
							ref={(el) => {
								gifVideoEl = el
								ctx.gifVideoRef = el
							}}
							autoplay
							muted
							playsinline
						/>
					</button>

					{/* Text input */}
					<div class="chat-input-wrap">
						<textarea
							class="chat-input"
							rows={1}
							placeholder={"Message " + (ctx.handle.doc()?.title || "chat")}
							ref={(el) => {
								inputEl = el
								props.inputRef(el)
							}}
							on:input={handleInput}
							on:keydown={handleKeydown}
							on:paste={handlePaste}
							on:scroll={() => {
								if (previewEl && inputEl) previewEl.scrollTop = inputEl.scrollTop
							}}
						/>
						<div class="chat-input-preview" ref={previewEl} />
					</div>

					{/* Mic button */}
					<button
						class="chat-input-btn"
						title="Record voice note"
						innerHTML={SVG_ICONS.mic}
						on:click={() => ctx.startRec()}
					/>

					{/* Send button */}
					<button
						class="chat-input-btn"
						title="Send"
						innerHTML={SVG_ICONS.send}
						on:click={() => ctx.sendMessage()}
					/>
				</div>
			</Show>
		</div>
	)
}

function RecordingBar() {
	const ctx = useChatContext()
	const [elapsed, setElapsed] = createSignal(0)
	let timerInterval: ReturnType<typeof setInterval> | undefined

	onMount(() => {
		const start = Date.now()
		timerInterval = setInterval(() => {
			setElapsed((Date.now() - start) / 1000)
		}, 500)
	})

	onCleanup(() => {
		if (timerInterval) clearInterval(timerInterval)
	})

	const bars = Array.from({length: 32}, () => ({height: 3}))

	return (
		<div class="chat-recording-bar">
			<div class="chat-recording-dot" />
			<span class="chat-recording-time">{formatDuration(elapsed())}</span>
			<div class="chat-recording-viz">
				{bars.map(() => (
					<div class="chat-recording-viz-bar" style="height:3px" />
				))}
			</div>
			<button class="chat-recording-cancel" on:click={() => ctx.cancelRec()}>
				Cancel
			</button>
			<button
				class="chat-recording-send"
				innerHTML={SVG_ICONS.send}
				on:click={() => ctx.stopAndSendRec()}
			/>
		</div>
	)
}
