import {createSignal, createEffect, createMemo, For, Show, onMount, onCleanup} from "solid-js"
import {useChat} from "../context/ChatContext"
import {SVG_ICONS} from "../lib/svg-icons"
import {getActiveDraftUrl, buildPreviewSrc, buildPreviewSrcdoc, reloadPreviewIframe} from "../lib/preview-frame"

function hasPatchworkDrop(dt: DataTransfer | null): boolean {
	return !!dt?.types?.includes("text/x-patchwork-dnd") ||
		!!dt?.types?.includes("text/x-patchwork-urls")
}

function parsePatchworkDrop(dt: DataTransfer): {url: string; toolId?: string; name?: string}[] | null {
	const dndData = dt.getData("text/x-patchwork-dnd")
	if (dndData) {
		try {
			const parsed = JSON.parse(dndData)
			if (parsed.items?.length) return parsed.items.map((it: any) => ({url: it.url, toolId: it.toolId, name: it.name}))
		} catch {}
	}
	const urlsData = dt.getData("text/x-patchwork-urls")
	if (urlsData) {
		try {
			const urls = JSON.parse(urlsData)
			return urls.map((u: string) => ({url: u}))
		} catch {}
	}
	return null
}

/** Extract documentId from automerge URL */
function docIdFromUrl(url: string): string {
	return url.replace(/^automerge:/, "")
}

