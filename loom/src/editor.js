/**
 * Loom editor — write WITH the model and watch it think.
 *
 * A CodeMirror editor (modelled on patchwork-base/file) wired to @patchwork/llm:
 *  - As you type it predicts the next token and shows the candidates in a popup
 *    (probability bars). Tab/Enter inserts; the temperature slider LIVE-reshapes
 *    the distribution (pᵢ^(1/T), renormalised over the top-k) so you can see
 *    temperature work. The stats line shows confidence (top-prob + entropy).
 *  - Every model-inserted token is recorded with the alternatives it beat and
 *    underlined. Click INTO such a word to see those alternatives and BRANCH:
 *    pick one and the model re-generates the rest from that point.
 *  - "Continue ▶" streams a continuation from the caret, recording each token's
 *    alternatives so the whole tail is branchable.
 *
 * Trailing-space note: BPE tokenizers fold the space into the next token (" a"),
 * so predicting right after a typed space yields junk. We predict from the text
 * with trailing whitespace trimmed and drop the candidates' leading space, which
 * restores the natural distribution.
 */

import {EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration} from "@codemirror/view"
import {EditorState, Prec, StateField, StateEffect} from "@codemirror/state"
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import {popup as openModelPicker, predict, stream, readConfig, writeConfig, describeConfig, onStatus, subscribeConfig, migrateConfig} from "@patchwork/llm"

const STYLE_ID = "loom-styles"
// warm paper, soft borders, gentle shadows, pink + mint accents.
const CSS = `
/* the popup mounts on <body>, outside .loom-root, so it needs the vars too */
.loom-root, .loom-popup {
	--paper:#fdfbf7; --card:#fff; --ink:#34313a; --line:#ece3d7;
	--accent:#ff4d97; --accent-text:#fff; --accent-soft:#ffe9f1;
	--accent2:#58cfb0; --highlight:#fff6da; --dim:#918a96;
	--radius:12px; --radius-sm:9px; --shadow-sm:0 1px 3px rgba(52,49,58,.10);
}
.loom-root {
	display:flex; flex-direction:column; height:100%; color:var(--ink); background:var(--paper);
	font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
}
.loom-root *, .loom-root *::before, .loom-root *::after { box-sizing:border-box; }
.loom-bar { display:flex; align-items:center; gap:12px; padding:9px 14px; flex-wrap:wrap; border-bottom:1px solid var(--line); background:var(--card); }
.loom-model { display:flex; align-items:center; gap:6px; padding:6px 12px; cursor:pointer; font:inherit; font-weight:600; color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:var(--radius-sm); box-shadow:var(--shadow-sm); transition:background .12s, box-shadow .12s, transform .08s; }
.loom-model:hover { background:var(--highlight); box-shadow:0 2px 7px rgba(52,49,58,.12); }
.loom-model:active { transform:translateY(1px); }
.loom-knob { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; color:var(--dim); }
.loom-knob input[type=range] { width:90px; accent-color:var(--accent); }
.loom-knob b { color:var(--ink); font-weight:700; font-variant-numeric:tabular-nums; min-width:2.6em; }
.loom-go { padding:7px 15px; cursor:pointer; font:inherit; font-weight:600; border-radius:var(--radius-sm); color:var(--accent-text); background:var(--accent); border:1px solid transparent; box-shadow:var(--shadow-sm); transition:background .12s, box-shadow .12s, transform .08s; }
.loom-go:hover { background:#ff63a6; box-shadow:0 2px 7px rgba(52,49,58,.14); }
.loom-go:active { transform:translateY(1px); }
.loom-status { margin-left:auto; font-size:11px; font-weight:600; color:var(--dim); min-height:1em; max-width:40%; text-align:right; }
.loom-stats { display:flex; gap:16px; padding:7px 14px; font-size:11px; font-weight:600; color:var(--dim); border-bottom:1px solid var(--line); flex-wrap:wrap; font-variant-numeric:tabular-nums; }
.loom-stats b { color:var(--ink); }
.loom-editor { flex:1; min-height:0; overflow:auto; }
.loom-editor .cm-editor { height:100%; background:transparent; color:var(--ink); }
.loom-editor .cm-content { font:15px/1.9 ui-monospace,SFMono-Regular,Menlo,monospace; max-width:46rem; margin:18px auto; padding:0 22px; caret-color:var(--accent); }
.loom-editor .cm-scroller { overflow:auto; }
.loom-editor .cm-gutters { display:none; }
.loom-editor .cm-activeLine { background:transparent; }
.loom-mark { border-bottom:2px solid var(--accent); background:var(--accent-soft); }
.loom-mark:hover { background:var(--highlight); }

/* the popup mounts on <body> — hardcode colours so it never depends on inherited vars */
.loom-popup { position:fixed; z-index:2147483600; min-width:230px; max-width:340px; background:#fff; border:1px solid #ece3d7; border-radius:12px; box-shadow:0 10px 30px rgba(52,49,58,.22); padding:7px; font:13px/1.3 system-ui,sans-serif; color:#34313a; }
.loom-head { padding:2px 6px 7px; font-size:10px; font-weight:700; color:#918a96; text-transform:uppercase; letter-spacing:.5px; }
.loom-row { display:grid; grid-template-columns:92px 1fr 44px; align-items:center; gap:8px; padding:4px 7px; border-radius:9px; cursor:pointer; margin:1px 0; border:1px solid transparent; }
.loom-row .loom-tok { text-align:right; font-family:ui-monospace,Menlo,monospace; font-weight:600; font-size:12px; color:#34313a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.loom-track { height:14px; background:#f3eee6; border-radius:7px; overflow:hidden; }
.loom-fill { height:100%; background:#58cfb0; transition:width .12s; }
.loom-row.top .loom-fill { background:#ff4d97; }
.loom-row.top .loom-tok { font-weight:700; }
.loom-row.sel { background:#ffe9f1; border-color:#ff4d97; }
.loom-row .loom-pct { text-align:right; font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; color:#34313a; }
.loom-row.chosen .loom-tok::after { content:" ✓"; color:#ff4d97; }
.loom-hint { padding:5px 6px 1px; font-size:10px; color:#918a96; }
`

