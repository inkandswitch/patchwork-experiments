import {EMOJI_ALIASES, EMOJI_DATA} from "./emoji-data"

const URL_RE = /https?:\/\/[^\s<>]+/g

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

export function formatText(
	text: string,
	emoticonBlobUrls?: Record<string, string>
): string {
	// Extract <think>...</think> blocks (Qwen3 reasoning) — closed and unclosed
	const thinkBlocks: string[] = []
	// Closed think blocks
	text = text.replace(/<think>([\s\S]*?)<\/think>\s*/g, (_, content) => {
		const idx = thinkBlocks.length
		thinkBlocks.push(content.trim())
		return "\x00THINK" + idx + "\x00"
	})
	// Unclosed <think> at end (still streaming)
	text = text.replace(/<think>([\s\S]*)$/, (_, content) => {
		const idx = thinkBlocks.length
		thinkBlocks.push(content.trim())
		return "\x00THINK" + idx + "\x00"
	})

	// Extract fenced code blocks first (before single-backtick processing)
	// Match both closed ```...``` and unclosed ```...(end of string) for streaming
	const codeBlocks: {lang: string; code: string}[] = []
	text = text.replace(/```([\w.-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
		const idx = codeBlocks.length
		codeBlocks.push({lang: lang || "", code})
		return "\x00CODEBLOCK" + idx + "\x00"
	})
	// Unclosed code fence at end of string (streaming)
	text = text.replace(/```([\w.-]*)\n([\s\S]+)$/, (_, lang, code) => {
		const idx = codeBlocks.length
		codeBlocks.push({lang: lang || "", code})
		return "\x00CODEBLOCK" + idx + "\x00"
	})

	const parts = text.split(/(`[^`]+`)/g)
	let out = ""
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			out += "<code>" + escapeHtml(parts[i].slice(1, -1)) + "</code>"
			continue
		}
		let s = escapeHtml(parts[i])
		const emoticonSlots: string[] = []
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
		// Order matters: specific delimiters first
		s = s.replace(/\._([^_]+?)_\./g, "<sub>$1</sub>")
		s = s.replace(/\.\^([^^]+?)\^\./g, "<sup>$1</sup>")
		s = s.replace(/___([^_]+?)___/g, "<u><em>$1</em></u>")
		s = s.replace(/__([^_]+?)__/g, "<u>$1</u>")
		s = s.replace(/(?<![_\w])_([^_]+?)_(?![_.\w])/g, "<em>$1</em>")
		s = s.replace(/\*([^*]+?)\*/g, "<strong>$1</strong>")
		s = s.replace(/\|\|([^|]+?)\|\|/g, '<span class="chat-spoiler">$1</span>')
		s = s.replace(/&lt;&gt;(.+?)&lt;&gt;/g, "<marquee>$1</marquee>")
		s = s.replace(/%%([^%]+?)%%/g, '<span class="chat-inverted">$1</span>')
		s = s.replace(/~~([^~]+?)~~/g, "<s>$1</s>")
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

	// Replace think block placeholders
	for (let j = 0; j < thinkBlocks.length; j++) {
		const content = thinkBlocks[j]
		const escaped = escapeHtml(content)
		out = out.replace(
			"\x00THINK" + j + "\x00",
			'<details class="chat-think-block"><summary>thinking</summary><div class="chat-think-content">' + escaped + '</div></details>'
		)
	}

	// Replace fenced code block placeholders
	for (let j = 0; j < codeBlocks.length; j++) {
		const {lang, code} = codeBlocks[j]
		const escaped = escapeHtml(code.replace(/\n$/, ""))
		const langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : ""
		out = out.replace(
			"\x00CODEBLOCK" + j + "\x00",
			'<pre class="chat-code-block"><code' + langAttr + ">" + escaped + "</code></pre>"
		)
	}

	return out
}

export type TextSegment =
	| {type: "html"; content: string}
	| {type: "think"; content: string}
	| {type: "code"; lang: string; code: string}

/**
 * Parse text into structured segments for Solid rendering.
 * Think blocks and code blocks are their own segments so they can be
 * rendered as stable Solid components (no DOM replacement on update).
 */
export function parseTextSegments(
	text: string,
	emoticonBlobUrls?: Record<string, string>
): TextSegment[] {
	// Extract <think>...</think> blocks
	const thinkBlocks: string[] = []
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

	// Extract fenced code blocks
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
			segments.push({type: "html", content: formatInlineHtml(before, emoticonBlobUrls)})
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
		segments.push({type: "html", content: formatInlineHtml(tail, emoticonBlobUrls)})
	}
	return segments
}

/** Format inline text (everything except think/code blocks) to HTML string */
function formatInlineHtml(
	text: string,
	emoticonBlobUrls?: Record<string, string>
): string {
	const parts = text.split(/(`[^`]+`)/g)
	let out = ""
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			out += "<code>" + escapeHtml(parts[i].slice(1, -1)) + "</code>"
			continue
		}
		let s = escapeHtml(parts[i])
		const emoticonSlots: string[] = []
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
		s = s.replace(/\._([^_]+?)_\./g, "<sub>$1</sub>")
		s = s.replace(/\.\^([^^]+?)\^\./g, "<sup>$1</sup>")
		s = s.replace(/___([^_]+?)___/g, "<u><em>$1</em></u>")
		s = s.replace(/__([^_]+?)__/g, "<u>$1</u>")
		s = s.replace(/(?<![_\w])_([^_]+?)_(?![_.\w])/g, "<em>$1</em>")
		s = s.replace(/\*([^*]+?)\*/g, "<strong>$1</strong>")
		s = s.replace(/\|\|([^|]+?)\|\|/g, '<span class="chat-spoiler">$1</span>')
		s = s.replace(/&lt;&gt;(.+?)&lt;&gt;/g, "<marquee>$1</marquee>")
		s = s.replace(/%%([^%]+?)%%/g, '<span class="chat-inverted">$1</span>')
		s = s.replace(/~~([^~]+?)~~/g, "<s>$1</s>")
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
			/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f\ufe0e\u20e3\u{1f3fb}-\u{1f3ff}\u{e0061}-\u{e007a}\u{e007f}]/gu,
			""
		)
		.trim()
	return stripped.length === 0 && text.trim().length > 0
}
