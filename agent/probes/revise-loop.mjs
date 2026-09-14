/**
 * Does checking a tool AFTER editing it run the new code?
 *
 * The failure this exists to rule out is quiet and total: the browser caches ES
 * modules by URL, so a second `tool_check` on an edited package could import the
 * version from before the edit, report on code that no longer exists, and tell
 * the user their change worked when the check never saw it. `packageFileUrl`
 * pins to the package's heads to avoid exactly this — and a comment saying so
 * is not evidence.
 *
 * No model involved: the files are written directly, so this is fast and
 * deterministic and can run on every change.
 *
 * Usage: node probes/revise-loop.mjs
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 600000 })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

const profile = mkdtempSync(join(tmpdir(), "revise-loop-"))
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
      .send("Runtime.evaluate", { expression: "!!window.repo && !!window.accountDocHandle", returnByValue: true })
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
        const checking = await import(base + "tools/checking.js")
        const folders = await import(base + "tools/folders.js")

        const root = await window.repo.create2()
        root.change((d) => { d.title = "revise-probe"; d.docs = []; d["@patchwork"] = { type: "folder" } })
        const ctx = { repo: window.repo, rootFolderUrl: root.url }

        const tool = (label) => \`
export default function Probe(handle, element) {
  const root = document.createElement("div")
  root.textContent = "\${label}"
  element.append(root)
  const button = document.createElement("button")
  button.textContent = "go"
  button.onclick = () => handle.change((d) => { d.count = (d.count ?? 0) + 1 })
  element.append(button)
  return () => { root.remove(); button.remove() }
}\`

        const files = (label) => ({
          "probe/package.json": JSON.stringify({ name: "probe", type: "module", main: "./index.js" }),
          "probe/datatype.js": 'export default { init(d) { d.title = "Probe"; d.count = 0 }, getTitle: (d) => d.title }',
          "probe/index.js": \`export const plugins = [
            { type: "patchwork:datatype", id: "probeit", name: "Probe", icon: "Hash", async load() { return (await import("./datatype.js")).default } },
            { type: "patchwork:tool", id: "probeit", name: "Probe", icon: "Hash", supportedDatatypes: ["probeit"], async load() { return (await import("./tool.js")).default } },
          ]\`,
          "probe/tool.js": tool(label),
        })

        // --- version one -------------------------------------------------
        const first = await folders.fsWrite.execute({ files: files("VERSION-ONE") }, ctx)
        const pkg = first.doc.url
        out.package = pkg

        const checkOne = await checking.toolCheck.execute({ url: pkg, screenshot: false }, ctx)
        out.one = typeof checkOne === "string" ? checkOne : checkOne.text
        out.steps.push({ step: "checked v1", sawOne: out.one.includes("VERSION-ONE"), sawTwo: out.one.includes("VERSION-TWO") })

        // --- edit, then check again --------------------------------------
        await folders.fsWrite.execute({ files: { "probe/tool.js": tool("VERSION-TWO") } }, ctx)

        const checkTwo = await checking.toolCheck.execute({ url: pkg, screenshot: false }, ctx)
        out.two = typeof checkTwo === "string" ? checkTwo : checkTwo.text
        out.steps.push({ step: "checked v2", sawOne: out.two.includes("VERSION-ONE"), sawTwo: out.two.includes("VERSION-TWO") })

        // --- and a third time, to rule out an off-by-one in the pinning ---
        await folders.fsWrite.execute({ files: { "probe/tool.js": tool("VERSION-THREE") } }, ctx)
        const checkThree = await checking.toolCheck.execute({ url: pkg, screenshot: false }, ctx)
        out.three = typeof checkThree === "string" ? checkThree : checkThree.text
        out.steps.push({ step: "checked v3", sawTwo: out.three.includes("VERSION-TWO"), sawThree: out.three.includes("VERSION-THREE") })

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
    console.log("\n=== what each check saw ===")
    for (const s of report.steps) console.log(`  ${JSON.stringify(s)}`)

    const checks = [
      ["the first check saw version one", report.steps[0].sawOne === true],
      ["the second check saw the EDIT, not the cached module", report.steps[1].sawTwo === true],
      ["the second check did not see the old version", report.steps[1].sawOne === false],
      ["a third edit is picked up too", report.steps[2].sawThree === true],
      ["the third check did not see the second version", report.steps[2].sawTwo === false],
    ]
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
    console.log(`\npackage: ${report.package}`)
  }

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-5)) console.log(`  ${line.slice(0, 250)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  await sleep(Number(option("flush", "3000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
