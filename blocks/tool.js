import {splice} from "@automerge/automerge"

/* ------------------------------------------------------------------ *
 * Parsing
 *
 * A markdown string is split into blocks separated by blank lines.
 * An "aside" block is a fenced region:
 *
 *   :::aside x=120 y=40
 *   {original block content, possibly multiple lines}
 *   :::
 *
 * We track exact character offsets for every block so operations can be
 * expressed as minimal splices on the content string.
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} Block
 * @property {"flow"|"aside"} kind
 * @property {number} start      offset of the block's first char
 * @property {number} end        offset one past the block's last char
 * @property {string} text       inner text (for aside: content inside the fence)
 * @property {number} [innerStart] aside only: offset where inner content starts
 * @property {number} [innerEnd]   aside only: offset where inner content ends
 * @property {number} [x]          aside only: canvas x
 * @property {number} [y]          aside only: canvas y
 */

/** @returns {Block[]} */
function parseBlocks(content) {
	const lines = content.split("\n")
	// offset of the start of each line
	const lineStart = []
	let acc = 0
	for (const line of lines) {
		lineStart.push(acc)
		acc += line.length + 1 // +1 for the "\n"
	}
	const endOf = i => lineStart[i] + lines[i].length

	const blocks = []
	let i = 0
	while (i < lines.length) {
		const line = lines[i]
		if (line.trim() === "") {
			i++
			continue
		}
		const asideOpen = line.match(/^:::aside\b(.*)$/)
		if (asideOpen) {
			const attrs = parseAttrs(asideOpen[1])
			// find the closing fence
			let k = i + 1
			while (k < lines.length && !/^:::\s*$/.test(lines[k])) k++
			const hasClose = k < lines.length
			const innerFirst = i + 1
			const innerLast = (hasClose ? k : lines.length) - 1
			const innerStart = lineStart[innerFirst] ?? endOf(i) + 1
			const innerEnd =
				innerLast >= innerFirst ? endOf(innerLast) : innerStart
			const end = hasClose ? endOf(k) : innerEnd
			blocks.push({
				kind: "aside",
				start: lineStart[i],
				end,
				innerStart,
				innerEnd,
				x: attrs.x,
				y: attrs.y,
				text: content.slice(innerStart, innerEnd),
			})
			i = hasClose ? k + 1 : k
			continue
		}
		// a normal flow block: consecutive non-blank, non-fence lines
		let j = i
		while (
			j < lines.length &&
			lines[j].trim() !== "" &&
			!/^:::aside\b/.test(lines[j])
		) {
			j++
		}
		const last = j - 1
		blocks.push({
			kind: "flow",
			start: lineStart[i],
			end: endOf(last),
			text: content.slice(lineStart[i], endOf(last)),
		})
		i = j
	}
	return blocks
}

function parseAttrs(s) {
	const x = /(?:^|\s)x=(-?\d+(?:\.\d+)?)/.exec(s)
	const y = /(?:^|\s)y=(-?\d+(?:\.\d+)?)/.exec(s)
	return {
		x: x ? Number(x[1]) : 24,
		y: y ? Number(y[1]) : 24,
	}
}

/* ------------------------------------------------------------------ *
 * Content mutations (all through Automerge splices on ["content"])
 * ------------------------------------------------------------------ */

// Set the whole content to `next` using a single minimal splice (common
// prefix / suffix diff). Used for reordering & inline edits — anything
// outside the changed span keeps its cursors.
function setContent(handle, next) {
	handle.change(doc => {
		const old = doc.content ?? ""
		if (old === next) return
		let start = 0
		const min = Math.min(old.length, next.length)
		while (start < min && old[start] === next[start]) start++
		let eo = old.length
		let en = next.length
		while (eo > start && en > start && old[eo - 1] === next[en - 1]) {
			eo--
			en--
		}
		splice(doc, ["content"], start, eo - start, next.slice(start, en))
	})
}

