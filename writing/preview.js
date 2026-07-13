// The prose live-preview: a CodeMirror StateField that renders markdown in place,
// Bear/Typora style. Delimiters live in the plain text (`# `, `- `, `**bold**`)
// and are hidden + the inner text styled, UNLESS the caret is there — then the raw
// source is shown so you can edit it. Line markers (headings, quotes, lists, tasks)
// reveal when the caret is anywhere on their line; inline marks reveal only when the
// caret is inside the span, so editing stays local.
//
// A StateField (not a ViewPlugin) is required because block-level replacements
// (horizontal rules, and future block widgets) can't be provided by a ViewPlugin.
// Decorations are computed from transaction state, so no dispatch is needed.

import {StateField} from "@codemirror/state"
import {EditorView, Decoration, WidgetType, keymap} from "@codemirror/view"

/* ------------------------------------------------------------------ *
 * Widgets
 * ------------------------------------------------------------------ */

// A task-list checkbox. Replaces the `[ ]` / `[x]` token; toggling rewrites the
// single character between the brackets (at `pos`).
class CheckboxWidget extends WidgetType {
	constructor(checked, pos) {
		super()
		this.checked = checked
		this.pos = pos
	}
	eq(other) {
		return other.checked === this.checked && other.pos === this.pos
	}
	toDOM(view) {
		const box = document.createElement("span")
		box.className = "cm-md-checkbox"
		box.setAttribute("role", "checkbox")
		box.setAttribute("aria-checked", String(this.checked))
		if (this.checked) box.setAttribute("data-checked", "")
		box.contentEditable = "false"
		box.addEventListener("mousedown", event => {
			event.preventDefault()
			event.stopPropagation()
			view.dispatch({
				changes: {from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x"},
				userEvent: "input",
			})
		})
		return box
	}
	ignoreEvent() {
		return true
	}
}

// A horizontal rule — a block-level replacement of the whole `---` line.
class RuleWidget extends WidgetType {
	eq() {
		return true
	}
	toDOM() {
		const wrap = document.createElement("div")
		wrap.className = "cm-md-rule"
		wrap.contentEditable = "false"
		wrap.append(document.createElement("hr"))
		return wrap
	}
	ignoreEvent() {
		return true
	}
}

// An inline image `![alt](src)` for http(s)/data URLs.
class ImageWidget extends WidgetType {
	constructor(src, alt) {
		super()
		this.src = src
		this.alt = alt
	}
	eq(other) {
		return other.src === this.src && other.alt === this.alt
	}
	toDOM() {
		const img = document.createElement("img")
		img.className = "cm-md-image"
		img.src = this.src
		img.alt = this.alt || ""
		img.loading = "lazy"
		return img
	}
	ignoreEvent() {
		return true
	}
}

/* ------------------------------------------------------------------ *
 * Inline scanning
 *
 * Each spec matches within a single line's content; group 1 is the inner text.
 * `open`/`close` are the delimiter lengths hidden on either side.
 * ------------------------------------------------------------------ */

function noWordAround(content, start, end) {
	const before = start > 0 ? content[start - 1] : " "
	const after = end < content.length ? content[end] : " "
	return !/\w/.test(before) && !/\w/.test(after)
}

const INLINE = [
	{re: /`([^`\n]+?)`/g, open: 1, close: 1, tag: "code", cls: "cm-md-code"},
	{re: /\*\*([^\n]+?)\*\*/g, open: 2, close: 2, tag: "strong", cls: "cm-md-strong"},
	{re: /__([^\n]+?)__/g, open: 2, close: 2, tag: "strong", cls: "cm-md-strong", guard: noWordAround},
	{re: /\*([^*\n]+?)\*/g, open: 1, close: 1, tag: "em", cls: "cm-md-em"},
	{re: /_([^_\n]+?)_/g, open: 1, close: 1, tag: "em", cls: "cm-md-em", guard: noWordAround},
	{re: /~~([^\n]+?)~~/g, open: 2, close: 2, tag: "del", cls: "cm-md-strike"},
	{re: /==([^\n]+?)==/g, open: 2, close: 2, tag: "mark", cls: "cm-md-highlight"},
]

const LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

// Non-overlapping inline spans within one line's content, offset by `base` to
// absolute document positions. Greedy: earliest start wins, ties broken by length.
function scanInline(content, base) {
	const cands = []
	for (const spec of INLINE) {
		spec.re.lastIndex = 0
		let m
		while ((m = spec.re.exec(content))) {
			if (!m[1]) {
				spec.re.lastIndex = m.index + 1
				continue
			}
			if (spec.guard && !spec.guard(content, m.index, m.index + m[0].length)) continue
			const start = base + m.index
			cands.push({
				kind: "mark",
				start,
				end: start + m[0].length,
				innerStart: start + spec.open,
				innerEnd: start + m[0].length - spec.close,
				tag: spec.tag,
				cls: spec.cls,
			})
		}
	}
	LINK_RE.lastIndex = 0
	let m
	while ((m = LINK_RE.exec(content))) {
		const isImage = m[1] === "!"
		const start = base + m.index
		const textStart = start + m[1].length + 1
		cands.push({
			kind: isImage ? "image" : "link",
			start,
			end: start + m[0].length,
			innerStart: textStart,
			innerEnd: textStart + m[2].length,
			href: m[3],
			alt: m[2],
			tag: "a",
			cls: "cm-md-link",
		})
	}
	cands.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
	const out = []
	let lastEnd = -1
	for (const c of cands) {
		if (c.start < lastEnd) continue
		out.push(c)
		lastEnd = c.end
	}
	return out
}

/* ------------------------------------------------------------------ *
 * Decoration building
 * ------------------------------------------------------------------ */

const FENCE_RE = /^(\s*)(```+|~~~+)(.*)$/
const HR_RE = /^(\s*)([-*_])(?:[ \t]*\2){2,}[ \t]*$/
const HEADING_RE = /^(#{1,6})([ \t]+)(.*)$/
const QUOTE_RE = /^((?:[ \t]*>[ \t]?)+)/
const TASK_RE = /^(\s*)([-*+]|\d+[.)])([ \t]+)\[([ xX])\]([ \t]+)/
const OL_RE = /^(\s*)(\d+)([.)])([ \t]+)/
const UL_RE = /^(\s*)([-*+])([ \t]+)/