export function Sidebar(props: {
	visible?: boolean
	onVisibilityChange?: (visible: boolean) => void
}) {
	let sidebarRef!: HTMLDivElement
	let resizeRef!: HTMLDivElement
	let pinnedRef!: HTMLDivElement
	const {handle, doc, element} = useChat()
	const [collapsed, setCollapsed] = createSignal(false)
	const [dropTarget, setDropTarget] = createSignal(false)
	const [pinVersion, setPinVersion] = createSignal(0)

	// Pinned docs — track by URL with stable references for <For>
	const pinnedDocCache = new Map<string, {url: string; name: string; type: string; pin: any}>()
	const pinnedDocs = createMemo(() => {
		pinVersion() // track local changes too
		const d = doc()
		if (!d?.docs) return []
		const pinned = (d.docs as any[]).filter((dl: any) => !!dl.pin)
		const urls = new Set(pinned.map((dl: any) => dl.url))
		// Remove stale entries
		for (const key of pinnedDocCache.keys()) {
			if (!urls.has(key)) pinnedDocCache.delete(key)
		}
		// Add/update entries with stable references
		return pinned.map((dl: any) => {
			const existing = pinnedDocCache.get(dl.url)
			if (existing && existing.pin === dl.pin && existing.name === dl.name && existing.type === dl.type) {
				return existing
			}
			const entry = {url: dl.url, name: dl.name, type: dl.type, pin: dl.pin}
			pinnedDocCache.set(dl.url, entry)
			return entry
		})
	})

	function unpinDoc(url: string) {
		handle.change((d: any) => {
			if (!d.docs) return
			const idx = d.docs.findIndex((dl: any) => dl.url === url)
			if (idx >= 0) {
				d.docs[idx].pin = false
			}
		})
		setPinVersion(v => v + 1)
	}

	function changeToolId(url: string, newToolId: string) {
		handle.change((d: any) => {
			if (!d.docs) return
			const existing = d.docs.find((dl: any) => dl.url === url)
			if (existing) existing.pin = newToolId || true
		})
	}

	function openInTab(dl: any) {
		const params = new URLSearchParams()
		params.set("doc", docIdFromUrl(dl.url))
		if (dl.name) params.set("title", dl.name)
		if (dl.type) params.set("type", dl.type)
		// Open as tool, not frame
		if (typeof dl.pin === "string" && dl.pin) params.set("tool", dl.pin)
		window.open("/#" + params.toString(), "_blank")
	}

	function openAsFrame(dl: any) {
		window.open(buildPreviewSrc(dl), "_blank")
	}

	// Resize handle for sidebar width
	onMount(() => {
		if (!resizeRef) return
		let resizing = false

		const onPointerDown = (e: PointerEvent) => {
			e.preventDefault()
			resizing = true
			resizeRef.setPointerCapture(e.pointerId)
			resizeRef.classList.add("dragging")
		}
		const onPointerMove = (e: PointerEvent) => {
			if (!resizing || !sidebarRef) return
			const root = sidebarRef.closest(".chat-root") as HTMLElement
			if (!root) return
			const rootRect = root.getBoundingClientRect()
			const isLeft = root.classList.contains("sidebar-left")
			const newWidth = isLeft
				? e.clientX - rootRect.left
				: rootRect.right - e.clientX
			const pct = Math.max(15, Math.min((newWidth / rootRect.width) * 100, 60))
			sidebarRef.style.width = pct + "%"
		}
		const onPointerUp = () => {
			resizing = false
			resizeRef.classList.remove("dragging")
		}

		resizeRef.addEventListener("pointerdown", onPointerDown)
		document.addEventListener("pointermove", onPointerMove)
		document.addEventListener("pointerup", onPointerUp)

		onCleanup(() => {
			resizeRef.removeEventListener("pointerdown", onPointerDown)
			document.removeEventListener("pointermove", onPointerMove)
			document.removeEventListener("pointerup", onPointerUp)
		})
	})

	function swapSide() {
		const root = sidebarRef?.closest(".chat-root") as HTMLElement
		if (!root) return
		const isLeft = root.classList.contains("sidebar-left")
		if (isLeft) {
			root.classList.remove("sidebar-left")
			localStorage.removeItem("chat-sidebar-side")
		} else {
			root.classList.add("sidebar-left")
			localStorage.setItem("chat-sidebar-side", "left")
		}
	}

	// Drop handling
	function handleDragOver(e: DragEvent) {
		if (hasPatchworkDrop(e.dataTransfer)) {
			e.preventDefault()
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
			setDropTarget(true)
		}
	}
	function handleDragLeave(e: DragEvent) {
		if (e.relatedTarget && sidebarRef.contains(e.relatedTarget as Node)) return
		setDropTarget(false)
	}
	function handleDrop(e: DragEvent) {
		e.preventDefault()
		setDropTarget(false)
		if (!e.dataTransfer) return
		const items = parsePatchworkDrop(e.dataTransfer)
		if (!items) return
		for (const item of items) {
			handle.change((d: any) => {
				if (!d.docs) d.docs = []
				const existing = d.docs.find((dl: any) => dl.url === item.url)
				if (existing) {
					existing.pin = item.toolId || true
				} else {
					d.docs.push({url: item.url, type: "unknown", name: item.name || "doc", pin: item.toolId || true})
				}
			})
		}
		props.onVisibilityChange?.(true)
	}

	// Auto-show the sidebar when a doc is newly pinned (count increases). We only
	// react to the pin count — NOT to `props.visible` — so a manual close sticks
	// instead of being immediately reopened by this effect.
	let prevPinnedCount = 0
	createEffect(() => {
		const count = pinnedDocs().length
		if (count > prevPinnedCount) props.onVisibilityChange?.(true)
		prevPinnedCount = count
	})

	return (
		<div
			ref={sidebarRef}
			class="chat-sidebar"
			classList={{
				visible: props.visible,
				collapsed: collapsed(),
				"drop-target": dropTarget(),
			}}
			on:dragover={handleDragOver}
			on:dragleave={handleDragLeave}
			on:drop={handleDrop}
		>
			<div ref={resizeRef} class="chat-sidebar-resize" />
			<div class="chat-sidebar-header">
				<span class="chat-sidebar-header-title">Sidebar</span>
				<div style="display:flex;gap:2px;align-items:center">
					<button
						class="chat-sidebar-collapse-btn"
						title="Swap side"
						innerHTML={SVG_ICONS.swap}
						on:click={swapSide}
					/>
					<button
						class="chat-sidebar-collapse-btn"
						title="Close sidebar"
						innerHTML={SVG_ICONS.sidebar}
						on:click={() => {
							setCollapsed(true)
							props.onVisibilityChange?.(false)
						}}
					/>
				</div>
			</div>
			<div ref={pinnedRef} class="chat-sidebar-pinned">
				<For each={pinnedDocs()}>
					{(dl: any, i) => (
						<PinnedDocWrap
							dl={dl}
							draftUrl={getActiveDraftUrl(element)}
							onUnpin={() => unpinDoc(dl.url)}
							onOpenInTab={() => openInTab(dl)}
							onOpenAsFrame={() => openAsFrame(dl)}
							onChangeToolId={(id: string) => changeToolId(dl.url, id)}
						/>
					)}
				</For>
			</div>
			<div class="chat-sidebar-status" />
		</div>
	)
}