// Wrap a flow block in an :::aside fence IN PLACE. We insert only the fence
// markers around the existing text — the block's own characters are never
// deleted, so cursors/comments inside it survive.
function popToAside(handle, block, x, y) {
	const open = `:::aside x=${Math.round(x)} y=${Math.round(y)}\n`
	const close = `\n:::`
	handle.change(doc => {
		// splice the later offset first so the earlier offset stays valid
		splice(doc, ["content"], block.end, 0, close)
		splice(doc, ["content"], block.start, 0, open)
	})
}

// Remove the fence markers, returning the inner content to the flow. Only the
// wrapper characters are deleted; the inner text is untouched.
function returnFromAside(handle, block) {
	handle.change(doc => {
		// closing "\n:::" lives in [innerEnd, end)
		splice(doc, ["content"], block.innerEnd, block.end - block.innerEnd, "")
		// opening ":::aside ...\n" lives in [start, innerStart)
		splice(doc, ["content"], block.start, block.innerStart - block.start, "")
	})
}

// Reposition an aside on the canvas by rewriting only its opening fence line.
function moveAside(handle, block, x, y) {
	const openLineEnd = block.innerStart - 1 // the "\n" after the fence line
	const next = `:::aside x=${Math.round(x)} y=${Math.round(y)}`
	handle.change(doc => {
		splice(doc, ["content"], block.start, openLineEnd - block.start, next)
	})
}

// Move a flow block to a new position among the flow blocks. Rebuilds the
// content from the current block segments (normalising separators to blank
// lines) and applies it as a minimal splice.
function reorderFlow(handle, blocks, fromIndex, toIndex) {
	const flow = blocks.filter(b => b.kind === "flow")
	if (fromIndex === toIndex || fromIndex === toIndex - 1) return
	const moved = flow[fromIndex]
	// build the new ordered list of flow blocks
	const rest = flow.filter((_, i) => i !== fromIndex)
	const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
	rest.splice(insertAt, 0, moved)

	// reconstruct: reordered flow blocks fill the flow slots in order; aside
	// blocks stay pinned in their original textual positions.
	const segments = []
	let ri = 0
	for (const b of blocks) {
		if (b.kind === "flow") {
			segments.push(rest[ri].__raw)
			ri++
		} else {
			segments.push(b.__raw)
		}
	}
	setContent(handle, segments.join("\n\n") + "\n")
}

// Take an aside back into the flow at a given flow-block position: drop the
// fence + its content, and re-insert the inner text as a plain flow block.
function returnAsideToFlow(handle, blocks, asideStart, flowInsertIndex) {
	const aside = blocks.find(b => b.start === asideStart && b.kind === "aside")
	if (!aside) return
	const remaining = blocks.filter(b => b !== aside)
	// linear index of the flow block currently at flowInsertIndex
	const flowLinear = []
	remaining.forEach((b, i) => {
		if (b.kind === "flow") flowLinear.push(i)
	})
	const linearInsert =
		flowInsertIndex >= flowLinear.length
			? remaining.length
			: flowLinear[flowInsertIndex]
	const segs = remaining.map(b => b.__raw)
	segs.splice(linearInsert, 0, aside.text)
	setContent(handle, segs.join("\n\n") + "\n")
}

