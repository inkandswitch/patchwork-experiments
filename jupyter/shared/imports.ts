/**
 * Linked documents in a notebook, and what a run records about them.
 *
 * A notebook's imports live in its nbformat metadata, so the notebook stays a
 * valid .ipynb and other tools carry them along untouched:
 *
 *   metadata.patchwork.imports   [{ name, docUrl }]
 *                                `name` is the Python module the document is
 *                                importable as; `docUrl` is the linked
 *                                document (automerge:…).
 *   metadata.patchwork.run       what the last run ran with (RunRecord).
 *
 * Before every run each import is resolved live, turned into a module's
 * source (moduleSource), and written into the kernel (setupCode). Where the
 * source comes from, in order:
 *
 *   1. hook       the linked document's datatype, looked up in the plugin
 *                 registry by its `@patchwork.type`, has `asSource(doc, "py")`
 *                 returning a string: that text (an assumptions register
 *                 gives its Python export).
 *   2. py-file    a file document whose name ends in .py: its text.
 *   3. notebook   another jupyter-notebook: its code cells, run quietly, so
 *                 one notebook imports another's functions.
 *   4. json       anything else: the document as JSON, bound as the dict
 *                 `data` in the module.
 *
 * Everything here is pure: no DOM, no repo, no kernel.
 */

export type NotebookImport = { name: string; docUrl: string }

export type SourceKind = "hook" | "py-file" | "notebook" | "json" | "missing"

/** What one import resolved to: the module's kind and source, and what it was made from. */
export type ResolvedImport = {
  name: string
  docUrl: string
  kind: SourceKind
  /** The linked document's title, for people. */
  title: string
  /** Its heads at resolution time; empty for a document that couldn't be opened. */
  heads: string[]
  /** The datatype id it was resolved by, when it has one. */
  type: string | null
  /** The Python module's text. */
  module: string
  /** Why a missing import is missing. */
  problem?: string
}

/** What a run ran with, kept as `metadata.patchwork.run`. */
export type RunRecord = {
  /** When it started and finished (ISO); `finished` is null while it runs. */
  at: string
  finished: string | null
  status: "running" | "ok" | "error" | "stopped"
  /** Who started it. */
  by: "person" | "agent"
  /** The code cells run, by id, in order. */
  cells: string[]
  /** Whether the kernel was fresh (nothing earlier ran in it) or carried on from earlier runs. */
  kernel: "fresh" | "continued"
  /** The notebook's code when the run started (codeFingerprint). */
  code: string
  /** The notebook's outputs when it finished (outputsFingerprint): which outputs this record describes. */
  outputs: string | null
  /** The notebook's own heads when the run began, before it wrote anything. */
  startHeads: string[]
  /**
   * The notebook's heads right after the run's last output write, taken
   * before the change that finishes this record (which writes only
   * metadata.patchwork.run, so the outputs at finishHeads are the outputs
   * after it). Null while running.
   */
  finishHeads: string[] | null
  /** Each import as resolved: its document's version and how it was bound; `hash` is its module text's. */
  imports: Array<{ name: string; docUrl: string; title: string; heads: string[]; as: SourceKind; type: string | null; hash: string; problem?: string }>
  /** Every document the cells read with patchwork.load, at the version they read, and what they read of it. */
  reads: ReadRecord[]
  /** Why the run didn't start, when it couldn't. */
  problem?: string
  /** The first cell that raised, when one did: its id, its 1-based position, and the exception (evalue cut to 300 characters). */
  error?: { cell: string; number: number; ename: string; evalue: string }
}

/**
 * One document a run read with patchwork.load: its version, which view
 * ("raw": the document; "json": its datatype's JSON view), and each path the
 * cells read, with the hash of what was there (a value, or with `keys` the
 * keys of a mapping or length of a list). Path [] is the whole document.
 */
export type ReadRecord = {
  docUrl: string
  title: string
  heads: string[]
  as: "raw" | "json"
  paths: Array<{ path: Array<string | number>; keys?: boolean; hash: string }>
}

