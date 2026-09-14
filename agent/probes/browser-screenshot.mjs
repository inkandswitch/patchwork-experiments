/**
 * Can the agent see what it is working on?
 *
 * Mounts a real tool, photographs it, and checks the picture is a picture:
 * right size, and actually varied rather than a blank rectangle. The WebGL case
 * is the one that matters — a GL canvas discards its drawing buffer after
 * compositing unless asked not to, so "screenshot succeeded" and "screenshot is
 * blank" are easy to confuse.
 *
 * Usage: node probes/browser-screenshot.mjs --tool automerge:<threejsPackage>
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
const AGENT =
  option("package", null) ??
  JSON.parse(readFileSync(join(here, "..", ".pushwork", "config.json"), "utf8")).rootUrl
const TOOL_PACKAGE = option("tool", null)
const DATATYPE = option("datatype", "orbit")
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

const profile = mkdtempSync(join(tmpdir(), "screenshot-probe-"))
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
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

      // Import the agent's modules PINNED TO HEADS. An unpinned URL is served
      // from the browser's module cache, so a freshly synced fix silently does
      // not run — which looks exactly like the fix not working.
      const agentUrl = ${JSON.stringify(AGENT)}
      const pinned = await (async () => {
        const handle = await window.repo.find(agentUrl)
        const heads = handle.heads?.() ?? []
        const bare = agentUrl.split("#")[0]
        return "/" + encodeURIComponent(heads.length ? bare + "#" + [...heads].sort().join("|") : bare) + "/"
      })()
      const step = (name, detail) => out.steps.push({ name, ...detail })
      try {
        const checking = await import(pinned + "tools/checking.js")
        const shots = await import(pinned + "tools/screenshot.js")

        // --- 1. A plain DOM view, rasterized ---------------------------
        const plain = document.createElement("div")
        plain.style.cssText = "position:fixed;left:-10000px;top:0;width:400px;height:200px;background:#123456;color:#fff;font:24px sans-serif;padding:20px"
        plain.textContent = "Hello from a document"
        document.body.append(plain)

        const domShot = await shots.viewScreenshot.execute(
          { selector: null, maxWidth: 400 },
          { element: plain, getMount: () => ({ container: plain }), }
        ).catch((err) => ({ error: String(err?.message ?? err) }))
        // capture the plain div explicitly through the mount path
        const domViaMount = await shots.viewScreenshot.execute(
          { mountId: "fake", maxWidth: 400 },
          { getMount: () => ({ container: plain }) }
        ).catch((err) => ({ error: String(err?.message ?? err) }))
        step("dom capture", { ok: !!domViaMount.image, error: domViaMount.error, bytes: domViaMount.image?.length })
        out.domImage = domViaMount.image ?? null
        plain.remove()

        // --- 2. A WebGL view, the hard case ----------------------------
        ${TOOL_PACKAGE ? `
        const mountReport = await checking.viewMount.execute(
          { url: ${JSON.stringify(TOOL_PACKAGE)}, datatype: ${JSON.stringify(DATATYPE)} },
          { repo: window.repo }
        )
        const mountId = mountReport.match(/mountId: (\\S+)/)?.[1]
        step("mounted the webgl tool", { mountId, mounted: /Mounted without throwing/.test(mountReport) })

        await new Promise((r) => setTimeout(r, 800))

        const glShot = await shots.viewScreenshot.execute(
          { mountId, maxWidth: 600 },
          { getMount: checking.getMount }
        ).catch((err) => ({ error: String(err?.message ?? err) }))
        step("webgl capture", { ok: !!glShot.image, error: glShot.error, text: glShot.text?.slice(0, 200) })
        out.glImage = glShot.image ?? null
        out.glText = glShot.text ?? null
        checking.viewUnmount.execute({ mountId }, {}).catch(() => {})
        ` : `step("webgl capture", { skipped: "no --tool package given" })`}

        // --- 3. Is a picture actually a picture? ------------------------
        const analyse = async (dataUrl) => {
          if (!dataUrl) return null
          const img = new Image()
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })
          const canvas = document.createElement("canvas")
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
          const g = canvas.getContext("2d")
          g.drawImage(img, 0, 0)
          const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
          const seen = new Set()
          for (let i = 0; i < data.length; i += 4 * 97) {
            seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
          }
          const hex = (i) => "#" + [data[i], data[i+1], data[i+2]].map((v) => v.toString(16).padStart(2, "0")).join("")
          return {
            width: canvas.width,
            height: canvas.height,
            distinctColours: seen.size,
            topLeft: hex(0),
            centre: hex(((canvas.height >> 1) * canvas.width + (canvas.width >> 1)) * 4),
          }
        }

        out.domAnalysis = await analyse(out.domImage)
        out.glAnalysis = await analyse(out.glImage)
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
  for (const s of report.steps ?? []) console.log(`  ${JSON.stringify(s)}`)

  if (!report.ok) {
    console.log("\n=== FAILED ===")
    console.log(report.error)
  } else {
    console.log("\n=== analysis ===")
    console.log(`dom:   ${JSON.stringify(report.domAnalysis)}  (${report.domImage?.length ?? 0} chars)`)
    console.log(`webgl: ${JSON.stringify(report.glAnalysis)}  (${report.glImage?.length ?? 0} chars)`)
    if (report.glText) console.log(`\n${report.glText}`)

    const checks = [
      ["a DOM view was captured", !!report.domImage],
      ["the DOM capture is a real image, not blank", (report.domAnalysis?.distinctColours ?? 0) > 1],
      ["it is a jpeg data url", report.domImage?.startsWith("data:image/jpeg")],
      ["it was downscaled as asked", (report.domAnalysis?.width ?? 9999) <= 400],
    ]
    if (TOOL_PACKAGE) {
      checks.push(["a WebGL view was captured", !!report.glImage])
      checks.push(["the WebGL capture is not blank", (report.glAnalysis?.distinctColours ?? 0) > 2])
    }
    console.log("\n=== verdict ===")
    for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
    exitCode = checks.every(([, ok]) => ok) ? 0 : 1
  }

  const errors = cdp.logs.filter((l) => /error|exception/i.test(l))
  if (errors.length) {
    console.log("\n=== page errors ===")
    for (const line of errors.slice(-6)) console.log(`  ${line.slice(0, 250)}`)
  }
} catch (err) {
  console.error("PROBE FAILED:", err.message)
} finally {
  await sleep(Number(option("flush", "5000")))
  chrome.kill("SIGKILL")
}
process.exit(exitCode)