/* ------------------------------------------------------------------ *
 * Tiny markdown renderer (enough for a readable block preview)
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
	return s.replace(/[&<>"]/g, c =>
		c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
	)
}

function renderInline(s) {
	let h = escapeHtml(s)
	h = h.replace(/`([^`]+)`/g, "<code>$1</code>")
	h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
	h = h.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
	h = h.replace(/\b_([^_]+)_\b/g, "<em>$1</em>")
	h = h.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		'<a href="$2" target="_blank" rel="noreferrer">$1</a>'
	)
	return h
}

function renderMarkdown(text) {
	const lines = text.split("\n")
	let html = ""
	let listType = null
	const closeList = () => {
		if (listType) {
			html += `</${listType}>`
			listType = null
		}
	}
	for (const raw of lines) {
		const line = raw
		const heading = line.match(/^(#{1,6})\s+(.*)$/)
		const ul = line.match(/^\s*[-*+]\s+(.*)$/)
		const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
		const quote = line.match(/^>\s?(.*)$/)
		if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
			closeList()
			html += "<hr>"
		} else if (heading) {
			closeList()
			const level = heading[1].length
			html += `<h${level}>${renderInline(heading[2])}</h${level}>`
		} else if (ul) {
			if (listType !== "ul") {
				closeList()
				html += "<ul>"
				listType = "ul"
			}
			html += `<li>${renderInline(ul[1])}</li>`
		} else if (ol) {
			if (listType !== "ol") {
				closeList()
				html += "<ol>"
				listType = "ol"
			}
			html += `<li>${renderInline(ol[1])}</li>`
		} else if (quote) {
			closeList()
			html += `<blockquote>${renderInline(quote[1])}</blockquote>`
		} else if (line.trim() === "") {
			closeList()
		} else {
			closeList()
			html += `<p>${renderInline(line)}</p>`
		}
	}
	closeList()
	return html || "<p class='blocks-empty'>empty</p>"
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const CSS = `
@layer package {
	:root, :host, [theme] {
		--blocks-fill: var(--editor-fill, white);
		--blocks-line: var(--editor-line, black);
		--blocks-muted: var(--editor-line-offset-50, #888);
		--blocks-border: var(--editor-fill-offset-20, #ddd);
		--blocks-surface: var(--editor-fill-offset-10, #f6f6f6);
		--blocks-hover: color-mix(in oklch, var(--editor-fill), var(--editor-line) 6%);
		--blocks-accent: var(--studio-primary, #35f7ca);
		--blocks-accent-line: var(--studio-primary-line, black);
		--blocks-family: var(--editor-family-sans, system-ui, sans-serif);
		--blocks-code: var(--editor-family-code, ui-monospace, monospace);
	}
}

.blocks-tool {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(240px, 40%);
	height: 100%;
	background: var(--blocks-fill);
	color: var(--blocks-line);
	font-family: var(--blocks-family);
	overflow: hidden;
}

.blocks-tool .flow-pane {
	overflow-y: auto;
	padding: var(--studio-space-lg, 1.5rem);
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.blocks-tool .block {
	position: relative;
	border-radius: var(--studio-radius-sm, 4px);
	padding: var(--studio-space-xs, 0.375rem) var(--studio-space-sm, 0.5rem);
	padding-left: 1.75rem;
	cursor: grab;
	border: 1px solid transparent;
	transition: background var(--studio-transition-fast, 0.1s ease);
}
.blocks-tool .block:hover {
	background: var(--blocks-hover);
	border-color: var(--blocks-border);
}
.blocks-tool .block[data-dragging] { opacity: 0.35; }
.blocks-tool .block::before {
	content: "⠿";
	position: absolute;
	left: 0.5rem;
	top: 50%;
	transform: translateY(-50%);
	color: var(--blocks-muted);
	opacity: 0;
	font-size: 0.9rem;
	transition: opacity var(--studio-transition-fast, 0.1s ease);
}
.blocks-tool .block:hover::before { opacity: 1; }

.blocks-tool .block :is(h1,h2,h3,h4,h5,h6) { margin: 0.2em 0; line-height: 1.2; }
.blocks-tool .block p { margin: 0.2em 0; line-height: var(--editor-line-height, 1.5); }
.blocks-tool .block ul, .blocks-tool .block ol { margin: 0.2em 0; padding-left: 1.4em; }
.blocks-tool .block blockquote {
	margin: 0.2em 0;
	padding-left: 0.75em;
	border-left: 3px solid var(--blocks-border);
	color: var(--blocks-muted);
}
.blocks-tool .block code {
	font-family: var(--blocks-code);
	background: var(--blocks-surface);
	padding: 0.05em 0.3em;
	border-radius: 3px;
}
.blocks-tool .block a { color: var(--studio-link, var(--blocks-accent)); }
.blocks-tool .block .blocks-empty { color: var(--blocks-muted); font-style: italic; }

.blocks-tool .block-edit {
	width: 100%;
	box-sizing: border-box;
	font-family: var(--blocks-code);
	font-size: 0.9rem;
	line-height: 1.5;
	color: var(--blocks-line);
	background: var(--blocks-surface);
	border: 1px solid var(--blocks-accent);
	border-radius: var(--studio-radius-sm, 4px);
	padding: 0.4rem 0.5rem;
	resize: none;
	white-space: pre-wrap;
	word-break: break-word;
	overflow-wrap: anywhere;
}

/* insertion indicator drawn on the block above/below the drop point */
.blocks-tool .block[data-drop-before] { box-shadow: 0 -3px 0 -1px var(--blocks-accent); }
.blocks-tool .block[data-drop-after] { box-shadow: 0 3px 0 -1px var(--blocks-accent); }

