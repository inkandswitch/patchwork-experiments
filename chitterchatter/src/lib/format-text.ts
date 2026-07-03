import {EMOJI_ALIASES, EMOJI_DATA} from "./emoji-data"
import type {InlineRule} from "./parser-extensions"

const URL_RE = /https?:\/\/[^\s<>]+/g

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

export type TextSegment =
	| {type: "html"; content: string}
	| {type: "think"; content: string}
	| {type: "code"; lang: string; code: string}

export interface ParseOptions {
	emoticonBlobUrls?: Record<string, string>
	// The active inline delimiter rules, in order (from the chat:parser-extension
	// registry, filtered by the tool's features). Omit → no delimiter formatting.
	rules?: InlineRule[]
	// Resolve `:name:` emoticons / emoji shortcodes (a full-tier feature).
	allowEmoticons?: boolean
	// Extract <think>…</think> reasoning blocks into their own segment.
	allowThink?: boolean
}

/**
 * Parse text into structured segments for Solid rendering.
 * Think blocks and code blocks are their own segments so they can be
 * rendered as stable Solid components (no DOM replacement on update).
 */
export function parseTextSegments(
	text: string,
	opts: ParseOptions = {}
): TextSegment[] {
	// Extract <think>...</think> blocks (only when the feature is enabled).
	const thinkBlocks: string[] = []
	if (opts.allowThink) {
		text = text.replace(/<think>([\s\S]*?)<\/think>\s*/g, (_, content) => {
			const idx = thinkBlocks.length
			thinkBlocks.push(content.trim())
			return "\x00THINK" + idx + "\x00"
		})
		text = text.replace(/<think>([\s\S]*)$/, (_, content) => {
			const idx = thinkBlocks.length
			thinkBlocks.push(content.trim())
			return "\x00THINK" + idx + "\x00"
		})
	}

	// Extract fenced code blocks (always — core feature).
	const codeBlocks: {lang: string; code: string}[] = []
	text = text.replace(/```([\w.-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
		const idx = codeBlocks.length
		codeBlocks.push({lang: lang || "", code})
		return "\x00CODEBLOCK" + idx + "\x00"
	})
	text = text.replace(/```([\w.-]*)\n([\s\S]+)$/, (_, lang, code) => {
		const idx = codeBlocks.length
		codeBlocks.push({lang: lang || "", code})
		return "\x00CODEBLOCK" + idx + "\x00"
	})

	// Split on placeholders, keeping delimiters
	const segments: TextSegment[] = []
	const re = /\x00(THINK|CODEBLOCK)(\d+)\x00/g
	let lastIndex = 0
	let m: RegExpExecArray | null
	while ((m = re.exec(text)) !== null) {
		const before = text.slice(lastIndex, m.index)
		if (before) {
			segments.push({type: "html", content: formatInlineHtml(before, opts)})
		}
		const kind = m[1]
		const idx = parseInt(m[2], 10)
		if (kind === "THINK") {
			segments.push({type: "think", content: thinkBlocks[idx]})
		} else {
			segments.push({type: "code", ...codeBlocks[idx]})
		}
		lastIndex = m.index + m[0].length
	}
	const tail = text.slice(lastIndex)
	if (tail) {
		segments.push({type: "html", content: formatInlineHtml(tail, opts)})
	}
	return segments
}

/** Format inline text (everything except think/code blocks) to an HTML string.
 * Inline `code`, emoticons and URL autolinking are structural; the delimiter
 * formatting comes from the active parser-extension rules. */
export function formatInlineHtml(text: string, opts: ParseOptions = {}): string {
	const {emoticonBlobUrls, rules = [], allowEmoticons} = opts
	const parts = text.split(/(`[^`]+`)/g)
	let out = ""
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			out += "<code>" + escapeHtml(parts[i].slice(1, -1)) + "</code>"
			continue
		}
		let s = escapeHtml(parts[i])
		const emoticonSlots: string[] = []
		if (allowEmoticons) {
			s = s.replace(/:([a-zA-Z0-9_+-]+):/g, (match, name) => {
				const placeholder = "\x00EMO" + emoticonSlots.length + "\x00"
				if (emoticonBlobUrls) {
					const blobUrl = emoticonBlobUrls[name]
					if (blobUrl) {
						emoticonSlots.push(
							'<img class="chat-emoticon-inline" src="' +
								blobUrl +
								'" alt=":' +
								escapeHtml(name) +
								':" title=":' +
								escapeHtml(name) +
								':">'
						)
						return placeholder
					}
				}
				const aliasLower = name.toLowerCase()
				if (EMOJI_ALIASES[aliasLower]) {
					emoticonSlots.push(
						'<span title=":' +
							escapeHtml(name) +
							':">' +
							EMOJI_ALIASES[aliasLower] +
							"</span>"
					)
					return placeholder
				}
				const lower = aliasLower.replace(/[-_]/g, " ")
				const found = EMOJI_DATA().find(e => e.name.toLowerCase() === lower)
				if (found) {
					emoticonSlots.push(
						'<span title=":' + escapeHtml(name) + ':">' + found.emoji + "</span>"
					)
					return placeholder
				}
				return match
			})
		}
		// Apply the active delimiter rules in order.
		for (const rule of rules) s = rule.apply(s)
		for (let j = 0; j < emoticonSlots.length; j++) {
			s = s.replace("\x00EMO" + j + "\x00", emoticonSlots[j])
		}
		s = s.replace(
			URL_RE,
			url =>
				'<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>"
		)
		out += s
	}
	return out
}

export function isEmojiOnly(text: string): boolean {
	const stripped = text
		.replace(/:[a-zA-Z0-9_+\-]+:/g, "")
		.replace(
			/[\p{Emoji_Presentation}\p{Extended_Pictographic}‍️︎⃣\u{1f3fb}-\u{1f3ff}\u{e0061}-\u{e007a}\u{e007f}]/gu,
			""
		)
		.trim()
	return stripped.length === 0 && text.trim().length > 0
}
