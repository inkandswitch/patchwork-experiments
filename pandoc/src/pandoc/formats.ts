// Format metadata, adapted from the official pandoc-wasm demo app
// (https://github.com/pandoc/pandoc-wasm).

export const formatNames: Record<string, string> = {
	ansi: "ANSI terminal",
	asciidoc: "AsciiDoc",
	asciidoc_legacy: "AsciiDoc (asciidoc-py)",
	asciidoctor: "AsciiDoctor",
	bbcode: "BBCode",
	beamer: "LaTeX Beamer slides",
	biblatex: "BibLaTeX bibliography",
	bibtex: "BibTeX bibliography",
	bits: "BITS XML",
	chunkedhtml: "Chunked HTML (zip)",
	commonmark: "CommonMark",
	commonmark_x: "CommonMark (extended)",
	context: "ConTeXt",
	creole: "Creole 1.0",
	csljson: "CSL JSON bibliography",
	csv: "CSV table",
	djot: "Djot",
	docbook: "DocBook v4",
	docbook5: "DocBook v5",
	docx: "Word (docx)",
	dokuwiki: "DokuWiki",
	dzslides: "DZSlides",
	endnotexml: "EndNote XML",
	epub: "EPUB v3",
	epub2: "EPUB v2",
	epub3: "EPUB v3",
	fb2: "FictionBook2",
	gfm: "GitHub Markdown",
	haddock: "Haddock",
	html: "HTML",
	html4: "XHTML 1.0",
	html5: "HTML5",
	icml: "InDesign ICML",
	ipynb: "Jupyter notebook",
	jats: "JATS XML",
	jira: "Jira wiki",
	json: "Pandoc AST (JSON)",
	latex: "LaTeX",
	man: "roff man",
	markdown: "Markdown (Pandoc)",
	markdown_mmd: "MultiMarkdown",
	markdown_phpextra: "PHP Markdown Extra",
	markdown_strict: "Markdown (strict)",
	markua: "Markua",
	mdoc: "mdoc man page",
	mediawiki: "MediaWiki",
	ms: "roff ms",
	muse: "Muse",
	native: "Native Haskell",
	odt: "OpenDocument (odt)",
	opendocument: "OpenDocument XML",
	opml: "OPML",
	org: "Org mode",
	pdf: "PDF (via Typst)",
	plain: "Plain text",
	pod: "Perl POD",
	pptx: "PowerPoint (pptx)",
	revealjs: "reveal.js slides",
	ris: "RIS bibliography",
	rst: "reStructuredText",
	rtf: "Rich Text Format",
	s5: "S5 slides",
	slideous: "Slideous slides",
	slidy: "Slidy slides",
	t2t: "txt2tags",
	tei: "TEI Simple",
	texinfo: "GNU Texinfo",
	textile: "Textile",
	tikiwiki: "TikiWiki",
	tsv: "TSV table",
	twiki: "TWiki",
	typst: "Typst",
	vimdoc: "Vimdoc",
	vimwiki: "Vimwiki",
	xlsx: "Excel (xlsx)",
	xml: "Pandoc AST (XML)",
	xwiki: "XWiki",
	zimwiki: "ZimWiki",
}

export function formatLabel(format: string): string {
	return formatNames[format] || format
}

/** Maps a file extension to the pandoc reader to use when autodetecting. */
export const formatByExtension: Record<string, string> = {
	md: "markdown",
	markdown: "markdown",
	mkd: "markdown",
	txt: "markdown",
	html: "html",
	htm: "html",
	tex: "latex",
	latex: "latex",
	rst: "rst",
	org: "org",
	docx: "docx",
	odt: "odt",
	epub: "epub",
	json: "json",
	ipynb: "ipynb",
	xml: "docbook",
	wiki: "mediawiki",
	textile: "textile",
	rtf: "rtf",
	bib: "bibtex",
	csv: "csv",
	tsv: "tsv",
	typ: "typst",
	typst: "typst",
	pptx: "pptx",
	xlsx: "xlsx",
	adoc: "asciidoc",
	dj: "djot",
	muse: "muse",
	t2t: "t2t",
	opml: "opml",
	fb2: "fb2",
	pod: "pod",
	man: "man",
	"1": "man",
}