/** A datatype implementation as the registry hands it out, as far as this file cares. */
export type DatatypeHook = { asSource?: (doc: unknown, ext: string) => unknown } | null | undefined

// ---------------------------------------------------------------- reading

/** A string as Automerge may hold it: plain, or an ImmutableString. */
export const str = (v: unknown): string => {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof (v as { val?: unknown }).val === "string") return (v as { val: string }).val
  if (v instanceof Uint8Array || ArrayBuffer.isView(v)) return new TextDecoder("utf-8", { fatal: false }).decode(v as Uint8Array)
  const text = String(v)
  return text === "[object Object]" ? "" : text
}

const joined = (v: unknown): string => (Array.isArray(v) ? v.map(str).join("") : str(v))

/** The notebook's imports, as stored; entries without a name or a URL are skipped. */
export function importsOf(doc: any): NotebookImport[] {
  const list = doc?.metadata?.patchwork?.imports
  if (!Array.isArray(list)) return []
  return list.map((i: any) => ({ name: str(i?.name), docUrl: str(i?.docUrl) })).filter(i => i.name && i.docUrl)
}

/** The last run's record, or null. */
export function runOf(doc: any): RunRecord | null {
  const run = doc?.metadata?.patchwork?.run
  return run && typeof run === "object" ? (JSON.parse(JSON.stringify(run)) as RunRecord) : null
}

// ---------------------------------------------------------------- names

/** Python's keywords and the names a module must not take. */
const KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
)

/** Why `name` can't be an import's name, or null when it can. The kernel also refuses a name that hides an installed module. */
export function nameProblem(name: string, others: Iterable<string> = []): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `"${name}" isn't a Python name: letters, digits and _, not starting with a digit`
  if (KEYWORDS.has(name)) return `"${name}" is a Python keyword`
  if (name.startsWith("__")) return `"${name}" starts with __, which Python keeps for itself`
  for (const other of others) if (other === name) return `another import is already called "${name}"`
  return null
}

