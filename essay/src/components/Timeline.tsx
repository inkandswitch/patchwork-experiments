import {createSignal, createEffect, onMount, onCleanup, For} from "solid-js"
import * as A from "@automerge/automerge"
import type {DocHandle, DocHandleChangePayload} from "@automerge/automerge-repo"
import type {SpliceTextPatch, DelPatch} from "@automerge/automerge"
import type {MarkdownDoc} from "../datatype"
import "../timeline.css"

const MERGE_WINDOW_MS = 3_000
const GAP_THRESHOLD_MS = 5 * 60_000

type OpType = "insert" | "delete" | "edit"

type OpItem = {kind: "op"; id: string; type: OpType; timestamp: number; charDelta: number; snapshotContent: string}
type GapItem = {kind: "gap"; id: string; durationMs: number}
type Entry = OpItem | GapItem

const ICON: Record<OpType, string> = {insert: "✏️", delete: "❌", edit: "✏️"}

function classifyPatches(patches: A.Patch[]): {type: OpType; delta: number} | null {
	let inserted = 0, deleted = 0
	for (const p of patches) {
		if (p.path[0] !== "content") continue
		if (p.action === "splice") inserted += (p as SpliceTextPatch).value.length
		else if (p.action === "del") deleted += (p as DelPatch).length ?? 1
	}
	if (inserted === 0 && deleted === 0) return null
	return {
		type: inserted > 0 && deleted > 0 ? "edit" : inserted > 0 ? "insert" : "delete",
		delta: inserted - deleted,
	}
}

function buildHistoryEntries(doc: A.Doc<MarkdownDoc>): Entry[] {
	const history = A.getHistory(doc).slice(-200)
	const result: Entry[] = []
	let prevLen = 0, prevTime = 0, current: OpItem | null = null
	for (const state of history) {
		const content = String(state.snapshot.content ?? "")
		const currLen = content.length
		const timeMs = state.change.time * 1000
		const delta = currLen - prevLen
		if (Math.abs(delta) < 2) { prevLen = currLen; prevTime = timeMs; continue }
		const type: OpType = delta > 3 ? "insert" : delta < -3 ? "delete" : "edit"
		if (current && prevTime > 0 && timeMs - prevTime > GAP_THRESHOLD_MS) {
			result.push(current)
			result.push({kind: "gap", id: `gap-${timeMs}`, durationMs: timeMs - prevTime})
			current = null
		}
		if (current && type === current.type && timeMs - current.timestamp < MERGE_WINDOW_MS) {
			current.charDelta += Math.abs(delta)
			current.timestamp = timeMs
			current.snapshotContent = content
		} else {
			if (current) result.push(current)
			current = {kind: "op", id: `hist-${timeMs}-${Math.random()}`, type, timestamp: timeMs, charDelta: Math.abs(delta), snapshotContent: content}
		}
		prevLen = currLen; prevTime = timeMs
	}
	if (current) result.push(current)
	return result
}

function formatGap(ms: number): string {
	const mins = Math.round(ms / 60_000)
	if (mins < 60) return `${mins}m`
	const hrs = Math.round(ms / 3_600_000)
	if (hrs < 24) return `${hrs}h`
	return `${Math.round(ms / 86_400_000)}d`
}

function fmtCount(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}


