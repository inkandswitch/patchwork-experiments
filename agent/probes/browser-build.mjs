/**
 * Can Patchwork build a TypeScript + three.js tool, in the browser?
 *
 * This is the feasibility question the whole "builds in the system" idea rests
 * on: esbuild compiled to wasm, running in a page, reading source out of an
 * automerge document, fetching three.js from a CDN as ES modules, and emitting
 * one self-contained bundle back into the document.
 *
 * No node, no npm install, no machine to provision — and nothing from the
 * dependency is executed, only parsed.
 *
 * Usage: node probes/browser-build.mjs [--package automerge:…]
 */

import { spawn } from "node:child_process"
import { readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const SHELL = option("shell", "https://patchwork.inkandswitch.com/")
const PACKAGE =
  option("package", null) ??
  JSON.parse(readFileSync(join(here, "..", ".pushwork", "config.json"), "utf8")).rootUrl
const PORT = Number(option("port", String(9400 + Math.floor(Math.random() * 400))))
const CHROME = option("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const logs = []
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      return
    }
    if (message.method === "Runtime.consoleAPICalled") {
      logs.push(`[${message.params.type}] ${(message.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}`)
    }
  })
  return {
    logs,
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
  }
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    timeout: 600000,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "browser-build-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    // NOT --disable-gpu: that leaves no WebGL at all, so anything drawing with
    // three.js or a canvas fails in a way that looks like a bug in the tool.
    // SwiftShader gives headless a software GL implementation.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore"] }
)

