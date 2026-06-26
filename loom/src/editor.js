/**
 * Loom editor — write WITH the model and watch it think.
 *
 * A CodeMirror editor (modelled on patchwork-base/file) wired to @patchwork/llm:
 *  - As you type it predicts the next token and shows the candidates in a popup
 *    (probability bars). Tab/Enter inserts; the sidebar controls LIVE-reshape
 *    the distribution so you can see temperature/top-p/min-p/repetition-penalty
 *    work. The stats line shows confidence (perplexity + spread).
 *  - Every model-inserted token is recorded with the alternatives it beat and
 *    underlined. Click INTO such a word to see those alternatives and BRANCH:
 *    pick one and the model re-generates the rest from that point.
 *  - The inline ▶ button (or ⌘⏎) streams a continuation from the caret,
 *    recording each token's alternatives so the whole tail is branchable.
 *  - The Display section offers switchable overlays, each a per-token quantity
 *    (see the reference block by the overlay system for the paper each is
 *    grounded in):
 *      Importance: erasure-based saliency, leave-one-out (white→pink)
 *      Surprisal:  −log₂ p of the token you wrote, in bits (white→teal)
 *      Info Gain:  drop in next-token entropy, max(0, H_i − H_{i+1}) (white→green)
 *      Uncertainty: next-token entropy H_t at each position (white→amber)
 *      Typicality: |surprisal − H_t|, distance from the local average (white→purple)
 *      Attention:  the model's real softmax attention weights, if it exports
 *                  them, with layer/head/view controls (yellow→blue)
 *    A sparkline under the stats row plots the active overlay's value across the
 *    whole document, and a "bits" stat shows the model's average surprisal
 *    (= cross-entropy = the compression rate of your prose, in bits/token).
 *
 * Trailing-space note: BPE tokenizers fold the space into the next token (" a"),
 * so predicting right after a typed space yields junk. We predict from the text
 * with trailing whitespace trimmed and drop the candidates' leading space, which
 * restores the natural distribution.
 */

import {EditorView, keymap, drawSelection, Decoration} from "@codemirror/view"
import {EditorState, Prec, StateField, StateEffect} from "@codemirror/state"
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import {popup as openModelPicker, predict, stream, readConfig, writeConfig, describeConfig, onStatus, subscribeConfig, migrateConfig, computeImportance, computeAttentionWeights, scoreTokens} from "@patchwork/llm"

