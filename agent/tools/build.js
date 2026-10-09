/**
 * Building a package, inside the browser.
 *
 * A bundleless tool needs no build. A TypeScript tool, or one with npm
 * dependencies like three.js, does — and the obvious way to get one is to shell
 * out to a machine with node and run `pnpm install && vite build`. That is the
 * wrong shape for this system, for two reasons:
 *
 *   - **Sandbox.** `npm install` runs arbitrary postinstall scripts on a real
 *     filesystem. Bundling inside the page executes none of the dependency's
 *     code; esbuild only parses it. The browser's sandbox is the security
 *     boundary we already trust everything else to.
 *   - **Portability.** A build that needs a particular machine is a build most
 *     people cannot run. This one runs wherever Patchwork runs.
 *
 * So: esbuild compiled to wasm, a resolver that reads source out of the package
 * document, and dependencies fetched as ESM and inlined. Worker tier, because
 * none of it needs a DOM — it runs in a tab or in a SharedWorker.
 *
 * The result goes back into the package document as `dist/index.js`, so the
 * package is still a folder of files and installs exactly like any other.
 */

import { truncate, bytes } from "./format.js"
import { contentToText, isFile, treeNode, treeEntries, treeEnter, treeAdd, treeRepin } from "./folders.js"

/** Pinned, because a build that changes under you is not a build. */
export const ESBUILD_VERSION = "0.21.5"

/**
 * esbuild-wasm's BROWSER entry, explicitly.
 *
 * The package's main entry is the node build — esm.sh happily serves it with a
 * `node/buffer` shim, and it has no `initialize`, which fails at the least
 * helpful moment. `esm/browser.min.js` is the one that runs in a page, and it
 * loads the wasm from a URL you hand it.
 */
const esbuildModuleUrl = (version) =>
  `https://cdn.jsdelivr.net/npm/esbuild-wasm@${version}/esm/browser.min.js`
const esbuildWasmUrl = (version) =>
  `https://cdn.jsdelivr.net/npm/esbuild-wasm@${version}/esbuild.wasm`

/** Where a bare specifier is fetched from when it is not in the importmap. */
export const CDN = "https://esm.sh"

/**
 * Specifiers Patchwork resolves at runtime through its importmap.
 *
 * These must stay external: bundling a second copy of automerge into a tool
 * would give it a different wasm instance and a different Repo, and nothing
 * would sync. Everything else gets inlined.
 */
export const IMPORTMAP_EXTERNALS = [
  "@automerge/automerge",
  "@automerge/automerge-repo",
  "@automerge/automerge-repo-network-messagechannel",
  "@automerge/automerge-repo-network-websocket",
  "@automerge/automerge-repo-storage-indexeddb",
  "@automerge/automerge-repo-keyhive",
  "@keyhive/keyhive",
  "@inkandswitch/patchwork-bootloader",
  "@inkandswitch/patchwork-elements",
  "@inkandswitch/patchwork-filesystem",
  "@inkandswitch/patchwork-plugins",
  "@inkandswitch/patchwork-providers",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/commands",
  "solid-js",
]

export function isExternal(specifier) {
  return IMPORTMAP_EXTERNALS.some(
    (external) => specifier === external || specifier.startsWith(`${external}/`)
  )
}

/** esbuild's loader for a path, by extension. */
/**
 * Which esbuild loader a file wants.
 *
 * The binary entries matter as much as the source ones: a `.wasm` imported for
 * its bytes wants the `binary` loader (a Uint8Array at runtime), and an image
 * or font wants `dataurl` so it ends up inside a single-file bundle rather than
 * as a fetch to a path that will not exist.
 */
export function loaderFor(path) {
  const extension = String(path).split(".").pop()?.toLowerCase()
  if (extension === "ts") return "ts"
  if (extension === "tsx") return "tsx"
  if (extension === "jsx") return "jsx"
  if (extension === "json") return "json"
  if (extension === "css") return "css"
  if (extension === "txt" || extension === "md") return "text"
  if (extension === "wasm") return "binary"
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "woff", "woff2", "ttf", "otf"].includes(extension)) {
    return "dataurl"
  }
  return "js"
}

