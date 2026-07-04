// The full-tier inline-formatting rules (the base keeps only core `italic`/`bold`).
// Pure data — `re`/`repl` are cloneable, so these ride raw in the registry with no
// `load()`. Each already carries a `name` title.
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
	{type: "chat:parser-extension", id: "spoiler", name: "Spoiler", tier: "full", re: /\|\|([^|]+?)\|\|/g, repl: '<span class="chat-spoiler">$1</span>'},
	{type: "chat:parser-extension", id: "marquee", name: "Marquee", tier: "full", re: /&lt;&gt;(.+?)&lt;&gt;/g, repl: "<marquee>$1</marquee>"},
	{type: "chat:parser-extension", id: "inverted", name: "Inverted", tier: "full", re: /%%([^%]+?)%%/g, repl: '<span class="chat-inverted">$1</span>'},
	{type: "chat:parser-extension", id: "strike", name: "Strikethrough", tier: "full", re: /~~([^~]+?)~~/g, repl: "<s>$1</s>"},
]
