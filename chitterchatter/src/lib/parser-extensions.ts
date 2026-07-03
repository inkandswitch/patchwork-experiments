// Built-in `chat:parser-extension` plugins — the inline delimiter rules, split
// into core (always available in the minimal `chat` tool) and full tiers.
//
// A parser-extension plugin is a simple, SYNCHRONOUS descriptor (like newspace's
// layer-transform plugins — no async load()):
//   { type:"chat:parser-extension", id, name, tier:"core"|"full",
//     re: RegExp, repl: string }                 // regex replace on the escaped run
//   { ..., apply(escapedHtml): string }          // or an arbitrary transform
// Rules run in registration order on the escaped-HTML working string, AFTER inline
// `code` and emoticons are protected and BEFORE URL autolinking. Order matters
// (e.g. ___ before __ before _), so keep this list canonical.

export interface ParserExtension {
	type: "chat:parser-extension"
	id: string
	name: string
	tier: "core" | "full"
	re?: RegExp
	repl?: string
	apply?: (s: string) => string
}

export const parserExtensionPlugins: ParserExtension[] = [
	{type: "chat:parser-extension", id: "sub", name: "Subscript", tier: "full", re: /\._([^_]+?)_\./g, repl: "<sub>$1</sub>"},
	{type: "chat:parser-extension", id: "sup", name: "Superscript", tier: "full", re: /\.\^([^^]+?)\^\./g, repl: "<sup>$1</sup>"},
	{type: "chat:parser-extension", id: "underline-em", name: "Underline italic", tier: "full", re: /___([^_]+?)___/g, repl: "<u><em>$1</em></u>"},
	{type: "chat:parser-extension", id: "underline", name: "Underline", tier: "full", re: /__([^_]+?)__/g, repl: "<u>$1</u>"},
	{type: "chat:parser-extension", id: "italic", name: "Italic", tier: "core", re: /(?<![_\w])_([^_]+?)_(?![_.\w])/g, repl: "<em>$1</em>"},
	{type: "chat:parser-extension", id: "bold", name: "Bold", tier: "core", re: /\*([^*]+?)\*/g, repl: "<strong>$1</strong>"},
	{type: "chat:parser-extension", id: "spoiler", name: "Spoiler", tier: "full", re: /\|\|([^|]+?)\|\|/g, repl: '<span class="chat-spoiler">$1</span>'},
	{type: "chat:parser-extension", id: "marquee", name: "Marquee", tier: "full", re: /&lt;&gt;(.+?)&lt;&gt;/g, repl: "<marquee>$1</marquee>"},
	{type: "chat:parser-extension", id: "inverted", name: "Inverted", tier: "full", re: /%%([^%]+?)%%/g, repl: '<span class="chat-inverted">$1</span>'},
	{type: "chat:parser-extension", id: "strike", name: "Strikethrough", tier: "full", re: /~~([^~]+?)~~/g, repl: "<s>$1</s>"},
]

export interface InlineRule {
	id: string
	apply: (s: string) => string
}

// Adapt a parser-extension plugin (regex-or-apply) into a callable inline rule.
export function toInlineRule(p: ParserExtension): InlineRule {
	if (typeof p.apply === "function") return {id: p.id, apply: p.apply}
	const {re, repl} = p
	return {
		id: p.id,
		apply: (s: string) => (re ? s.replace(re, repl ?? "") : s),
	}
}
