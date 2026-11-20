/**
 * What a file document is, for a model to read.
 *
 * A file in Patchwork is a document whose content is a string (text written
 * as text) or bytes (everything else, and text that arrived as a file). Read
 * as data, bytes are a count — "<20 bytes>" — which tells a model nothing, so
 * a CSV dropped into a conversation, a PDF datasheet or a spreadsheet could
 * not be read at all. This says what a file is and gives the model the form it
 * can use:
 *
 *   text     decoded, and read like any string
 *   image    shown (images.js)
 *   pdf      handed to the model as the PDF itself, which current models read
 *            natively, figures and tables included
 *   office   a Word, Excel or PowerPoint file's text, taken from the XML inside
 *            it (no dependency: the platform's own decompression)
 *   binary   named for what it is, and said to be unreadable here
 */

import { imageTypeOf } from "./images.js"

/** Types and extensions that are text, whatever bytes they arrive as. */
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|toml|x-sh|sql|csv|x-ndjson|ld\+json|geo\+json)|image\/svg\+xml)/i
const TEXT_EXTENSIONS = new Set(
  "txt md markdown csv tsv json jsonl ndjson xml yaml yml toml ini cfg conf log js mjs cjs ts tsx jsx css scss html htm svg py rb rs go java c h cpp hpp cs sh bash zsh sql scad tex bib r jl lua swift kt php pl ipynb geojson".split(" ")
)
const OFFICE = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

const extensionOf = (doc) => String(doc?.extension ?? String(doc?.name ?? "").split(".").pop() ?? "").toLowerCase().replace(/^\./, "")
const isBytes = (v) => v instanceof Uint8Array

/** Bytes as UTF-8 text, or null when they are not text: invalid UTF-8, or a NUL in them. */
export function decodeIfText(bytes) {
  if (!isBytes(bytes)) return null
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return text.includes("\u0000") ? null : text
}

/** Is this a PDF, by its bytes or what it says it is? */
function isPdf(doc) {
  const b = doc.content
  if (isBytes(b) && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return true
  return /application\/pdf/i.test(String(doc.mimeType ?? "")) || extensionOf(doc) === "pdf"
}

/** Which Office format, by what the file says it is (a zip either way). */
function officeFormat(doc) {
  const ext = extensionOf(doc)
  if (OFFICE[ext]) return ext
  const mime = String(doc.mimeType ?? "")
  return Object.keys(OFFICE).find((k) => OFFICE[k] === mime) ?? null
}

/**
 * What a file document is.
 *
 *   { kind: "text", text, type } | { kind: "image", type } | { kind: "pdf" }
 *   | { kind: "office", format } | { kind: "binary", type } | null (not a file)
 */
export function fileKind(doc) {
  if (!doc || !("content" in doc)) return null
  const content = doc.content
  const type = doc.mimeType ?? null
  if (typeof content === "string" || content?.constructor?.name === "ImmutableString") return { kind: "text", text: String(content), type }
  if (!isBytes(content)) return null
  const image = imageTypeOf(doc)
  if (image) return { kind: "image", type: image }
  if (isPdf(doc)) return { kind: "pdf" }
  const office = officeFormat(doc)
  if (office) return { kind: "office", format: office }
  const declaredText = TEXT_TYPES.test(String(type ?? "")) || TEXT_EXTENSIONS.has(extensionOf(doc))
  const text = decodeIfText(content)
  if (text != null && (declaredText || !type || type === "application/octet-stream")) return { kind: "text", text, type }
  return { kind: "binary", type }
}

// ---------------------------------------------------------------- office

/** The files inside a zip, by name, each as a function giving its bytes. */
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record: within the last 64 KB plus 22 bytes.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error("not a zip file")
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("a damaged zip directory")
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, async () => {
      const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = bytes.subarray(dataAt, dataAt + size)
      if (method === 0) return data
      if (method !== 8) throw new Error(`zip method ${method} is not supported`)
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
const unescapeXml = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m))
const textOfXml = (xml) => unescapeXml(xml.replace(/<[^>]+>/g, ""))

async function xmlAt(entries, name) {
  const get = entries.get(name)
  return get ? new TextDecoder().decode(await get()) : null
}