function injectStyles() {
	if (document.getElementById(STYLE_ID)) return
	const s = document.createElement("style")
	s.id = STYLE_ID
	s.textContent = CSS
	document.head.appendChild(s)
}

// p_i^(1/T) renormalised over the top-k — the temperature-adjusted distribution
// restricted to the candidates we have (exact within the top-k).
function reTemperature(cands, T) {
	if (!cands.length) return cands
	if (T <= 0.01) return cands.map((c, i) => ({...c, p: i === 0 ? 1 : 0}))
	const w = cands.map((c) => Math.pow(c.p, 1 / T))
	const sum = w.reduce((a, b) => a + b, 0)
	return cands.map((c, i) => ({...c, p: sum > 0 ? w[i] / sum : c.p}))
}

function entropyBits(cands) {
	let h = 0
	for (const c of cands) if (c.p > 0) h -= c.p * Math.log2(c.p)
	return h
}

function showToken(t) {
	return t.replace(/\n/g, "⏎").replace(/\t/g, "⇥").replace(/ /g, "·")
}

// ---- "mark" state: every model-inserted token + the alternatives it beat ----
const addMark = StateEffect.define()
const truncMarks = StateEffect.define() // drop marks whose `to` is >= the value

const marksField = StateField.define({
	create: () => [],
	update(marks, tr) {
		let next = marks
		if (tr.docChanged) {
			next = next
				.map((m) => ({
					...m,
					from: tr.changes.mapPos(m.from, 1),
					to: tr.changes.mapPos(m.to, -1),
				}))
				.filter((m) => m.to > m.from)
		}
		for (const e of tr.effects) {
			if (e.is(addMark)) next = [...next, e.value]
			else if (e.is(truncMarks)) next = next.filter((m) => m.to <= e.value)
		}
		return next
	},
})

const markDecorations = EditorView.decorations.compute([marksField], (state) => {
	const marks = [...state.field(marksField)].sort((a, b) => a.from - b.from || a.to - b.to)
	const ranges = []
	for (const m of marks) if (m.to > m.from) ranges.push(Decoration.mark({class: "loom-mark"}).range(m.from, m.to))
	return Decoration.set(ranges, true)
})