function PinnedDocWrap(props: {
	dl: any
	draftUrl: string
	onUnpin: () => void
	onOpenInTab: () => void
	onOpenAsFrame: () => void
	onChangeToolId: (id: string) => void
}) {
	let wrapRef!: HTMLDivElement
	let iframeRef: HTMLIFrameElement | null = null
	const [editingToolId, setEditingToolId] = createSignal(false)
	const pinAsToolId = () => typeof props.dl.pin === "string" ? props.dl.pin : ""
	const [toolIdValue, setToolIdValue] = createSignal(pinAsToolId())

	// Keep toolIdValue in sync when prop changes (e.g. from external edit)
	createEffect(() => {
		if (!editingToolId()) setToolIdValue(pinAsToolId())
	})
	const [infoCollapsed, setInfoCollapsed] = createSignal(true)

	onMount(() => {
		if (!wrapRef) return
		const iframe = document.createElement("iframe")
		iframe.title = props.dl.name || "Pinned doc"
		iframe.style.cssText = "width:100%;flex:1;border:none;border-radius:4px;min-height:200px;background:var(--bg-mid)"
		if (props.draftUrl) {
			// On a draft: boot the preview with the draft overlay so it shows the
			// drafted tool source. Falls back to the plain src on failure.
			buildPreviewSrcdoc(props.dl, props.draftUrl)
				.then((srcdoc) => {
					iframe.srcdoc = srcdoc
				})
				.catch((e) => {
					console.warn("[Chat] draft preview failed, using Main:", e)
					iframe.src = buildPreviewSrc(props.dl)
				})
		} else {
			iframe.src = buildPreviewSrc(props.dl)
		}
		wrapRef.appendChild(iframe)
		iframeRef = iframe

		// Handle patchwork:no-tool so dynamically created tools get loaded
		iframe.addEventListener("load", () => {
			try {
				const win = iframe.contentWindow
				if (!win) return
				win.addEventListener("patchwork:no-tool", ((event: any) => {
					if (win.patchwork?.modules?.loadSuggestedImportUrl) {
						win.patchwork.modules.loadSuggestedImportUrl(event.detail?.url)
					}
				}) as EventListener)
			} catch {}
		})
	})

	function refreshIframe() {
		if (iframeRef) reloadPreviewIframe(iframeRef)
	}

	function goFullscreen() {
		if (!iframeRef) return
		if (iframeRef.requestFullscreen) iframeRef.requestFullscreen()
		else if ((iframeRef as any).webkitRequestFullscreen) (iframeRef as any).webkitRequestFullscreen()
	}

	function saveToolId() {
		props.onChangeToolId(toolIdValue())
		setEditingToolId(false)
	}

	const truncatedUrl = () => {
		const url = props.dl.url || ""
		if (url.length <= 30) return url
		return url.slice(0, 15) + "..." + url.slice(-10)
	}

	return (
		<div class="chat-sidebar-pinned-wrap">
			{/* Toolbar */}
			<div class="chat-sidebar-pinned-toolbar" on:pointerdown={(e) => e.stopPropagation()}>
				<button title="Open in tab" innerHTML={SVG_ICONS.externalLink} on:click={props.onOpenInTab} />
				<button title="Open as frame" innerHTML={SVG_ICONS.monitor} on:click={props.onOpenAsFrame} />
				<button title="Fullscreen" innerHTML={SVG_ICONS.fullscreen} on:click={goFullscreen} />
				<button title="Refresh" innerHTML={SVG_ICONS.refresh} on:click={refreshIframe} />
				<button title="Unpin" innerHTML={SVG_ICONS.close} on:click={props.onUnpin} />
			</div>

			{/* Info bar */}
			<div class="chat-sidebar-pinned-info">
				<div class="chat-sidebar-pinned-info-main" on:click={() => setInfoCollapsed(!infoCollapsed())}>
					<span class="chat-sidebar-pinned-info-title">{props.dl.name || "doc"}</span>
					<span class="chat-sidebar-pinned-info-chevron" classList={{open: !infoCollapsed()}}>&#9656;</span>
				</div>
				<Show when={!infoCollapsed()}>
					<div class="chat-sidebar-pinned-info-details">
						<div class="chat-sidebar-pinned-info-row">
							<span class="chat-sidebar-pinned-info-label">url</span>
							<span
								class="chat-sidebar-pinned-info-value chat-sidebar-pinned-info-url"
								title={props.dl.url}
								on:click={() => navigator.clipboard?.writeText(props.dl.url)}
							>
								{truncatedUrl()}
							</span>
						</div>
						<div class="chat-sidebar-pinned-info-row">
							<span class="chat-sidebar-pinned-info-label">tool</span>
							<Show when={editingToolId()} fallback={
								<span
									class="chat-sidebar-pinned-info-value chat-sidebar-pinned-info-editable"
									on:click={() => setEditingToolId(true)}
								>
									{typeof props.dl.pin === "string" ? props.dl.pin : "(auto)"}
								</span>
							}>
								<input
									class="chat-sidebar-pinned-info-input"
									value={toolIdValue()}
									on:input={(e) => setToolIdValue(e.currentTarget.value)}
									on:keydown={(e) => {
										if (e.key === "Enter") saveToolId()
										if (e.key === "Escape") setEditingToolId(false)
									}}
									on:blur={saveToolId}
									ref={(el) => setTimeout(() => el.focus(), 0)}
								/>
							</Show>
						</div>
					</div>
				</Show>
			</div>

			{/* Iframe container */}
			<div ref={wrapRef} style="flex:1;min-height:0;display:flex;flex-direction:column" />

			{/* Resize handle between pinned items */}
			<PinnedResizeHandle wrapRef={() => wrapRef?.parentElement} />
		</div>
	)
}