export function Timeline(props: {handle: DocHandle<MarkdownDoc>; onTimeTravel: (content: string | null) => void}) {
	const [entries, setEntries] = createSignal<Entry[]>([])
	// pinIndex: null = at end (auto-advances). Number = fixed position.
	const [pinIndex, setPinIndex] = createSignal<number | null>(null)

	let scrollEl!: HTMLDivElement
	let pinEl!: HTMLDivElement
	let isDragging = false

	const effectivePinIndex = () => pinIndex() ?? entries().length

	function getSnapshotForIndex(idx: number): string | null {
		const ents = entries()
		for (let i = idx; i >= 0; i--) {
			if (ents[i]?.kind === "op") return (ents[i] as OpItem).snapshotContent
		}
		return null
	}

	createEffect(() => {
		const idx = pinIndex()
		if (idx === null) {
			props.onTimeTravel(null)
		} else {
			const content = getSnapshotForIndex(idx)
			if (content !== null) props.onTimeTravel(content)
		}
	})

	// ---------------------------------------------------------------------------
	// Pin positioning — update the pin's left CSS after any state change

	function repositionPin() {
		if (!scrollEl || !pinEl) return
		const chips = scrollEl.querySelectorAll<HTMLElement>("[data-ei]")
		const pi = effectivePinIndex()
		let x: number
		if (chips.length === 0) {
			x = 12
		} else if (pi >= chips.length) {
			const last = chips[chips.length - 1]
			x = last.offsetLeft + last.offsetWidth + 2
		} else {
			x = chips[pi].offsetLeft - 1
		}
		pinEl.style.left = `${x}px`
	}

	createEffect(() => {
		entries(); effectivePinIndex() // track both
		requestAnimationFrame(repositionPin)
	})

	// ---------------------------------------------------------------------------
	// Drag interaction

	function pinIndexFromClientX(clientX: number): number | null {
		const chips = scrollEl.querySelectorAll<HTMLElement>("[data-ei]")
		let idx = entries().length
		for (const chip of chips) {
			const rect = chip.getBoundingClientRect()
			if (clientX < rect.left + rect.width / 2) {
				idx = parseInt(chip.dataset.ei!)
				break
			}
		}
		return idx >= entries().length ? null : idx
	}

	function onGlobalMouseMove(e: MouseEvent) {
		if (!isDragging) return
		const newIdx = pinIndexFromClientX(e.clientX)
		setPinIndex(newIdx)
		// update pin visually without waiting for effect cycle
		repositionPin()
	}

	function stopDrag() {
		isDragging = false
		window.removeEventListener("mousemove", onGlobalMouseMove)
		window.removeEventListener("mouseup", stopDrag)
	}

	function onPinMouseDown(e: MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		isDragging = true
		window.addEventListener("mousemove", onGlobalMouseMove)
		window.addEventListener("mouseup", stopDrag)
	}

	function onTimelineClick(e: MouseEvent) {
		if ((e.target as HTMLElement).closest(".essay-timeline-pin")) return
		setPinIndex(pinIndexFromClientX(e.clientX))
	}

	// ---------------------------------------------------------------------------
	// Change tracking

	function scrollToEnd() {
		requestAnimationFrame(() => { if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth })
	}

	function pushOp(type: OpType, delta: number, content: string) {
		const now = Date.now()
		setEntries(prev => {
			const next = [...prev]
			const last = next[next.length - 1]
			const lastOp = last?.kind === "op" ? (last as OpItem) : null
			if (lastOp && now - lastOp.timestamp > GAP_THRESHOLD_MS) {
				next.push({kind: "gap", id: `gap-${now}`, durationMs: now - lastOp.timestamp})
			}
			if (lastOp && lastOp.type === type && now - lastOp.timestamp < MERGE_WINDOW_MS) {
				next[next.length - 1] = {...lastOp, charDelta: lastOp.charDelta + Math.abs(delta), timestamp: now, snapshotContent: content}
			} else {
				next.push({kind: "op", id: `op-${now}-${Math.random()}`, type, timestamp: now, charDelta: Math.abs(delta), snapshotContent: content})
			}
			return next
		})
		if (pinIndex() === null) scrollToEnd()
	}

	const changeHandler = (payload: DocHandleChangePayload<MarkdownDoc>) => {
		const r = classifyPatches(payload.patches)
		if (r) {
			const content = props.handle.doc()?.content?.toString() ?? ""
			pushOp(r.type, r.delta, content)
		}
	}

	onMount(() => {
		const doc = props.handle.doc()
		if (doc) {
			try { setEntries(buildHistoryEntries(doc)); scrollToEnd() } catch {}
		}
		props.handle.on("change", changeHandler)
	})

	onCleanup(() => {
		props.handle.off("change", changeHandler)
		window.removeEventListener("mousemove", onGlobalMouseMove)
		window.removeEventListener("mouseup", stopDrag)
	})

	// ---------------------------------------------------------------------------

	return (
		<div class="essay-timeline" onClick={onTimelineClick}>
			<div class="essay-timeline-scroll" ref={scrollEl}>
				<For each={entries()}>
					{(entry, i) => {
						const future = () => i() >= effectivePinIndex()
						if (entry.kind === "gap") {
							return (
								<div data-ei={i()} class="essay-timeline-gap" classList={{"future": future()}}>
									<span class="essay-timeline-gap-dots">···</span>
									<span class="essay-timeline-gap-label">{formatGap(entry.durationMs)}</span>
								</div>
							)
						}
						const op = entry as OpItem
						return (
							<div
								data-ei={i()}
								class={`essay-timeline-clip essay-timeline-clip-${op.type}`}
								classList={{"future": future()}}
							>
								<span class="essay-timeline-clip-icon">{ICON[op.type]}</span>
								<span class="essay-timeline-clip-count">{fmtCount(op.charDelta)}</span>
							</div>
						)
					}}
				</For>

				{/* Absolutely-positioned playhead pin */}
				<div class="essay-timeline-pin" ref={pinEl} onMouseDown={onPinMouseDown}>
					<div class="essay-timeline-pin-head" />
					<div class="essay-timeline-pin-line" />
				</div>
			</div>
		</div>
	)
}