export function LoomTool(handle, element) {
	injectStyles()
	if (getComputedStyle(element).position === "static") element.style.position = "relative"

	const cfg0 = readConfig()
	const state = {
		config: cfg0, // active LLM config (resolved via patchwork:llm-config provider, else account doc)
		temperature: cfg0.temperature,
		topk: 8,
		lastRaw: [], // last predict() result (already de-spaced if needed), T=1
		streaming: false,
	}
	// popup: {mode:"predict"|"alt", items, sel, chosen, onPick, anchor, visible}
	const popup = {visible: false}

	// ---- DOM scaffold ----
	const root = el("div", {class: "loom-root"})
	const modelBtn = el("button", {class: "loom-model"}, ["🧠 ", el("span", {text: describeConfig(readConfig())})])
	const goBtn = el("button", {class: "loom-go", text: "Continue ▶"})
	const statusEl = el("span", {class: "loom-status"})
	const tempVal = el("b", {text: state.temperature.toFixed(2)})
	const tempRange = el("input", {type: "range", min: "0", max: "2", step: "0.05", value: String(state.temperature)})
	const bar = el("div", {class: "loom-bar"}, [
		modelBtn,
		// temperature reflects the panel's value (and live-reshapes the popup);
		// all other sampling params live in the model panel (🧠).
		el("label", {class: "loom-knob"}, ["🌡", tempRange, tempVal]),
		goBtn,
		statusEl,
	])
	const statTop = el("span", {}, ["next: ", el("b", {text: "—"})])
	const statEntropy = el("span", {}, ["entropy: ", el("b", {text: "—"})])
	const statLatency = el("span", {}, ["predict: ", el("b", {text: "—"})])
	const statSpeed = el("span", {}, ["speed: ", el("b", {text: "—"})])
	const stats = el("div", {class: "loom-stats"}, [statTop, statEntropy, statLatency, statSpeed])
	const editorHost = el("div", {class: "loom-editor"})
	root.append(bar, stats, editorHost)
	element.append(root)

	const popupEl = el("div", {class: "loom-popup"})
	popupEl.style.display = "none"
	document.body.append(popupEl)

	function hidePopup() {
		popup.visible = false
		popupEl.style.display = "none"
	}

	function openPopup(o) {
		Object.assign(popup, o, {visible: true, sel: o.sel ?? 0})
		renderPopup()
	}

	function renderPopup() {
		if (!popup.items?.length) return hidePopup()
		popupEl.replaceChildren()
		popupEl.append(
			el("div", {class: "loom-head", text: popup.mode === "alt" ? "alternatives here" : "next token"})
		)
		popup.items.forEach((c, i) => {
			const fill = el("div", {class: "loom-fill"})
			fill.style.width = Math.max(2, c.p * 100).toFixed(1) + "%"
			const cls =
				"loom-row" +
				(i === 0 ? " top" : "") +
				(i === popup.sel ? " sel" : "") +
				(popup.mode === "alt" && c.token === popup.chosen ? " chosen" : "")
			const row = el("div", {class: cls}, [
				el("span", {class: "loom-tok", text: showToken(c.token) || "∅"}),
				el("div", {class: "loom-track"}, [fill]),
				el("span", {class: "loom-pct", text: (c.p * 100).toFixed(1) + "%"}),
			])
			row.addEventListener("mousedown", (e) => {
				e.preventDefault()
				popup.sel = i
				popup.onPick(i)
			})
			popupEl.append(row)
		})
		popupEl.append(
			el("div", {
				class: "loom-hint",
				text: popup.mode === "alt" ? "↑↓ choose · ↵ branch from here · Esc" : "↑↓ choose · Tab insert · Esc",
			})
		)
		const coords = view.coordsAtPos(popup.anchor ?? view.state.selection.main.head)
		if (coords) {
			popupEl.style.left = Math.round(coords.left) + "px"
			popupEl.style.top = Math.round(coords.bottom + 6) + "px"
		}
		popupEl.style.display = "block"
		if (popup.mode === "predict") {
			statTop.lastChild.textContent =
				(showToken(popup.items[0].token) || "∅") + " " + (popup.items[0].p * 100).toFixed(0) + "%"
			statEntropy.lastChild.textContent = entropyBits(popup.items).toFixed(2) + " bits"
		}
	}

	function move(d) {
		if (!popup.visible) return
		popup.sel = Math.max(0, Math.min(popup.items.length - 1, popup.sel + d))
		renderPopup()
	}
	function activate() {
		if (popup.visible) popup.onPick(popup.sel)
	}

	// ---- forward prediction (debounced) ----
	let timer = null
	let abortCtl = null
	function schedule() {
		clearTimeout(timer)
		timer = setTimeout(tick, 200)
	}
	function markStrictlyAt(pos) {
		// caret inside a marked token (not merely at its trailing edge) → show alts
		const marks = view.state.field(marksField)
		return marks.find((m) => pos > m.from && pos < m.to)
	}
	function markOverlapping(from, to) {
		return view.state.field(marksField).find((m) => from < m.to && to > m.from)
	}
	async function tick() {
		if (state.streaming) return hidePopup()
		const sel = view.state.selection.main
		// selection (or caret) inside a model-authored token → alternatives panel
		const mark =
			sel.from !== sel.to ? markOverlapping(sel.from, sel.to) : markStrictlyAt(sel.head)
		if (mark) {
			openPopup({
				mode: "alt",
				items: mark.alts,
				chosen: mark.chosen,
				anchor: mark.from,
				onPick: (i) => branch(mark, mark.alts[i]),
			})
			return
		}
		if (sel.from !== sel.to) return hidePopup() // a non-marked selection: nothing to predict
		// forward prediction (with the trailing-space fix)
		if (abortCtl) abortCtl.abort()
		abortCtl = new AbortController()
		const before = view.state.sliceDoc(0, sel.head)
		const trimmed = before.replace(/[ \t]+$/, "")
		const hadTrailing = trimmed.length < before.length
		const t0 = performance.now()
		try {
			let cands = await predict(trimmed, {continuation: true, topk: state.topk, config: state.config, signal: abortCtl.signal})
			statLatency.lastChild.textContent = Math.round(performance.now() - t0) + " ms"
			if (hadTrailing) cands = cands.map((c) => ({...c, token: c.token.replace(/^ /, "")}))
			cands = cands.filter((c) => c.token.length)
			state.lastRaw = cands
			if (!cands.length) return hidePopup()
			openPredictPopup()
		} catch (e) {
			if (e.name !== "AbortError") hidePopup()
		}
	}
	function openPredictPopup() {
		openPopup({
			mode: "predict",
			items: reTemperature(state.lastRaw, state.temperature),
			anchor: view.state.selection.main.head,
			onPick: (i) => insertPredicted(i),
		})
	}
	function insertPredicted(i) {
		const tok = state.lastRaw[i]?.token
		if (tok == null) return hidePopup()
		const head = view.state.selection.main.head
		view.dispatch({
			changes: {from: head, insert: tok},
			selection: {anchor: head + tok.length},
			effects: addMark.of({from: head, to: head + tok.length, chosen: tok, alts: state.lastRaw.slice()}),
			scrollIntoView: true,
		})
		hidePopup()
		schedule()
	}

	// ---- branch: replace from a mark to the end, then regenerate ----
	async function branch(mark, alt) {
		hidePopup()
		const docEnd = view.state.doc.length
		view.dispatch({
			changes: {from: mark.from, to: docEnd, insert: alt.token},
			selection: {anchor: mark.from + alt.token.length},
			effects: [
				truncMarks.of(mark.from),
				addMark.of({from: mark.from, to: mark.from + alt.token.length, chosen: alt.token, alts: mark.alts}),
			],
			scrollIntoView: true,
		})
		await continueFrom(view.state.selection.main.head)
	}

	// ---- streaming continuation, recording each token's alternatives ----
	let streamAbort = null
	async function continueFrom(pos) {
		if (state.streaming) return
		state.streaming = true
		hidePopup()
		goBtn.textContent = "■ Stop"
		streamAbort = new AbortController()
		let pending = null
		let at = pos
		const text = view.state.sliceDoc(0, pos)
		try {
			for await (const ev of stream(text, {
				continuation: true, // continue the text (not chat) — frames chat-only models
				topk: state.topk,
				temperature: state.temperature,
				maxNewTokens: 120,
				config: state.config,
				signal: streamAbort.signal,
			})) {
				if (ev.type === "prediction") pending = ev.candidates
				else if (ev.type === "token") {
					const tok = ev.delta
					const from = at
					const to = from + tok.length
					view.dispatch({
						changes: {from, insert: tok},
						selection: {anchor: to},
						effects: pending ? addMark.of({from, to, chosen: tok, alts: pending}) : [],
						scrollIntoView: true,
					})
					at = to
					pending = null
				} else if (ev.type === "stats") updateGenStats(ev)
				else if (ev.type === "status") statusEl.textContent = ev.message || ""
			}
		} catch (e) {
			/* aborted or errored — leave what we have */
		}
		state.streaming = false
		goBtn.textContent = "Continue ▶"
		statusEl.textContent = ""
		schedule()
	}
	function updateGenStats(s) {
		if (s.tokPerSec) statSpeed.lastChild.textContent = s.tokPerSec + " tok/s"
		if (s.ttftMs != null) statLatency.lastChild.textContent = s.ttftMs + " ms ttft"
	}

	// ---- CodeMirror ----
	const theme = EditorView.theme(
		{
			"&": {height: "100%", backgroundColor: "transparent", color: "var(--ink)"},
			".cm-gutters": {display: "none"},
			".cm-activeLine": {backgroundColor: "transparent"},
			".cm-cursor": {borderLeftColor: "var(--accent)", borderLeftWidth: "2px"},
			".cm-selectionBackground": {background: "#ffd0e4"},
			"&.cm-focused .cm-selectionBackground": {background: "#ffbcd8"},
		},
		{dark: false}
	)
	const popupKeys = Prec.highest(
		keymap.of([
			{key: "ArrowDown", run: () => (popup.visible ? (move(1), true) : false)},
			{key: "ArrowUp", run: () => (popup.visible ? (move(-1), true) : false)},
			{key: "Tab", run: () => (popup.visible ? (activate(), true) : false)},
			{key: "Enter", run: () => (popup.visible ? (activate(), true) : false)},
			{key: "Escape", run: () => (popup.visible ? (hidePopup(), true) : false)},
		])
	)
	const watcher = EditorView.updateListener.of((u) => {
		if (state.streaming) return
		if (u.docChanged || u.selectionSet) {
			hidePopup()
			schedule()
		}
	})

	const view = new EditorView({
		state: EditorState.create({
			doc: handle.doc()?.content?.toString() || "",
			extensions: [
				popupKeys,
				lineNumbers(),
				highlightActiveLine(),
				drawSelection(),
				history(),
				EditorView.lineWrapping,
				keymap.of([...defaultKeymap, ...historyKeymap]),
				theme,
				marksField,
				markDecorations,
				watcher,
				automergeSyncPlugin({handle, path: ["content"]}),
			],
		}),
		parent: editorHost,
	})

	// ---- controls ----
	tempRange.addEventListener("input", () => {
		state.temperature = +tempRange.value
		tempVal.textContent = state.temperature.toFixed(2)
		if (popup.visible && popup.mode === "predict") openPredictPopup() // live reshape
	})
	tempRange.addEventListener("change", () => {
		try {
			writeConfig({temperature: state.temperature})
		} catch {}
	})
	goBtn.addEventListener("click", () => {
		if (state.streaming) streamAbort?.abort()
		else continueFrom(view.state.selection.main.head)
	})
	modelBtn.addEventListener("click", async () => {
		const picker = openModelPicker()
		element.appendChild(picker)
		picker.showPopover()
		await picker.result
		modelBtn.lastChild.textContent = describeConfig(readConfig())
		schedule()
	})

	// One-time: migrate any legacy llm.tools / systemPrompts / prePrompts arrays
	// into folder docs. Idempotent; writes the account doc → subscribeConfig
	// picks up the new shape.
	migrateConfig().catch((e) => console.warn("[loom] config migration:", e))

	const offStatus = onStatus((m) => {
		if (!state.streaming) statusEl.textContent = m || ""
	})
	// Resolve the active config via the patchwork:llm-config provider (account-doc
	// fallback) and stay live as it changes.
	const offConfig = subscribeConfig(element, (cfg) => {
		state.config = cfg
		modelBtn.lastChild.textContent = describeConfig(cfg)
		if (document.activeElement !== tempRange) {
			state.temperature = cfg.temperature
			tempRange.value = String(cfg.temperature)
			tempVal.textContent = cfg.temperature.toFixed(2)
		}
	})
	const reposition = () => {
		if (popup.visible) renderPopup()
	}
	editorHost.addEventListener("scroll", reposition, true)
	window.addEventListener("resize", reposition)

	return () => {
		clearTimeout(timer)
		abortCtl?.abort()
		streamAbort?.abort()
		offStatus()
		offConfig()
		editorHost.removeEventListener("scroll", reposition, true)
		window.removeEventListener("resize", reposition)
		view.destroy()
		popupEl.remove()
		root.remove()
	}
}

function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") node.className = v
		else if (k === "text") node.textContent = v
		else if (v != null) node.setAttribute(k, v)
	}
	for (const c of [].concat(children)) {
		if (c == null) continue
		node.append(c.nodeType ? c : document.createTextNode(String(c)))
	}
	return node
}
