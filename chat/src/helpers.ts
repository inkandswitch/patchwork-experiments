import type {EmbedLink, SlashCommandResult} from "./types"

export function generateId(): string {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	})
}

export function formatDuration(s: number): string {
	const m = Math.floor(s / 60)
	return m + ":" + Math.floor(s % 60).toString().padStart(2, "0")
}

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

export const URL_RE = /https?:\/\/[^\s<>]+/g

export function formatTextPreview(text: string): string {
	const parts = text.split(/(`[^`]+`)/g)
	let out = ""
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			const inner = escapeHtml(parts[i])
			out += "<code>" + inner + "</code>"
			continue
		}
		let s = escapeHtml(parts[i])
		s = s.replace(/\._([^_]+?)_\./g, "<sub>._$1_.</sub>")
		s = s.replace(/\.\^([^^]+?)\^\./g, "<sup>.^$1^.</sup>")
		s = s.replace(/___([^_]+?)___/g, "<u><em>___$1___</em></u>")
		s = s.replace(/__([^_]+?)__/g, "<u>__$1__</u>")
		s = s.replace(/(?<![_])_([^_]+?)_(?![_.])/g, "<em>_$1_</em>")
		s = s.replace(/\*([^*]+?)\*/g, "<strong>*$1*</strong>")
		s = s.replace(
			/\|\|([^|]+?)\|\|/g,
			'<span class="chat-spoiler revealed">||$1||</span>'
		)
		s = s.replace(
			/&lt;&gt;(.+?)&lt;&gt;/g,
			'<span style="color:var(--accent)">&lt;&gt;$1&lt;&gt;</span>'
		)
		s = s.replace(
			/%%([^%]+?)%%/g,
			'<span class="chat-inverted">%%$1%%</span>'
		)
		s = s.replace(/~~([^~]+?)~~/g, "<s>~~$1~~</s>")
		out += s
	}
	return out
}

export function formatText(
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
		s = s.replace(/\._([^_]+?)_\./g, "<sub>$1</sub>")
		s = s.replace(/\.\^([^^]+?)\^\./g, "<sup>$1</sup>")
		s = s.replace(/___([^_]+?)___/g, "<u><em>$1</em></u>")
		s = s.replace(/__([^_]+?)__/g, "<u>$1</u>")
		s = s.replace(/(?<![_])_([^_]+?)_(?![_.])/g, "<em>$1</em>")
		s = s.replace(/\*([^*]+?)\*/g, "<strong>$1</strong>")
		s = s.replace(
			/\|\|([^|]+?)\|\|/g,
			'<span class="chat-spoiler">$1</span>'
		)
		s = s.replace(/&lt;&gt;(.+?)&lt;&gt;/g, "<marquee>$1</marquee>")
		s = s.replace(
			/%%([^%]+?)%%/g,
			'<span class="chat-inverted">$1</span>'
		)
		s = s.replace(/~~([^~]+?)~~/g, "<s>$1</s>")
		if (emoticonBlobUrls) {
			s = s.replace(/:([a-zA-Z0-9_-]+):/g, (match, name) => {
				const blobUrl = emoticonBlobUrls[name]
				if (blobUrl)
					return (
						'<img class="chat-emoticon-inline" src="' +
						blobUrl +
						'" alt=":' +
						escapeHtml(name) +
						':" title=":' +
						escapeHtml(name) +
						':">'
					)
				return match
			})
		}
		s = s.replace(
			URL_RE,
			(url) =>
				'<a href="' +
				url +
				'" target="_blank" rel="noopener">' +
				url +
				"</a>"
		)
		out += s
	}
	return out
}

export const TINY_PW_RE =
	/https?:\/\/tiny\.patchwork\.inkandswitch\.com\/#[^\s]+/g

export function parsePatchworkLinks(text: string): EmbedLink[] {
	const links: EmbedLink[] = []
	let match
	while ((match = TINY_PW_RE.exec(text)) !== null) {
		try {
			const parsed = new URL(match[0])
			if (parsed.hash) {
				const params = new URLSearchParams(parsed.hash.slice(1))
				const docId = params.get("doc")
				if (docId) {
					links.push({
						docUrl: ("automerge:" + docId) as any,
						title: params.get("title")
							? decodeURIComponent(
									params.get("title")!.replace(/\+/g, " ")
								)
							: "",
						type: params.get("type") || "",
						originalUrl: match[0],
					})
				}
			}
		} catch (e) {}
	}
	TINY_PW_RE.lastIndex = 0
	return links
}

export const NAMED_COLORS: Record<
	string,
	{light: string; dark: string}
> = {
	red: {light: "oklch(0.55 0.25 25)", dark: "oklch(0.72 0.22 25)"},
	orange: {light: "oklch(0.62 0.22 55)", dark: "oklch(0.78 0.18 55)"},
	yellow: {light: "oklch(0.60 0.20 95)", dark: "oklch(0.88 0.18 95)"},
	green: {light: "oklch(0.50 0.20 145)", dark: "oklch(0.75 0.22 145)"},
	teal: {light: "oklch(0.50 0.14 180)", dark: "oklch(0.75 0.14 180)"},
	cyan: {light: "oklch(0.52 0.15 210)", dark: "oklch(0.80 0.15 210)"},
	blue: {light: "oklch(0.50 0.22 260)", dark: "oklch(0.72 0.18 260)"},
	indigo: {light: "oklch(0.45 0.25 280)", dark: "oklch(0.68 0.20 280)"},
	purple: {light: "oklch(0.50 0.25 300)", dark: "oklch(0.72 0.22 300)"},
	pink: {light: "oklch(0.55 0.25 340)", dark: "oklch(0.75 0.22 340)"},
	hotpink: {light: "oklch(0.55 0.30 350)", dark: "oklch(0.75 0.28 350)"},
	magenta: {light: "oklch(0.52 0.28 320)", dark: "oklch(0.72 0.25 320)"},
	coral: {light: "oklch(0.58 0.20 35)", dark: "oklch(0.78 0.18 35)"},
	gold: {light: "oklch(0.58 0.18 85)", dark: "oklch(0.85 0.16 85)"},
	lime: {light: "oklch(0.52 0.22 130)", dark: "oklch(0.82 0.25 130)"},
	lavender: {light: "oklch(0.50 0.18 290)", dark: "oklch(0.78 0.15 290)"},
	salmon: {light: "oklch(0.55 0.18 25)", dark: "oklch(0.78 0.16 25)"},
	white: {light: "oklch(0.35 0 0)", dark: "oklch(0.95 0 0)"},
	black: {light: "oklch(0.20 0 0)", dark: "oklch(0.60 0 0)"},
	grey: {light: "oklch(0.45 0 0)", dark: "oklch(0.70 0 0)"},
	gray: {light: "oklch(0.45 0 0)", dark: "oklch(0.70 0 0)"},
	neonmint: {light: "oklch(0.85 0.30 160)", dark: "oklch(0.85 0.30 160)"},
}

export function resolveNamedColor(name: string, isLightBg: boolean): string {
	const entry = NAMED_COLORS[name.toLowerCase()]
	if (entry) return isLightBg ? entry.light : entry.dark
	return name
}

export function parseToken(str: string): [string, string] | null {
	str = str.trimStart()
	if (str.startsWith('"')) {
		const end = str.indexOf('"', 1)
		if (end < 0) return null
		return [str.slice(1, end), str.slice(end + 1).trimStart()]
	}
	const sp = str.indexOf(" ")
	if (sp < 0) return [str, ""]
	return [str.slice(0, sp), str.slice(sp + 1)]
}

export function parseSlashCommand(text: string): SlashCommandResult | null {
	if (text.startsWith("/me ")) {
		return {action: true, text: text.slice(4)}
	}
	const slapMatch = text.match(/^\/slap\s+(.+)/)
	if (slapMatch) {
		return {
			action: true,
			text: "slaps " + slapMatch[1].trim() + " with a large trout",
		}
	}
	if (text.startsWith("/font ")) {
		const parsed = parseToken(text.slice(6))
		if (parsed && parsed[1])
			return {overrideFont: parsed[0], text: parsed[1]}
	}
	if (text.startsWith("/color ") || text.startsWith("/colour ")) {
		const offset = text.startsWith("/colour ") ? 8 : 7
		const parsed = parseToken(text.slice(offset))
		if (parsed && parsed[1])
			return {overrideColor: parsed[0], text: parsed[1]}
	}
	if (text.startsWith("/face ")) {
		const p1 = parseToken(text.slice(6))
		if (p1) {
			const p2 = parseToken(p1[1])
			if (p2 && p2[1])
				return {
					overrideColor: p1[0],
					overrideFont: p2[0],
					text: p2[1],
				}
		}
	}
	if (text.startsWith("/marquee ")) {
		return {marquee: true, text: text.slice(9)}
	}
	return null
}