/** Output file extension for each writer. */
export const extensionByFormat: Record<string, string> = {
	html: "html",
	html5: "html",
	html4: "html",
	chunkedhtml: "zip",
	markdown: "md",
	markdown_strict: "md",
	markdown_mmd: "md",
	markdown_phpextra: "md",
	gfm: "md",
	commonmark: "md",
	commonmark_x: "md",
	latex: "tex",
	beamer: "tex",
	context: "tex",
	docx: "docx",
	odt: "odt",
	pdf: "pdf",
	epub: "epub",
	epub2: "epub",
	epub3: "epub",
	rst: "rst",
	org: "org",
	plain: "txt",
	ansi: "txt",
	json: "json",
	native: "native",
	docbook: "xml",
	docbook4: "xml",
	docbook5: "xml",
	jats: "xml",
	jats_archiving: "xml",
	jats_articleauthoring: "xml",
	jats_publishing: "xml",
	tei: "xml",
	man: "1",
	rtf: "rtf",
	textile: "textile",
	mediawiki: "wiki",
	asciidoc: "adoc",
	asciidoctor: "adoc",
	asciidoc_legacy: "adoc",
	revealjs: "html",
	slidy: "html",
	slideous: "html",
	dzslides: "html",
	s5: "html",
	ipynb: "ipynb",
	typst: "typ",
	texinfo: "texi",
	ms: "ms",
	icml: "icml",
	opml: "opml",
	bibtex: "bib",
	biblatex: "bib",
	csljson: "json",
	pptx: "pptx",
	djot: "dj",
	fb2: "fb2",
	opendocument: "xml",
	vimdoc: "txt",
	muse: "muse",
	xwiki: "xwiki",
	zimwiki: "txt",
	dokuwiki: "txt",
	tikiwiki: "txt",
	twiki: "txt",
	jira: "txt",
	haddock: "txt",
	markua: "md",
	bbcode: "txt",
}

/** Writers whose output is a binary file rather than text. */
export const binaryFormats = new Set([
	"docx",
	"odt",
	"pptx",
	"epub",
	"epub2",
	"epub3",
	"chunkedhtml",
])

/** Writers whose output can be previewed as a rendered HTML page. */
export const htmlPreviewFormats = new Set([
	"html",
	"html4",
	"html5",
	"revealjs",
	"slidy",
	"slideous",
	"dzslides",
	"s5",
])

/**
 * Static fallbacks shown in the dropdowns until the live lists are queried
 * from the loaded pandoc instance (which is the source of truth).
 */
export const FALLBACK_INPUT_FORMATS = [
	"asciidoc", "biblatex", "bibtex", "commonmark", "commonmark_x", "creole",
	"csljson", "csv", "djot", "docbook", "docx", "dokuwiki", "endnotexml",
	"epub", "fb2", "gfm", "haddock", "html", "ipynb", "jats", "jira", "json",
	"latex", "man", "markdown", "markdown_mmd", "markdown_phpextra",
	"markdown_strict", "mdoc", "mediawiki", "muse", "native", "odt", "opml",
	"org", "pod", "ris", "rst", "rtf", "t2t", "textile", "tikiwiki", "tsv",
	"twiki", "typst", "vimwiki",
]

export const FALLBACK_OUTPUT_FORMATS = [
	"ansi", "asciidoc", "asciidoc_legacy", "beamer", "biblatex", "bibtex",
	"chunkedhtml", "commonmark", "commonmark_x", "context", "csljson", "djot",
	"docbook", "docbook5", "docx", "dokuwiki", "dzslides", "epub", "epub2",
	"epub3", "fb2", "gfm", "haddock", "html", "html4", "html5", "icml",
	"ipynb", "jats", "jira", "json", "latex", "man", "markdown",
	"markdown_mmd", "markdown_phpextra", "markdown_strict", "markua",
	"mediawiki", "ms", "muse", "native", "odt", "opendocument", "opml", "org",
	"pdf", "plain", "pptx", "revealjs", "rst", "rtf", "s5", "slideous", "slidy",
	"tei", "texinfo", "textile", "typst", "vimdoc", "xwiki", "zimwiki",
]

/** Mime types for saved/downloaded outputs, keyed by file extension. */
export const mimeByExtension: Record<string, string> = {
	html: "text/html",
	md: "text/markdown",
	tex: "application/x-tex",
	json: "application/json",
	xml: "application/xml",
	txt: "text/plain",
	rst: "text/x-rst",
	org: "text/org",
	typ: "text/plain",
	adoc: "text/asciidoc",
	rtf: "application/rtf",
	ipynb: "application/x-ipynb+json",
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	odt: "application/vnd.oasis.opendocument.text",
	epub: "application/epub+zip",
	zip: "application/zip",
	bib: "text/x-bibtex",
	wiki: "text/plain",
	texi: "text/plain",
	icml: "application/xml",
	opml: "text/x-opml",
}

export function extensionOf(name: string): string {
	const base = name.split("/").pop() || name
	const i = base.lastIndexOf(".")
	return i > 0 ? base.slice(i + 1).toLowerCase() : ""
}

/** Detect the reader to use for a file name; null if unknown. */
export function detectFormat(name: string): string | null {
	return formatByExtension[extensionOf(name)] || null
}

/** Default output format when "to" is set to autodetect. */
export function autoOutputFormat(fromFormat: string): string {
	if (fromFormat === "markdown" || fromFormat.startsWith("markdown_")) {
		return "html"
	}
	if (["html", "html4", "html5", "docx", "odt", "epub", "rtf", "latex"].includes(fromFormat)) {
		return "markdown"
	}
	return "html"
}

/** True if the file looks like a document pandoc can read (vs. a resource like an image). */
export function isConvertibleDocument(name: string): boolean {
	return detectFormat(name) !== null
}
