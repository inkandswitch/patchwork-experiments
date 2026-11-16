/**
 * Probes P5 and P6: is a snapshot inert in a real browser?
 *
 * The snapshot view shows `freeze(doc)` as the srcdoc of an iframe sandboxed
 * with only allow-popups and allow-popups-to-escape-sandbox (snapshot/view.js).
 * happy-dom honours neither the sandbox nor the CSP, so the claim that this
 * runs nothing and reaches nothing can only be checked in Chrome. This serves
 * a page from a local server that counts every request, mounts frames on it
 * the way the view does, waits, and reports:
 *
 *   P5  a frozen page whose not-kept resources point at the counting server
 *       (an image, a stylesheet), with a refresh, a script and a link in the
 *       original: the server must see none of them; the parent cannot reach
 *       into the frame (`contentDocument` is null); and the kept image, a
 *       data: URL, does load (read through a DevTools isolated world, which
 *       works where the page's own scripts may not run).
 *   P5b the same page NOT frozen, sandboxed alone: shows which requests the
 *       CSP is stopping that the sandbox does not.
 *   P6  a PDF in a frame with the same sandbox: Chrome is expected to refuse
 *       to show it, which is why a snapshot never holds a PDF.
 *
 * Run inside Patchwork's own policy container, data: resources might be
 * refused by the page's CSP; this probe uses a plain local page, so that
 * part of P5 is for a run with Patchwork open (see README, "Keeping web pages").
 *
 * Usage: node probes/snapshot-frame.mjs [--chrome PATH]
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { freeze } from "../capture/freeze.js"

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const CHROME = option("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
const PORT = Number(option("port", String(9400 + Math.floor(Math.random() * 400))))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A 1×1 red PNG, as a kept blob.
const RED = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))
const PDF = new TextEncoder().encode("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")

const counts = new Map()
const server = createServer((req, res) => {
  counts.set(req.url, (counts.get(req.url) ?? 0) + 1)
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(PARENT)
  } else if (req.url === "/doc.pdf") {
    res.writeHead(200, { "content-type": "application/pdf" })
    res.end(PDF)
  } else {
    res.writeHead(200, { "content-type": "image/png" })
    res.end(RED)
  }
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const origin = `http://127.0.0.1:${server.address().port}`

const original = [
  `<!doctype html><html><head><title>t</title>`,
  `<meta http-equiv="refresh" content="1;url=${origin}/refresh">`,
  `<link rel="stylesheet" href="${origin}/leak.css">`,
  `<script>fetch("${origin}/script")</script>`,
  `</head><body><p>frozen</p>`,
  `<img id="kept" src="https://kept.test/red.png" width="50" height="50">`,
  `<img src="${origin}/leak.png">`,
  `<div style="background:url(${origin}/leak-bg.png);width:10px;height:10px"></div>`,
  `<a href="${origin}/link">a link</a></body></html>`,
].join("")
const doc = {
  html: new TextEncoder().encode(original),
  charset: "utf-8",
  source: "https://kept.test/",
  base: "https://kept.test/",
  capture: { at: 0, sha256: "x" },
  resources: { "https://kept.test/red.png": { kind: "image", outcome: "ok", sha256: "red", mimeType: "image/png" } },
  blobs: { red: RED },
}
const SANDBOX = "allow-popups allow-popups-to-escape-sandbox"
// A string inside the parent's inline script: "</" would end the script early.
const js = (value) => JSON.stringify(value).replaceAll("</", "<\\/")
const PARENT = `<!doctype html><body><script>
  const frame = (id, attrs) => { const f = document.createElement("iframe"); f.id = id; for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v); document.body.append(f); return f }
  frame("frozen", { sandbox: ${js(SANDBOX)}, referrerpolicy: "no-referrer", srcdoc: ${js(freeze(doc))} })
  frame("raw", { sandbox: ${js(SANDBOX)}, srcdoc: ${js(original.replaceAll(origin + "/", origin + "/raw-"))} })
  frame("pdf", { sandbox: ${js(SANDBOX)}, src: "/doc.pdf" })
</script></body>`

const profile = mkdtempSync(join(tmpdir(), "snapshot-frame-probe-"))
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], {
  stdio: ["ignore", "ignore", "ignore"],
})

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true })
  })
  let next = 0
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
  })
  return {
    send(method, params = {}) {
      const id = ++next
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close: () => socket.close(),
  }
}

let failed = false
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) failed = true
}

try {
  let target = null
  for (let i = 0; i < 60 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    } catch {
      /* starting */
    }
    if (!target) await sleep(250)
  }
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  await cdp.send("Page.navigate", { url: origin + "/" })
  await sleep(3000) // longer than the refresh's one second

  const parent = await cdp.send("Runtime.evaluate", { expression: `document.getElementById("frozen").contentDocument === null`, returnByValue: true })
  check(parent.result.value === true, "P5: the parent cannot reach into the frozen frame")

  const { frameTree } = await cdp.send("Page.getFrameTree")
  const frozenFrame = frameTree.childFrames?.[0]?.frame
  const world = await cdp.send("Page.createIsolatedWorld", { frameId: frozenFrame.id, worldName: "probe" })
  const image = await cdp.send("Runtime.evaluate", {
    contextId: world.executionContextId,
    expression: `(() => { const i = document.getElementById("kept"); return { src: i.src.slice(0, 22), complete: i.complete, width: i.naturalWidth } })()`,
    returnByValue: true,
  })
  console.log("     kept image:", image.result.value)
  check(image.result.value?.width === 1, "P5: the kept image, a data: URL, loaded")

  const frozenHits = ["/leak.css", "/leak.png", "/leak-bg.png", "/script", "/refresh", "/link"].map((p) => [p, counts.get(p) ?? 0])
  console.log("     requests from the frozen frame:", Object.fromEntries(frozenHits))
  check(frozenHits.every(([, n]) => n === 0), "P5: the frozen frame made no request")
  const rawHits = ["/raw-leak.css", "/raw-leak.png", "/raw-leak-bg.png", "/raw-script", "/raw-refresh"].map((p) => [p, counts.get(p) ?? 0])
  console.log("P5b: requests from the un-frozen, sandboxed frame (the CSP's share of the work):", Object.fromEntries(rawHits))
  check((counts.get("/raw-script") ?? 0) === 0, "P5b: the sandbox alone stops the script")

  console.log(`P6: /doc.pdf was requested ${counts.get("/doc.pdf") ?? 0} time(s); see the screenshot for whether Chrome showed it.`)
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
  const file = join(profile, "frames.png")
  writeFileSync(file, Buffer.from(shot.data, "base64"))
  console.log(`     screenshot: ${file}`)
  cdp.close()
} finally {
  chrome.kill()
  server.close()
}
process.exit(failed ? 1 : 0)