/** A module name from a document's title: lower case, _ for anything else, unique among `taken`. */
export function importName(title: string | undefined, taken: Iterable<string> = []): string {
  let name = String(title ?? "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (!name) name = "data"
  if (/^[0-9]/.test(name)) name = `_${name}`
  if (KEYWORDS.has(name)) name = `${name}_`
  const used = new Set(taken)
  if (!used.has(name)) return name
  let i = 2
  while (used.has(`${name}_${i}`)) i++
  return `${name}_${i}`
}

// ---------------------------------------------------------------- sources

/** A document's datatype id, however Automerge holds the string; null when it has none. */
export function typeOf(doc: any): string | null {
  return str(doc?.["@patchwork"]?.type) || null
}

/** A linked document's title, as Patchwork shows it. */
export function titleOf(doc: any): string {
  return str(doc?.title) || str(doc?.name) || "Untitled"
}

/** Whether a document is a file document holding Python. */
export function isPythonFile(doc: any): boolean {
  if (!doc || doc.content == null) return false
  const ext = str(doc.extension).replace(/^\./, "").toLowerCase()
  return ext === "py" || /\.py$/i.test(str(doc.name))
}

export function isNotebook(doc: any): boolean {
  return typeOf(doc) === "jupyter-notebook" || Array.isArray(doc?.cells)
}

/** A notebook's code cells, joined, with IPython-only lines (%magic, !shell) kept as comments so the module still compiles. */
export function notebookCode(doc: any): string {
  const cells = Array.isArray(doc?.cells) ? doc.cells : []
  return cells
    .filter((c: any) => str(c?.cell_type) === "code")
    .map((c: any) =>
      joined(c.source)
        .split("\n")
        .map(line => line.replace(/^(\s*)([%!].*)$/, "$1pass  # $2"))
        .join("\n"),
    )
    .join("\n\n")
}

const IMMUTABLE_STRING = Symbol.for("_am_immutableString")
const COUNTER = Symbol.for("_am_counter")
const own = (value: object, symbol: symbol) => Object.prototype.hasOwnProperty.call(value, symbol)

/** The tag bytes travel under in JSON; patchwork.load turns `{"$bytes": base64}` back into Python bytes. */
export const BYTES_TAG = "$bytes"

function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * The one conversion from an Automerge document to plain JSON, used for
 * patchwork.load's data, its datatype JSON views' input, the `data` dict of
 * an import bound as JSON, and the hashes in the read record:
 *
 *   ImmutableString   a string (anywhere: top level, nested, in lists)
 *   Text              a string (Automerge already reads it as one)
 *   Counter           its number
 *   Uint8Array        { "$bytes": base64 }, which arrives in Python as bytes
 *   Date              its ISO 8601 string (UTC); Python gets a str, not a datetime
 *   keys starting "@" dropped (Patchwork's own bookkeeping), as are
 *   functions and undefined; anything else unrecognised is null.
 */
export function docToJson(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return Number(value)
  if (typeof value !== "object") return null
  if (own(value, IMMUTABLE_STRING)) return String((value as { val: unknown }).val)
  if (own(value, COUNTER)) return Number((value as { value: unknown }).value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return { [BYTES_TAG]: base64(value) }
  if (ArrayBuffer.isView(value)) return { [BYTES_TAG]: base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
  if (Array.isArray(value)) return Array.from(value, docToJson)
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith("@") || typeof item === "function" || item === undefined) continue
    out[key] = docToJson(item)
  }
  return out
}

/** A Python string literal for any text. JSON's string syntax is a subset of Python's. */
export const pyString = (text: string): string => JSON.stringify(text)

/**
 * Where an import's source comes from, and its text, in the order above.
 * `hook` is the linked document's datatype implementation (or null when it
 * has none, or when the registry couldn't be consulted).
 */
export function sourceOf(doc: any, hook: DatatypeHook): { kind: Exclude<SourceKind, "missing">; text: string } {
  if (typeof hook?.asSource === "function") {
    let text: unknown = null
    try {
      text = hook.asSource(doc, "py")
    } catch (error) {
      throw new Error(`its datatype couldn't give Python source (${(error as Error)?.message ?? error})`)
    }
    if (typeof text === "string") return { kind: "hook", text }
  }
  if (isPythonFile(doc)) return { kind: "py-file", text: str(doc.content) }
  if (isNotebook(doc)) return { kind: "notebook", text: notebookCode(doc) }
  return { kind: "json", text: JSON.stringify(docToJson(doc) ?? {}) }
}

/** The module's text for one import. */
export function moduleSource(
  imp: NotebookImport,
  resolved: { kind: SourceKind; text: string; title: string; problem?: string },
): string {
  const header = `# ${imp.name}: ${resolved.title.replace(/\s+/g, " ")} (${imp.docUrl}), imported live by the notebook; edit that document, not this file.`
  switch (resolved.kind) {
    case "hook":
    case "py-file":
      return `${header}\n${resolved.text}\n`
    case "notebook":
      // Run quietly, as its own module: its printed results stay in its own
      // outputs, and code under `if __name__ == "__main__":` doesn't run.
      return [
        header,
        "import contextlib as _pw_contextlib, io as _pw_io",
        `with _pw_contextlib.redirect_stdout(_pw_io.StringIO()):`,
        `    exec(compile(${pyString(resolved.text)}, ${pyString(resolved.title)}, "exec"), globals())`,
        "del _pw_contextlib, _pw_io",
        "",
      ].join("\n")
    case "json":
      return [
        header,
        "import base64 as _pw_base64, json as _pw_json",
        `data = _pw_json.loads(${pyString(resolved.text)}, object_hook=lambda o: _pw_base64.b64decode(o[${pyString(BYTES_TAG)}]) if len(o) == 1 and ${pyString(BYTES_TAG)} in o else o)`,
        "del _pw_base64, _pw_json",
        "",
      ].join("\n")
    case "missing":
      return `${header}\nraise ImportError(${pyString(`couldn't open "${resolved.title}" for import ${imp.name}: ${resolved.problem ?? "it isn't available"}`)})\n`
  }
}

/** Where the documents a run can patchwork.load are written, with index.json naming them. */
export const DOCUMENTS_DIR = "/tmp/patchwork_documents"

/**
 * What patchwork.load reads: `index.names` maps import names to URLs;
 * `index.documents[url]` names the files holding the document (`raw`) and
 * its datatype's JSON view (`json`, when it has one), or says why it couldn't
 * be opened (`problem`).
 */
export type DocumentFiles = {
  index: { names: Record<string, string>; documents: Record<string, { title: string; raw?: string; json?: string; problem?: string }> }
  files: Record<string, string>
}

/** The code that reads which documents and which paths the run's cells loaded, printed as JSON. */
export const READS_CODE = [
  "def _pw_reads():",
  "    import json",
  "    try:",
  "        import patchwork.documents",
  "    except ImportError:",
  "        return '[]'",
  "    return json.dumps(patchwork.documents.reads())",
  "print(_pw_reads())",
  "del _pw_reads",
].join("\n")

/** Document URLs written as literals in the notebook's code cells: the documents patchwork.load may read. */
export function documentUrlsIn(doc: any): string[] {
  const cells: any[] = Array.isArray(doc?.cells) ? doc.cells : []
  const out = new Set<string>()
  for (const cell of cells) {
    if (str(cell?.cell_type) !== "code") continue
    for (const m of joined(cell.source).matchAll(/automerge:[1-9A-HJ-NP-Za-km-z]{16,}/g)) out.add(m[0])
  }
  return [...out]
}

/** The value at a path in plain data, or undefined. */
export function valueAt(data: unknown, path: ReadonlyArray<string | number>): unknown {
  let at: any = data
  for (const key of path) {
    if (at == null || typeof at !== "object") return undefined
    at = at[key as any]
  }
  return at
}

/** JSON with keys sorted, so equal values hash equally. */
function canonical(value: unknown): string {
  if (value === undefined) return "\u2205"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(",")}}`
}

/** What a read saw at a path: the value's hash, or with `keys` the hash of a mapping's keys or a list's length. */
export function readHash(data: unknown, path: ReadonlyArray<string | number>, keys = false): string {
  const at = valueAt(data, path)
  if (!keys) return hash(canonical(at))
  if (Array.isArray(at)) return hash(`#${at.length}`)
  if (at && typeof at === "object") return hash(canonical(Object.keys(at).sort()))
  return hash(canonical(at))
}