const STYLE_ID = "loom-styles"
const CSS = `
@layer package {
:root,
:host,
[theme] {
	--loom-bg: var(--studio-fill, white);
	--loom-fg: var(--studio-line, #34313a);
	--loom-border: var(--studio-fill-offset-20, #ece3d7);
	--loom-accent: var(--studio-primary, #ff4d97);
	--loom-accent-fg: var(--studio-fill, white);
	--loom-accent-soft: color-mix(in oklch, var(--loom-accent), var(--loom-bg) 85%);
	--loom-accent-hover: color-mix(in oklch, var(--loom-accent), var(--loom-bg) 20%);
	--loom-accent2: var(--studio-secondary, #58cfb0);
	--loom-highlight: color-mix(in oklch, var(--loom-bg), var(--studio-warning, #fde68a) 20%);
	--loom-muted: var(--studio-line-offset-50, #918a96);
	--loom-shadow: var(--studio-shadow-sm, 0 1px 3px rgba(52,49,58,.10));
	--loom-popup-shadow: var(--studio-shadow-lg, 0 10px 30px rgba(52,49,58,.22));
	--loom-family: var(--studio-family-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif);
	--loom-family-code: var(--studio-family-code, ui-monospace, monospace);
	--loom-track-bg: var(--studio-fill-offset-10, #f3eee6);
	--loom-switch-off: var(--studio-fill-offset-30, #d4cfc7);
}
}

.loom-root {
	display:flex; flex-direction:column; height:100%; color:var(--loom-fg); background:var(--studio-fill-offset-10, #f3eee6);
	font-family:var(--loom-family); font-size:14px; line-height:1.5;
}
.loom-root *, .loom-root *::before, .loom-root *::after { box-sizing:border-box; }
.loom-status { font-size:11px; font-weight:600; color:var(--loom-muted); min-height:1em; text-align:right; }
.loom-stats { display:flex; align-items:center; gap:16px; padding:7px 14px; font-size:11px; font-weight:600; color:var(--loom-muted); border-bottom:1px solid var(--loom-border); flex-wrap:wrap; font-variant-numeric:tabular-nums; }
.loom-stats b { color:var(--loom-fg); }
.loom-stats-right { margin-left:auto; display:flex; align-items:center; gap:8px; }
.loom-sidebar-toggle { display:flex; align-items:center; justify-content:center; width:24px; height:24px; cursor:pointer; font-size:14px; color:var(--loom-muted); background:none; border:1px solid transparent; border-radius:var(--studio-radius-sm, 4px); padding:0; transition:color .12s; }
.loom-sidebar-toggle:hover { color:var(--loom-fg); }
.loom-sidebar-toggle[data-open] { color:var(--loom-accent); }

/* body: editor + floating sidebar */
.loom-body { display:flex; flex:1; min-height:0; position:relative; }
.loom-editor { flex:1; min-height:0; min-width:0; overflow:auto; background:var(--loom-bg); box-shadow:0 1px 6px rgba(0,0,0,.1); z-index:1; }
.loom-editor .cm-content { max-width:46rem; padding:18px 22px 0; }
.loom-editor .cm-scroller { overflow:auto; }
/* "model predicted this" marker: a pink underline only — no background, so it
   composes with (rather than fights) the colored overlay highlights. */
.loom-mark { border-bottom:2px solid var(--loom-accent); }
.loom-mark:hover { border-bottom-color:var(--loom-accent-hover); }
.loom-mark.loom-attn { border-bottom:none; cursor:default; }
.loom-mark.loom-attn:hover { filter:brightness(0.95); }

/* inline continue widget — subtle cursor-following arrow */
.loom-continue-widget { display:inline; margin-left:1px; font-size:11px; color:var(--loom-muted); background:none; border:none; cursor:pointer; vertical-align:baseline; opacity:0.3; transition:opacity .12s, color .12s; padding:0; }
.loom-continue-widget:hover { opacity:1; color:var(--loom-accent); }
.loom-continue-widget.streaming { color:var(--loom-accent); opacity:0.8; }
.loom-continue-widget.streaming:hover { color:var(--loom-fg); }

/* floating sidebar */
.loom-sidebar { position:absolute; right:12px; top:12px; bottom:12px; width:240px; background:var(--loom-bg); border-radius:var(--studio-radius-lg, 12px); box-shadow:var(--loom-popup-shadow); overflow-y:auto; padding:16px; z-index:10; }
.loom-sidebar[data-hidden] { display:none; }
.loom-section { padding:10px 0 6px; font-size:9px; font-weight:800; color:var(--loom-muted); text-transform:uppercase; letter-spacing:.6px; }
.loom-section:not(:first-child) { border-top:1px solid var(--loom-border); margin-top:10px; }
.loom-model { display:flex; align-items:center; gap:6px; width:100%; padding:8px 10px; cursor:pointer; font:inherit; font-size:12px; font-weight:600; color:var(--loom-fg); background:var(--loom-bg); border:1px solid var(--loom-border); border-radius:var(--studio-radius-md, 9px); box-shadow:var(--loom-shadow); transition:background .12s; text-align:left; }
.loom-model:hover { background:var(--loom-highlight); }
.loom-model:active { transform:translateY(1px); }
.loom-ctrl { padding:6px 0; }
.loom-ctrl-head { display:flex; align-items:center; justify-content:flex-start; gap:4px; }
.loom-ctrl-label { font-size:11px; font-weight:700; color:var(--loom-fg); }
.loom-ctrl-val { font-size:11px; font-weight:700; color:var(--loom-fg); font-variant-numeric:tabular-nums; min-width:2.6em; text-align:right; margin-left:auto; }
.loom-ctrl-emoji { font-size:14px; line-height:1; }
.loom-ctrl-desc { font-size:10px; color:var(--loom-muted); line-height:1.35; margin-top:2px; }
.loom-ctrl input[type=range] { width:100%; accent-color:var(--loom-accent2); margin:4px 0 0; }
.loom-ctrl input[type=number] { width:100%; margin:4px 0 0; padding:4px 8px; border:1px solid var(--loom-border); border-radius:6px; font:inherit; font-size:11px; background:var(--loom-bg); color:var(--loom-fg); }
.loom-ctrl input[type=number]:focus { outline:2px solid var(--loom-accent2); outline-offset:-1px; }
.loom-switch-row { display:flex; align-items:center; gap:8px; padding:8px 0; }
.loom-switch-label { font-size:11px; font-weight:700; color:var(--loom-fg); flex:1; }
.loom-switch { position:relative; width:36px; height:20px; flex-shrink:0; }
.loom-switch input { opacity:0; width:0; height:0; position:absolute; }
.loom-switch .slider { position:absolute; inset:0; background:var(--loom-switch-off); border-radius:10px; transition:.2s; cursor:pointer; }
.loom-switch .slider::before { content:""; position:absolute; width:16px; height:16px; left:2px; bottom:2px; background:var(--loom-bg); border-radius:50%; transition:.2s; }
.loom-switch input:checked + .slider { background:var(--loom-accent); }
.loom-switch input:checked + .slider::before { transform:translateX(16px); }
.loom-overlay-row { display:flex; gap:4px; padding:6px 0; flex-wrap:wrap; }
.loom-overlay-btn { font:inherit; font-size:10px; font-weight:600; padding:3px 8px; border:1px solid var(--loom-border); border-radius:6px; background:var(--loom-bg); color:var(--loom-muted); cursor:pointer; transition:all .12s; }
.loom-overlay-btn:hover { color:var(--loom-fg); border-color:var(--loom-fg); }
.loom-overlay-btn.active { background:var(--loom-accent); color:var(--loom-accent-fg); border-color:var(--loom-accent); }

/* attention config (layer / head / view selectors) — shown under the overlay
   row only while the attention overlay is active */
.loom-attn-cfg { padding:4px 0 2px; }
.loom-attn-cfg[data-hidden] { display:none; }
.loom-select-row { display:flex; align-items:center; gap:8px; padding:5px 0; }
.loom-select-label { font-size:11px; font-weight:700; color:var(--loom-fg); flex:1; }
.loom-select { font:inherit; font-size:11px; font-weight:600; color:var(--loom-fg); background:var(--loom-bg); border:1px solid var(--loom-border); border-radius:6px; padding:3px 6px; max-width:55%; cursor:pointer; }
.loom-select:focus { outline:2px solid var(--loom-accent2); outline-offset:-1px; }
.loom-attn-note { font-size:10px; color:var(--loom-muted); line-height:1.35; padding:2px 0; }

/* sparkline — per-token trajectory of the active overlay, under the stats row */
.loom-spark { position:relative; height:34px; border-bottom:1px solid var(--loom-border); background:var(--loom-bg); overflow:hidden; }
.loom-spark[data-hidden] { display:none; }
.loom-spark svg { display:block; width:100%; height:30px; }
.loom-spark-label { position:absolute; right:6px; top:2px; font-size:9px; font-weight:700; color:var(--loom-muted); text-transform:uppercase; letter-spacing:.4px; background:color-mix(in oklch, var(--loom-bg), transparent 25%); padding:0 4px; border-radius:3px; pointer-events:none; }

/* explainer panel — under the text, shown while an overlay is active */
.loom-panel { padding:10px 16px 12px; border-top:1px solid var(--loom-border); background:var(--loom-bg); font-size:12px; line-height:1.5; max-height:38%; overflow-y:auto; }
.loom-panel[data-hidden] { display:none; }
.loom-panel-title { font-size:13px; font-weight:800; color:var(--loom-fg); margin-bottom:6px; display:flex; align-items:center; gap:7px; }
.loom-panel-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; display:inline-block; }
.loom-panel-sec { margin:4px 0; color:var(--loom-fg); }
.loom-panel-papers { margin:4px 0 0; padding-left:18px; }
.loom-panel-papers li { margin:2px 0; color:var(--loom-muted); }
.loom-panel-papers a { color:var(--loom-accent2); text-decoration:none; }
.loom-panel-papers a:hover { text-decoration:underline; }
.loom-panel-footer { margin-top:8px; padding-top:6px; border-top:1px dashed var(--loom-border); font-size:11px; color:var(--loom-muted); }

/* popup — mounts on <body>, outside .loom-root */
.loom-popup { position:fixed; z-index:2147483600; min-width:230px; max-width:340px; background:var(--loom-bg); border:1px solid var(--loom-border); border-radius:var(--studio-radius-lg, 12px); box-shadow:var(--loom-popup-shadow); padding:7px; font-family:var(--loom-family); font-size:13px; line-height:1.3; color:var(--loom-fg); }
.loom-head { padding:2px 6px 7px; font-size:10px; font-weight:700; color:var(--loom-muted); text-transform:uppercase; letter-spacing:.5px; }
.loom-row { display:grid; grid-template-columns:92px 1fr 44px; align-items:center; gap:8px; padding:4px 7px; border-radius:var(--studio-radius-md, 9px); cursor:pointer; margin:1px 0; border:1px solid transparent; }
.loom-row .loom-tok { text-align:right; font-family:var(--loom-family-code); font-weight:600; font-size:12px; color:var(--loom-fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.loom-track { height:14px; background:var(--loom-track-bg); border-radius:7px; overflow:hidden; }
.loom-fill { height:100%; background:var(--loom-accent2); transition:width .12s; }
.loom-row.top .loom-fill { background:var(--loom-accent); }
.loom-row.top .loom-tok { font-weight:700; }
.loom-row.sel { background:var(--loom-accent-soft); border-color:var(--loom-accent); }
.loom-row .loom-pct { text-align:right; font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--loom-fg); }
.loom-row.chosen .loom-tok::after { content:" \\2713"; color:var(--loom-accent); }
.loom-hint { padding:5px 6px 1px; font-size:10px; color:var(--loom-muted); }
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
	const w = cands.map((c) => Math.pow(Number.isFinite(c.p) ? c.p : 0, 1 / T))
	const sum = w.reduce((a, b) => a + b, 0)
	return cands.map((c, i) => ({...c, p: sum > 0 ? w[i] / sum : 1 / cands.length}))
}

// Client-side top-p and min-p filters: applied after temperature reshaping so
// the popup shows only the candidates that would survive sampling.
function applySamplingFilters(cands, config) {
	let items = cands
	const minP = config.minP ?? 0
	if (minP > 0 && items.length) {
		const maxProb = items[0].p
		items = items.filter((c) => c.p >= minP * maxProb)
	}
	const topP = config.topP ?? 1
	if (topP < 1 && items.length) {
		let cum = 0
		const kept = []
		for (const c of items) {
			kept.push(c)
			cum += c.p
			if (cum >= topP) break
		}
		items = kept
	}
	return items
}

// Client-side penalty simulation: repetition (p^penalty), frequency (proportional
// to count), and presence (binary appeared-or-not). All three reshape the popup
// bars live as you drag the sliders.
function applyPenalties(cands, text, config) {
	const rep = config.repetitionPenalty ?? 1
	const freq = config.frequencyPenalty ?? 0
	const pres = config.presencePenalty ?? 0
	if (rep <= 1 && !freq && !pres) return cands
	if (!text || !cands.length) return cands
	const lower = text.toLowerCase()
	const adjusted = cands.map((c) => {
		const tok = c.token.trim().toLowerCase()
		if (!tok) return c
		let count = 0, idx = -1
		while ((idx = lower.indexOf(tok, idx + 1)) !== -1) count++
		if (count === 0) return c
		let p = c.p
		if (rep > 1) p = Math.pow(p, rep)
		if (pres) p *= Math.exp(-Math.abs(pres))
		if (freq) p *= Math.exp(-Math.abs(freq) * count)
		return {...c, p}
	})
	const sum = adjusted.reduce((a, c) => a + c.p, 0)
	if (sum <= 0) return cands
	return adjusted.map((c) => ({...c, p: c.p / sum})).sort((a, b) => b.p - a.p)
}

function entropyBits(cands) {
	let h = 0
	for (const c of cands) if (c.p > 0 && Number.isFinite(c.p)) h -= c.p * Math.log2(c.p)
	return Number.isFinite(h) ? h : 0
}

function showToken(t) {
	return t.replace(/\n/g, "\u23CE").replace(/\t/g, "\u21E5").replace(/ /g, "\u00B7")
}

// Attention uses the field-standard yellow→blue heatmap (ColorBrewer YlGnBu):
// low weight = pale yellow, high weight = deep blue, the way attention maps are
// drawn in the literature (e.g. BertViz, "Attention is not Explanation").
const ATTN_STOPS = [
	[0.0, [255, 247, 200]],
	[0.35, [199, 233, 180]],
	[0.6, [120, 198, 190]],
	[0.8, [73, 150, 205]],
	[1.0, [44, 90, 185]],
]
function ylgnbu(t) {
	t = Math.max(0, Math.min(1, t))
	for (let i = 1; i < ATTN_STOPS.length; i++) {
		const [t1, c1] = ATTN_STOPS[i]
		const [t0, c0] = ATTN_STOPS[i - 1]
		if (t <= t1) {
			const f = (t - t0) / (t1 - t0 || 1)
			return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},${Math.round(c0[1] + (c1[1] - c0[1]) * f)},${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`
		}
	}
	const c = ATTN_STOPS[ATTN_STOPS.length - 1][1]
	return `rgb(${c[0]},${c[1]},${c[2]})`
}

// Overlay styles: white → accent color based on mode.
function overlayStyle(mode, p) {
	const t = Math.max(0, Math.min(1, p))
	let r, g, b
	if (mode === "attention") {
		return "background:" + ylgnbu(t)
	} else if (mode === "importance") {
		// white → pink (--loom-accent)
		r = Math.round(255 * (1 - t) + 255 * t)
		g = Math.round(255 * (1 - t) + 77 * t)
		b = Math.round(255 * (1 - t) + 151 * t)
	} else if (mode === "surprisal") {
		// white → teal (--loom-accent2)
		r = Math.round(255 * (1 - t) + 88 * t)
		g = Math.round(255 * (1 - t) + 207 * t)
		b = Math.round(255 * (1 - t) + 176 * t)
	} else if (mode === "entropy") {
		// white → amber (uncertainty / heat)
		r = Math.round(255 * (1 - t) + 245 * t)
		g = Math.round(255 * (1 - t) + 158 * t)
		b = Math.round(255 * (1 - t) + 11 * t)
	} else if (mode === "typicality") {
		// white → purple (atypical)
		r = Math.round(255 * (1 - t) + 150 * t)
		g = Math.round(255 * (1 - t) + 100 * t)
		b = Math.round(255 * (1 - t) + 220 * t)
	} else {
		// gain: white → green
		r = Math.round(255 * (1 - t) + 80 * t)
		g = Math.round(255 * (1 - t) + 200 * t)
		b = Math.round(255 * (1 - t) + 120 * t)
	}
	return `background:rgb(${r},${g},${b})`
}