function PinnedResizeHandle(props: {wrapRef: () => HTMLElement | null | undefined}) {
	let handleRef!: HTMLDivElement

	onMount(() => {
		if (!handleRef) return
		let resizing = false
		let startY = 0
		let startHeight = 0

		const onPointerDown = (e: PointerEvent) => {
			e.preventDefault()
			e.stopPropagation()
			const wrap = props.wrapRef()
			if (!wrap) return
			resizing = true
			startY = e.clientY
			startHeight = wrap.getBoundingClientRect().height
			handleRef.setPointerCapture(e.pointerId)
			handleRef.classList.add("active")
		}
		const onPointerMove = (e: PointerEvent) => {
			if (!resizing) return
			const wrap = props.wrapRef()
			if (!wrap) return
			const dy = e.clientY - startY
			const newHeight = Math.max(100, startHeight + dy)
			wrap.style.minHeight = newHeight + "px"
			wrap.style.flex = "0 0 " + newHeight + "px"
		}
		const onPointerUp = () => {
			resizing = false
			handleRef.classList.remove("active")
		}

		handleRef.addEventListener("pointerdown", onPointerDown)
		document.addEventListener("pointermove", onPointerMove)
		document.addEventListener("pointerup", onPointerUp)

		onCleanup(() => {
			handleRef.removeEventListener("pointerdown", onPointerDown)
			document.removeEventListener("pointermove", onPointerMove)
			document.removeEventListener("pointerup", onPointerUp)
		})
	})

	return <div ref={handleRef} class="chat-sidebar-pinned-resize-handle" />
}
