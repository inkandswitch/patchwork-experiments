/**
 * PD Editor — Visual Pure Data patch editor for Patchwork.
 *
 * Canvas-based editor with node creation, wiring, editing,
 * and interactive GUI objects (bang, toggle, slider, number, radio, vu, canvas).
 */

import { parsePd, serializePd, getObjectIO, parseGuiParams, DEFAULT_PATCH } from "./pd-parser.js"
import { createRuntime, pdDebug } from "./pd-runtime.js"

const DPI = window.devicePixelRatio || 1
const GRID = 20
const NODE_MIN_WIDTH = 50
const NODE_HEIGHT = 24
const PORT_SIZE = 8
const PORT_SPACING = 2
const FONT_SIZE = 12
const WIRE_CURVE = 20

const GUI_TYPES = new Set(["bng", "tgl", "vsl", "hsl", "nbx", "vradio", "hradio", "vu", "cnv", "keyboard"])

function snap(v) {
	return Math.round(v / GRID) * GRID
}

const STYLES = `
	.pd-root {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #f8f5ec;
		font-family: "Menlo", "Consolas", "DejaVu Sans Mono", monospace;
		font-size: 12px;
		color: #222;
		user-select: none;
		-webkit-user-select: none;
		overflow: hidden;
	}

	.pd-toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px 6px;
		background: #2a2618;
		border-bottom: 1px solid #1a1608;
		flex-shrink: 0;
	}
	.pd-toolbar button {
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		padding: 4px 6px;
		cursor: pointer;
		color: #c8b878;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 28px;
	}
	.pd-toolbar button:hover:not(:disabled) {
		background: rgba(255,255,255,0.08);
		border-color: rgba(255,255,255,0.06);
	}
	.pd-toolbar button:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.pd-toolbar button.active {
		background: rgba(100,200,150,0.25);
		color: #8fd8a8;
		border-color: rgba(100,200,150,0.3);
	}
	.pd-toolbar button svg {
		width: 16px;
		height: 16px;
		fill: currentColor;
		stroke: currentColor;
	}
	.pd-toolbar .pd-sep {
		width: 1px;
		height: 18px;
		background: rgba(255,255,255,0.1);
		margin: 0 4px;
	}
	.pd-toolbar .pd-spacer {
		flex: 1;
	}
	.pd-toolbar .pd-status {
		font-size: 10px;
		color: #8a7e58;
	}

	.pd-canvas-wrap {
		flex: 1;
		position: relative;
		overflow: hidden;
	}
	.pd-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		cursor: crosshair;
	}
	.pd-canvas.locked {
		cursor: pointer;
	}

	.pd-edit-input {
		position: absolute;
		background: #fff;
		border: 1px solid #08f;
		padding: 2px 4px;
		font-family: inherit;
		font-size: 12px;
		outline: none;
		z-index: 10;
		min-width: 60px;
	}
`