// Full-intensity accent color per overlay — used by the sparkline fill.
const OVERLAY_ACCENT = {
	importance: "rgb(255,77,151)",
	surprisal: "rgb(88,207,176)",
	gain: "rgb(80,200,120)",
	entropy: "rgb(245,158,11)",
	typicality: "rgb(150,100,220)",
	attention: "rgb(56,120,200)",
}
function overlayAccent(mode) {
	return OVERLAY_ACCENT[mode] || "rgb(150,150,150)"
}

function tempEmoji(t) {
	if (t <= 0.15) return "\uD83E\uDDCA" // 🧊
	if (t <= 0.4) return "\uD83E\uDD76"  // 🥶
	if (t <= 1.0) return "\uD83D\uDE10"  // 😐
	if (t <= 1.6) return "\uD83D\uDE13"  // 😓
	if (t < 1.9) return "\uD83E\uDD75"   // 🥵
	return "\uD83D\uDD25"                // 🔥 (1.9+)
}

// ---- "mark" state: every model-inserted token + the alternatives it beat ----
const addMark = StateEffect.define()
const truncMarks = StateEffect.define() // drop marks whose `to` is >= the value
const clearScoredMarks = StateEffect.define() // drop all marks with scored:true
const setOverlay = StateEffect.define()    // null | "importance" | "surprisal" | "gain"
const setStreaming = StateEffect.define()

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
			else if (e.is(clearScoredMarks)) next = next.filter((m) => !m.scored)
		}
		return next
	},
})

const overlayField = StateField.define({
	create: () => null,
	update(mode, tr) {
		for (const e of tr.effects) if (e.is(setOverlay)) return e.value
		return mode
	},
})

const streamingField = StateField.define({
	create: () => false,
	update(on, tr) {
		for (const e of tr.effects) if (e.is(setStreaming)) return e.value
		return on
	},
})

const markDecorations = EditorView.decorations.compute([marksField, overlayField], (state) => {
	const marks = [...state.field(marksField)].sort((a, b) => a.from - b.from || a.to - b.to)
	const overlay = state.field(overlayField)
	const ranges = []
	for (const m of marks) {
		if (m.to <= m.from) continue
		// Scored marks only visible when an overlay is active.
		if (m.scored && !overlay) continue
		if (m.scored && overlay) {
			const prob = m.exactP ?? 0
			ranges.push(
				Decoration.mark({
					class: "loom-mark loom-attn",
					attributes: {style: overlayStyle(overlay, prob)},
				}).range(m.from, m.to)
			)
		} else if (!m.scored) {
			ranges.push(Decoration.mark({class: "loom-mark"}).range(m.from, m.to))
		}
	}
	return Decoration.set(ranges, true)
})

