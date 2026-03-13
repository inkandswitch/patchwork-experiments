/**
 * markdown.js — GFM-style fenced code block parsing + shiki syntax highlighting
 *
 * Exports:
 *   parseBlocks(text)        → [{type:"text"|"code", content, lang?, closed?}]
 *   isSpecialLang(lang)      → boolean (patchwork-tool, file, etc.)
 *   highlightAllIn(container) → async, highlights unhighlighted <pre.md-pre> elements
 */

const SPECIAL_LANGS = new Set([
	"patchwork-tool",
	"file",
	"embed",
	"image",
	"tool-call",
])

let highlighterPromise = null

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = import("https://esm.sh/shiki@3.2.1")
			.then(({createHighlighter}) =>
				createHighlighter({
					themes: ["github-dark-default"],
					langs: [
						"javascript",
						"typescript",
						"html",
						"css",
						"json",
						"python",
						"bash",
						"shell",
						"jsx",
						"tsx",
						"markdown",
						"xml",
						"yaml",
						"rust",
						"go",
						"c",
						"cpp",
						"sql",
					],
				})
			)
			.catch(err => {
				console.warn("[markdown] shiki load failed:", err)
				highlighterPromise = null
				return null
			})
	}
	return highlighterPromise
}

// Start loading eagerly
getHighlighter()

/**
 * Parse text into prose and fenced code blocks.
 * Returns [{type: "text"|"code", content: string, lang?: string, closed?: boolean}]
 */
export function parseBlocks(text) {
	if (!text) return []
	const blocks = []
	const lines = text.split("\n")
	let textBuf = []
	let inCode = false
	let codeLang = ""
	let codeBuf = []

	for (const line of lines) {
		if (!inCode && /^```(\S*)/.test(line)) {
			if (textBuf.length) {
				blocks.push({type: "text", content: textBuf.join("\n")})
				textBuf = []
			}
			codeLang = line.slice(3).trim().split(/\s/)[0] || ""
			codeBuf = []
			inCode = true
		} else if (inCode && line.trimEnd() === "```") {
			blocks.push({
				type: "code",
				lang: codeLang,
				content: codeBuf.join("\n"),
				closed: true,
			})
			codeBuf = []
			inCode = false
			codeLang = ""
		} else if (inCode) {
			codeBuf.push(line)
		} else {
			textBuf.push(line)
		}
	}

	if (inCode) {
		blocks.push({
			type: "code",
			lang: codeLang,
			content: codeBuf.join("\n"),
			closed: false,
		})
	}
	if (textBuf.length) {
		blocks.push({type: "text", content: textBuf.join("\n")})
	}
	return blocks
}

export function isSpecialLang(lang) {
	return SPECIAL_LANGS.has(lang)
}

/** Map special block types to a real language for highlighting */
function mapLang(lang) {
	if (SPECIAL_LANGS.has(lang)) return "html"
	return lang || "text"
}

/**
 * Highlight a code string. Returns HTML string or null.
 */
export async function highlightCode(code, lang) {
	const hl = await getHighlighter()
	if (!hl) return null
	try {
		let useLang = mapLang(lang)
		const loaded = hl.getLoadedLanguages()
		if (useLang !== "text" && !loaded.includes(useLang)) {
			try {
				await hl.loadLanguage(useLang)
			} catch {
				useLang = "text"
			}
		}
		return hl.codeToHtml(code, {
			lang: useLang,
			theme: "github-dark-default",
		})
	} catch {
		return null
	}
}

/**
 * Async-highlight all unhighlighted <pre.md-pre> in a container.
 * Replaces each <pre> with shiki's output, preserving data attributes.
 */
export async function highlightAllIn(container) {
	const pres = container.querySelectorAll("pre.md-pre:not([data-hl])")
	for (const pre of pres) {
		const code = pre.querySelector("code")
		if (!code) continue
		const lang = pre.dataset.lang || ""
		const text = code.textContent
		if (!text.trim()) continue
		const html = await highlightCode(text, lang)
		if (!html) continue
		const tmp = document.createElement("template")
		tmp.innerHTML = html
		const newPre = tmp.content.querySelector("pre")
		if (newPre) {
			newPre.classList.add("md-pre")
			newPre.dataset.hl = "1"
			newPre.dataset.lang = lang
			newPre.style.margin = "0"
			newPre.style.borderRadius = "4px"
			newPre.style.padding = "8px 10px"
			newPre.style.overflow = "auto"
			pre.replaceWith(newPre)
		}
	}
}