/** A module's hash without its header line, so a document's title doesn't count as a change to what it gives. */
export function moduleHash(module: string): string {
  return hash(module.slice(module.indexOf("\n") + 1))
}

/** The directory in the kernel's filesystem the modules are written to, first on sys.path. */
export const IMPORTS_DIR = "/tmp/patchwork_imports"

/**
 * The silent code that makes `modules` ({ name: text }) importable before a
 * run: written to IMPORTS_DIR, which goes first on sys.path; every module
 * from an earlier run dropped from sys.modules (so `import x` reads the new
 * text) and its file removed when it is no longer an import; and any module
 * the notebook's namespace already holds rebound to the new one. It raises,
 * naming them, when a name would hide one of Python's own modules or an
 * installed package.
 */
export function setupCode(modules: Record<string, string>, documents: DocumentFiles = { index: { names: {}, documents: {} }, files: {} }): string {
  return `def _pw_documents(index, files, root=${pyString(DOCUMENTS_DIR)}):
    import os, shutil
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root, exist_ok=True)
    for name, text in files.items():
        with open(os.path.join(root, name), "w", encoding="utf-8") as f:
            f.write(text)
    with open(os.path.join(root, "index.json"), "w", encoding="utf-8") as f:
        f.write(__import__("json").dumps(index))
    try:
        import patchwork.documents
        patchwork.documents._begin(index)
    except ImportError:
        pass
_pw_documents(__import__("json").loads(${pyString(JSON.stringify(documents.index))}), __import__("json").loads(${pyString(JSON.stringify(documents.files))}))
del _pw_documents
def _pw_imports(modules, root=${pyString(IMPORTS_DIR)}):
    import importlib, importlib.util, os, sys, types
    import __main__
    os.makedirs(root, exist_ok=True)
    if root in sys.path:
        sys.path.remove(root)
    for file in os.listdir(root):
        if file.endswith(".py"):
            sys.modules.pop(file[:-3], None)
            if file[:-3] not in modules:
                os.remove(os.path.join(root, file))
    importlib.invalidate_caches()
    hidden = []
    for name in modules:
        sys.modules.pop(name, None)
        if name in sys.stdlib_module_names or name in sys.builtin_module_names or importlib.util.find_spec(name) is not None:
            hidden.append(name)
    if hidden:
        raise ImportError("rename the import" + ("s " if len(hidden) > 1 else " ") + ", ".join(hidden) + ": " + ("they would hide modules" if len(hidden) > 1 else "it would hide a module") + " Python already has")
    for name, text in modules.items():
        with open(os.path.join(root, name + ".py"), "w", encoding="utf-8") as f:
            f.write(text)
    sys.path.insert(0, root)
    importlib.invalidate_caches()
    for key, value in list(vars(__main__).items()):
        if isinstance(value, types.ModuleType) and value.__name__ in modules:
            try:
                setattr(__main__, key, importlib.import_module(value.__name__))
            except Exception:
                delattr(__main__, key)
_pw_imports(__import__("json").loads(${pyString(JSON.stringify(modules))}))
del _pw_imports
`
}

