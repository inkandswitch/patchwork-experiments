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

// The base owns only the core `italic`/`bold` rules; the rest come from chitter.
export const parserExtensionPlugins: ParserExtension[] = [
	{type: "chat:parser-extension", id: "italic", name: "Italic", tier: "core", re: /(?<![_\w])_([^_]+?)_(?![_.\w])/g, repl: "<em>$1</em>"},
	{type: "chat:parser-extension", id: "bold", name: "Bold", tier: "core", re: /\*([^*]+?)\*/g, repl: "<strong>$1</strong>"},
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
