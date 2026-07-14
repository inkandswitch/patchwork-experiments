// Chitter's full-tier inline formatting, contributed to the base chat tool as
// `chat:syntax` plugins (the base owns only core bold/italic). Each is a cute.txt-
// shaped mark spec behind `async load()`, matched against the RAW message string
// (which contains its own delimiters) — NOT escaped HTML like the old
// `chat:parser-extension` rules. So the marquee delimiter is a literal `<>`, not
// the previously-escaped `&lt;&gt;`. Classes emit chat's names so chat.css applies.

interface SyntaxSpec {
	pattern: RegExp
	toDOM: (attrs?: any) => any
	key?: string
	wrap?: string
	raw?: boolean
}

interface SyntaxPlugin {
	type: "chat:syntax"
	id: string
	name: string
	tier: "core" | "full"
	kind: "mark" | "block" | "replace"
	load: () => Promise<SyntaxSpec>
}

export const syntaxPlugins: SyntaxPlugin[] = [
	{type: "chat:syntax", id: "sub", name: "Subscript", tier: "full", kind: "mark",
		async load() { return {pattern: /\._([^_\n]+?)_\./, toDOM: () => ["sub"]} }},
	{type: "chat:syntax", id: "sup", name: "Superscript", tier: "full", kind: "mark",
		async load() { return {pattern: /\.\^([^^\n]+?)\^\./, toDOM: () => ["sup"]} }},
	{type: "chat:syntax", id: "underline-em", name: "Underline italic", tier: "full", kind: "mark",
		async load() { return {pattern: /___([^_\n]+?)___/, toDOM: () => ["span", {class: "chat-underline-em"}], wrap: "___"} }},
	{type: "chat:syntax", id: "underline", name: "Underline", tier: "full", kind: "mark",
		async load() { return {pattern: /__([^_\n]+?)__/, toDOM: () => ["u"], key: "Mod-u", wrap: "__"} }},
	{type: "chat:syntax", id: "spoiler", name: "Spoiler", tier: "full", kind: "mark",
		async load() { return {pattern: /\|\|([^|\n]+?)\|\|/, toDOM: () => ["span", {class: "chat-spoiler"}], wrap: "||"} }},
	{type: "chat:syntax", id: "marquee", name: "Marquee", tier: "full", kind: "mark",
		async load() { return {pattern: /<>([^\n]+?)<>/, toDOM: () => ["marquee"], wrap: "<>"} }},
	{type: "chat:syntax", id: "inverted", name: "Inverted", tier: "full", kind: "mark",
		async load() { return {pattern: /%%([^%\n]+?)%%/, toDOM: () => ["span", {class: "chat-inverted"}], wrap: "%%"} }},
	{type: "chat:syntax", id: "strike", name: "Strikethrough", tier: "full", kind: "mark",
		async load() { return {pattern: /~~([^~\n]+?)~~/, toDOM: () => ["s"], wrap: "~~"} }},
]