export default function PdEditorTool(handle, element) {
	const style = document.createElement("style")
	style.textContent = STYLES
	element.appendChild(style)

	const root = document.createElement("div")
	root.className = "pd-root"
	element.appendChild(root)

	// State
	let model = { canvas: { x: 0, y: 0, width: 600, height: 400, name: "(subpatch)", fontSize: 12 }, nodes: [], connections: [] }
	let selectedNodes = new Set()
	let selectedWire = -1
	let dragging = null // { nodeId, offsetX, offsetY }
	let wiring = null // { sourceNode, sourceOutlet, x, y }
	let marquee = null // { startX, startY, x, y } — rubber band selection
	let editingNode = -1
	let patchHandle = null
	let locked = false // false = edit mode, true = run/lock mode

	// Undo/redo stacks (serialized PD content strings)
	const undoStack = []
	const redoStack = []
	const MAX_UNDO = 100

	let skipUndoPush = false

	function pushUndo() {
		if (skipUndoPush) return
		const snapshot = serializePd(model)
		if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snapshot) return
		undoStack.push(snapshot)
		if (undoStack.length > MAX_UNDO) undoStack.shift()
		redoStack.length = 0
	}

	function undo() {
		if (undoStack.length === 0) return
		redoStack.push(serializePd(model))
		model = parsePd(undoStack.pop())
		selectedNodes.clear()
		selectedWire = -1
		skipUndoPush = true
		saveModel()
		skipUndoPush = false
		draw()
	}

	function redo() {
		if (redoStack.length === 0) return
		undoStack.push(serializePd(model))
		model = parsePd(redoStack.pop())
		selectedNodes.clear()
		selectedWire = -1
		skipUndoPush = true
		saveModel()
		skipUndoPush = false
		draw()
	}

	// GUI state: nodeIndex → { value, active }
	const guiState = new Map()
	const guiBindings = []
	let arrayPollInterval = null

	const runtime = createRuntime()

	// Toolbar
	const toolbar = document.createElement("div")
	toolbar.className = "pd-toolbar"
	root.appendChild(toolbar)

	function iconBtn(svgContent, title) {
		const btn = document.createElement("button")
		btn.innerHTML = svgContent
		btn.title = title
		toolbar.appendChild(btn)
		return btn
	}
	function sep() {
		const s = document.createElement("span")
		s.className = "pd-sep"
		toolbar.appendChild(s)
	}

	// Play: filled triangle
	const playBtn = iconBtn(`<svg viewBox="0 0 16 16"><polygon points="3,1 14,8 3,15" fill="currentColor" stroke="none"/></svg>`, "Play")
	// Stop: filled square
	const stopBtn = iconBtn(`<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" stroke="none"/></svg>`, "Stop")
	// Lock/Edit: pencil (edit mode) — toggled to lock icon
	const lockBtn = iconBtn(`<svg viewBox="0 0 16 16"><path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`, "Toggle edit/run mode (Cmd+E)")

	sep()

	// Mic: microphone
	const micBtn = iconBtn(`<svg viewBox="0 0 16 16"><rect x="5.5" y="1" width="5" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 7.5a4.5 4.5 0 009 0" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="12" x2="8" y2="15" stroke="currentColor" stroke-width="1.3"/></svg>`, "Toggle microphone input (adc~)")
	// MIDI: piano keys
	const midiBtn = iconBtn(`<svg viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="2" x2="5" y2="14" stroke="currentColor" stroke-width="0.8"/><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="0.8"/><line x1="11" y1="2" x2="11" y2="14" stroke="currentColor" stroke-width="0.8"/><rect x="3.5" y="2" width="2" height="7" rx="0.5" fill="currentColor"/><rect x="6.5" y="2" width="2" height="7" rx="0.5" fill="currentColor"/><rect x="10.5" y="2" width="2" height="7" rx="0.5" fill="currentColor"/></svg>`, "Toggle MIDI input (notein, ctlin, etc.)")

	sep()

	// Object: empty rectangle
	const objBtn = iconBtn(`<svg viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`, "Object (Cmd+1)")
	// Message: msg box shape
	const msgBtn = iconBtn(`<svg viewBox="0 0 16 16"><path d="M2 4h11l-2 4 2 4H2l1.5-4L2 4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`, "Message (Cmd+2)")
	// Number: number box with triangle
	const numBtn = iconBtn(`<svg viewBox="0 0 16 16"><path d="M4 4h10.5v8H4l-2.5-4L4 4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><text x="7" y="10.5" font-size="7" font-family="monospace" fill="currentColor" stroke="none">0</text></svg>`, "Number (Cmd+3)")
	// Comment: text icon
	const commentBtn = iconBtn(`<svg viewBox="0 0 16 16"><text x="2" y="12" font-size="12" font-family="serif" font-style="italic" fill="currentColor" stroke="none">T</text></svg>`, "Comment (Cmd+5)")

	const spacer = document.createElement("span")
	spacer.className = "pd-spacer"
	toolbar.appendChild(spacer)

	const statusEl = document.createElement("span")
	statusEl.className = "pd-status"
	toolbar.appendChild(statusEl)

	const ICON_PENCIL = `<svg viewBox="0 0 16 16"><path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`
	const ICON_LOCK = `<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`

	function setLocked(val) {
		locked = val
		lockBtn.innerHTML = locked ? ICON_LOCK : ICON_PENCIL
		lockBtn.classList.toggle("active", locked)
		canvas.classList.toggle("locked", locked)
		// Disable edit buttons in lock mode
		objBtn.disabled = locked
		msgBtn.disabled = locked
		numBtn.disabled = locked
		commentBtn.disabled = locked
		draw()
	}

	// Canvas
	const canvasWrap = document.createElement("div")
	canvasWrap.className = "pd-canvas-wrap"
	root.appendChild(canvasWrap)

	const canvas = document.createElement("canvas")
	canvas.className = "pd-canvas"
	canvasWrap.appendChild(canvas)
	const ctx = canvas.getContext("2d")

	let editInput = null

	// ─── Sizing ───
	function resize() {
		const r = canvasWrap.getBoundingClientRect()
		canvas.width = r.width * DPI
		canvas.height = r.height * DPI
		canvas.style.width = r.width + "px"
		canvas.style.height = r.height + "px"
		draw()
	}

	const resizeObs = new ResizeObserver(resize)
	resizeObs.observe(canvasWrap)

	// ─── Node geometry helpers ───
	function measureNode(node) {
		ctx.font = `${FONT_SIZE}px "Menlo", "Consolas", monospace`

		if (node.guiParams && GUI_TYPES.has(node.type)) {
			const gp = node.guiParams
			switch (node.type) {
				case "bng":
					return { w: gp.size, h: gp.size, inlets: 1, outlets: 1 }
				case "tgl":
					return { w: gp.size, h: gp.size, inlets: 1, outlets: 1 }
				case "vsl":
					return { w: gp.width, h: gp.height, inlets: 1, outlets: 1 }
				case "hsl":
					return { w: gp.width, h: gp.height, inlets: 1, outlets: 1 }
				case "nbx": {
					const charW = 8
					return { w: gp.width * charW + 4, h: gp.height, inlets: 1, outlets: 1 }
				}
				case "vradio":
					return { w: gp.size, h: gp.size * gp.number, inlets: 1, outlets: 1 }
				case "hradio":
					return { w: gp.size * gp.number, h: gp.size, inlets: 1, outlets: 1 }
				case "vu":
					return { w: gp.width, h: gp.height, inlets: 1, outlets: 0 }
				case "cnv":
					return { w: gp.width, h: gp.height, inlets: 0, outlets: 0 }
				case "keyboard": {
					const octaves = gp.octaves || 2
					const whiteW = gp.whiteW || 20
					return { w: octaves * 7 * whiteW, h: gp.height || 60, inlets: 0, outlets: 0 }
				}
			}
		}

		// Array nodes
		if (node.isArray) {
			return { w: 200, h: 140, inlets: 0, outlets: 0 }
		}

		const label = getNodeLabel(node)
		const textW = ctx.measureText(label).width
		const w = Math.max(NODE_MIN_WIDTH, textW + 16)
		const io = getNodeIO(node)
		return { w, h: NODE_HEIGHT, inlets: io[0], outlets: io[1] }
	}

	function getNodeLabel(node) {
		if (node.type === "obj") {
			if (node.params && node.params.length) return node.text + " " + node.params.join(" ")
			return node.text || "obj"
		}
		if (node.type === "msg") return node.text || ""
		if (node.type === "floatatom") return node.text || "0"
		if (node.type === "symbolatom") return node.text || "symbol"
		if (node.type === "text") return node.text || ""
		if (GUI_TYPES.has(node.type)) return node.type
		return node.text || node.type
	}

	function getNodeIO(node) {
		if (node.type === "msg") return [1, 1]
		if (node.type === "floatatom") return [1, 1]
		if (node.type === "symbolatom") return [1, 1]
		if (node.type === "text") return [0, 0]
		if (node.type === "bng") return [1, 1]
		if (node.type === "tgl") return [1, 1]
		if (node.type === "vsl" || node.type === "hsl") return [1, 1]
		if (node.type === "nbx") return [1, 1]
		if (node.type === "vradio" || node.type === "hradio") return [1, 1]
		if (node.type === "vu") return [1, 0]
		if (node.type === "cnv") return [0, 0]
		if (node.type === "keyboard") return [0, 0]
		if (node.isArray) return [0, 0]
		// Subpatches: count inlet/outlet objects in raw content
		if (node.isSubpatch && node.rawContent) {
			const inlets = (node.rawContent.match(/\bobj\s+\d+\s+\d+\s+inlet~?\b/g) || []).length
			const outlets = (node.rawContent.match(/\bobj\s+\d+\s+\d+\s+outlet~?\b/g) || []).length
			return [inlets || 0, outlets || 0]
		}
		// Abstractions loaded from automerge docs
		if (node.abstractionIO) return node.abstractionIO
		if (node.type === "obj") return getObjectIO(node.text, node.params)
		return [1, 1]
	}

	function getPortPos(node, portIndex, portCount, isInlet) {
		const m = measureNode(node)
		const totalW = portCount * PORT_SIZE + (portCount - 1) * PORT_SPACING
		const startX = node.x + (m.w - totalW) / 2
		const px = startX + portIndex * (PORT_SIZE + PORT_SPACING) + PORT_SIZE / 2
		const py = isInlet ? node.y : node.y + m.h
		return { x: px, y: py }
	}

	function hitTestPort(mx, my) {
		for (let i = 0; i < model.nodes.length; i++) {
			const node = model.nodes[i]
			const io = getNodeIO(node)
			for (let p = 0; p < io[0]; p++) {
				const pos = getPortPos(node, p, io[0], true)
				if (Math.abs(mx - pos.x) < PORT_SIZE && Math.abs(my - pos.y) < PORT_SIZE) {
					return { nodeIndex: i, port: p, isInlet: true }
				}
			}
			for (let p = 0; p < io[1]; p++) {
				const pos = getPortPos(node, p, io[1], false)
				if (Math.abs(mx - pos.x) < PORT_SIZE && Math.abs(my - pos.y) < PORT_SIZE) {
					return { nodeIndex: i, port: p, isInlet: false }
				}
			}
		}
		return null
	}

	function hitTestNode(mx, my) {
		for (let i = model.nodes.length - 1; i >= 0; i--) {
			const node = model.nodes[i]
			const m = measureNode(node)
			if (mx >= node.x && mx <= node.x + m.w && my >= node.y && my <= node.y + m.h) {
				return i
			}
		}
		return -1
	}

	function hitTestWire(mx, my) {
		for (let i = 0; i < model.connections.length; i++) {
			const conn = model.connections[i]
			const srcNode = model.nodes[conn.sourceNode]
			const dstNode = model.nodes[conn.targetNode]
			if (!srcNode || !dstNode) continue
			const srcIO = getNodeIO(srcNode)
			const dstIO = getNodeIO(dstNode)
			const from = getPortPos(srcNode, conn.sourceOutlet, srcIO[1], false)
			const to = getPortPos(dstNode, conn.targetInlet, dstIO[0], true)
			if (distToLine(mx, my, from.x, from.y, to.x, to.y) < 5) return i
		}
		return -1
	}

	function distToLine(px, py, x1, y1, x2, y2) {
		const dx = x2 - x1
		const dy = y2 - y1
		const lenSq = dx * dx + dy * dy
		if (lenSq === 0) return Math.hypot(px - x1, py - y1)
		let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
		t = Math.max(0, Math.min(1, t))
		return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
	}

	// ─── GUI Send/Receive Symbol Injection ───

	// Map from GUI type → [sendParamIndex, receiveParamIndex] in the raw params array
	const GUI_SEND_IDX = {
		bng: [4, 5],
		tgl: [2, 3],
		vsl: [6, 7],
		hsl: [6, 7],
		nbx: [6, 7],
		vradio: [4, 5],
		hradio: [4, 5],
	}

	// Auto-generated send symbol prefix
	const AUTO_SYM = "__pw_"

	/**
	 * Get the effective send symbol for a node (user-configured or auto-generated).
	 */
	function getEffectiveSend(node, idx) {
		const gp = node.guiParams
		if (gp && gp.send) return gp.send
		if (node.type === "floatatom" && gp && gp.send) return gp.send
		// Auto-generated
		return AUTO_SYM + idx
	}

	/**
	 * Get the effective receive symbol for a node.
	 */
	function getEffectiveReceive(node, idx) {
		const gp = node.guiParams
		if (gp && gp.receive) return gp.receive
		return AUTO_SYM + "r_" + idx
	}

	/**
	 * Serialize the model for playback, injecting auto-send/receive symbols
	 * into GUI objects so they can be controlled from JS.
	 */
	// Visual-only GUI types that libpd doesn't support (no audio/message function)
	const VISUAL_ONLY = new Set(["cnv", "vu", "keyboard"])

	function serializeForPlayback() {
		// Deep-clone the model so we don't mutate the user's params
		const playModel = JSON.parse(JSON.stringify(model))

		// Strip visual-only nodes and remap connection indices
		const indexMap = new Map() // old index → new index
		const stripped = []
		const origIndices = [] // new index → original index (for matching GUI bindings)
		for (let i = 0; i < playModel.nodes.length; i++) {
			if (VISUAL_ONLY.has(playModel.nodes[i].type)) {
				continue // skip visual-only nodes
			}
			indexMap.set(i, stripped.length)
			origIndices.push(i)
			stripped.push(playModel.nodes[i])
		}
		// Remap connections, dropping any that reference stripped nodes
		playModel.connections = playModel.connections.filter(c =>
			indexMap.has(c.sourceNode) && indexMap.has(c.targetNode)
		).map(c => ({
			...c,
			sourceNode: indexMap.get(c.sourceNode),
			targetNode: indexMap.get(c.targetNode),
		}))
		playModel.nodes = stripped

		// Rewrite automerge URLs to sanitized filenames (without .pd extension —
		// PD adds it automatically when searching for abstractions)
		const urlPattern = /^automerge:[a-zA-Z0-9]+$/
		for (const node of playModel.nodes) {
			if (node.text && urlPattern.test(node.text)) {
				node.text = node.text.replace(":", "_")
			}
			if (node.params) {
				for (let j = 0; j < node.params.length; j++) {
					if (urlPattern.test(node.params[j])) {
						node.params[j] = node.params[j].replace(":", "_")
					}
				}
			}
		}

		for (let i = 0; i < playModel.nodes.length; i++) {
			const node = playModel.nodes[i]
			const origIdx = origIndices[i] // use original index for auto-symbols

			// Msg boxes: inject a hidden [r __pw_r_N] → [msg] connection
			// so clicking in lock mode can trigger the msg box via sendBang
			if (node.type === "msg") {
				const recvSym = AUTO_SYM + "r_" + origIdx
				const recvNode = {
					id: playModel.nodes.length,
					type: "obj",
					x: node.x - 100,
					y: node.y - 40,
					text: "r",
					params: [recvSym],
				}
				const recvIdx = playModel.nodes.length
				playModel.nodes.push(recvNode)
				playModel.connections.push({
					sourceNode: recvIdx,
					sourceOutlet: 0,
					targetNode: i,
					targetInlet: 0,
				})
			}

			const indices = GUI_SEND_IDX[node.type]
			if (indices) {
				const [sendIdx, recvIdx] = indices
				// Ensure params array is long enough
				while (node.params.length <= Math.max(sendIdx, recvIdx)) {
					node.params.push("empty")
				}
				// Set send symbol if it's "empty" or "-"
				if (node.params[sendIdx] === "empty" || node.params[sendIdx] === "-") {
					node.params[sendIdx] = AUTO_SYM + origIdx
				}
				// Set receive symbol if it's "empty" or "-"
				if (node.params[recvIdx] === "empty" || node.params[recvIdx] === "-") {
					node.params[recvIdx] = AUTO_SYM + "r_" + origIdx
				}
			}
			// floatatom / symbolatom: PD's gatom outlet connections fail in this
			// libpd WASM build, so we replace the floatatom with a [float] object
			// and wire a [r __pw_r_N] to trigger it. The [float] object's outlet
			// connections work normally.
			if (node.type === "floatatom" || node.type === "symbolatom") {
				const recvSym = AUTO_SYM + "r_" + origIdx
				// Replace the floatatom with a [float] object (which has working outlets)
				node.type = "obj"
				node.text = "float"
				node.params = []
				// Create hidden [r __pw_r_N] → [float] inlet connection
				const recvNode = {
					id: playModel.nodes.length,
					type: "obj",
					x: node.x - 100,
					y: node.y - 40,
					text: "r",
					params: [recvSym],
				}
				const recvIdx = playModel.nodes.length
				playModel.nodes.push(recvNode)
				playModel.connections.push({
					sourceNode: recvIdx,
					sourceOutlet: 0,
					targetNode: i,
					targetInlet: 0,
				})
			}
		}

		const result = serializePd(playModel)
		console.log("[pd] serialized for playback:\n" + result)
		return result
	}

	// ─── GUI State & Binding ───

	function resolveSymbol(sym, dollarZero) {
		if (!sym) return ""
		return sym.replace(/\$0/g, String(dollarZero))
	}

	function bindGuiObjects() {
		const $0 = runtime.getDollarZero()

		for (let i = 0; i < model.nodes.length; i++) {
			const node = model.nodes[i]
			if (!GUI_TYPES.has(node.type) && node.type !== "floatatom" && node.type !== "symbolatom") continue

			const gp = node.guiParams

			// Initialize GUI state — floatatom/symbolatom may not have guiParams
			let initVal = 0
			if (node.type === "floatatom") {
				initVal = Number(node.text) || 0
			} else if (node.type === "tgl" && gp) {
				initVal = gp.init ? (gp.defaultValue || gp.initValue || 0) : 0
			} else if ((node.type === "vsl" || node.type === "hsl") && gp) {
				initVal = gp.init ? (gp.defaultValue || 0) : 0
			} else if (node.type === "nbx" && gp) {
				initVal = gp.init ? (gp.defaultValue || 0) : 0
			} else if ((node.type === "vradio" || node.type === "hradio") && gp) {
				initVal = gp.init ? (gp.defaultValue || 0) : 0
			}

			guiState.set(i, { value: node.type === "keyboard" ? -1 : initVal, active: false })

			// Keyboard doesn't need receive bindings — it sends MIDI directly
			if (node.type === "keyboard") continue

			// Bind receive symbol — use auto-generated if none configured
			const recv = resolveSymbol(getEffectiveReceive(node, i), $0)
			if (recv) {
				const unbind = runtime.bind(recv, (msg) => {
					const state = guiState.get(i)
					if (!state) return
					if (msg.type === "bang") {
						if (node.type === "bng") {
							state.active = true
							draw()
							setTimeout(() => { state.active = false; draw() }, (gp && gp.hold) || 100)
						}
					} else if (msg.type === "float") {
						state.value = msg.value
						if (node.type === "floatatom") {
							node.text = String(Math.round(msg.value * 1000) / 1000)
						}
						draw()
					}
				})
				guiBindings.push(unbind)
			}
		}
	}

	function unbindGuiObjects() {
		for (const unbind of guiBindings) unbind()
		guiBindings.length = 0
		guiState.clear()
		if (arrayPollInterval) {
			clearInterval(arrayPollInterval)
			arrayPollInterval = null
		}
	}

	function startArrayPolling() {
		const arrayNodes = model.nodes.filter(n => n.isArray)
		if (arrayNodes.length === 0) return

		arrayPollInterval = setInterval(() => {
			let changed = false
			for (const node of arrayNodes) {
				const name = node.arrayName || (node.params && node.params[0])
				if (!name) continue
				const data = runtime.readArray(name)
				if (data) {
					const state = guiState.get(node.id) || { value: 0, active: false }
					state.arrayData = data
					guiState.set(node.id, state)
					changed = true
				}
			}
			if (changed) draw()
		}, 100)
	}

	// ─── GUI Interaction ───

	function ensureGuiState(nodeIdx) {
		if (!guiState.has(nodeIdx)) {
			const node = model.nodes[nodeIdx]
			const initVal = node.type === "keyboard" ? -1 : 0
			guiState.set(nodeIdx, { value: initVal, active: false })
		}
		return guiState.get(nodeIdx)
	}

	function handleGuiClick(nodeIdx, mx, my) {
		const node = model.nodes[nodeIdx]
		const gp = node.guiParams
		const $0 = runtime.getDollarZero()
		// Send to the RECEIVE symbol — this triggers the object inside libpd
		// as if it was clicked, so it fires through its outlet wires
		const recvName = resolveSymbol(getEffectiveReceive(node, nodeIdx), $0)
		const state = ensureGuiState(nodeIdx)
		if (!state) return false

		const playing = runtime.isPlaying

		switch (node.type) {
			case "bng": {
				state.active = true
				draw()
				setTimeout(() => { state.active = false; draw() }, (gp && gp.hold) || 100)
				if (playing) runtime.sendBang(recvName)
				return true
			}
			case "tgl": {
				state.value = state.value ? 0 : ((gp && gp.defaultValue) || 1)
				draw()
				if (playing) runtime.sendFloat(recvName, state.value)
				return true
			}
			case "hsl": {
				if (!gp) return false
				const ratio = (mx - node.x) / gp.width
				const clamped = Math.max(0, Math.min(1, ratio))
				state.value = gp.bottom + clamped * (gp.top - gp.bottom)
				draw()
				if (playing) runtime.sendFloat(recvName, state.value)
				return true
			}
			case "vsl": {
				if (!gp) return false
				const ratio = 1 - (my - node.y) / gp.height
				const clamped = Math.max(0, Math.min(1, ratio))
				state.value = gp.bottom + clamped * (gp.top - gp.bottom)
				draw()
				if (playing) runtime.sendFloat(recvName, state.value)
				return true
			}
			case "vradio": {
				if (!gp) return false
				const sz = gp.size
				const btnIdx = Math.floor((my - node.y) / sz)
				const clamped = Math.max(0, Math.min(gp.number - 1, btnIdx))
				state.value = clamped
				draw()
				if (playing) runtime.sendFloat(recvName, clamped)
				return true
			}
			case "hradio": {
				if (!gp) return false
				const sz = gp.size
				const btnIdx = Math.floor((mx - node.x) / sz)
				const clamped = Math.max(0, Math.min(gp.number - 1, btnIdx))
				state.value = clamped
				draw()
				if (playing) runtime.sendFloat(recvName, clamped)
				return true
			}
		}
		return false
	}

	function handleGuiDragStart(nodeIdx, mx, my) {
		const node = model.nodes[nodeIdx]

		if (node.type === "floatatom") {
			return { nodeIdx, startX: mx, startY: my, startValue: ensureGuiState(nodeIdx).value || 0 }
		}

		const gp = node.guiParams
		if (!gp) return null

		if (node.type === "vsl" || node.type === "hsl" || node.type === "nbx") {
			return { nodeIdx, startX: mx, startY: my, startValue: ensureGuiState(nodeIdx).value || 0 }
		}
		return null
	}

	function handleGuiDrag(dragInfo, mx, my, shiftKey) {
		const node = model.nodes[dragInfo.nodeIdx]
		const state = ensureGuiState(dragInfo.nodeIdx)
		if (!state) return
		const playing = runtime.isPlaying

		if (node.type === "floatatom") {
			// Drag up/down to change value, shift for fine control
			const dy = dragInfo.startY - my
			const step = shiftKey ? 0.01 : 1
			let val = dragInfo.startValue + dy * step
			// Respect limits from guiParams if present
			const gp = node.guiParams
			if (gp && gp.lower !== gp.upper) {
				val = Math.max(gp.lower, Math.min(gp.upper, val))
			}
			state.value = val
			node.text = String(Math.round(val * 1000) / 1000)
			draw()
			if (playing) {
				const $0 = runtime.getDollarZero()
				const recvName = resolveSymbol(getEffectiveReceive(node, dragInfo.nodeIdx), $0)
				runtime.sendFloat(recvName, val)
			}
			return
		}

		const gp = node.guiParams
		const $0 = runtime.getDollarZero()
		const recvName = resolveSymbol(getEffectiveReceive(node, dragInfo.nodeIdx), $0)

		if (node.type === "vsl" && gp) {
			const ratio = 1 - (my - node.y) / gp.height
			const clamped = Math.max(0, Math.min(1, ratio))
			state.value = gp.bottom + clamped * (gp.top - gp.bottom)
			draw()
			if (playing) runtime.sendFloat(recvName, state.value)
		} else if (node.type === "hsl" && gp) {
			const ratio = (mx - node.x) / gp.width
			const clamped = Math.max(0, Math.min(1, ratio))
			state.value = gp.bottom + clamped * (gp.top - gp.bottom)
			draw()
			if (playing) runtime.sendFloat(recvName, state.value)
		} else if (node.type === "nbx" && gp) {
			const dy = dragInfo.startY - my
			const step = shiftKey ? 0.01 : 1
			let val = dragInfo.startValue + dy * step
			val = Math.max(gp.min, Math.min(gp.max, val))
			state.value = val
			draw()
			if (playing) runtime.sendFloat(recvName, val)
		}
	}

	// ─── Drawing ───
	function draw() {
		const w = canvas.width
		const h = canvas.height
		ctx.setTransform(DPI, 0, 0, DPI, 0, 0)
		ctx.clearRect(0, 0, w / DPI, h / DPI)

		// Dot grid
		const gw = w / DPI
		const gh = h / DPI
		ctx.fillStyle = "#e0d8c0"
		for (let x = 0; x < gw; x += GRID) {
			for (let y = 0; y < gh; y += GRID) {
				ctx.beginPath()
				ctx.arc(x, y, 0.8, 0, Math.PI * 2)
				ctx.fill()
			}
		}

		// Wires
		for (let i = 0; i < model.connections.length; i++) {
			const conn = model.connections[i]
			const srcNode = model.nodes[conn.sourceNode]
			const dstNode = model.nodes[conn.targetNode]
			if (!srcNode || !dstNode) continue
			const srcIO = getNodeIO(srcNode)
			const dstIO = getNodeIO(dstNode)
			const from = getPortPos(srcNode, conn.sourceOutlet, srcIO[1], false)
			const to = getPortPos(dstNode, conn.targetInlet, dstIO[0], true)

			ctx.strokeStyle = i === selectedWire ? "#08f" : "#555"
			ctx.lineWidth = i === selectedWire ? 2 : 1.5
			ctx.beginPath()
			ctx.moveTo(from.x, from.y)
			const cy = (to.y - from.y) * 0.4
			ctx.bezierCurveTo(from.x, from.y + cy, to.x, to.y - cy, to.x, to.y)
			ctx.stroke()
		}

		// Wiring in progress
		if (wiring) {
			ctx.strokeStyle = "#08f"
			ctx.lineWidth = 1.5
			ctx.setLineDash([4, 4])
			ctx.beginPath()
			const srcNode = model.nodes[wiring.sourceNode]
			const srcIO = getNodeIO(srcNode)
			const from = getPortPos(srcNode, wiring.sourceOutlet, srcIO[1], false)
			ctx.moveTo(from.x, from.y)
			ctx.lineTo(wiring.x, wiring.y)
			ctx.stroke()
			ctx.setLineDash([])
		}

		// Nodes
		for (let i = 0; i < model.nodes.length; i++) {
			drawNode(i)
		}

		// Marquee selection rectangle
		if (marquee) {
			const mx1 = Math.min(marquee.startX, marquee.x)
			const my1 = Math.min(marquee.startY, marquee.y)
			const mw = Math.abs(marquee.x - marquee.startX)
			const mh = Math.abs(marquee.y - marquee.startY)
			ctx.strokeStyle = "#08f"
			ctx.lineWidth = 1
			ctx.setLineDash([3, 3])
			ctx.strokeRect(mx1, my1, mw, mh)
			ctx.setLineDash([])
			ctx.fillStyle = "rgba(0, 136, 255, 0.05)"
			ctx.fillRect(mx1, my1, mw, mh)
		}
	}

	function drawPorts(node, m) {
		const io = getNodeIO(node)
		ctx.fillStyle = "#333"
		for (let p = 0; p < io[0]; p++) {
			const pos = getPortPos(node, p, io[0], true)
			ctx.fillRect(pos.x - PORT_SIZE / 2, pos.y - 2, PORT_SIZE, 4)
		}
		for (let p = 0; p < io[1]; p++) {
			const pos = getPortPos(node, p, io[1], false)
			ctx.fillRect(pos.x - PORT_SIZE / 2, pos.y - 2, PORT_SIZE, 4)
		}
	}

	function drawNode(idx) {
		const node = model.nodes[idx]
		const m = measureNode(node)
		const selected = selectedNodes.has(idx)
		const x = node.x
		const y = node.y

		ctx.save()

		// GUI objects with parsed params
		if (GUI_TYPES.has(node.type) && node.guiParams) {
			drawGuiNode(idx, node, m, selected)
			drawPorts(node, m)
			ctx.restore()
			return
		}

		// Array display
		if (node.isArray) {
			drawArrayNode(idx, node, m, selected)
			ctx.restore()
			return
		}

		// Node body
		if (node.type === "text") {
			ctx.font = `${FONT_SIZE}px "Menlo", "Consolas", monospace`
			ctx.fillStyle = selected ? "#08f" : "#666"
			ctx.textBaseline = "middle"
			ctx.fillText(getNodeLabel(node), x + 4, y + m.h / 2)
		} else if (node.type === "msg") {
			ctx.fillStyle = "#fff"
			ctx.strokeStyle = selected ? "#08f" : "#333"
			ctx.lineWidth = selected ? 2 : 1
			ctx.beginPath()
			ctx.moveTo(x + 4, y)
			ctx.lineTo(x + m.w, y)
			ctx.lineTo(x + m.w - 4, y + m.h / 2)
			ctx.lineTo(x + m.w, y + m.h)
			ctx.lineTo(x + 4, y + m.h)
			ctx.lineTo(x, y + m.h / 2)
			ctx.closePath()
			ctx.fill()
			ctx.stroke()

			ctx.font = `${FONT_SIZE}px "Menlo", "Consolas", monospace`
			ctx.fillStyle = "#222"
			ctx.textBaseline = "middle"
			ctx.fillText(getNodeLabel(node), x + 8, y + m.h / 2)
		} else if (node.type === "floatatom" || node.type === "symbolatom") {
			ctx.fillStyle = "#fff"
			ctx.strokeStyle = selected ? "#08f" : "#333"
			ctx.lineWidth = selected ? 2 : 1
			ctx.beginPath()
			ctx.moveTo(x + 6, y)
			ctx.lineTo(x + m.w, y)
			ctx.lineTo(x + m.w, y + m.h)
			ctx.lineTo(x, y + m.h)
			ctx.lineTo(x, y + 6)
			ctx.closePath()
			ctx.fill()
			ctx.stroke()

			// Show live value when playing, or the typed value
			let label = node.text || "0"
			const state = guiState.get(idx)
			if (state) {
				label = String(Math.round(state.value * 1000) / 1000)
			}
			ctx.font = `${FONT_SIZE}px "Menlo", "Consolas", monospace`
			ctx.fillStyle = "#222"
			ctx.textBaseline = "middle"
			ctx.fillText(label, x + 8, y + m.h / 2)
		} else {
			ctx.fillStyle = "#fff"
			ctx.strokeStyle = selected ? "#08f" : "#333"
			ctx.lineWidth = selected ? 2 : 1
			ctx.strokeRect(x, y, m.w, m.h)
			ctx.fillRect(x, y, m.w, m.h)
			ctx.strokeRect(x, y, m.w, m.h)

			ctx.font = `${FONT_SIZE}px "Menlo", "Consolas", monospace`
			ctx.fillStyle = "#222"
			ctx.textBaseline = "middle"
			ctx.fillText(getNodeLabel(node), x + 4, y + m.h / 2)
		}

		drawPorts(node, m)
		ctx.restore()
	}

	function drawGuiNode(idx, node, m, selected) {
		const gp = node.guiParams
		const state = guiState.get(idx) || { value: 0, active: false }
		const x = node.x
		const y = node.y
		const bg = gp.bgColor || "#e0e0e0"
		const fg = gp.fgColor || "#000000"

		switch (node.type) {
			case "bng": {
				// Square background + circle
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : "#333"
				ctx.lineWidth = selected ? 2 : 1
				ctx.fillRect(x, y, gp.size, gp.size)
				ctx.strokeRect(x, y, gp.size, gp.size)
				// Circle
				const r = gp.size * 0.35
				const cx = x + gp.size / 2
				const cy = y + gp.size / 2
				ctx.beginPath()
				ctx.arc(cx, cy, r, 0, Math.PI * 2)
				ctx.fillStyle = state.active ? fg : bg
				ctx.fill()
				ctx.strokeStyle = fg
				ctx.lineWidth = 1
				ctx.stroke()
				break
			}
			case "tgl": {
				// Square background + X cross when on
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : "#333"
				ctx.lineWidth = selected ? 2 : 1
				ctx.fillRect(x, y, gp.size, gp.size)
				ctx.strokeRect(x, y, gp.size, gp.size)
				if (state.value) {
					ctx.strokeStyle = fg
					ctx.lineWidth = 2
					const pad = 3
					ctx.beginPath()
					ctx.moveTo(x + pad, y + pad)
					ctx.lineTo(x + gp.size - pad, y + gp.size - pad)
					ctx.stroke()
					ctx.beginPath()
					ctx.moveTo(x + gp.size - pad, y + pad)
					ctx.lineTo(x + pad, y + gp.size - pad)
					ctx.stroke()
				}
				break
			}
			case "vsl": {
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : "#333"
				ctx.lineWidth = selected ? 2 : 1
				ctx.fillRect(x, y, gp.width, gp.height)
				ctx.strokeRect(x, y, gp.width, gp.height)
				// Slider indicator
				const range = gp.top - gp.bottom
				const ratio = range !== 0 ? (state.value - gp.bottom) / range : 0
				const indicatorY = y + gp.height - ratio * gp.height
				ctx.fillStyle = fg
				ctx.fillRect(x + 1, indicatorY - 2, gp.width - 2, 4)
				break
			}
			case "hsl": {
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : "#333"
				ctx.lineWidth = selected ? 2 : 1
				ctx.fillRect(x, y, gp.width, gp.height)
				ctx.strokeRect(x, y, gp.width, gp.height)
				// Slider indicator
				const range = gp.top - gp.bottom
				const ratio = range !== 0 ? (state.value - gp.bottom) / range : 0
				const indicatorX = x + ratio * gp.width
				ctx.fillStyle = fg
				ctx.fillRect(indicatorX - 2, y + 1, 4, gp.height - 2)
				break
			}
			case "nbx": {
				const w = m.w
				const h = gp.height
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : "#333"
				ctx.lineWidth = selected ? 2 : 1
				// Left triangle
				ctx.beginPath()
				ctx.moveTo(x, y)
				ctx.lineTo(x + h / 2, y + h / 2)
				ctx.lineTo(x, y + h)
				ctx.closePath()
				ctx.fill()
				ctx.stroke()
				// Main rect
				ctx.fillRect(x + h / 2, y, w - h / 2, h)
				ctx.strokeRect(x + h / 2, y, w - h / 2, h)
				// Number text
				ctx.font = `${Math.min(FONT_SIZE, h - 2)}px "Menlo", "Consolas", monospace`
				ctx.fillStyle = fg
				ctx.textBaseline = "middle"
				const numStr = String(Math.round(state.value * 1000) / 1000)
				ctx.fillText(numStr, x + h / 2 + 2, y + h / 2)
				break
			}
			case "vradio": {
				const sz = gp.size
				for (let b = 0; b < gp.number; b++) {
					const by = y + b * sz
					ctx.fillStyle = bg
					ctx.strokeStyle = selected ? "#08f" : "#333"
					ctx.lineWidth = selected ? 2 : 1
					ctx.fillRect(x, by, sz, sz)
					ctx.strokeRect(x, by, sz, sz)
					if (b === Math.round(state.value)) {
						ctx.fillStyle = fg
						const pad = 3
						ctx.fillRect(x + pad, by + pad, sz - pad * 2, sz - pad * 2)
					}
				}
				break
			}
			case "hradio": {
				const sz = gp.size
				for (let b = 0; b < gp.number; b++) {
					const bx = x + b * sz
					ctx.fillStyle = bg
					ctx.strokeStyle = selected ? "#08f" : "#333"
					ctx.lineWidth = selected ? 2 : 1
					ctx.fillRect(bx, y, sz, sz)
					ctx.strokeRect(bx, y, sz, sz)
					if (b === Math.round(state.value)) {
						ctx.fillStyle = fg
						const pad = 3
						ctx.fillRect(bx + pad, y + pad, sz - pad * 2, sz - pad * 2)
					}
				}
				break
			}
			case "vu": {
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : "#333"
				ctx.lineWidth = selected ? 2 : 1
				ctx.fillRect(x, y, gp.width, gp.height)
				ctx.strokeRect(x, y, gp.width, gp.height)
				// VU meter bars
				const level = Math.max(0, Math.min(1, (state.value + 100) / 100))
				const barH = gp.height * level
				const gradient = ctx.createLinearGradient(x, y + gp.height, x, y)
				gradient.addColorStop(0, "#0f0")
				gradient.addColorStop(0.6, "#ff0")
				gradient.addColorStop(1, "#f00")
				ctx.fillStyle = gradient
				ctx.fillRect(x + 2, y + gp.height - barH, gp.width - 4, barH)
				break
			}
			case "cnv": {
				ctx.fillStyle = bg
				ctx.strokeStyle = selected ? "#08f" : bg
				ctx.lineWidth = selected ? 2 : 1
				ctx.fillRect(x, y, gp.width, gp.height)
				if (selected) ctx.strokeRect(x, y, gp.width, gp.height)
				// Label
				if (gp.label) {
					ctx.font = `${gp.labelFontSize || 10}px "Menlo", "Consolas", monospace`
					ctx.fillStyle = gp.labelColor || "#000"
					ctx.textBaseline = "top"
					ctx.fillText(gp.label, x + (gp.labelX || 0), y + (gp.labelY || 0))
				}
				break
			}
			case "keyboard": {
				drawKeyboard(idx, node, gp, selected)
				break
			}
		}

		// Draw label for non-cnv GUI objects
		if (node.type !== "cnv" && node.type !== "keyboard" && gp.label) {
			ctx.font = `${gp.labelFontSize || 10}px "Menlo", "Consolas", monospace`
			ctx.fillStyle = gp.labelColor || "#000"
			ctx.textBaseline = "top"
			ctx.fillText(gp.label, x + (gp.labelX || 0), y + (gp.labelY || 0))
		}
	}

	function drawArrayNode(idx, node, m, selected) {
		const x = node.x
		const y = node.y
		const w = m.w
		const h = m.h
		const name = node.arrayName || (node.params && node.params[0]) || "array"

		// Background
		ctx.fillStyle = "#fff"
		ctx.strokeStyle = selected ? "#08f" : "#333"
		ctx.lineWidth = selected ? 2 : 1
		ctx.fillRect(x, y, w, h)
		ctx.strokeRect(x, y, w, h)

		// Title bar
		ctx.fillStyle = "#e8e8e0"
		ctx.fillRect(x, y, w, 18)
		ctx.strokeRect(x, y, w, 18)
		ctx.font = `10px "Menlo", "Consolas", monospace`
		ctx.fillStyle = "#333"
		ctx.textBaseline = "middle"
		ctx.fillText(name, x + 4, y + 9)

		// Waveform
		const state = guiState.get(idx)
		const data = state?.arrayData
		const plotY = y + 18
		const plotH = h - 18

		if (data && data.length > 0) {
			ctx.strokeStyle = "#08f"
			ctx.lineWidth = 1
			ctx.beginPath()
			for (let i = 0; i < data.length; i++) {
				const px = x + (i / data.length) * w
				const val = Math.max(-1, Math.min(1, data[i]))
				const py = plotY + plotH / 2 - val * plotH / 2
				if (i === 0) ctx.moveTo(px, py)
				else ctx.lineTo(px, py)
			}
			ctx.stroke()
		} else {
			// Zero line
			ctx.strokeStyle = "#ccc"
			ctx.lineWidth = 1
			ctx.beginPath()
			ctx.moveTo(x, plotY + plotH / 2)
			ctx.lineTo(x + w, plotY + plotH / 2)
			ctx.stroke()
		}
	}

	// ─── Keyboard (piano) helpers ───

	// Which notes in an octave are black keys (semitone offsets)
	const BLACK_KEYS = new Set([1, 3, 6, 8, 10]) // C# D# F# G# A#
	// White key semitone values within an octave
	const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] // C D E F G A B

	/**
	 * Get the MIDI note for a position on the keyboard widget.
	 * Returns { note, isBlack } or null if outside keys.
	 */
	function hitTestKeyboard(node, mx, my) {
		const gp = node.guiParams
		if (!gp) return null
		const x = node.x, y = node.y
		const octaves = gp.octaves || 2
		const whiteW = gp.whiteW || 20
		const h = gp.height || 60
		const blackH = h * 0.6
		const blackW = whiteW * 0.6
		const lowNote = gp.lowNote || 48
		const totalWhite = octaves * 7

		// Out of bounds?
		if (mx < x || mx >= x + totalWhite * whiteW || my < y || my >= y + h) return null

		// Check black keys first (they overlap white keys)
		if (my < y + blackH) {
			for (let o = 0; o < octaves; o++) {
				for (let i = 0; i < 7; i++) {
					const semi = WHITE_SEMITONES[i]
					// Black key sits between this white key and the next (except E-F and B-C)
					if (semi === 4 || semi === 11) continue // no black key after E or B
					const whiteIdx = o * 7 + i
					const bx = x + (whiteIdx + 1) * whiteW - blackW / 2
					if (mx >= bx && mx < bx + blackW) {
						return { note: lowNote + o * 12 + semi + 1, isBlack: true }
					}
				}
			}
		}

		// White key
		const whiteIdx = Math.floor((mx - x) / whiteW)
		if (whiteIdx < 0 || whiteIdx >= totalWhite) return null
		const octave = Math.floor(whiteIdx / 7)
		const keyInOctave = whiteIdx % 7
		return { note: lowNote + octave * 12 + WHITE_SEMITONES[keyInOctave], isBlack: false }
	}

	function drawKeyboard(idx, node, gp, selected) {
		const x = node.x, y = node.y
		const octaves = gp.octaves || 2
		const whiteW = gp.whiteW || 20
		const h = gp.height || 60
		const blackH = h * 0.6
		const blackW = whiteW * 0.6
		const lowNote = gp.lowNote || 48
		const totalWhite = octaves * 7
		const totalW = totalWhite * whiteW

		const state = guiState.get(idx)
		const activeNote = state?.value || -1

		// Border
		ctx.strokeStyle = selected ? "#08f" : "#333"
		ctx.lineWidth = selected ? 2 : 1

		// White keys
		for (let i = 0; i < totalWhite; i++) {
			const kx = x + i * whiteW
			const o = Math.floor(i / 7)
			const k = i % 7
			const note = lowNote + o * 12 + WHITE_SEMITONES[k]
			ctx.fillStyle = note === activeNote ? "#cde" : "#fff"
			ctx.fillRect(kx, y, whiteW, h)
			ctx.strokeStyle = "#999"
			ctx.lineWidth = 0.5
			ctx.strokeRect(kx, y, whiteW, h)
			// Note name on lowest octave C keys
			if (k === 0) {
				ctx.font = '8px "Menlo", monospace'
				ctx.fillStyle = "#aaa"
				ctx.textBaseline = "bottom"
				ctx.fillText("C" + Math.floor(note / 12 - 1), kx + 2, y + h - 2)
			}
		}

		// Black keys
		for (let o = 0; o < octaves; o++) {
			for (let i = 0; i < 7; i++) {
				const semi = WHITE_SEMITONES[i]
				if (semi === 4 || semi === 11) continue
				const whiteIdx = o * 7 + i
				const bx = x + (whiteIdx + 1) * whiteW - blackW / 2
				const note = lowNote + o * 12 + semi + 1
				ctx.fillStyle = note === activeNote ? "#567" : "#222"
				ctx.fillRect(bx, y, blackW, blackH)
				ctx.strokeStyle = "#000"
				ctx.lineWidth = 0.5
				ctx.strokeRect(bx, y, blackW, blackH)
			}
		}

		// Overall border
		ctx.strokeStyle = selected ? "#08f" : "#333"
		ctx.lineWidth = selected ? 2 : 1
		ctx.strokeRect(x, y, totalW, h)
	}

	let keyboardNote = -1 // currently held note (-1 = none)
	let keyboardNodeIdx = -1 // which keyboard node is active

	// ─── Interaction ───
	function canvasCoords(e) {
		const r = canvas.getBoundingClientRect()
		return { x: e.clientX - r.left, y: e.clientY - r.top }
	}

	let guiDrag = null // active GUI drag (slider/nbx)

	function isInteractive(node) {
		return GUI_TYPES.has(node.type) || node.type === "msg" || node.type === "floatatom" || node.type === "symbolatom"
	}

	canvas.addEventListener("pointerdown", (e) => {
		const { x, y } = canvasCoords(e)
		if (editInput) commitEdit()

		// ─── LOCK (run) mode: interact with GUI objects ───
		if (locked) {
			const nodeIdx = hitTestNode(x, y)
			if (nodeIdx >= 0) {
				const node = model.nodes[nodeIdx]

				// Keyboard: send MIDI note-on directly to libpd
				if (runtime.isPlaying && node.type === "keyboard") {
					const hit = hitTestKeyboard(node, x, y)
					if (hit) {
						if (keyboardNote >= 0) runtime.noteOn(0, keyboardNote, 0)
						keyboardNote = hit.note
						keyboardNodeIdx = nodeIdx
						runtime.noteOn(0, hit.note, 100)
						const state = guiState.get(nodeIdx)
						if (state) { state.value = hit.note; draw() }
						canvas.setPointerCapture(e.pointerId)
						e.stopPropagation()
					}
					return
				}

				if (isInteractive(node)) {
					// Msg box: send a bang to its receive symbol to trigger it
					if (node.type === "msg") {
						if (runtime.isPlaying) {
							const $0 = runtime.getDollarZero()
							const recvName = resolveSymbol(getEffectiveReceive(node, nodeIdx), $0)
							runtime.sendBang(recvName)
						}
						e.stopPropagation()
						return
					}

					// GUI click (bng, tgl, radio, sliders)
					handleGuiClick(nodeIdx, x, y)

					// GUI drag start (sliders, nbx, floatatom) — also starts after click for sliders
					guiDrag = handleGuiDragStart(nodeIdx, x, y)
					if (guiDrag) {
						canvas.setPointerCapture(e.pointerId)
						e.stopPropagation()
						return
					}

					// Non-draggable clicks (bng, tgl, radio) already handled above
					e.stopPropagation()
					canvas.setPointerCapture(e.pointerId)
					return
				}
			}
			// In lock mode, clicks on non-interactive objects or empty space do nothing
			return
		}

		// ─── EDIT mode: move, wire, select ───

		// Check port hit first (for wiring)
		const port = hitTestPort(x, y)
		if (port && !port.isInlet) {
			wiring = { sourceNode: port.nodeIndex, sourceOutlet: port.port, x, y }
			canvas.setPointerCapture(e.pointerId)
			e.stopPropagation()
			return
		}

		// Check node hit (for moving)
		const nodeIdx = hitTestNode(x, y)
		if (nodeIdx >= 0) {
			const node = model.nodes[nodeIdx]

			// While playing, dragging a floatatom/slider changes its value even in edit mode
			if (runtime.isPlaying && (node.type === "floatatom" || node.type === "vsl" || node.type === "hsl" || node.type === "nbx")) {
				guiDrag = handleGuiDragStart(nodeIdx, x, y)
				if (guiDrag) {
					canvas.setPointerCapture(e.pointerId)
					e.stopPropagation()
					return
				}
			}

			if (!e.shiftKey) {
				if (!selectedNodes.has(nodeIdx)) {
					selectedNodes.clear()
				}
			}
			selectedNodes.add(nodeIdx)
			selectedWire = -1
			dragging = { nodeId: nodeIdx, offsetX: x - node.x, offsetY: y - node.y }
			canvas.setPointerCapture(e.pointerId)
			draw()
			e.stopPropagation()
			return
		}

		// Check wire hit
		const wireIdx = hitTestWire(x, y)
		if (wireIdx >= 0) {
			selectedNodes.clear()
			selectedWire = wireIdx
			draw()
			e.stopPropagation()
			return
		}

		// Empty space — start marquee selection
		if (!e.shiftKey) {
			selectedNodes.clear()
		}
		selectedWire = -1
		marquee = { startX: x, startY: y, x, y }
		canvas.setPointerCapture(e.pointerId)
		draw()
	})

	canvas.addEventListener("pointermove", (e) => {
		const { x, y } = canvasCoords(e)

		// Keyboard: glide across keys
		if (keyboardNote >= 0 && keyboardNodeIdx >= 0) {
			const node = model.nodes[keyboardNodeIdx]
			if (node && node.type === "keyboard") {
				const hit = hitTestKeyboard(node, x, y)
				if (hit && hit.note !== keyboardNote) {
					runtime.noteOn(0, keyboardNote, 0)
					keyboardNote = hit.note
					runtime.noteOn(0, hit.note, 100)
					const state = guiState.get(keyboardNodeIdx)
					if (state) { state.value = hit.note; draw() }
				}
			}
			return
		}

		if (guiDrag) {
			handleGuiDrag(guiDrag, x, y, e.shiftKey)
			return
		}

		if (wiring) {
			wiring.x = x
			wiring.y = y
			draw()
			return
		}

		if (marquee) {
			marquee.x = x
			marquee.y = y
			// Update selection based on marquee rect
			const mx1 = Math.min(marquee.startX, marquee.x)
			const my1 = Math.min(marquee.startY, marquee.y)
			const mx2 = Math.max(marquee.startX, marquee.x)
			const my2 = Math.max(marquee.startY, marquee.y)
			if (!e.shiftKey) selectedNodes.clear()
			for (let i = 0; i < model.nodes.length; i++) {
				const node = model.nodes[i]
				const m = measureNode(node)
				// Select if node overlaps marquee rect
				if (node.x + m.w >= mx1 && node.x <= mx2 && node.y + m.h >= my1 && node.y <= my2) {
					selectedNodes.add(i)
				}
			}
			draw()
			return
		}

		if (dragging) {
			const dx = snap(x - dragging.offsetX) - model.nodes[dragging.nodeId].x
			const dy = snap(y - dragging.offsetY) - model.nodes[dragging.nodeId].y
			// Move all selected nodes together
			for (const idx of selectedNodes) {
				model.nodes[idx].x += dx
				model.nodes[idx].y += dy
			}
			draw()
			return
		}
	})

	canvas.addEventListener("pointerup", (e) => {
		const { x, y } = canvasCoords(e)

		// Keyboard: note off on release
		if (keyboardNote >= 0) {
			runtime.noteOn(0, keyboardNote, 0)
			const state = guiState.get(keyboardNodeIdx)
			if (state) { state.value = -1; draw() }
			keyboardNote = -1
			keyboardNodeIdx = -1
			return
		}

		if (guiDrag) {
			guiDrag = null
			return
		}

		if (marquee) {
			marquee = null
			draw()
			return
		}

		if (wiring) {
			const port = hitTestPort(x, y)
			if (port && port.isInlet && port.nodeIndex !== wiring.sourceNode) {
				const exists = model.connections.some(
					(c) => c.sourceNode === wiring.sourceNode && c.sourceOutlet === wiring.sourceOutlet && c.targetNode === port.nodeIndex && c.targetInlet === port.port
				)
				if (!exists) {
					model.connections.push({
						sourceNode: wiring.sourceNode,
						sourceOutlet: wiring.sourceOutlet,
						targetNode: port.nodeIndex,
						targetInlet: port.port,
					})
					saveModel()
				}
			}
			wiring = null
			draw()
			return
		}

		if (dragging) {
			saveModel()
			dragging = null
			return
		}
	})

	canvas.addEventListener("dblclick", (e) => {
		if (locked) return // No editing in lock mode
		const { x, y } = canvasCoords(e)
		const nodeIdx = hitTestNode(x, y)
		if (nodeIdx >= 0) {
			startEditingNode(nodeIdx)
		} else {
			addNode("obj", snap(x), snap(y), "")
		}
	})

	function startEditingNode(idx) {
		closeEditInput()
		editingNode = idx
		const node = model.nodes[idx]
		const m = measureNode(node)

		editInput = document.createElement("input")
		editInput.className = "pd-edit-input"
		editInput.style.left = node.x + "px"
		editInput.style.top = node.y + "px"
		editInput.style.width = Math.max(m.w, 100) + "px"
		editInput.style.height = NODE_HEIGHT + "px"

		if (node.type === "obj" || GUI_TYPES.has(node.type)) {
			editInput.value = node.text + (node.params.length ? " " + node.params.join(" ") : "")
		} else {
			editInput.value = node.text
		}

		canvasWrap.appendChild(editInput)
		editInput.focus()
		editInput.select()

		editInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				commitEdit()
			} else if (e.key === "Escape") {
				closeEditInput()
				draw()
			}
		})

		editInput.addEventListener("blur", () => {
			commitEdit()
		})
	}

	// Default GUI params for creating new GUI objects from the edit box
	const GUI_DEFAULTS = {
		bng:    ["15", "250", "50", "0", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1"],
		tgl:    ["15", "0", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1", "0", "1"],
		vsl:    ["15", "128", "0", "127", "0", "0", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1", "0", "1"],
		hsl:    ["128", "15", "0", "127", "0", "0", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1", "0", "1"],
		nbx:    ["5", "14", "-1e+37", "1e+37", "0", "0", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1", "0", "256"],
		vradio: ["15", "1", "0", "8", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1", "0"],
		hradio: ["15", "1", "0", "8", "empty", "empty", "empty", "0", "0", "0", "10", "-262144", "-1", "-1", "0"],
		vu:     ["15", "120", "empty", "empty", "0", "0", "0", "10", "-66577", "-1", "1"],
		cnv:    ["15", "100", "60", "empty", "empty", "empty", "0", "0", "0", "10", "-233017", "-66577"],
		keyboard: ["48", "2", "20", "60"],
	}

	function commitEdit() {
		if (editingNode < 0 || !editInput) return
		const node = model.nodes[editingNode]
		const val = editInput.value.trim()

		if (node.type === "obj" || GUI_TYPES.has(node.type)) {
			const parts = val.split(/\s+/)
			const name = parts[0] || ""

			// Check if this is a GUI type name — convert/update GUI node
			if (GUI_DEFAULTS[name]) {
				node.type = name
				node.text = name
				node.params = parts.length > 1 ? parts.slice(1) : GUI_DEFAULTS[name]
				node.guiParams = parseGuiParams(name, node.params)
			} else {
				node.type = "obj"
				node.text = name
				node.params = parts.slice(1)
				delete node.guiParams
			}
		} else if (node.type === "floatatom") {
			// Store the typed number as the display value and update guiState
			const numVal = Number(val)
			node.text = Number.isFinite(numVal) ? String(numVal) : "0"
			const state = guiState.get(editingNode)
			if (state) {
				state.value = Number.isFinite(numVal) ? numVal : 0
			}
		} else {
			node.text = val
		}

		closeEditInput()
		saveModel()
		draw()
	}

	function closeEditInput() {
		if (editInput) {
			try { editInput.remove() } catch {}
			editInput = null
		}
		editingNode = -1
	}

	function addNode(type, x, y, text) {
		const node = { id: model.nodes.length, type, x, y, text, params: [] }
		model.nodes.push(node)
		selectedNodes.clear()
		selectedNodes.add(model.nodes.length - 1)
		selectedWire = -1
		saveModel()
		draw()
		startEditingNode(model.nodes.length - 1)
	}

	// Keyboard
	function onKeyDown(e) {
		// Cmd+E: toggle edit/lock mode
		if ((e.ctrlKey || e.metaKey) && e.key === "e") {
			e.preventDefault()
			setLocked(!locked)
			return
		}

		// Cmd+Z: undo, Cmd+Shift+Z: redo (works in all modes)
		if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
			e.preventDefault()
			undo()
			return
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
			e.preventDefault()
			redo()
			return
		}

		if (editInput) return
		if (locked) return // No editing shortcuts in lock mode

		if (e.key === "Delete" || e.key === "Backspace") {
			if (selectedWire >= 0) {
				model.connections.splice(selectedWire, 1)
				selectedWire = -1
				saveModel()
				draw()
				return
			}
			if (selectedNodes.size > 0) {
				deleteSelectedNodes()
				return
			}
		}

		const r = canvasWrap.getBoundingClientRect()
		const cx = snap(r.width / 2)
		const cy = snap(r.height / 2)

		if ((e.ctrlKey || e.metaKey) && e.key === "1") {
			e.preventDefault()
			addNode("obj", cx, cy, "")
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "2") {
			e.preventDefault()
			addNode("msg", cx, cy, "")
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "3") {
			e.preventDefault()
			addNode("floatatom", cx, cy, "")
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "5") {
			e.preventDefault()
			addNode("text", cx, cy, "comment")
		}
	}

	root.addEventListener("keydown", onKeyDown)
	root.setAttribute("tabindex", "0")

	// ─── Paste PD content ───
	function onPaste(e) {
		if (locked) return
		if (editInput) return // don't intercept when editing a node
		const text = (e.clipboardData || window.clipboardData)?.getData("text")
		if (!text || !text.trim().match(/^#[NX]\b/)) return // not PD content

		e.preventDefault()

		// Parse pasted content
		let content = text.trim()
		// Ensure it starts with a canvas header
		if (!content.startsWith("#N canvas")) {
			content = "#N canvas 0 0 600 400 (subpatch) 12;\n" + content
		}
		const parsed = parsePd(content)
		if (!parsed.nodes.length) return

		// Find offset: shift pasted nodes so they don't overlap existing ones
		const baseIdx = model.nodes.length
		// Find bounding box of pasted nodes to center them in view
		let minX = Infinity, minY = Infinity
		for (const n of parsed.nodes) {
			if (n.x < minX) minX = n.x
			if (n.y < minY) minY = n.y
		}
		// Offset to place near center of visible canvas, shifted by 20px to hint it's new
		const r = canvasWrap.getBoundingClientRect()
		const offsetX = snap(r.width / 4) - minX
		const offsetY = snap(r.height / 4) - minY

		selectedNodes.clear()
		for (const n of parsed.nodes) {
			n.x += offsetX
			n.y += offsetY
			n.id = model.nodes.length
			model.nodes.push(n)
			selectedNodes.add(n.id)
		}
		for (const c of parsed.connections) {
			model.connections.push({
				sourceNode: c.sourceNode + baseIdx,
				sourceOutlet: c.sourceOutlet,
				targetNode: c.targetNode + baseIdx,
				targetInlet: c.targetInlet,
			})
		}

		saveModel()
		draw()
	}
	root.addEventListener("paste", onPaste)

	function deleteSelectedNodes() {
		const indices = Array.from(selectedNodes).sort((a, b) => b - a)
		for (const idx of indices) {
			model.connections = model.connections.filter(
				(c) => c.sourceNode !== idx && c.targetNode !== idx
			)
		}
		for (const idx of indices) {
			model.nodes.splice(idx, 1)
			for (const c of model.connections) {
				if (c.sourceNode > idx) c.sourceNode--
				if (c.targetNode > idx) c.targetNode--
			}
		}
		model.nodes.forEach((n, i) => (n.id = i))
		selectedNodes.clear()
		saveModel()
		draw()
	}

	// Toolbar buttons
	objBtn.addEventListener("click", () => {
		const r = canvasWrap.getBoundingClientRect()
		addNode("obj", snap(r.width / 2), snap(r.height / 2), "")
	})
	msgBtn.addEventListener("click", () => {
		const r = canvasWrap.getBoundingClientRect()
		addNode("msg", snap(r.width / 2), snap(r.height / 2), "")
	})
	numBtn.addEventListener("click", () => {
		const r = canvasWrap.getBoundingClientRect()
		addNode("floatatom", snap(r.width / 2), snap(r.height / 2), "")
	})
	commentBtn.addEventListener("click", () => {
		const r = canvasWrap.getBoundingClientRect()
		addNode("text", snap(r.width / 2), snap(r.height / 2), "comment")
	})

	// Lock/Edit mode button
	lockBtn.addEventListener("click", () => {
		setLocked(!locked)
	})

	// Mic button
	micBtn.addEventListener("click", async () => {
		if (runtime.micEnabled) {
			runtime.disableMic()
			micBtn.classList.remove("active")
		} else {
			const ok = await runtime.enableMic()
			micBtn.classList.toggle("active", ok)
		}
	})

	// MIDI button
	midiBtn.addEventListener("click", async () => {
		if (runtime.midiEnabled) {
			runtime.disableMidi()
			midiBtn.classList.remove("active")
		} else {
			const ok = await runtime.enableMidi()
			midiBtn.classList.toggle("active", ok)
		}
	})

	// Play/Stop

	/**
	 * Collect automerge URL references from the model.
	 * These are objects whose text or params contain automerge:... URLs,
	 * used as PD abstractions (external .pd file references).
	 * Returns a map of { sanitizedFilename: automergeUrl }
	 */
	function collectAbstractionRefs() {
		const refs = new Map() // automergeUrl → sanitizedFilename
		const urlPattern = /^automerge:[a-zA-Z0-9]+$/
		for (const node of model.nodes) {
			// Check object text (e.g. [automerge:3amRY...])
			if (node.type === "obj" && node.text && urlPattern.test(node.text)) {
				if (!refs.has(node.text)) {
					refs.set(node.text, node.text.replace(":", "_") + ".pd")
				}
			}
			// Check params (e.g. [pd automerge:3amRY...])
			if (node.params) {
				for (const p of node.params) {
					if (urlPattern.test(p) && !refs.has(p)) {
						refs.set(p, p.replace(":", "_") + ".pd")
					}
				}
			}
		}
		return refs
	}

	// Cache of fetched abstraction content: automergeUrl → pdContent
	const abstractionCache = new Map()
	// Subscribed abstraction doc handles: automergeUrl → { handle, cleanup }
	const abstractionHandles = new Map()

	/**
	 * Fetch a single abstraction's .pd content from an automerge doc.
	 */
	async function fetchAbstractionContent(url) {
		if (abstractionCache.has(url)) return abstractionCache.get(url)
		try {
			const docHandle = await element.repo.find(url)
			const doc = docHandle.doc()
			let content = null
			let watchHandle = docHandle // the handle to subscribe to for changes

			if (doc && doc.content) {
				content = typeof doc.content === "string" ? doc.content : ""
			} else if (doc && doc.patch) {
				const fileHandle = await element.repo.find(doc.patch)
				const fileDoc = fileHandle.doc()
				if (fileDoc && fileDoc.content) {
					content = typeof fileDoc.content === "string" ? fileDoc.content : ""
					watchHandle = fileHandle // watch the file handle for content changes
				}
			}
			if (content !== null) {
				abstractionCache.set(url, content)
				pdDebug("puredata:editor", `loaded abstraction ${url}`)
			}

			// Subscribe to changes so we can update IO when the abstraction doc changes
			if (!abstractionHandles.has(url)) {
				const onChange = () => {
					// Invalidate cache and re-resolve
					abstractionCache.delete(url)
					resolveAbstractions()
				}
				watchHandle.on("change", onChange)
				abstractionHandles.set(url, { handle: watchHandle, cleanup: () => watchHandle.off("change", onChange) })
			}

			return content
		} catch (err) {
			console.warn(`Failed to load abstraction ${url}:`, err)
			return null
		}
	}

	/**
	 * Resolve all abstraction references in the model:
	 * fetch their content, count inlets/outlets, store on nodes.
	 */
	async function resolveAbstractions() {
		const refs = collectAbstractionRefs()
		if (refs.size === 0) return

		for (const [url] of refs) {
			const content = await fetchAbstractionContent(url)
			if (!content) continue

			// Count inlets/outlets in the abstraction
			const inlets = (content.match(/\bobj\s+\d+\s+\d+\s+inlet~?\b/g) || []).length
			const outlets = (content.match(/\bobj\s+\d+\s+\d+\s+outlet~?\b/g) || []).length

			// Store IO info on all nodes that reference this URL
			for (const node of model.nodes) {
				const isRef = (node.text === url) ||
					(node.text === "pd" && node.params && node.params.includes(url))
				if (isRef) {
					node.abstractionUrl = url
					node.abstractionIO = [inlets, outlets]
				}
			}
		}
		draw()
	}

	/**
	 * Collect abstraction files for playback.
	 * Returns { filename: pdContent } map for the runtime.
	 */
	async function loadAbstractions() {
		const refs = collectAbstractionRefs()
		if (refs.size === 0) return {}

		const extraFiles = {}
		for (const [url, filename] of refs) {
			const content = await fetchAbstractionContent(url)
			if (content !== null) {
				extraFiles[filename] = content
			}
		}
		return extraFiles
	}

	/**
	 * Send initial values for floatatoms and GUI objects with init flag
	 * after playback starts, so typed/saved values flow through the patch.
	 */
	function sendInitialValues() {
		const $0 = runtime.getDollarZero()
		for (let i = 0; i < model.nodes.length; i++) {
			const node = model.nodes[i]
			const state = guiState.get(i)
			if (!state) continue
			const val = state.value
			if (val === 0) continue // PD already starts at 0
			const recvName = resolveSymbol(getEffectiveReceive(node, i), $0)
			if (!recvName) continue

			if (node.type === "floatatom") {
				runtime.sendFloat(recvName, val)
			} else if (node.type === "tgl" || node.type === "hsl" || node.type === "vsl" || node.type === "nbx" || node.type === "hradio" || node.type === "vradio") {
				const gp = node.guiParams
				if (gp && gp.init) {
					// PD handles init natively, but send anyway to be safe
					runtime.sendFloat(recvName, val)
				}
			}
		}
	}

	async function startPlayback() {
		unbindGuiObjects()
		const content = serializeForPlayback()
		const extraFiles = await loadAbstractions()
		const ok = await runtime.play(content, extraFiles)
		if (ok) {
			bindGuiObjects()
			sendInitialValues()
			startArrayPolling()
		}
		playBtn.classList.toggle("active", ok)
		statusEl.textContent = ok ? "playing" : "play failed"
		return ok
	}

	playBtn.addEventListener("click", () => startPlayback())

	stopBtn.addEventListener("click", () => {
		unbindGuiObjects()
		runtime.stop()
		playBtn.classList.remove("active")
		statusEl.textContent = ""
		draw()
	})

	runtime.onStatusChange = () => {
		playBtn.classList.toggle("active", runtime.isPlaying)
		statusEl.textContent = runtime.isPlaying ? "playing" : ""
		if (!runtime.isPlaying) {
			unbindGuiObjects()
			draw()
		}
	}

	// ─── Document sync ───

	// Is this handle a file doc with .pd content? (UnixFileEntry)
	let isDirectFile = false

	async function loadFromDoc() {
		const doc = handle.doc()
		if (!doc) return

		// Detect if the handle IS a .pd file directly (UnixFileEntry shape)
		if (doc.content !== undefined && (doc.extension === "pd" || doc.mimeType === "text/x-puredata")) {
			isDirectFile = true
			patchHandle = handle
			model = parsePd(typeof doc.content === "string" ? doc.content : "")
			draw()
			resolveAbstractions()
			return
		}

		if (!doc.patch) {
			const fileHandle = await element.repo.create2({
				content: DEFAULT_PATCH,
				extension: "pd",
				mimeType: "text/x-puredata",
				name: "patch.pd",
			})
			handle.change((d) => {
				d.patch = fileHandle.url
			})
			patchHandle = fileHandle
			model = parsePd(DEFAULT_PATCH)
			draw()
			return
		}

		try {
			patchHandle = await element.repo.find(doc.patch)
			const fileDoc = patchHandle.doc()
			if (fileDoc && fileDoc.content) {
				model = parsePd(typeof fileDoc.content === "string" ? fileDoc.content : "")
			} else {
				model = parsePd(DEFAULT_PATCH)
			}
		} catch (err) {
			console.warn("Failed to load patch file:", err)
			model = parsePd(DEFAULT_PATCH)
		}
		restoreAtomValues()
		draw()
		resolveAbstractions()
	}

	let recompileTimer = null
	let saving = false

	function saveModel() {
		if (!patchHandle) return
		pushUndo()
		saving = true
		try {
			const content = serializePd(model)
			patchHandle.change((d) => {
				d.content = content
			})

			// Persist floatatom values to the main doc
			saveAtomValues()
		} finally {
			saving = false
		}

		// Hot-recompile: if playing, debounce and re-play
		if (runtime.isPlaying) {
			if (recompileTimer) clearTimeout(recompileTimer)
			recompileTimer = setTimeout(() => {
				recompileTimer = null
				startPlayback()
			}, 300)
		}
	}

	/**
	 * Save floatatom values to the automerge doc so they persist across reloads.
	 * Stored as { atomValues: { "nodeIndex": value } }
	 */
	function saveAtomValues() {
		const vals = {}
		let hasAny = false
		for (let i = 0; i < model.nodes.length; i++) {
			const node = model.nodes[i]
			if (node.type === "floatatom" && node.text && node.text !== "0" && node.text !== "") {
				vals[i] = Number(node.text) || 0
				hasAny = true
			}
		}
		handle.change((d) => {
			if (hasAny) {
			d.atomValues = vals
		} else if (d.atomValues) {
			delete d.atomValues
		}
		})
	}

	/**
	 * Restore floatatom values from the automerge doc after parsing.
	 */
	function restoreAtomValues() {
		const doc = handle.doc()
		if (!doc || !doc.atomValues) return
		for (const [idx, val] of Object.entries(doc.atomValues)) {
			const i = Number(idx)
			const node = model.nodes[i]
			if (node && node.type === "floatatom") {
				node.text = String(val)
			}
		}
	}

	function onPatchChange() {
		if (saving) return
		if (!patchHandle) return
		const fileDoc = patchHandle.doc()
		if (fileDoc && fileDoc.content) {
			const content = typeof fileDoc.content === "string" ? fileDoc.content : ""
			const currentContent = serializePd(model)
			if (content !== currentContent) {
				model = parsePd(content)
				restoreAtomValues()
				draw()
			}
		}
	}

	loadFromDoc()

	const onDocChange = () => {
		if (saving) return
		if (isDirectFile) {
			// Direct file doc — content changes arrive on this handle
			onPatchChange()
			return
		}
		const doc = handle.doc()
		if (doc && doc.patch && (!patchHandle || patchHandle.url !== doc.patch)) {
			loadFromDoc()
		}
	}
	handle.on("change", onDocChange)

	let patchChangeInterval = setInterval(() => {
		if (patchHandle && !isDirectFile) {
			patchHandle.off("change", onPatchChange)
			patchHandle.on("change", onPatchChange)
			clearInterval(patchChangeInterval)
		} else if (isDirectFile) {
			clearInterval(patchChangeInterval)
		}
	}, 500)

	// Cleanup
	return () => {
		unbindGuiObjects()
		runtime.destroy()
		handle.off("change", onDocChange)
		if (patchHandle) patchHandle.off("change", onPatchChange)
		clearInterval(patchChangeInterval)
		resizeObs.disconnect()
		root.removeEventListener("keydown", onKeyDown)
		root.removeEventListener("paste", onPaste)
		midiBtn.classList.remove("active")
		// Unsubscribe from abstraction doc handles
		for (const { cleanup } of abstractionHandles.values()) cleanup()
		abstractionHandles.clear()
		style.remove()
		root.remove()
	}
}