// ---------------------------------------------------------------- fingerprints
//
// The same functions as the assumptions register's where.js (codeOf,
// runKeyOf), so the register can tell which outputs a run record describes.
// Copied, not imported: the two packages stay standalone. test/imports.spec.ts
// pins both to fixed values.

/** A short, stable hash of a string (cyrb53), as hex. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/**
 * What a run rests on in the notebook: its code cells' source (all cells'
 * when it has no code; its heads when it has no text at all). Any change
 * counts, comments and whitespace included.
 */
export function codeFingerprint(doc: any, heads: readonly string[] = []): string {
  const cells: any[] = Array.isArray(doc?.cells) ? doc.cells : []
  const code = cells.filter(c => str(c?.cell_type) === "code")
  const texts = (code.length ? code : cells).map(c => joined(c?.source))
  if (texts.some(t => t.trim())) return `t:${hash(texts.join("\n\u0000\n"))}`
  return `h:${[...heads].sort().join(",")}`
}

function outputText(out: any): string {
  if (str(out?.output_type) === "stream") return joined(out.text)
  return joined(out?.data?.["text/plain"])
}

/** The notebook's outputs with their execution counts: moves when it is run, not when its code is edited. */
export function outputsFingerprint(doc: any): string | null {
  if (!Array.isArray(doc?.cells)) return null
  const cells = doc.cells.filter((c: any) => str(c?.cell_type) === "code").map((c: any) => [c.execution_count ?? null, (c.outputs ?? []).map(outputText)])
  return `r:${hash(JSON.stringify(cells))}`
}

// ---------------------------------------------------------------- results

const RESULT_LINE = /^\s*([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\s*(?:[:=]\s*|\s+)([-+]?(?:\d[\d_,]*\.?\d*|\.\d+)(?:e[-+]?\d+)?\b.*?)\s*$/i

/** Lines of output that give a result as `id value` ("boat_drag_N 1020.4", "prop_P_kW = 46.1 kW"). */
export function resultLines(text: string): Array<{ id: string; value: string; line: string }> {
  const out: Array<{ id: string; value: string; line: string }> = []
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(RESULT_LINE)
    if (m) out.push({ id: m[1], value: m[2], line: line.trim().slice(0, 160) })
  }
  return out
}