.blocks-tool .flow-pane[data-return-active] {
	background: color-mix(in oklch, var(--blocks-accent), transparent 92%);
}

/* Canvas */
.blocks-tool .canvas {
	position: relative;
	border-left: 1px solid var(--blocks-border);
	background:
		radial-gradient(circle, var(--blocks-border) 1px, transparent 1px)
		0 0 / 20px 20px;
	background-color: var(--blocks-surface);
	overflow: hidden;
}
.blocks-tool .canvas[data-drop-active]::after {
	content: "drop to set aside";
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	color: var(--blocks-accent-line);
	background: color-mix(in oklch, var(--blocks-accent), transparent 70%);
	font-weight: 600;
	pointer-events: none;
}
.blocks-tool .canvas-hint {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	text-align: center;
	color: var(--blocks-muted);
	padding: 2rem;
	pointer-events: none;
	font-size: 0.85rem;
}

.blocks-tool .aside-card {
	position: absolute;
	max-width: 220px;
	min-width: 120px;
	background: var(--blocks-fill);
	border: 1px solid var(--blocks-border);
	border-radius: var(--studio-radius-md, 8px);
	box-shadow: var(--studio-shadow-md, 0 2px 8px rgba(0,0,0,0.15));
	padding: 0.5rem 0.6rem;
	font-size: 0.85rem;
	cursor: grab;
	touch-action: none;
}
.blocks-tool .aside-card[data-dragging] { cursor: grabbing; box-shadow: var(--studio-shadow-lg, 0 8px 24px rgba(0,0,0,0.25)); }
.blocks-tool .aside-card :is(h1,h2,h3,h4,h5,h6) { font-size: 1em; margin: 0.15em 0; }
.blocks-tool .aside-card p { margin: 0.15em 0; }
.blocks-tool .aside-card .aside-return {
	position: absolute;
	top: -0.6rem;
	right: -0.6rem;
	width: 1.4rem;
	height: 1.4rem;
	border-radius: 50%;
	border: 1px solid var(--blocks-border);
	background: var(--blocks-accent);
	color: var(--blocks-accent-line);
	font-size: 0.8rem;
	line-height: 1;
	cursor: pointer;
	display: none;
	place-items: center;
	padding: 0;
}
.blocks-tool .aside-card:hover .aside-return { display: grid; }
`

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

export default function BlocksTool(handle, element) {
	const style = document.createElement("style")
	style.textContent = CSS
	const root = document.createElement("div")
	root.className = "blocks-tool"

	const flowPane = document.createElement("div")
	flowPane.className = "flow-pane"
	const canvas = document.createElement("div")
	canvas.className = "canvas"
	root.append(flowPane, canvas)
	element.append(style, root)

	// UI state that must survive re-renders
	let editingKey = null // start-offset of the block currently being edited
	let suspendRender = false // true while a textarea is focused

	function getBlocks() {
		const content = handle.doc()?.content ?? ""
		const blocks = parseBlocks(String(content))
		for (const b of blocks) b.__raw = String(content).slice(b.start, b.end)
		return blocks
	}

	/* ---------- flow pane ---------- */

	// drag transfer state (kept outside dataTransfer so canvas can read it live)
	let dragKind = null
	let dragFlowIndex = null
	let dragBlockStart = null

	// live list of rendered flow-block elements, used for drop hit-testing
	let blockEls = []
	let flowDropIndex = null

	// Which gap does clientY fall into? Top half of a block → before it, bottom
	// half → after it; above the first / below the last → the ends.
	function flowInsertIndexAt(clientY) {
		for (let i = 0; i < blockEls.length; i++) {
			const r = blockEls[i].getBoundingClientRect()
			if (clientY < r.top + r.height / 2) return i
		}
		return blockEls.length
	}

	function setFlowDropIndicator(idx) {
		flowDropIndex = idx
		for (const el of blockEls) {
			el.removeAttribute("data-drop-before")
			el.removeAttribute("data-drop-after")
		}
		if (idx == null) return
		if (idx < blockEls.length) blockEls[idx].setAttribute("data-drop-before", "")
		else if (blockEls.length)
			blockEls[blockEls.length - 1].setAttribute("data-drop-after", "")
	}

	// reorder-by-drag: the whole pane is the drop target (easy to hit)
	flowPane.addEventListener("dragover", e => {
		if (dragKind !== "flow") return
		e.preventDefault()
		e.dataTransfer.dropEffect = "move"
		setFlowDropIndicator(flowInsertIndexAt(e.clientY))
	})
	flowPane.addEventListener("dragleave", e => {
		if (!flowPane.contains(e.relatedTarget)) setFlowDropIndicator(null)
	})
	flowPane.addEventListener("drop", e => {
		if (dragKind !== "flow") return
		e.preventDefault()
		const idx = flowDropIndex ?? flowInsertIndexAt(e.clientY)
		setFlowDropIndicator(null)
		if (dragFlowIndex != null) {
			reorderFlow(handle, getBlocks(), dragFlowIndex, idx)
		}
	})

	function renderFlow() {
		flowPane.replaceChildren()
		blockEls = []
		const blocks = getBlocks()
		const flow = blocks.filter(b => b.kind === "flow")

		flow.forEach((block, flowIndex) => {
			const el = document.createElement("div")
			el.className = "block"
			el.draggable = true
			blockEls.push(el)

			if (editingKey === block.start) {
				const ta = document.createElement("textarea")
				ta.className = "block-edit"
				ta.value = block.__raw
				el.draggable = false
				el.style.cursor = "text"
				const autosize = () => {
					ta.style.height = "auto"
					ta.style.height = ta.scrollHeight + "px"
				}
				ta.addEventListener("input", () => {
					autosize()
					commitEdit(block.start, ta.value)
				})
				ta.addEventListener("blur", () => {
					suspendRender = false
					editingKey = null
					render()
				})
				ta.addEventListener("keydown", e => {
					if (e.key === "Escape") ta.blur()
				})
				el.append(ta)
				flowPane.append(el)
				queueMicrotask(() => {
					autosize()
					ta.focus()
					suspendRender = true
				})
			} else {
				el.innerHTML = renderMarkdown(block.__raw)
				el.addEventListener("dblclick", () => {
					editingKey = block.start
					render()
				})
				el.addEventListener("dragstart", e => {
					dragKind = "flow"
					dragFlowIndex = flowIndex
					dragBlockStart = block.start
					el.setAttribute("data-dragging", "")
					e.dataTransfer.effectAllowed = "move"
					e.dataTransfer.setData("text/plain", block.__raw)
				})
				el.addEventListener("dragend", () => {
					el.removeAttribute("data-dragging")
					dragKind = null
					dragFlowIndex = null
					dragBlockStart = null
					canvas.removeAttribute("data-drop-active")
					setFlowDropIndicator(null)
				})
			}

			flowPane.append(el)
		})
	}

	// A local edit within one block: recompute the whole content string with
	// that block replaced, then splice minimally.
	function commitEdit(blockStart, newRaw) {
		const content = String(handle.doc()?.content ?? "")
		const blocks = parseBlocks(content)
		const b = blocks.find(bl => bl.start === blockStart)
		if (!b) return
		const next = content.slice(0, b.start) + newRaw + content.slice(b.end)
		setContent(handle, next)
	}

	/* ---------- canvas ---------- */

	canvas.addEventListener("dragover", e => {
		if (dragKind !== "flow") return
		e.preventDefault()
		e.dataTransfer.dropEffect = "move"
		canvas.setAttribute("data-drop-active", "")
	})
	canvas.addEventListener("dragleave", e => {
		if (e.target === canvas) canvas.removeAttribute("data-drop-active")
	})
	canvas.addEventListener("drop", e => {
		e.preventDefault()
		canvas.removeAttribute("data-drop-active")
		if (dragKind !== "flow" || dragBlockStart == null) return
		const rect = canvas.getBoundingClientRect()
		const x = e.clientX - rect.left - 60
		const y = e.clientY - rect.top - 16
		const blocks = getBlocks()
		const block = blocks.find(b => b.start === dragBlockStart)
		if (block) popToAside(handle, block, Math.max(4, x), Math.max(4, y))
	})

	function renderCanvas() {
		canvas.replaceChildren()
		const blocks = getBlocks()
		const asides = blocks.filter(b => b.kind === "aside")

		if (asides.length === 0) {
			const hint = document.createElement("div")
			hint.className = "canvas-hint"
			hint.textContent =
				"Drag a block here to set it aside. It stays in the document (hidden) so cursors keep working."
			canvas.append(hint)
		}

		asides.forEach(block => {
			const card = document.createElement("div")
			card.className = "aside-card"
			card.style.left = block.x + "px"
			card.style.top = block.y + "px"
			card.innerHTML = renderMarkdown(block.text)

			const back = document.createElement("button")
			back.className = "aside-return"
			back.title = "return to document"
			back.textContent = "↩"
			back.addEventListener("click", e => {
				e.stopPropagation()
				const fresh = getBlocks().find(b => b.start === block.start)
				if (fresh) returnFromAside(handle, fresh)
			})
			card.append(back)

			// pointer-drag to reposition; commit on release
			card.addEventListener("pointerdown", e => {
				if (e.target === back) return
				e.preventDefault()
				card.setPointerCapture(e.pointerId)
				card.setAttribute("data-dragging", "")
				const rect = canvas.getBoundingClientRect()
				const offsetX = e.clientX - (rect.left + block.x)
				const offsetY = e.clientY - (rect.top + block.y)
				let nx = block.x
				let ny = block.y
				let returning = false

				const overFlow = (x, y) => {
					const fr = flowPane.getBoundingClientRect()
					return x >= fr.left && x <= fr.right && y >= fr.top && y <= fr.bottom
				}

				const move = ev => {
					if (overFlow(ev.clientX, ev.clientY)) {
						// hovering the document: preview a return-to-flow drop
						returning = true
						card.style.opacity = "0.4"
						flowPane.setAttribute("data-return-active", "")
						setFlowDropIndicator(flowInsertIndexAt(ev.clientY))
					} else {
						returning = false
						card.style.opacity = ""
						flowPane.removeAttribute("data-return-active")
						setFlowDropIndicator(null)
						nx = Math.max(4, ev.clientX - rect.left - offsetX)
						ny = Math.max(4, ev.clientY - rect.top - offsetY)
						card.style.left = nx + "px"
						card.style.top = ny + "px"
					}
				}
				const up = ev => {
					card.releasePointerCapture(e.pointerId)
					card.removeAttribute("data-dragging")
					card.style.opacity = ""
					card.removeEventListener("pointermove", move)
					card.removeEventListener("pointerup", up)
					flowPane.removeAttribute("data-return-active")
					if (returning) {
						const idx = flowInsertIndexAt(ev.clientY)
						setFlowDropIndicator(null)
						returnAsideToFlow(handle, getBlocks(), block.start, idx)
					} else {
						const fresh = getBlocks().find(b => b.start === block.start)
						if (fresh) moveAside(handle, fresh, nx, ny)
					}
				}
				card.addEventListener("pointermove", move)
				card.addEventListener("pointerup", up)
			})

			canvas.append(card)
		})
	}

	function render() {
		renderFlow()
		renderCanvas()
	}

	const onChange = () => {
		if (suspendRender) return // don't blow away a focused textarea
		render()
	}

	render()
	handle.on("change", onChange)

	return () => {
		handle.off("change", onChange)
		root.remove()
		style.remove()
	}
}