/** A Word document's paragraphs, a spreadsheet's sheets as rows, a deck's slides. */
export async function officeText(bytes, format) {
  const entries = await unzip(bytes)
  if (format === "docx") {
    const xml = (await xmlAt(entries, "word/document.xml")) ?? ""
    return textOfXml(xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<\/w:p>/g, "\n")).replace(/\n{3,}/g, "\n\n").trim()
  }
  if (format === "pptx") {
    const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    const out = []
    for (const [i, name] of slides.entries()) {
      const xml = await xmlAt(entries, name)
      const paragraphs = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => [...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => unescapeXml(t[1])).join("")).filter(Boolean)
      out.push(`## Slide ${i + 1}\n${paragraphs.join("\n")}`)
    }
    return out.join("\n\n").trim()
  }
  if (format === "xlsx") {
    const shared = [...((await xmlAt(entries, "xl/sharedStrings.xml")) ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(""))
    const workbook = (await xmlAt(entries, "xl/workbook.xml")) ?? ""
    const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unescapeXml(m[1]))
    const sheets = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    const out = []
    for (const [i, name] of sheets.entries()) {
      const xml = await xmlAt(entries, name)
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map(([, attrs, inner = ""]) => {
            const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ""
            return /t="s"/.test(attrs) ? shared[Number(v)] ?? "" : unescapeXml(v)
          })
          .join("\t")
      )
      out.push(`## ${names[i] ?? `Sheet ${i + 1}`}\n${rows.join("\n")}`)
    }
    return out.join("\n\n").trim()
  }
  throw new Error(`${format} is not an office format this reads`)
}

// ---------------------------------------------------------------- files in a request

/** The largest file handed to a model with a request. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

const fileCache = new Map() // url -> { bytes, data }, a few, newest last

function base64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** A file document's bytes as a data URL, or why not. */
async function dataOf(repo, ref) {
  let doc
  try {
    doc = (await repo.find(ref.url)).doc()
  } catch {
    return { error: "it could not be opened" }
  }
  const bytes = doc?.content
  if (!(bytes instanceof Uint8Array)) return { error: "it holds no file" }
  if (bytes.byteLength > MAX_FILE_BYTES) return { error: `it is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, more than the ${MAX_FILE_BYTES / 1024 / 1024} MB sent` }
  const cached = fileCache.get(ref.url)
  if (cached?.bytes === bytes.byteLength) return { data: cached.data }
  const data = `data:${ref.mimeType ?? doc.mimeType ?? "application/pdf"};base64,${base64(bytes)}`
  fileCache.set(ref.url, { bytes: bytes.byteLength, data })
  if (fileCache.size > 4) fileCache.delete(fileCache.keys().next().value)
  return { data }
}

/**
 * Load the files a request refers to — a tool result's `file`, a person's
 * attached PDF — just before it is sent. The session document holds only
 * references; a file that cannot be had becomes a line saying so, and the
 * turn goes ahead.
 */
export async function withFileData(messages, repo) {
  if (!repo) return messages
  for (const message of messages) {
    const content = message.content ?? []
    for (let i = 0; i < content.length; i++) {
      const part = content[i]
      if (part.type === "file" && part.url && !part.data) {
        const got = await dataOf(repo, part)
        content[i] = got.data ? { ...part, data: got.data } : { type: "text", text: `[The attached ${part.name ?? "file"} could not be sent: ${got.error}.]` }
      } else if (part.type === "result" && part.file?.url && !part.file.data) {
        const got = await dataOf(repo, part.file)
        if (got.data) part.file = { ...part.file, data: got.data }
        else {
          part.output = `${part.output}\n[The file could not be sent: ${got.error}.]`
          delete part.file
        }
      }
    }
  }
  return messages
}

/** A short line on what a file is: its name, type and size. */
export function describeFile(doc, kind) {
  const size = isBytes(doc.content) ? doc.content.byteLength : String(doc.content ?? "").length
  const what = kind?.kind === "office" ? kind.format : kind?.kind === "pdf" ? "application/pdf" : doc.mimeType ?? kind?.type ?? "unknown type"
  return `'${doc.name ?? doc.title ?? "file"}' (${what}, ${size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} B`})`
}