/**
 * Resolve a relative import against the files in the package.
 *
 * Tries the literal path, then the usual extensions, then index files — the
 * conventions every bundler implements and every author assumes.
 */
export function resolveInPackage(files, importer, specifier) {
  const base = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : ""
  const joined = specifier.startsWith("/")
    ? specifier.slice(1)
    : normalizePath(base ? `${base}/${specifier}` : specifier)

  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.json`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
  ]
  return candidates.find((candidate) => files.has(candidate)) ?? null
}

/** Collapse `.` and `..` segments. */
export function normalizePath(path) {
  const out = []
  for (const part of String(path).split("/")) {
    if (!part || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}

/**
 * The package's entry point, from package.json's `main`, else a conventional guess.
 *
 * `main` names what Patchwork loads, which in a built package is this build's
 * own output. Before the first build that file does not exist; after it, it
 * does, and taking it as the entry meant every rebuild bundled the previous
 * bundle and quietly ignored every edit to the source.
 */
export function entryPointFor(files, explicit, outfile = "dist/index.js") {
  if (explicit) return explicit

  const manifest = files.get("package.json")
  if (manifest) {
    try {
      const main = JSON.parse(manifest).main
      if (main) {
        const cleaned = normalizePath(main.replace(/^\.\//, ""))
        if (files.has(cleaned) && cleaned !== normalizePath(outfile)) return cleaned
        // `main` usually points at the build output; fall through to the
        // source conventions below.
      }
    } catch {
      /* a malformed package.json is not fatal here */
    }
  }

  return ["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.tsx", "index.js"].find(
    (candidate) => files.has(candidate)
  ) ?? null
}

// ---------------------------------------------------------------- documents

/** Walk a package folder document into a flat map of path → contents. */
/**
 * A file's contents, as the kind of thing it actually is.
 *
 * Bytes stay bytes. Running everything through a UTF-8 decoder — which is what
 * this used to do — turns a wasm module into replacement characters on the way
 * to esbuild, and esbuild takes a Uint8Array for `contents` perfectly happily.
 * Text still comes back as text, including automerge's ImmutableString.
 */
export function fileContents(content) {
  if (content instanceof Uint8Array) return content
  if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
  return contentToText(content)
}

export async function materialize(repo, folderUrl, { maxFiles = 400 } = {}) {
  const files = new Map()

  // A package is a folder document of file documents, or one directory
  // document with a key per path (pushwork's shape); the tree helpers read both.
  const walk = async ({ node, handle }, prefix, depth) => {
    if (depth > 12 || files.size >= maxFiles) return
    if (node) {
      for (const entry of treeEntries(node)) {
        await walk(await treeEnter(repo, entry), prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1)
      }
      return
    }
    const doc = handle.doc()
    if (isFile(doc)) files.set(prefix, fileContents(doc.content))
  }

  const root = await repo.find(folderUrl)
  await walk({ node: treeNode(root), handle: root }, "", 0)
  return files
}

/**
 * Write build output back into the package document.
 *
 * Files are created or updated in place, so the document keeps its identity and
 * its history — and an already-installed module picks up the new build without
 * being reinstalled. In a directory document a link pinned to heads is moved to
 * the new heads, or Patchwork would go on serving the previous build.
 */
export async function absorb(repo, folderUrl, outputs, { makeFile, makeFolder }) {
  const written = []

  const folderFor = async (parts) => {
    let node = treeNode(await repo.find(folderUrl))
    if (!node) throw new Error(`${folderUrl} is not a folder or a directory document.`)
    for (const part of parts) {
      const existing = treeEntries(node).find((entry) => entry.name === part)
      if (existing) {
        ;({ node } = await treeEnter(repo, existing))
        if (!node) throw new Error(`'${part}' is a file, so build output cannot go inside it.`)
      } else if (node.prefix !== null) {
        node = { handle: node.handle, prefix: `${node.prefix}${part}/` }
      } else {
        const created = await makeFolder(part)
        node.handle.change((draft) => {
          if (!draft.docs) draft.docs = []
          draft.docs.push({ name: part, type: "folder", url: created.url })
        })
        node = { handle: created, prefix: null }
      }
    }
    return node
  }

  for (const [path, content] of outputs) {
    const parts = path.split("/").filter(Boolean)
    const name = parts.pop()
    const folder = await folderFor(parts)
    const existing = treeEntries(folder).find((entry) => entry.name === name)

    if (existing) {
      const { handle: file } = await treeEnter(repo, existing)
      file.change((draft) => {
        draft.content = content
      })
      treeRepin(folder, existing, file)
      written.push(`${path} · updated, ${bytes(content.length)}`)
    } else {
      const file = await makeFile(name, content)
      treeAdd(folder, name, file.url)
      written.push(`${path} · created, ${bytes(content.length)}`)
    }
  }

  return written
}

/** Document constructors for absorb, so callers do not have to supply them. */
export function makers(repo) {
  return {
    async makeFile(name, content) {
      const handle = await repo.create2()
      const extension = name.includes(".") ? name.split(".").pop() : ""
      handle.change((doc) => {
        doc.name = name
        doc.extension = extension
        doc.mimeType = extension === "js" ? "text/javascript" : "text/plain"
        doc.content = content
        doc["@patchwork"] = { type: "file" }
      })
      return handle
    },
    async makeFolder(name) {
      const handle = await repo.create2()
      handle.change((doc) => {
        doc.title = name
        doc.docs = []
        doc["@patchwork"] = { type: "folder" }
      })
      return handle
    },
  }
}

// ---------------------------------------------------------------- esbuild

/**
 * Where the "have we initialized esbuild yet" answer lives.
 *
 * On globalThis, deliberately, and not in a module-level variable — which is
 * where it used to be, and which was a bug.
 *
 * `esbuild.initialize()` may be called exactly once per esbuild module, and the
 * browser keys modules by absolute URL. This file gets imported at more than
 * one URL in normal use: a heads-pinned import and an unpinned one are
 * different modules, and after a sync a tab can hold both. Two copies of this
 * file meant two guards standing in front of one esbuild, so the second copy
 * called `initialize()` again and got `Cannot call "initialize" more than once`
 * — reported to the agent as a failed package_test, which looked like a problem
 * with the package under test and was not.
 *
 * esbuild's own state is per-realm, so the shared answer has to be per-realm
 * too. `Symbol.for` gives every copy the same key. Reproduced and fixed against
 * the deployed shell: probes/esbuild-twice.mjs.
 */
const ESBUILD_READY = Symbol.for("patchwork.agent.esbuild")

/** How long to wait for an initialization somebody else started. */
const INIT_WAIT_MS = 30000

/**
 * Is esbuild finished initializing?
 *
 * There is no flag to read, and `build()` does NOT wait — while initialization
 * is in flight every API call throws "You need to wait for the promise returned
 * from initialize to be resolved". So the only honest test is to try something
 * trivial and see which error comes back.
 */
async function usable(esbuild) {
  try {
    await esbuild.transform("", { loader: "js" })
    return true
  } catch (err) {
    if (/need to wait|need to call/i.test(String(err?.message ?? err))) return false
    throw err
  }
}

/**
 * Load and initialize esbuild-wasm once per realm.
 *
 * Imported by absolute URL rather than bare specifier, so this works in a
 * worker, where there is no importmap.
 */
export async function loadEsbuild({ version = ESBUILD_VERSION, importModule } = {}) {
  const url = esbuildModuleUrl(version)
  const shared = (globalThis[ESBUILD_READY] ??= new Map())
  const existing = shared.get(url)
  if (existing) return existing

  const ready = (async () => {
    const load = importModule ?? ((specifier) => import(/* @vite-ignore */ specifier))
    const esbuild = await load(url)
    try {
      await esbuild.initialize({ wasmURL: esbuildWasmUrl(version), worker: true })
    } catch (err) {
      // Somebody else initialized this esbuild — an older copy of this file, or
      // another package sharing the same CDN module. That is fine; it just
      // means waiting for their initialization rather than starting ours.
      if (!/more than once/i.test(String(err?.message ?? err))) throw err
      const deadline = Date.now() + INIT_WAIT_MS
      while (!(await usable(esbuild))) {
        if (Date.now() > deadline) throw new Error("esbuild was initialized elsewhere but never became usable.")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    return esbuild
  })()

  shared.set(url, ready)
  try {
    return await ready
  } catch (err) {
    shared.delete(url) // let a later call try again
    throw err
  }
}

/** Tests only. */
export function _resetEsbuild() {
  globalThis[ESBUILD_READY] = new Map()
}

/**
 * The plugin that makes esbuild read a document instead of a disk.
 *
 * Three namespaces: files from the package, modules fetched from the CDN, and
 * specifiers left external for the importmap to resolve at runtime.
 */
export function packagePlugin(files, { cdn = CDN, fetchImpl = fetch, fetched = new Map() } = {}) {
  return {
    name: "patchwork-package",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const specifier = args.path

        // The entry point comes through here too, with no importer — and a
        // path like "src/index.ts" looks exactly like a bare dependency. Check
        // the package's own files first.
        if (args.kind === "entry-point" || files.has(specifier)) {
          const direct = files.has(specifier) ? specifier : resolveInPackage(files, "", specifier)
          if (direct) return { path: direct, namespace: "package" }
        }

        if (isExternal(specifier)) return { path: specifier, external: true }

        if (/^https?:\/\//.test(specifier)) return { path: specifier, namespace: "cdn" }

        // Anything non-bare inside a CDN module stays on the CDN, resolved
        // against the module that imported it. esm.sh re-exports through
        // ABSOLUTE paths ("/three@0.186.0/es2022/three.mjs"), not just relative
        // ones, so both have to be handled here or they fall through and get
        // looked up in the package.
        if (args.namespace === "cdn" && (specifier.startsWith(".") || specifier.startsWith("/"))) {
          return { path: new URL(specifier, args.importer).href, namespace: "cdn" }
        }

        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          const resolved = resolveInPackage(files, args.importer ?? "", specifier)
          if (!resolved) {
            return {
              errors: [
                {
                  text: `Cannot find '${specifier}' from '${args.importer || "entry"}'. The package contains: ${[...files.keys()].join(", ")}`,
                },
              ],
            }
          }
          return { path: resolved, namespace: "package" }
        }

        // A bare specifier that the importmap does not provide: fetch it as
        // ESM and inline it. Nothing from the dependency is executed — esbuild
        // only parses it.
        return { path: `${cdn}/${specifier}`, namespace: "cdn" }
      })

      build.onLoad({ filter: /.*/, namespace: "package" }, (args) => ({
        contents: files.get(args.path) ?? "",
        loader: loaderFor(args.path),
      }))

      build.onLoad({ filter: /.*/, namespace: "cdn" }, async (args) => {
        if (fetched.has(args.path)) {
          return { contents: fetched.get(args.path), loader: "js" }
        }
        const response = await fetchImpl(args.path)
        if (!response.ok) {
          return { errors: [{ text: `Could not fetch ${args.path} (${response.status})` }] }
        }
        // esm.sh answers with a redirect to a pinned, fully-resolved URL; the
        // final URL is what relative imports inside it must resolve against.
        const finalUrl = response.url || args.path
        const contents = await response.text()
        fetched.set(args.path, contents)
        if (finalUrl !== args.path) fetched.set(finalUrl, contents)
        return { contents, loader: loaderFor(finalUrl.split("?")[0]), resolveDir: "" }
      })
    },
  }
}

export const packageBuild = {
  id: "package_build",
  name: "Build a package",
  description: [
    "Compile a package that needs building — TypeScript, JSX, or npm dependencies — and write the result back into it as dist/index.js.",
    "",
    "This runs in the browser: esbuild compiled to wasm, reading your source out of the package document. Dependencies you import by bare name (three, d3, …) are fetched as ES modules and bundled in; nothing from them is executed, only parsed. There is no npm install and no machine to provision.",
    "",
    "Patchwork's own modules (@automerge/*, @inkandswitch/*, solid-js, @codemirror/*) are left external and resolve through the importmap at runtime — bundling a second copy of automerge would give your tool a different Repo and nothing would sync.",
    "",
    "Afterwards, point package.json's `main` at './dist/index.js', then tool_check the package before installing it.",
  ].join("\n"),
  // No DOM required, so a SharedWorker can do this off the main thread.
  where: "worker",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "The package folder document URL." },
      entry: { type: "string", description: "Entry file, e.g. 'src/index.ts'. Inferred if omitted." },
      outfile: { type: "string", description: "Where to write the bundle. Default 'dist/index.js'." },
      minify: { type: "boolean", description: "Default false — readable output is easier to debug." },
      jsxImportSource: {
        type: "string",
        description:
          "For JSX, the package whose jsx-runtime to use. Not for Solid: solid-js has no JSX runtime Patchwork can load — write Solid with solid-js/html templates, which need no build.",
      },
    },
  },

  async execute(input, ctx) {
    const files = await materialize(ctx.repo, input.url)
    if (!files.size) throw new Error(`${input.url} has no files in it.`)

    const outfile = input.outfile ?? "dist/index.js"
    const entry = entryPointFor(files, input.entry, outfile)
    if (!entry) {
      throw new Error(
        `No entry point. Pass \`entry\`, or add one of src/index.ts, index.ts, index.js. The package contains: ${[...files.keys()].join(", ")}`
      )
    }

    const esbuild = await loadEsbuild({ importModule: ctx.importModule })
    const started = Date.now()

    let result
    try {
      result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        target: "es2022",
        platform: "browser",
        write: false,
        minify: input.minify ?? false,
        sourcemap: false,
        jsx: input.jsxImportSource ? "automatic" : "transform",
        jsxImportSource: input.jsxImportSource ?? undefined,
        plugins: [packagePlugin(files, { fetchImpl: ctx.fetchImpl })],
        logLevel: "silent",
      })
    } catch (err) {
      // esbuild throws with structured errors; they are the useful part.
      const errors = (err?.errors ?? []).map((e) => `  ${e.location?.file ?? ""}: ${e.text}`).join("\n")
      throw new Error(`Build failed:\n${errors || err?.message || String(err)}`)
    }

    const output = result.outputFiles?.[0]
    if (!output) throw new Error("Build produced no output.")

    const code = output.text
    const written = await absorb(ctx.repo, input.url, new Map([[outfile, code]]), makers(ctx.repo))

    const warnings = (result.warnings ?? []).slice(0, 5).map((w) => `  ${w.text}`)
    return [
      `Built ${entry} → ${outfile} in ${Math.round((Date.now() - started) / 100) / 10}s`,
      `${bytes(code.length)}, bundled from ${files.size} source file(s).`,
      ...written.map((line) => `• ${line}`),
      warnings.length ? `\nWarnings:\n${warnings.join("\n")}` : "",
      `\nFirst lines of the bundle:\n${truncate(code.split("\n").slice(0, 3).join("\n"), 300)}`,
    ]
      .filter(Boolean)
      .join("\n")
  },

  summarize(input, output) {
    const size = String(output ?? "").match(/([\d.]+ [kMB]+), bundled/)
    return `built ${input?.entry ?? "package"}${size ? ` · ${size[1]}` : ""}`
  },
}

export default [packageBuild]