export function buildDecorations(state) {
	const doc = state.doc
	const decos = []

	// which lines the selection touches (their markers reveal to raw source)
	const active = new Set()
	for (const range of state.selection.ranges) {
		const first = doc.lineAt(range.from).number
		const last = doc.lineAt(range.to).number
		for (let n = first; n <= last; n++) active.add(n)
	}

	const revealed = span => state.selection.ranges.some(r => r.from < span.end && r.to > span.start)

	// hide a leading marker, or (on the active line) style it as a dim raw marker
	const marker = (from, to, isActive) => {
		if (to <= from) return
		if (isActive) decos.push(Decoration.mark({class: "cm-md-marker"}).range(from, to))
		else decos.push(Decoration.replace({}).range(from, to))
	}

	const inline = (text, from, contentStart) => {
		for (const span of scanInline(text.slice(contentStart), from + contentStart)) {
			if (revealed(span)) continue
			if (span.kind === "image" && /^(https?:|data:)/i.test(span.href)) {
				decos.push(Decoration.replace({widget: new ImageWidget(span.href, span.alt)}).range(span.start, span.end))
				continue
			}
			if (span.innerStart > span.start) decos.push(Decoration.replace({}).range(span.start, span.innerStart))
			if (span.innerEnd > span.innerStart) {
				const attributes = span.kind === "link" ? {href: span.href, title: span.href} : undefined
				decos.push(Decoration.mark({tagName: span.tag, class: span.cls, attributes}).range(span.innerStart, span.innerEnd))
			}
			if (span.end > span.innerEnd) decos.push(Decoration.replace({}).range(span.innerEnd, span.end))
		}
	}

	let inFence = false
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n)
		const text = line.text
		const from = line.from
		const isActive = active.has(n)

		if (FENCE_RE.test(text)) {
			decos.push(Decoration.line({class: "cm-md-codeline cm-md-fence"}).range(from))
			inFence = !inFence
			continue
		}
		if (inFence) {
			decos.push(Decoration.line({class: "cm-md-codeline"}).range(from))
			continue
		}

		if (HR_RE.test(text)) {
			if (isActive) decos.push(Decoration.line({class: "cm-md-hr-raw"}).range(from))
			else decos.push(Decoration.replace({widget: new RuleWidget(), block: true}).range(from, line.to))
			continue
		}

		let m
		if ((m = text.match(HEADING_RE))) {
			const level = m[1].length
			const markerLen = m[1].length + m[2].length
			decos.push(Decoration.line({class: "cm-md-heading cm-md-h" + level}).range(from))
			marker(from, from + markerLen, isActive)
			inline(text, from, markerLen)
			continue
		}
		if ((m = text.match(QUOTE_RE))) {
			const markerLen = m[1].length
			decos.push(Decoration.line({class: "cm-md-quote"}).range(from))
			marker(from, from + markerLen, isActive)
			inline(text, from, markerLen)
			continue
		}
		if ((m = text.match(TASK_RE))) {
			const bulletLen = m[1].length + m[2].length + m[3].length
			const bracketStart = from + bulletLen
			const contentStart = m[0].length
			const checked = m[4].toLowerCase() === "x"
			const indent = m[1].replace(/\t/g, "  ").length
			decos.push(
				Decoration.line({
					class: "cm-md-li cm-md-task" + (checked ? " cm-md-task-done" : ""),
					attributes: indent ? {style: `--md-indent:${indent}`} : undefined,
				}).range(from)
			)
			if (isActive) {
				marker(from, from + contentStart, true)
			} else {
				decos.push(Decoration.replace({}).range(from, bracketStart))
				decos.push(Decoration.replace({widget: new CheckboxWidget(checked, bracketStart + 1)}).range(bracketStart, bracketStart + 3))
				decos.push(Decoration.replace({}).range(bracketStart + 3, from + contentStart))
			}
			inline(text, from, contentStart)
			continue
		}
		if ((m = text.match(OL_RE))) {
			const indent = m[1].replace(/\t/g, "  ").length
			decos.push(
				Decoration.line({
					class: "cm-md-li cm-md-ol",
					attributes: indent ? {style: `--md-indent:${indent}`} : undefined,
				}).range(from)
			)
			inline(text, from, m[0].length) // keep the number visible
			continue
		}
		if ((m = text.match(UL_RE))) {
			const markerLen = m[0].length
			const indent = m[1].replace(/\t/g, "  ").length
			decos.push(
				Decoration.line({
					class: "cm-md-li cm-md-ul" + (isActive ? " cm-md-ul-raw" : ""),
					attributes: indent ? {style: `--md-indent:${indent}`} : undefined,
				}).range(from)
			)
			marker(from, from + markerLen, isActive)
			inline(text, from, markerLen)
			continue
		}

		inline(text, from, 0)
	}

	return Decoration.set(decos, true)
}