let exitCode = 1
try {
  let target = null
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    } catch {
      /* starting */
    }
    if (!target) await sleep(250)
  }
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send("Runtime.enable")
  await cdp.send("Page.enable")
  await cdp.send("Page.navigate", { url: SHELL })

  for (let i = 0; i < 120; i++) {
    if (await evaluate(cdp, `!!window.repo && !!window.accountDocHandle`, false).catch(() => false)) break
    await sleep(500)
  }
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = { steps: [] }

      // Import the agent's modules PINNED TO HEADS. An unpinned URL is served
      // from the browser's module cache, so a freshly synced fix silently does
      // not run — which looks exactly like the fix not working.
      const agentUrl = ${JSON.stringify(PACKAGE)}
      const pinned = await (async () => {
        const handle = await window.repo.find(agentUrl)
        const heads = handle.heads?.() ?? []
        const bare = agentUrl.split("#")[0]
        return "/" + encodeURIComponent(heads.length ? bare + "#" + [...heads].sort().join("|") : bare) + "/"
      })()
      const started = Date.now()
      const step = (name, detail) => out.steps.push({ t: Date.now() - started, name, ...detail })

      try {
        // 1. A TypeScript source tree, written into a package document —
        //    exactly what the agent's fs_write would produce.
        const SOURCE = {
          "package.json": JSON.stringify({ name: "spinner", type: "module", main: "./dist/index.js" }, null, 2),
          "src/index.ts": [
            'import { makeScene } from "./scene"',
            '',
            'export const plugins = [',
            '  { type: "patchwork:datatype", id: "spinner", name: "Spinner", icon: "Box",',
            '    async load() { return (await import("./datatype")).default } },',
            '  { type: "patchwork:tool", id: "spinner", name: "Spinner", icon: "Box",',
            '    supportedDatatypes: ["spinner"],',
            '    async load() { return makeScene } },',
            ']',
          ].join("\\n"),
          "src/scene.ts": [
            'import * as THREE from "three"',
            '',
            'interface Handle { doc(): { spin?: number }; change(fn: (d: any) => void): void }',
            '',
            'export function makeScene(handle: Handle, element: HTMLElement) {',
            '  const scene = new THREE.Scene()',
            '  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)',
            '  camera.position.z = 3',
            '  const cube = new THREE.Mesh(',
            '    new THREE.BoxGeometry(1, 1, 1),',
            '    new THREE.MeshBasicMaterial({ color: 0x35f7ca, wireframe: true })',
            '  )',
            '  scene.add(cube)',
            '  return () => { scene.clear() }',
            '}',
          ].join("\\n"),
          "src/datatype.ts": [
            'export default {',
            '  init(doc: any) { doc.title = "Spinner"; doc.spin = 0 },',
            '  getTitle(doc: any) { return doc.title },',
            '  setTitle(doc: any, t: string) { doc.title = t },',
            '}',
          ].join("\\n"),
        }

        const makeFile = async (name, content) => {
          const h = await window.repo.create2()
          const extension = name.includes(".") ? name.split(".").pop() : ""
          h.change((d) => {
            d.name = name; d.extension = extension
            d.mimeType = extension === "ts" ? "text/plain" : "text/javascript"
            d.content = content; d["@patchwork"] = { type: "file" }
          })
          return h
        }
        const makeFolder = async (name) => {
          const h = await window.repo.create2()
          h.change((d) => { d.title = name; d.docs = []; d["@patchwork"] = { type: "folder" } })
          return h
        }

        const pkg = await makeFolder("spinner")
        const src = await makeFolder("src")
        pkg.change((d) => d.docs.push({ name: "src", type: "folder", url: src.url }))
        for (const [path, content] of Object.entries(SOURCE)) {
          const parts = path.split("/")
          const file = await makeFile(parts.at(-1), content)
          const target = parts.length > 1 ? src : pkg
          target.change((d) => d.docs.push({ name: parts.at(-1), type: "file", url: file.url }))
        }
        step("wrote a TypeScript package", { url: pkg.url, files: Object.keys(SOURCE).length })

        // 2. Import the agent's builder straight out of its own package
        //    document, the same way Patchwork imports any module.
        const buildModule = await import(pinned + "tools/build.js")
        step("loaded the builder", { has: typeof buildModule.packageBuild?.execute })

        // 3. Build it. esbuild-wasm in the page; three.js fetched as ESM.
        const result = await buildModule.packageBuild.execute(
          { url: pkg.url, entry: "src/index.ts" },
          { repo: window.repo }
        )
        step("built", { report: result.slice(0, 400) })

        // 4. What actually landed in the document?
        const dist = (pkg.doc().docs ?? []).find((d) => d.name === "dist")
        if (!dist) throw new Error("no dist folder in the package")
        const distDoc = (await window.repo.find(dist.url)).doc()
        const bundleLink = (distDoc.docs ?? []).find((d) => d.name === "index.js")
        const bundle = String((await window.repo.find(bundleLink.url)).doc()?.content ?? "")

        out.bundleBytes = bundle.length
        out.bundleHead = bundle.slice(0, 200)
        // three.js should be INSIDE the bundle, not imported at runtime.
        out.inlinedThree = /BoxGeometry/.test(bundle) && /PerspectiveCamera/.test(bundle)
        out.noBareThreeImport = !/from\\s*["']three["']/.test(bundle)
        out.noTypeScript = !/interface Handle/.test(bundle)
        out.exportsPlugins = /plugins/.test(bundle)
        out.packageUrl = pkg.url

        // 5. Does the bundle actually load and expose plugins?
        const blob = new Blob([bundle], { type: "text/javascript" })
        const blobUrl = URL.createObjectURL(blob)
        try {
          const loaded = await import(blobUrl)
          out.importedOk = true
          out.pluginIds = (loaded.plugins ?? []).map((p) => p.type + ":" + p.id)
        } catch (err) {
          out.importedOk = false
          out.importError = String(err?.message ?? err)
        } finally {
          URL.revokeObjectURL(blobUrl)
        }

        out.ok = true
        return out
      } catch (err) {
        out.ok = false
        out.error = String(err?.stack ?? err?.message ?? err)
        return out
      }
    })()`
  )

  console.log("\n=== steps ===")
  for (const s of report.steps ?? []) {
    const { t, name, ...rest } = s
    console.log(`${String(t).padStart(7)}ms  ${name}  ${JSON.stringify(rest).slice(0, 300)}`)
  }

  if (!report.ok) {
    console.log("\n=== FAILED ===")
    console.log(report.error)
  } else {
    console.log("\n=== bundle ===")
    console.log(`bytes: ${report.bundleBytes}`)
    console.log(`head:  ${report.bundleHead.replace(/\n/g, " ").slice(0, 160)}`)
    console.log(`plugins exported: ${JSON.stringify(report.pluginIds)}`)

    const checks = [
      ["esbuild ran in the browser", report.bundleBytes > 0],
      ["TypeScript was compiled away", report.noTypeScript === true],
      ["three.js was bundled in", report.inlinedThree === true],
      ["no runtime dependency on a CDN", report.noBareThreeImport === true],
      ["the bundle imports and exposes plugins", report.importedOk === true && report.pluginIds?.length === 2],
    ]
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    if (report.importError) console.log(`import error: ${report.importError}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
    console.log(`\npackage: ${report.packageUrl}`)
  }

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-8)) console.log(`  ${line.slice(0, 300)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  // Let sync flush before killing the browser. Documents created seconds ago
  // may exist only in this throwaway profile; SIGKILL here and they are gone,
  // which later looks like "the agent produced a broken package" rather than
  // "the probe threw the package away".
  await sleep(Number(option("flush", "8000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
