// End-to-end smoke test: downloads the pinned pandoc.wasm and runs a few
// conversions through the pandoc-wasm core. Run with `node scripts/smoke-test.mjs`.
import {createPandocInstance} from "../node_modules/pandoc-wasm/src/core.js"

const url = "https://unpkg.com/pandoc-wasm@1.0.1/src/pandoc.wasm"
console.log(`downloading ${url} ...`)
const response = await fetch(url)
if (!response.ok) throw new Error(`HTTP ${response.status}`)
const binary = await response.arrayBuffer()
console.log(`got ${(binary.byteLength / 1024 / 1024).toFixed(1)} MB, instantiating ...`)

const pandoc = await createPandocInstance(binary)

console.log("version:", pandoc.query({query: "version"}))
console.log("input formats:", pandoc.query({query: "input-formats"}).length)
console.log("output formats:", pandoc.query({query: "output-formats"}).length)

// markdown -> html (text output via output-file + input-files)
const md = "# Hello\n\nSome **bold** text and a [link](https://example.com).\n"
const result = await pandoc.convert(
	{from: "markdown", to: "html", standalone: true, "output-file": "out.html", "input-files": ["test.md"]},
	null,
	{"test.md": md}
)
const html = await result.files["out.html"].text()
if (!html.includes("<strong>bold</strong>")) throw new Error("html conversion failed:\n" + html)
console.log("markdown -> html OK,", html.length, "chars")

// markdown -> docx (binary output)
const result2 = await pandoc.convert(
	{from: "markdown", to: "docx", "output-file": "out.docx", "input-files": ["test.md"]},
	null,
	{"test.md": md}
)
const docx = result2.files["out.docx"]
if (!(docx instanceof Blob) || docx.size < 1000) throw new Error("docx conversion failed")
console.log("markdown -> docx OK,", docx.size, "bytes")

// html -> markdown
const result3 = await pandoc.convert(
	{from: "html", to: "markdown", "output-file": "out.md", "input-files": ["in.html"]},
	null,
	{"in.html": "<h1>Title</h1><p>Hello <em>world</em></p>"}
)
const backToMd = await result3.files["out.md"].text()
if (!backToMd.includes("# Title")) throw new Error("html -> markdown failed:\n" + backToMd)
console.log("html -> markdown OK:", JSON.stringify(backToMd.trim()))

console.log("all smoke tests passed")