function previewField() {
	return StateField.define({
		create: state => buildDecorations(state),
		update(value, tr) {
			if (tr.docChanged || tr.selection) return buildDecorations(tr.state)
			return value.map(tr.changes)
		},
		provide: f => EditorView.decorations.from(f),
	})
}

/* ------------------------------------------------------------------ *
 * Keymap & interaction
 * ------------------------------------------------------------------ */

function wrap(view, delim) {
	const {from, to} = view.state.selection.main
	view.dispatch({
		changes: [
			{from, insert: delim},
			{to, insert: delim},
		],
		selection: {anchor: from + delim.length, head: to + delim.length},
		userEvent: "input",
	})
	return true
}

// Enter inside a list continues it; on an empty item it exits the list.
function continueList(view) {
	const sel = view.state.selection.main
	if (!sel.empty) return false
	const line = view.state.doc.lineAt(sel.from)
	const m = line.text.match(/^(\s*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/)
	if (!m) return false
	const contentStart = line.from + m[1].length + m[2].length + m[3].length + (m[4] ? m[4].length : 0)
	if (sel.from < contentStart) return false
	if (m[5].trim() === "") {
		view.dispatch({
			changes: {from: line.from, to: line.to, insert: m[1]},
			selection: {anchor: line.from + m[1].length},
			userEvent: "delete",
		})
		return true
	}
	let next
	if (/\d/.test(m[2])) next = m[1] + (parseInt(m[2], 10) + 1) + m[2].slice(-1) + m[3]
	else next = m[1] + m[2] + m[3]
	if (m[4]) next += "[ ] "
	view.dispatch({
		changes: {from: sel.from, insert: "\n" + next},
		selection: {anchor: sel.from + 1 + next.length},
		userEvent: "input",
	})
	return true
}

function markdownKeymap() {
	return keymap.of([
		{key: "Enter", run: continueList},
		{key: "Mod-b", preventDefault: true, run: view => wrap(view, "**")},
		{key: "Mod-i", preventDefault: true, run: view => wrap(view, "*")},
		{key: "Mod-e", preventDefault: true, run: view => wrap(view, "`")},
	])
}

// Cmd/Ctrl-click a rendered link to open it.
function linkClicks() {
	return EditorView.domEventHandlers({
		mousedown(event) {
			if (!(event.metaKey || event.ctrlKey)) return false
			const anchor = event.target.closest && event.target.closest("a.cm-md-link")
			const href = anchor && anchor.getAttribute("href")
			if (!href) return false
			window.open(href, "_blank", "noopener,noreferrer")
			event.preventDefault()
			return true
		},
	})
}

export function markdownExtensions() {
	return [previewField(), markdownKeymap(), linkClicks()]
}