export function LoomTool(handle, element) {
	injectStyles()
	if (getComputedStyle(element).position === "static") element.style.position = "relative"

	// Merge global config (model/provider/key) with per-doc sampling params.
	// Doc config overrides global for sampling keys; global serves as defaults.
	const SAMPLING_KEYS = ["temperature", "topP", "minP", "repetitionPenalty", "frequencyPenalty", "presencePenalty", "maxTokens"]
	const globalCfg = readConfig()
	const docCfg = handle.doc()?.config || {}
	const cfg0 = {...globalCfg}
	for (const key of SAMPLING_KEYS) {
		if (docCfg[key] != null) cfg0[key] = docCfg[key]
	}
	// Overlays that derive from the per-token score pass (surprisal, gain,
	// entropy, typicality) plus the erasure-based importance overlay. Centralised
	// so the cache reset and the cache literal can't drift out of sync.
	const OVERLAY_KEYS = ["importance", "surprisal", "gain", "entropy", "typicality", "attention"]
	const freshOverlayCache = () => Object.fromEntries(OVERLAY_KEYS.map((k) => [k, null]))

	const state = {
		config: cfg0,
		temperature: cfg0.temperature,
		topk: docCfg.topk ?? 8,
		lastRaw: [],
		streaming: false,
		overlay: docCfg.overlay || null,
		overlayCache: freshOverlayCache(),
		scoreDataCache: null,
		sidebarOpen: docCfg.sidebarOpen !== false, // default open
		// Attention overlay: layer/head/view selection + cached raw weights.
		// layer/head are "mean" or an integer; view is "received" | "fromLast".
		attn: {
			layer: docCfg.attention?.layer ?? "mean",
			head: docCfg.attention?.head ?? "mean",
			view: docCfg.attention?.view ?? "received",
		},
		attnRaw: null,      // {text, dims, received, fromLast, spans, tokens, decoded}
		attnDims: null,     // {layers, heads, seq} once a pass has run
		attnSupported: null, // null=unknown, true/false after a pass
		attnNote: "",       // why attention is unavailable (shown in the panel)
	}
	const popup = {visible: false}

	// ---- helpers for sidebar controls ----
	const refs = {}

	function makeRange(name, label, desc, {min, max, step, value, emoji}, onChange) {
		const fmt = +step < 1 ? (v) => (+v).toFixed(String(step).split(".")[1]?.length || 2) : (v) => String(Math.round(+v))
		const valEl = el("span", {class: "loom-ctrl-val", text: fmt(value)})
		const emojiEl = emoji ? el("span", {class: "loom-ctrl-emoji", text: emoji(+value)}) : null
		const input = el("input", {type: "range", min, max, step, value: String(value)})
		input.addEventListener("input", () => {
			valEl.textContent = fmt(input.value)
			if (emojiEl && emoji) emojiEl.textContent = emoji(+input.value)
			onChange(+input.value, false)
		})
		input.addEventListener("change", () => onChange(+input.value, true))
		refs[name] = {input, valEl, fmt, emojiEl, emoji}
		const headChildren = []
		if (emojiEl) headChildren.push(emojiEl)
		headChildren.push(el("span", {class: "loom-ctrl-label", text: label}))
		headChildren.push(valEl)
		return el("div", {class: "loom-ctrl"}, [
			el("div", {class: "loom-ctrl-head"}, headChildren),
			input,
			el("div", {class: "loom-ctrl-desc", text: desc}),
		])
	}

	function makeNumber(name, label, desc, {value, min, placeholder}, onChange) {
		const input = el("input", {type: "number", min, placeholder, value: value != null && value !== "" ? String(value) : ""})
		input.addEventListener("input", () => onChange(input.value === "" ? null : +input.value, false))
		input.addEventListener("change", () => onChange(input.value === "" ? null : +input.value, true))
		refs[name] = {input}
		return el("div", {class: "loom-ctrl"}, [
			el("div", {class: "loom-ctrl-head"}, [el("span", {class: "loom-ctrl-label", text: label})]),
			input,
			el("div", {class: "loom-ctrl-desc", text: desc}),
		])
	}

	function makeSelectRow(label, options, value, onChange) {
		const sel = el("select", {class: "loom-select"})
		for (const o of options) {
			const opt = el("option", {value: String(o.v), text: o.t})
			if (String(o.v) === String(value)) opt.selected = true
			sel.append(opt)
		}
		sel.addEventListener("change", () => onChange(sel.value))
		return el("div", {class: "loom-select-row"}, [
			el("span", {class: "loom-select-label", text: label}),
			sel,
		])
	}

	// Attention config (layer / head / view) — rebuilt when dims are discovered
	// or the overlay toggles. Hidden unless the attention overlay is active.
	const attnBox = el("div", {class: "loom-attn-cfg"})
	attnBox.dataset.hidden = ""
	function renderAttnControls() {
		attnBox.replaceChildren()
		if (state.overlay !== "attention") { attnBox.dataset.hidden = ""; return }
		attnBox.removeAttribute("data-hidden")
		if (!state.attnDims) {
			attnBox.append(el("div", {
				class: "loom-attn-note",
				text: state.attnSupported === false
					? (state.attnNote || "This model has no attention output. Use a model exported with attention (e.g. cheerabbits/qwen3-0.6b-attn).")
					: "Running attention pass…",
			}))
			return
		}
		const {layers: L, heads: H} = state.attnDims
		const viewRow = makeSelectRow("View", [
			{v: "received", t: "Received (avg)"},
			{v: "fromLast", t: "From last token"},
		], state.attn.view, (v) => { state.attn.view = v; persistAttn(); reapplyAttention() })
		const layerOpts = [{v: "mean", t: "All (mean)"}, ...Array.from({length: L}, (_, i) => ({v: i, t: `Layer ${i}`}))]
		const layerRow = makeSelectRow("Layer", layerOpts, state.attn.layer, (v) => {
			state.attn.layer = v === "mean" ? "mean" : +v; persistAttn(); reapplyAttention()
		})
		const headOpts = [{v: "mean", t: "All (mean)"}, ...Array.from({length: H}, (_, i) => ({v: i, t: `Head ${i}`}))]
		const headRow = makeSelectRow("Head", headOpts, state.attn.head, (v) => {
			state.attn.head = v === "mean" ? "mean" : +v; persistAttn(); reapplyAttention()
		})
		const note = el("div", {class: "loom-attn-note", text: `${L} layers × ${H} heads. "Received" = mean attention each token gets; "From last token" = what the newest token attends to.`})
		attnBox.append(viewRow, layerRow, headRow, note)
	}

	// ---- DOM scaffold ----
	const root = el("div", {class: "loom-root"})

	// stats row
	const statTop = el("span", {}, ["next: ", el("b", {text: "\u2014"})])
	const statPerp = el("span", {}, ["perplexity: ", el("b", {text: "\u2014"})])
	const statSpread = el("span", {}, ["spread: ", el("b", {text: "\u2014"})])
	const statLatency = el("span", {}, ["latency: ", el("b", {text: "\u2014"})])
	const statSpeed = el("span", {}, ["speed: ", el("b", {text: "\u2014"})])
	const statTokens = el("span", {}, ["tokens: ", el("b", {text: "\u2014"})])
	const statBits = el("span", {}, ["bits: ", el("b", {text: "\u2014"})])
	statBits.title = "Average surprisal over your text = cross-entropy = bits/token the model would need to compress it. Computed when a scored overlay runs (Del\u00e9tang et al. 2024, 'Language Modeling Is Compression')."
	const statusEl = el("span", {class: "loom-status"})
	const toggleBtn = el("button", {class: "loom-sidebar-toggle", text: "\u2699"})
	if (state.sidebarOpen) toggleBtn.dataset.open = ""
	const statsRight = el("span", {class: "loom-stats-right"}, [statusEl, toggleBtn])
	const stats = el("div", {class: "loom-stats"}, [statTop, statPerp, statSpread, statLatency, statSpeed, statTokens, statBits, statsRight])

	// sparkline: per-token trajectory of the active overlay across the document
	const sparkEl = el("div", {class: "loom-spark"})
	sparkEl.dataset.hidden = ""

	// explainer panel: appears under the text when an overlay is on, describing
	// what it shows, how it's computed, and the papers it's grounded in.
	const panelEl = el("div", {class: "loom-panel"})
	panelEl.setAttribute("data-hidden", "")

	// editor
	const editorHost = el("div", {class: "loom-editor"})

	// floating continue button (positioned near cursor)
	const continueBtn = el("span", {class: "loom-continue-widget", text: "\u25B8"})
	continueBtn.title = "Continue (\u2318\u23CE)"
	continueBtn.style.cssText = "position:absolute; display:none; z-index:5; pointer-events:auto;"

	// ---- overlay system (importance / surprisal / info gain) ----
	//
	// Each overlay re-scores the whole document (local models only — both
	// primitives need raw logits) and colors each token white→accent by one
	// information-theoretic quantity. The color value is a [0,1] scalar stored
	// on the mark as `exactP` (a generic overlay intensity, not a probability).
	//
	// Surprisal (teal): −log2 p of the token you actually wrote, in bits.
	//   Self-information of each word given its context — "how surprised was
	//   the model by this word?" Hale 2001 ("A probabilistic Earley parser as
	//   a psycholinguistic model") and Levy 2008 ("Expectation-based syntactic
	//   comprehension…") — surprisal theory of sentence processing. Normalized
	//   by the document's max so the scale is relative (min 0 at p=1).
	//
	// Info Gain (green): the drop in next-token entropy from one position to
	//   the next, max(0, H_i − H_{i+1}) — "how much did this token reduce the
	//   model's uncertainty about what comes next?" Frank 2010 ("Uncertainty
	//   reduction as a measure of cognitive effort…") and Frank & Willems
	//   2017; the incremental form of predictive information (Bialek, Nemenman
	//   & Tishby 2001). Clamped at 0, so tokens that raise uncertainty stay
	//   white and invisible.
	//
	// Uncertainty (amber): the next-token entropy H_t at each position — how
	//   unsure the model was about the word that follows. This is the raw
	//   signal that Info Gain is the *difference* of, so the two pair well:
	//   Uncertainty shows the terrain, Info Gain shows the downhill steps.
	//   Entropy is the quantity training minimizes (cross-entropy loss), so
	//   spikes are literally the loss the model would incur at that word. In
	//   psycholinguistics, per-word entropy predicts reading time — Hale 2006
	//   ("Uncertainty about the rest of the sentence") and Roark et al. 2009
	//   ("Hierarchical derivation and entropy reduction"). Shannon 1948 is the
	//   origin of the measure. Normalized by the document's max.
	//
	// Typicality (purple): |surprisal − H_t| — how far this token's own
	//   information content is from the *expected* information content (the
	//   local entropy). 0 = a "typical" word carrying exactly the average
	//   load; high = a word that is markedly more or less informative than its
	//   context, i.e. a violation of uniform information density. This is the
	//   exact criterion behind locally typical sampling — Meister, Pimentel,
	//   Wiher & Cotterell 2023 ("Locally Typical Sampling", TACL) — which is
	//   itself motivated by the Uniform Information Density hypothesis (Levy &
	//   Jaeger 2007; Jaeger 2010): speakers choose words to spread information
	//   evenly, and sampling that respects typicality produces less degenerate
	//   text. So this overlay shows where your prose would make a typical-
	//   sampling decoder hesitate. Normalized by the document's max.
	//
	// Importance (pink): erasure-based saliency — mask each token (replace
	//   with unk/pad), re-run, and take the Jensen-Shannon divergence between
	//   the original and masked next-token distributions. Leave-one-out
	//   attribution over the full output distribution; N+1 forward passes.
	//   Li, Chen, Zhu & Rudin 2016 ("Understanding Neural Networks through
	//   Representation Erasure"). This is the `computeImportance` primitive;
	//   real attention weights are a separate overlay (`computeAttentionWeights`).
	let overlayTimer = null
	let attnAbort = null
	function scheduleOverlay() {
		if (!state.overlay || state.streaming) return
		clearTimeout(overlayTimer)
		state.overlayCache = freshOverlayCache()
		state.scoreDataCache = null
		state.attnRaw = null
		overlayTimer = setTimeout(refreshOverlay, 600)
	}

	async function refreshOverlay() {
		const mode = state.overlay
		if (!mode) return
		const text = view.state.sliceDoc()
		if (!text.trim()) return
		const cached = state.overlayCache[mode]
		if (cached && cached.text === text) {
			applyOverlayMarks(cached.marks)
			return
		}
		try {
			if (mode === "importance") await refreshImportance(text)
			else if (mode === "attention") await refreshAttention(text)
			else await refreshScoredOverlays(text) // surprisal / gain / entropy / typicality
		} catch (e) {
			console.warn("[loom] overlay:", e)
		}
	}

	function applyOverlayMarks(marks) {
		const docLen = view.state.doc.length
		const effects = [clearScoredMarks.of(null)]
		for (const m of marks) {
			if (m.from >= 0 && m.to <= docLen && m.to > m.from) {
				effects.push(addMark.of({
					from: m.from, to: m.to, chosen: "", alts: [],
					scored: true, exactP: m.exactP,
				}))
			}
		}
		view.dispatch({effects})
		renderSpark()
	}

	function scoreOffset(decoded, editorText) {
		if (!decoded || decoded === editorText) return 0
		const i = editorText.indexOf(decoded.slice(0, 30))
		return i >= 0 ? i : -1
	}

	async function refreshImportance(text) {
		const result = await computeImportance(text, {config: state.config})
		if (!result) return
		const {decoded, spans} = result
		const offset = scoreOffset(decoded, view.state.sliceDoc())
		if (offset < 0) { console.warn("[loom] importance: decoded text mismatch"); return }
		const marks = spans
			.map(s => ({from: s.from + offset, to: s.to + offset, exactP: s.importance}))
			.filter(m => m.from >= 0 && m.to <= view.state.doc.length && m.to > m.from)
		state.overlayCache.importance = {text, marks, label: "importance · JS-divergence (normalized)"}
		if (state.overlay === "importance") applyOverlayMarks(marks)
	}

	// ---- attention overlay: REAL attention weights ----
	// Runs one forward pass (computeAttentionWeights), caches the raw per-(layer,
	// head) vectors keyed by text, then slices them by the active layer/head/view
	// selection. Changing the selection re-slices the cache with no model call.
	// On unsupported we DON'T silently flip the overlay back off — that just
	// flickers with no explanation. Stay on Attention and show why in the panel.
	function setAttnSupported(ok, msg) {
		state.attnSupported = ok
		state.attnNote = ok ? "" : (msg || "")
		if (!ok) {
			statusEl.textContent = msg || ""
			view.dispatch({effects: clearScoredMarks.of(null)})
			renderSpark()
			renderAttnControls()
		}
	}

	// Slice cached attention into one [0,1] value per token, then into marks.
	// Position 0 (BOS / first token) is excluded from the normalization max: it
	// is an "attention sink" (Xiao et al. 2023) that otherwise washes everything
	// else out to white.
	function buildAttentionMarks() {
		const raw = state.attnRaw
		if (!raw || !raw.spans?.length || !raw.dims) return {marks: [], label: "attention"}
		const {layers: L, heads: H, seq: S} = raw.dims
		if (!L || !H || !S) return {marks: [], label: "attention"}
		const text = view.state.sliceDoc()
		const offset = scoreOffset(raw.decoded, text)
		if (offset < 0) return {marks: [], label: "attention"}
		const arr = state.attn.view === "fromLast" ? raw.fromLast : raw.received
		const layerList = state.attn.layer === "mean" ? null : [Math.min(Math.max(0, state.attn.layer), L - 1)]
		const headList = state.attn.head === "mean" ? null : [Math.min(Math.max(0, state.attn.head), H - 1)]
		const val = new Float64Array(S)
		for (let j = 0; j < S; j++) {
			let sum = 0, cnt = 0
			for (let l = 0; l < L; l++) {
				if (layerList && l !== layerList[0]) continue
				for (let h = 0; h < H; h++) {
					if (headList && h !== headList[0]) continue
					sum += arr[(l * H + h) * S + j]
					cnt++
				}
			}
			val[j] = cnt ? sum / cnt : 0
		}
		let mx = 0
		for (let j = 1; j < S; j++) if (val[j] > mx) mx = val[j]
		if (mx <= 0) for (let j = 0; j < S; j++) if (val[j] > mx) mx = val[j]
		if (mx <= 0) mx = 1
		const marks = raw.spans
			.map(s => ({from: s.from + offset, to: s.to + offset, exactP: Math.min(1, val[s.index] / mx)}))
			.filter(m => m.from >= 0 && m.to <= view.state.doc.length && m.to > m.from)
		const layerLbl = state.attn.layer === "mean" ? "all layers" : `layer ${state.attn.layer}`
		const headLbl = state.attn.head === "mean" ? "all heads" : `head ${state.attn.head}`
		const viewLbl = state.attn.view === "fromLast" ? "from last token" : "received"
		return {marks, label: `attention · ${viewLbl} · ${layerLbl} · ${headLbl}`}
	}

	async function refreshAttention(text) {
		if (!(state.attnRaw && state.attnRaw.text === text)) {
			attnAbort?.abort()
			attnAbort = new AbortController()
			let result
			try {
				result = await computeAttentionWeights(text, {config: state.config, signal: attnAbort.signal})
			} catch (e) {
				if (e.name === "AbortError") return
				// A model-load / forward error: surface it instead of a blank overlay.
				console.warn("[loom] attention:", e)
				return setAttnSupported(false, "Attention failed: " + (e.message || e))
			}
			if (result == null) return setAttnSupported(false, "Attention needs a local model — pick one in the model picker.")
			if (result.supported === false) {
				const m = result.model ? `"${result.model}"` : "this model"
				const keys = result.outputKeys ? ` (model outputs: ${result.outputKeys.join(", ")})` : ""
				return setAttnSupported(false, `${m} has no attention output. Use a model exported with attention (e.g. cheerabbits/qwen3-0.6b-attn).${keys}`)
			}
			console.log(`[loom] attention ready: ${result.dims.layers} layers × ${result.dims.heads} heads, seq ${result.dims.seq}`)
			setAttnSupported(true, "")
			state.attnDims = result.dims
			state.attnRaw = {text, ...result}
			renderAttnControls()
		}
		const {marks, label} = buildAttentionMarks()
		state.overlayCache.attention = {text, marks, label}
		if (state.overlay === "attention") applyOverlayMarks(marks)
	}

	// Re-slice cached attention after a layer/head/view change — no model call.
	function reapplyAttention() {
		if (state.overlay !== "attention" || !state.attnRaw) return
		const {marks, label} = buildAttentionMarks()
		state.overlayCache.attention = {text: state.attnRaw.text, marks, label}
		applyOverlayMarks(marks)
	}

	function persistAttn() {
		handle.change(d => {
			if (!d.config) d.config = {}
			d.config.attention = {layer: state.attn.layer, head: state.attn.head, view: state.attn.view}
		})
	}

	async function ensureScoreData(text) {
		if (state.scoreDataCache && state.scoreDataCache.text === text) return state.scoreDataCache.result
		let result = null
		for await (const ev of scoreTokens(text, {config: state.config})) {
			if (ev.type === "done") result = ev
		}
		if (result) state.scoreDataCache = {text, result}
		return result
	}

	// ---- scored-overlay builders (all reuse one scoreTokens pass) ----
	// Each returns {marks, label}; marks are {from, to, exactP} with exactP in
	// [0,1] (normalized over the document) and label is a short scale caption
	// for the sparkline. scores[i] is the distribution that predicted the token
	// at span i, so every builder colors a token by what the model knew just
	// before it.

	function buildSurprisalMarks(text, data) {
		const {scores, spans, decoded} = data
		const offset = scoreOffset(decoded, text)
		if (offset < 0 || !spans) return {marks: [], label: "surprisal"}
		// Surprisal = −log2 p in bits (Hale 2001 / Levy 2008). Normalized by the
		// document's max so white→teal is a relative scale: whitest = most
		// predictable token, tealest = most surprising (min is 0 at p=1).
		const pairs = spans.filter(s => scores[s.index])
		let maxS = 0
		for (const s of pairs) {
			const p = scores[s.index].p
			if (p > 0) { const bits = -Math.log2(p); if (bits > maxS) maxS = bits }
		}
		if (maxS <= 0) maxS = 1
		const marks = pairs.map(s => {
			const p = scores[s.index].p
			const sup = p > 0 ? -Math.log2(p) : maxS
			return {from: s.from + offset, to: s.to + offset, exactP: sup / maxS}
		})
		return {marks, label: `surprisal · max ${maxS.toFixed(1)} bits`}
	}

	function buildEntropyMarks(text, data) {
		const {scores, spans, decoded} = data
		const offset = scoreOffset(decoded, text)
		if (offset < 0 || !spans) return {marks: [], label: "uncertainty"}
		// Next-token entropy H_t at each position — the model's uncertainty about
		// the word that follows. The raw signal Info Gain is the difference of;
		// training minimizes exactly this (cross-entropy loss), so amber peaks
		// are the loss the model would incur at that word. Normalized by the
		// document's max (min 0 when the model is certain).
		const pairs = spans.filter(s => scores[s.index])
		let maxH = 0
		for (const s of pairs) { const h = scores[s.index].entropy || 0; if (h > maxH) maxH = h }
		if (maxH <= 0) maxH = 1
		const marks = pairs.map(s => ({
			from: s.from + offset, to: s.to + offset,
			exactP: (scores[s.index].entropy || 0) / maxH,
		}))
		return {marks, label: `uncertainty · max ${maxH.toFixed(1)} bits`}
	}

	function buildTypicalityMarks(text, data) {
		const {scores, spans, decoded} = data
		const offset = scoreOffset(decoded, text)
		if (offset < 0 || !spans) return {marks: [], label: "typicality"}
		// |surprisal − H_t|: distance of this token's information content from
		// the local expected information. 0 = typical (uniform information
		// density); high = atypical — the word carries markedly more or less
		// than the local average. Meister, Pimentel, Wiher & Cotterell 2023.
		// Normalized by the document's max.
		const pairs = spans.filter(s => scores[s.index])
		let maxT = 0
		const ds = pairs.map(s => {
			const sc = scores[s.index]
			const sup = sc.p > 0 ? -Math.log2(sc.p) : 20
			const d = Math.abs(sup - (sc.entropy || 0))
			if (d > maxT) maxT = d
			return {s, d}
		})
		if (maxT <= 0) maxT = 1
		const marks = ds.map(({s, d}) => ({
			from: s.from + offset, to: s.to + offset, exactP: d / maxT,
		}))
		return {marks, label: `typicality · max ${maxT.toFixed(1)} bits`}
	}

	function buildGainMarks(text, data) {
		const {scores, spans, decoded} = data
		const offset = scoreOffset(decoded, text)
		if (offset < 0 || !spans) return {marks: [], label: "info gain"}
		// max(0, H_i − H_{i+1}): how much observing this token reduced the
		// model's next-token uncertainty. Frank 2010 / Frank & Willems 2017.
		// Normalized by the document's max; clamped at 0 so uncertainty-raising
		// tokens stay white and invisible.
		const gains = scores.map((s, i) =>
			i < scores.length - 1 ? Math.max(0, scores[i].entropy - scores[i + 1].entropy) : 0
		)
		let hi = 0
		for (const g of gains) if (g > hi) hi = g
		if (hi <= 0) hi = 1
		const marks = spans
			.filter(s => s.index < gains.length)
			.map(s => ({from: s.from + offset, to: s.to + offset, exactP: gains[s.index] / hi}))
		return {marks, label: `info gain · max ${hi.toFixed(2)} bits`}
	}

	// One scoreTokens pass feeds all four scored overlays; cache each, apply the
	// active one, refresh the sparkline, and update the compression (bits/token)
	// readout — all from the same data.
	async function refreshScoredOverlays(text) {
		const data = await ensureScoreData(text)
		if (!data?.scores?.length) return
		const builders = {
			surprisal: buildSurprisalMarks,
			entropy: buildEntropyMarks,
			typicality: buildTypicalityMarks,
			gain: buildGainMarks,
		}
		for (const [mode, build] of Object.entries(builders)) {
			const cached = state.overlayCache[mode]
			if (!cached || cached.text !== text) {
				const {marks, label} = build(text, data)
				state.overlayCache[mode] = {text, marks, label}
			}
		}
		updateCompressionStats(data)
		const active = state.overlayCache[state.overlay]
		if (active?.text === text) applyOverlayMarks(active.marks)
	}

	// Average surprisal over the text = cross-entropy in bits/token = the rate at
	// which the model could arithmetic-code-compress your prose (Delétang et al.
	// 2024, "Language Modeling Is Compression"; Shannon 1948). Perplexity would
	// be 2^(this). Only meaningful once a scored overlay has run the pass.
	function updateCompressionStats(data) {
		const scores = data?.scores
		if (!scores?.length) return
		let total = 0, n = 0
		for (const s of scores) {
			if (s.p > 0) { total += -Math.log2(s.p); n++ }
		}
		if (n) statBits.lastChild.textContent = (total / n).toFixed(2) + " bpt"
	}

	// Sparkline: one bar per scored mark, width proportional to its span and
	// height to its normalized value, filled with the overlay's accent. Reads
	// the active overlay's cache so it stays in sync with the colored marks.
	function renderSpark() {
		const mode = state.overlay
		sparkEl.replaceChildren()
		if (!mode) { sparkEl.dataset.hidden = ""; return }
		const cached = state.overlayCache[mode]
		if (!cached?.marks?.length) { sparkEl.dataset.hidden = ""; return }
		sparkEl.removeAttribute("data-hidden")
		const W = sparkEl.clientWidth || 600
		const H = 30
		const docLen = view.state.doc.length || 1
		const ns = "http://www.w3.org/2000/svg"
		const svg = document.createElementNS(ns, "svg")
		svg.setAttribute("width", W)
		svg.setAttribute("height", H)
		svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
		svg.setAttribute("preserveAspectRatio", "none")
		const fill = overlayAccent(mode)
		for (const m of cached.marks) {
			const x = (m.from / docLen) * W
			const w = Math.max(1, ((m.to - m.from) / docLen) * W)
			const h = Math.max(1, (m.exactP ?? 0) * (H - 2))
			const rect = document.createElementNS(ns, "rect")
			rect.setAttribute("x", x.toFixed(1))
			rect.setAttribute("y", (H - h).toFixed(1))
			rect.setAttribute("width", w.toFixed(1))
			rect.setAttribute("height", h.toFixed(1))
			rect.setAttribute("fill", fill)
			svg.appendChild(rect)
		}
		sparkEl.append(svg)
		sparkEl.append(el("span", {class: "loom-spark-label", text: cached.label || mode}))
	}

	// Per-overlay explainer text for the panel. The point of this tool is
	// learning, so this is deliberately verbose: what each visualizer shows,
	// the exact computation, and the papers it comes from.
	const OVERLAY_INFO = {
		importance: {
			title: "Importance — erasure-based saliency",
			what: "Each token is colored by how much it matters to the model's prediction of the final word. Pink = removing this token most changed what the model expected to come next.",
			how: "For every token: replace it with an unknown/pad token, re-run the model, and measure the Jensen–Shannon divergence between the original and the altered next-token distributions. That's N+1 forward passes (one baseline + one per token) — a gradient-free, leave-one-out attribution over the full output distribution, not just the top word.",
			papers: [
				{text: "Li, Chen, Zhu & Rudin (2016), “Understanding Neural Networks through Representation Erasure” — the canonical erase-a-feature, measure-the-output-change method.", href: "https://arxiv.org/abs/1612.08220"},
				{text: "Cousin: Koh & Liang (2017), “Influence Functions” — a gradient version of the same “what would change if I removed this?” question."},
				{text: "Note: this is the computeImportance primitive (erasure). For the model's literal attention weights, use the Attention overlay."},
			],
		},
		surprisal: {
			title: "Surprisal — how surprised was the model by each word",
			what: "Each token is colored by its self-information: −log₂ of the probability the model assigned it in context. Teal = the model gave this word low probability = it was genuinely surprised by what you wrote.",
			how: "One forward pass per position, softmax over the whole vocabulary, take p for the token you actually wrote, then −log₂ p (in bits). White is p≈1 (the model saw it coming); teal is p≈0. Normalized by the document's most surprising token so the scale is relative. The strict unit is bits; 2^(average surprisal) = perplexity.",
			papers: [
				{text: "Hale (2001), “A probabilistic Earley parser as a psycholinguistic model” — first to frame parsing cost as surprisal.", href: "https://aclanthology.org/N01-1021/"},
				{text: "Levy (2008), “Expectation-based syntactic comprehension as a psycholinguistic theory” — the canonical surprisal theory of reading; reading time ∝ −log p.", href: "https://www.semanticscholar.org/paper/Expectation-based-syntactic-comprehension-as-a-Levy/"},
				{text: "Shannon (1948), “A Mathematical Theory of Communication” — self-information and entropy, the foundation.", href: "https://en.wikipedia.org/wiki/A_Mathematical_Theory_of_Communication"},
			],
		},
		gain: {
			title: "Info Gain — which words reduced the model's uncertainty",
			what: "Each token is colored by how much it dropped the model's next-word uncertainty: max(0, H_before − H_after). Green = this word made what comes next more predictable; it carried real information.",
			how: "From the same per-position pass: H_i is the entropy of the next-token distribution before token i is seen, H_{i+1} after it. The drop H_i − H_{i+1} is the information gained by observing the token. Clamped at 0, so words that raise uncertainty (a plot twist, a new topic) stay white and invisible.",
			papers: [
				{text: "Frank (2010), “Uncertainty reduction as a measure of cognitive effort in sentence comprehension” — defines reading effort as the drop in next-word entropy, exactly H_i − H_{i+1}.", href: "https://www.semanticscholar.org/paper/Uncertainty-reduction-as-a-measure-of-cognitive-Frank/"},
				{text: "Frank & Willems (2017) — entropy reduction (and surprisal) predict fMRI activation during reading."},
				{text: "Bialek, Nemenman & Tishby (2001), “Predictability, complexity, and learning” — predictive information, of which this is the incremental form."},
			],
		},
		entropy: {
			title: "Uncertainty — how unsure the model was about the next word",
			what: "Each token is colored by the entropy of the model's next-token distribution at that point. Amber = the model was choosing between many plausible next words; white = it was nearly certain.",
			how: "H_t = −Σ p·log₂ p over the full vocabulary at each position, in bits. This is the raw signal that Info Gain is the difference of, and the exact quantity cross-entropy training minimizes — so amber peaks are literally the loss the model would incur at that word. Spikes tend to fall at idea boundaries, where the text could branch many ways. Normalized by the document's max.",
			papers: [
				{text: "Shannon (1948), “A Mathematical Theory of Communication” — entropy as a measure of uncertainty.", href: "https://en.wikipedia.org/wiki/A_Mathematical_Theory_of_Communication"},
				{text: "Hale (2006), “Uncertainty about the rest of the sentence” — per-word entropy as a reading-time predictor."},
				{text: "Roark, Bachrach, Vasilescu & Narayanan (2009), “Hierarchical derivation and entropy reduction” — entropy and its reduction model reading difficulty."},
			],
		},
		typicality: {
			title: "Typicality — how far each word is from the local average load",
			what: "Each token is colored by |surprisal − entropy|: the distance between this word's own information and the expected information at that point. Purple = atypical — a word carrying markedly more or less information than the local average; white = typical.",
			how: "Surprisal is the word's actual −log₂ p; entropy is the average −log₂ p the model expects there. A typical word sits right at the average — speakers and (well-sampled) models spread information evenly across a sentence (uniform information density). An atypical word violates that: it's either a surprisingly heavy lift or a surprisingly freebie. This is the exact criterion behind locally typical sampling, a decoding method that restricts sampling to words near the local entropy and produces less degenerate text.",
			papers: [
				{text: "Meister, Pimentel, Wiher & Cotterell (2023), “Locally Typical Sampling” (TACL) — formalizes local typicality and the sampling algorithm.", href: "https://aclanthology.org/2023.tacl-1.7/"},
				{text: "Levy & Jaeger (2007); Jaeger (2010) — the Uniform Information Density hypothesis: speakers choose words to distribute information evenly."},
				{text: "Shannon (1948) — the typical set: why typical sequences dominate under sampling.", href: "https://en.wikipedia.org/wiki/A_Mathematical_Theory_of_Communication"},
			],
		},
		attention: {
			title: "Attention — what the model actually attends to",
			what: "Each token is colored by a real attention weight read out of the model (yellow = low, blue = high, the field-standard YlGnBu heatmap). Unlike Importance — which infers saliency by erasing tokens — this is the literal softmax attention the model computed. Pick a layer, a head, and a view below.",
			how: "One forward pass with the model's attentions output (shape [layers, heads, query, key], post-softmax). “Received” averages, for each token, the attention it gets from every later query position (causal). “From last token” shows the attention distribution the newest token places over everything before it — i.e. what the model is looking at to predict what comes next. “All (mean)” averages over layers/heads; or isolate a single layer/head. The first token is excluded from the color scale because it's an attention sink that otherwise dominates. Needs a model exported with attention output (most aren't).",
			papers: [
				{text: "Vaswani et al. (2017), “Attention Is All You Need” — the attention mechanism itself.", href: "https://arxiv.org/abs/1706.03762"},
				{text: "Vig (2019), “A Multiscale Visualization of Attention in the Transformer Model” (BertViz) — the per-layer/per-head attention visualization this mirrors.", href: "https://aclanthology.org/P19-3007/"},
				{text: "Jain & Wallace (2019), “Attention is not Explanation”; Wiegreffe & Pinter (2019), “Attention is not not Explanation” — read attention as what the model attends to, not necessarily why.", href: "https://aclanthology.org/N19-1357/"},
				{text: "Xiao et al. (2023), “Efficient Streaming Language Models with Attention Sinks” — why the first token soaks up attention (and why we drop it from the scale).", href: "https://arxiv.org/abs/2309.17453"},
			],
		},
	}

	function renderPanel() {
		const mode = state.overlay
		panelEl.replaceChildren()
		if (!mode) { panelEl.setAttribute("data-hidden", ""); return }
		const info = OVERLAY_INFO[mode]
		if (!info) { panelEl.setAttribute("data-hidden", ""); return }
		panelEl.removeAttribute("data-hidden")

		const title = el("div", {class: "loom-panel-title"}, [
			el("span", {class: "loom-panel-dot", style: `background:${overlayAccent(mode)}`}),
			info.title,
		])
		const what = el("div", {class: "loom-panel-sec"}, [
			el("b", {text: "What it's showing. "}),
			info.what,
		])
		const how = el("div", {class: "loom-panel-sec"}, [
			el("b", {text: "How it's computed. "}),
			info.how,
		])
		const papersList = el("ul", {class: "loom-panel-papers"})
		for (const p of info.papers) {
			const li = el("li", {})
			if (p.href) {
				li.append(el("a", {href: p.href, target: "_blank", rel: "noreferrer", text: p.text}))
			} else {
				li.append(document.createTextNode(p.text))
			}
			papersList.append(li)
		}
		const papers = el("div", {class: "loom-panel-sec"}, [
			el("b", {text: "Papers. "}),
			papersList,
		])
		const footer = el("div", {class: "loom-panel-footer", text: "The strip above plots this value across your whole document; the “bits” stat is the model's average surprisal — the rate (bits/token) at which it could compress your text (Delétang et al. 2024, “Language Modeling Is Compression”)."})
		panelEl.append(title, what, how, papers, footer)
	}

	// sidebar
	const modelBtn = el("button", {class: "loom-model"}, ["\uD83E\uDDE0 ", el("span", {text: describeConfig(readConfig())})])

	function paramChange(key) {
		return (val, commit) => {
			state.config[key] = val
			if (key === "temperature") state.temperature = val
			if (commit) {
				// Persist sampling params to the doc (per-document, syncs with peers)
				handle.change(d => {
					if (!d.config) d.config = {}
					if (val == null) delete d.config[key]
					else d.config[key] = val
				})
			}
			// Live-reshape the popup — all sampling params are applied client-side
			// so every slider drag visibly updates the bars.
			if (popup.visible && popup.mode === "predict") openPredictPopup()
		}
	}

	const sidebar = el("div", {class: "loom-sidebar"}, [
		el("div", {class: "loom-section", text: "Model"}),
		modelBtn,

		el("div", {class: "loom-section", text: "Prediction"}),
		makeRange("temperature", "Temperature", "Low = predictable, high = creative.", {min: "0", max: "2", step: "0.05", value: state.temperature, emoji: tempEmoji}, paramChange("temperature")),
		makeRange("topP", "Top P", "Only tokens within this cumulative probability mass survive.", {min: "0", max: "1", step: "0.01", value: cfg0.topP ?? 0.9}, paramChange("topP")),
		makeRange("minP", "Min P", "Drop tokens less probable than this fraction of the best.", {min: "0", max: "1", step: "0.01", value: cfg0.minP ?? 0}, paramChange("minP")),
		makeRange("repetitionPenalty", "Repetition", "Penalizes tokens that already appear in your text.", {min: "1", max: "2", step: "0.01", value: cfg0.repetitionPenalty ?? 1.1}, paramChange("repetitionPenalty")),
		makeRange("frequencyPenalty", "Frequency", "Penalizes proportional to how often a token appears.", {min: "0", max: "2", step: "0.05", value: cfg0.frequencyPenalty ?? 0}, paramChange("frequencyPenalty")),
		makeRange("presencePenalty", "Presence", "Penalizes any token that has appeared at all.", {min: "0", max: "2", step: "0.05", value: cfg0.presencePenalty ?? 0}, paramChange("presencePenalty")),
		makeRange("topk", "Candidates", "How many candidate tokens to fetch.", {min: "2", max: "20", step: "1", value: state.topk}, (val, commit) => {
			state.topk = Math.round(val)
			if (commit) {
				handle.change(d => {
					if (!d.config) d.config = {}
					d.config.topk = Math.round(val)
				})
			}
			schedule()
		}),

		el("div", {class: "loom-section", text: "Continue"}),
		makeNumber("maxTokens", "Max Tokens", "Maximum tokens to generate. Empty = provider default.", {value: cfg0.maxTokens, min: "1", placeholder: "default"}, paramChange("maxTokens")),

		el("div", {class: "loom-section", text: "Display"}),
		(() => {
			const OVERLAYS = [
				{id: null, label: "Off"},
				{id: "importance", label: "Importance"},
				{id: "surprisal", label: "Surprisal"},
				{id: "gain", label: "Info Gain"},
				{id: "entropy", label: "Uncertainty"},
				{id: "typicality", label: "Typicality"},
				{id: "attention", label: "Attention"},
			]
			const DESCRIPTIONS = {
				importance: "Erasure-based saliency — masks each token and measures prediction change. One forward pass per token (Li et al. 2016).",
				surprisal: "How predictable was each token? High = the model was surprised (−log₂ p, bits; Hale 2001 / Levy 2008).",
				gain: "Which tokens helped the model understand what comes next? High = reduced uncertainty (Frank 2010).",
				entropy: "How unsure was the model about the next word here? High = choosing between many options (entropy H, bits).",
				typicality: "How far this token's information is from the local average. High = atypical (Meister et al. 2023).",
				attention: "Real attention weights (yellow→blue), if the model exports them. Pick a layer/head/view below.",
			}
			const row = el("div", {class: "loom-overlay-row"})
			const desc = el("div", {class: "loom-ctrl-desc"})
			function renderOverlayBtns() {
				row.replaceChildren()
				for (const o of OVERLAYS) {
					const btn = el("button", {
						class: "loom-overlay-btn" + (state.overlay === o.id ? " active" : ""),
						text: o.label,
					})
					btn.addEventListener("click", () => {
						const newMode = state.overlay === o.id ? null : o.id
						state.overlay = newMode
						view.dispatch({effects: setOverlay.of(newMode)})
						handle.change(d => {
							if (!d.config) d.config = {}
							d.config.overlay = newMode
						})
						if (newMode) refreshOverlay()
						else view.dispatch({effects: clearScoredMarks.of(null)})
						renderSpark()
						renderPanel()
						renderOverlayBtns()
						renderAttnControls()
					})
					row.append(btn)
				}
				desc.textContent = DESCRIPTIONS[state.overlay] || ""
			}
			renderOverlayBtns()
			refs.overlay = {render: renderOverlayBtns}
			return el("div", {}, [row, desc, attnBox])
		})(),
	])

	if (!state.sidebarOpen) sidebar.setAttribute("data-hidden", "")
	const body = el("div", {class: "loom-body"}, [editorHost, sidebar])
	root.append(stats, sparkEl, body, panelEl)
	element.append(root)
	editorHost.append(continueBtn)

	// popup (mounted on body for positioning)
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
			const pct = Number.isFinite(c.p) ? c.p : 0
			const fill = el("div", {class: "loom-fill"})
			fill.style.width = Math.max(2, pct * 100).toFixed(1) + "%"
			const cls =
				"loom-row" +
				(i === 0 ? " top" : "") +
				(i === popup.sel ? " sel" : "") +
				(popup.mode === "alt" && c.token === popup.chosen ? " chosen" : "")
			const row = el("div", {class: cls}, [
				el("span", {class: "loom-tok", text: showToken(c.token) || "\u2205"}),
				el("div", {class: "loom-track"}, [fill]),
				el("span", {class: "loom-pct", text: (pct * 100).toFixed(1) + "%"}),
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
				text: popup.mode === "alt" ? "\u2191\u2193 choose \u00B7 \u23CE branch from here \u00B7 Esc" : "\u2191\u2193 choose \u00B7 Tab insert \u00B7 Esc",
			})
		)
		const coords = view.coordsAtPos(popup.anchor ?? view.state.selection.main.head)
		if (coords) {
			popupEl.style.left = Math.round(coords.left) + "px"
			popupEl.style.top = Math.round(coords.bottom + 6) + "px"
		}
		popupEl.style.display = "block"
		if (popup.mode === "predict") {
			const items = popup.items
			const top = items[0]
			const topProb = Number.isFinite(top.p) ? top.p : 0
			const secondProb = items[1]?.p || 0
			statTop.lastChild.textContent = (showToken(top.token) || "\u2205") + " " + (topProb * 100).toFixed(0) + "%"
			// perplexity: 2^entropy — "the model is choosing between N equally-likely words"
			const perp = Math.pow(2, entropyBits(items))
			statPerp.lastChild.textContent = perp.toFixed(1)
			// spread: how dominant the top pick is over the second (ratio)
			const spread = secondProb > 0 ? topProb / secondProb : Infinity
			statSpread.lastChild.textContent = Number.isFinite(spread) ? spread.toFixed(1) + "\u00D7" : "\u221E"
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
		const marks = view.state.field(marksField)
		return marks.find((m) => pos > m.from && pos < m.to)
	}
	function markOverlapping(from, to) {
		return view.state.field(marksField).find((m) => from < m.to && to > m.from)
	}
	async function tick() {
		if (state.streaming) return hidePopup()
		const sel = view.state.selection.main
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
		if (sel.from !== sel.to) return hidePopup()
		if (abortCtl) abortCtl.abort()
		abortCtl = new AbortController()
		const before = view.state.sliceDoc(0, sel.head)
		const trimmed = before.replace(/[ \t]+$/, "")
		if (!trimmed.length) return hidePopup() // nothing to predict on an empty doc
		const hadTrailing = trimmed.length < before.length
		const t0 = performance.now()
		try {
			let cands = await predict(trimmed, {continuation: true, topk: state.topk, config: state.config, signal: abortCtl.signal})
			statLatency.lastChild.textContent = Math.round(performance.now() - t0) + " ms"
			if (hadTrailing) cands = cands.map((c) => ({...c, token: c.token.replace(/^ /, "")}))
			cands = cands.filter((c) => c.token.length && Number.isFinite(c.p) && c.p > 0)
			state.lastRaw = cands
			if (!cands.length) return hidePopup()

			openPredictPopup()
		} catch (e) {
			if (e.name !== "AbortError") hidePopup()
		}
	}
	function openPredictPopup() {
		let items = reTemperature(state.lastRaw, state.temperature)
		const text = view.state.sliceDoc()
		items = applyPenalties(items, text, state.config)
		items = applySamplingFilters(items, state.config)
		if (!items.length) return hidePopup()
		openPopup({
			mode: "predict",
			items,
			anchor: view.state.selection.main.head,
			onPick: (i) => insertPredicted(items[i]?.token),
		})
	}
	function insertPredicted(tok) {
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
		view.dispatch({effects: setStreaming.of(true)})
		hidePopup()
		streamAbort = new AbortController()
		let pending = null
		let at = pos
		const text = view.state.sliceDoc(0, pos)
		try {
			for await (const ev of stream(text, {
				continuation: true,
				topk: state.topk,
				temperature: state.temperature,
				maxNewTokens: state.config.maxTokens || 120,
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
		view.dispatch({effects: setStreaming.of(false)})
		statusEl.textContent = ""
		if (state.overlay) refreshOverlay()
		schedule()
	}
	function updateGenStats(s) {
		if (s.tokPerSec) statSpeed.lastChild.textContent = s.tokPerSec + " tok/s"
		if (s.ttftMs != null) statLatency.lastChild.textContent = s.ttftMs + " ms ttft"
	}

	// ---- CodeMirror ----
	const theme = EditorView.theme(
		{
			"&": {
				height: "100%",
				color: "var(--text-editor-line, var(--loom-fg))",
				backgroundColor: "var(--text-editor-fill, transparent)",
				fontFamily: "var(--text-editor-family, var(--loom-family))",
				fontSize: "var(--text-editor-font-size, 16px)",
			},
			".cm-content": {
				caretColor: "var(--text-editor-cursor-fill, var(--loom-accent))",
				fontFamily: "var(--text-editor-family, var(--loom-family))",
			},
			".cm-cursor, .cm-dropCursor": {
				borderLeft: "1px solid var(--text-editor-cursor-fill, var(--loom-accent))",
			},
			".cm-selectionBackground, .cm-content ::selection": {
				backgroundColor: "var(--text-editor-selection-fill, #e3f6ff)",
			},
			".cm-activeLine": {
				backgroundColor: "var(--text-editor-active-line-fill, transparent)",
			},
			".cm-gutters": {
				userSelect: "none",
				background: "var(--text-editor-gutter-fill, var(--loom-bg))",
				color: "var(--text-editor-gutter-line, var(--loom-muted))",
				border: "var(--text-editor-gutter-border, none)",
			},
			".cm-gutterElement": {
				userSelect: "none",
				color: "var(--text-editor-gutter-line--line-numbers, var(--loom-muted))",
				fontSize: "0.8em",
				display: "flex",
				placeItems: "center",
				placeContent: "center",
			},
			".cm-scroller": {
				fontFamily: "var(--text-editor-family, var(--loom-family))",
				lineHeight: "var(--text-editor-line-height, 1.9)",
			},
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
			{
				key: "Mod-Enter",
				run: () => {
					if (state.streaming) streamAbort?.abort()
					else continueFrom(view.state.selection.main.head)
					return true
				},
			},
		])
	)
	const watcher = EditorView.updateListener.of((u) => {
		if (u.selectionSet || u.docChanged) repositionContinueBtn()
		if (u.docChanged) { updateTokenCount(); scheduleOverlay() }
		if (state.streaming) return
		// Only hide/reschedule when the cursor actually moved, not on mere
		// focus-return (e.g. releasing a sidebar slider refocuses the editor).
		const prev = u.startState.selection.main
		const curr = u.state.selection.main
		const selMoved = prev.from !== curr.from || prev.to !== curr.to
		if (u.docChanged || selMoved) {
			hidePopup()
			schedule()
		}
	})

	const view = new EditorView({
		state: EditorState.create({
			doc: handle.doc()?.content?.toString() || "",
			extensions: [
				popupKeys,
				drawSelection(),
				history(),
				EditorView.lineWrapping,
				keymap.of([...defaultKeymap, ...historyKeymap]),
				theme,
				marksField,
				overlayField,
				streamingField,
				markDecorations,
				watcher,
				automergeSyncPlugin({handle, path: ["content"]}),
			],
		}),
		parent: editorHost,
	})

	// ---- controls ----
	continueBtn.addEventListener("mousedown", (e) => {
		e.preventDefault()
		if (state.streaming) streamAbort?.abort()
		else continueFrom(view.state.selection.main.head)
	})
	toggleBtn.addEventListener("click", () => {
		state.sidebarOpen = sidebar.hasAttribute("data-hidden")
		if (state.sidebarOpen) { sidebar.removeAttribute("data-hidden"); toggleBtn.dataset.open = "" }
		else { sidebar.setAttribute("data-hidden", ""); delete toggleBtn.dataset.open }
		handle.change(d => {
			if (!d.config) d.config = {}
			d.config.sidebarOpen = state.sidebarOpen
		})
	})
	modelBtn.addEventListener("click", async () => {
		const picker = openModelPicker({locked: [...SAMPLING_KEYS, "topk"]})
		element.appendChild(picker)
		picker.showPopover()
		await picker.result
		// Pull the freshly-picked model/dtype into state.config (the provider
		// subscription may not have fired yet) and re-run the active overlay.
		onGlobalConfig(readConfig())
		if (state.overlay) refreshOverlay()
		schedule()
	})

	// Position the floating continue button near the cursor
	function repositionContinueBtn() {
		const head = view.state.selection.main.head
		const coords = view.coordsAtPos(head)
		if (!coords) { continueBtn.style.display = "none"; return }
		const hostRect = editorHost.getBoundingClientRect()
		continueBtn.style.left = Math.round(coords.left - hostRect.left + editorHost.scrollLeft + 2) + "px"
		continueBtn.style.top = Math.round(coords.top - hostRect.top + editorHost.scrollTop + 1) + "px"
		continueBtn.style.display = ""
		continueBtn.textContent = state.streaming ? "\u25A0" : "\u25B8"
		continueBtn.className = "loom-continue-widget" + (state.streaming ? " streaming" : "")
		continueBtn.title = state.streaming ? "Stop (\u2318\u23CE)" : "Continue (\u2318\u23CE)"
	}

	// Update token count estimate
	function updateTokenCount() {
		const len = view.state.doc.length
		statTokens.lastChild.textContent = "~" + Math.round(len / 4)
	}

	migrateConfig().catch((e) => console.warn("[loom] config migration:", e))

	const offStatus = onStatus((m) => {
		if (!state.streaming) statusEl.textContent = m || ""
	})
	// Global config changes affect provider/model/dtype (sampling is per-doc).
	// readConfig() is NESTED ({provider, local:{model,dtype}, openrouter:{…}, …})
	// and callConfig() flattens it downstream — so we must copy the nested
	// provider blocks wholesale, NOT a flat cfg.model (which is undefined here).
	function onGlobalConfig(cfg) {
		const prevModel = state.config.local?.model
		const prevDtype = state.config.local?.dtype
		state.config.provider = cfg.provider
		state.config.local = cfg.local
		state.config.openrouter = cfg.openrouter
		state.config.ollama = cfg.ollama
		state.config.webllm = cfg.webllm
		state.config.builtin = cfg.builtin
		// A config provider can attach an in-memory request handler (e.g. choochoo
		// applies a live LoRA delta on top of a base model). Carry it so predict()
		// can intercept; null in normal use, so no effect when unset.
		state.config.handler = cfg.handler
		modelBtn.lastChild.textContent = describeConfig(cfg)
		// A different model/quantization makes every model-derived overlay stale.
		if (cfg.local?.model !== prevModel || cfg.local?.dtype !== prevDtype) {
			state.overlayCache = freshOverlayCache()
			state.scoreDataCache = null
			state.attnRaw = null
			state.attnDims = null
			state.attnSupported = null
			state.attnNote = ""
			renderAttnControls()
		}
	}
	const offConfig = subscribeConfig(element, onGlobalConfig)

	// Doc config changes (from peers or ourselves) update sampling + UI controls
	function syncDocConfig() {
		const docCfg = handle.doc()?.config || {}
		const active = document.activeElement
		for (const key of [...SAMPLING_KEYS, "topk"]) {
			const val = key === "topk" ? docCfg.topk : docCfg[key]
			if (val == null) continue
			if (key === "topk") { state.topk = Math.round(val) }
			else { state.config[key] = val }
			const r = refs[key]
			if (!r || r.input === active) continue
			if (r.input.type === "range") {
				r.input.value = String(val)
				if (r.valEl && r.fmt) r.valEl.textContent = r.fmt(val)
				if (r.emojiEl && r.emoji) r.emojiEl.textContent = r.emoji(val)
			} else {
				r.input.value = val != null && val !== "" ? String(val) : ""
			}
		}
		if (active !== refs.temperature?.input && docCfg.temperature != null) {
			state.temperature = docCfg.temperature
		}
		// Sync attention selection (layer / head / view) from peers
		const da = docCfg.attention
		if (da && (da.layer !== state.attn.layer || da.head !== state.attn.head || da.view !== state.attn.view)) {
			state.attn.layer = da.layer ?? "mean"
			state.attn.head = da.head ?? "mean"
			state.attn.view = da.view ?? "received"
			renderAttnControls()
			reapplyAttention()
		}
		// Sync overlay mode
		const docOverlay = docCfg.overlay || null
		if (docOverlay !== state.overlay) {
			state.overlay = docOverlay
			view.dispatch({effects: setOverlay.of(docOverlay)})
			if (refs.overlay) refs.overlay.render()
			if (docOverlay) refreshOverlay()
			else view.dispatch({effects: clearScoredMarks.of(null)})
			renderSpark()
			renderPanel()
			renderAttnControls()
		}
		// Sync sidebar visibility
		if (docCfg.sidebarOpen != null && docCfg.sidebarOpen !== state.sidebarOpen) {
			state.sidebarOpen = docCfg.sidebarOpen
			if (state.sidebarOpen) { sidebar.removeAttribute("data-hidden"); toggleBtn.dataset.open = "" }
			else { sidebar.setAttribute("data-hidden", ""); delete toggleBtn.dataset.open }
		}
	}
	handle.on("change", syncDocConfig)
	const reposition = () => {
		if (popup.visible) renderPopup()
		repositionContinueBtn()
	}
	editorHost.addEventListener("scroll", reposition, true)
	window.addEventListener("resize", () => { reposition(); renderSpark() })
	// Initial position + token count + restore overlay state
	setTimeout(() => {
		repositionContinueBtn()
		updateTokenCount()
		if (state.overlay) {
			view.dispatch({effects: setOverlay.of(state.overlay)})
			refreshOverlay()
			renderPanel()
			renderAttnControls()
		}
	}, 0)

	return () => {
		clearTimeout(timer)
		clearTimeout(overlayTimer)
		abortCtl?.abort()
		streamAbort?.abort()
		attnAbort?.abort()
		offStatus()
		offConfig()
		handle.off("change", syncDocConfig)
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
