/**
 * Does a binary download survive the round trip?
 *
 * `http_request` used to call `response.text()`, which decodes as UTF-8 with
 * replacement — so every byte sequence that is not valid UTF-8 became U+FFFD
 * and the result still looked like a successful download. This fetches a real
 * wasm module over a real network, through the real tool, into a real automerge
 * document, and reads the bytes back out.
 *
 * The assertion that matters is byte equality against a second, independent
 * fetch. Checking only the magic number would pass on a file that was corrupted
 * after its first four bytes, which is exactly what UTF-8 replacement does.
 *
 * Usage: node probes/binary-fetch.mjs
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
// Small, real, and definitely not UTF-8.
const TARGET = option("url", "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.21.5/esbuild.wasm")
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
      logs.push(
        `[${message.params.type}] ${(message.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}`
      )
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 600000,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "binary-fetch-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
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
    const ready = await cdp
      .send("Runtime.evaluate", { expression: "!!window.repo", returnByValue: true })
      .then((r) => r.result?.value)
      .catch(() => false)
    if (ready) break
    await sleep(500)
  }
  console.log("booted")

  const report = await evaluate(
    cdp,
    `(async () => {
      const out = { steps: [] }
      const bare = ${JSON.stringify(PACKAGE)}.split("#")[0]
      const handle = await window.repo.find(bare)
      const heads = handle.heads?.() ?? []
      const base = "/" + encodeURIComponent(heads.length ? bare + "#" + [...heads].sort().join("|") : bare) + "/"

      try {
        const http = await import(base + "tools/http.js")
        const build = await import(base + "tools/build.js")

        // A package folder to fetch into, so the "put it somewhere useful" path
        // is exercised rather than just the "write an orphan doc" one.
        const folder = await window.repo.create2()
        folder.change((d) => { d.title = "wasm-probe"; d.docs = []; d["@patchwork"] = { type: "folder" } })

        const result = await http.httpRequest.execute(
          { url: ${JSON.stringify(TARGET)}, folder: folder.url, saveAs: "engine.wasm" },
          { repo: window.repo }
        )
        out.resultText = result.text ?? String(result)
        out.ref = result.doc ?? null
        if (!out.ref) throw new Error("no document reference came back")

        const saved = (await window.repo.find(out.ref.url)).doc()
        const stored = saved.content
        out.storedType = stored?.constructor?.name ?? typeof stored
        out.storedLength = stored?.byteLength ?? stored?.length ?? 0

        // The control: fetch the same URL again, independently, and compare.
        const truth = new Uint8Array(await (await fetch(${JSON.stringify(TARGET)})).arrayBuffer())
        out.trueLength = truth.byteLength

        let identical = stored instanceof Uint8Array && stored.byteLength === truth.byteLength
        if (identical) {
          for (let i = 0; i < truth.byteLength; i++) {
            if (stored[i] !== truth[i]) { identical = false; out.firstDifference = i; break }
          }
        }
        out.identical = identical

        // What the old code would have produced, for the record.
        const roundTripped = new TextEncoder().encode(new TextDecoder().decode(truth))
        out.lossIfDecoded = roundTripped.byteLength - truth.byteLength

        // It has to still BE a wasm module, not merely the right bytes.
        try {
          const module = await WebAssembly.compile(stored)
          out.compiles = !!module
        } catch (err) {
          out.compiles = false
          out.compileError = String(err?.message ?? err).slice(0, 160)
        }

        // And it must be reachable as a package file, with bytes intact.
        const files = await build.materialize(window.repo, folder.url)
        const inPackage = files.get("engine.wasm")
        out.inPackageType = inPackage?.constructor?.name ?? typeof inPackage
        out.inPackageLength = inPackage?.byteLength ?? inPackage?.length ?? 0
        out.loader = build.loaderFor("engine.wasm")

        out.ok = true
        return out
      } catch (err) {
        out.ok = false
        out.error = String(err?.stack ?? err?.message ?? err)
        return out
      }
    })()`
  )

  if (!report.ok) {
    console.log("\n=== FAILED ===")
    console.log(report.error)
  } else {
    console.log("\n=== what the tool said ===")
    console.log(report.resultText)

    console.log("\n=== measurements ===")
    console.log(`  stored as:        ${report.storedType}, ${report.storedLength} bytes`)
    console.log(`  fetched directly: ${report.trueLength} bytes`)
    console.log(`  identical:        ${report.identical}${report.firstDifference != null ? ` (differs at ${report.firstDifference})` : ""}`)
    console.log(`  bytes a UTF-8 round trip would have added: ${report.lossIfDecoded}`)
    console.log(`  in package as:    ${report.inPackageType}, ${report.inPackageLength} bytes, loader "${report.loader}"`)
    if (report.compileError) console.log(`  compile error:    ${report.compileError}`)

    const checks = [
      ["the document holds bytes, not a string", report.storedType === "Uint8Array"],
      ["every byte matches an independent fetch", report.identical === true],
      ["the wasm module actually compiles", report.compiles === true],
      ["it reaches the build as bytes", report.inPackageType === "Uint8Array"],
      ["nothing was truncated on the way into the package", report.inPackageLength === report.trueLength],
      ["the build gives it a binary loader", report.loader === "binary"],
      // If this is 0 the file was valid UTF-8 and the probe proves nothing;
      // pick a different target.
      ["the target is genuinely not UTF-8, so this test has teeth", report.lossIfDecoded !== 0],
    ]
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
  }

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-5)) console.log(`  ${line.slice(0, 250)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  await sleep(Number(option("flush", "4000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
