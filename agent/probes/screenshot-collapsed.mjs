/**
 * A real browser's answer to "does view_screenshot work on a mount whose
 * transcript view is collapsed?" — a container inside a `display:none` body
 * measures 0×0, and the tool must lay it out before it captures.
 *
 * Bundles tools/screenshot.js into a page, mounts a styled container in a
 * collapsed view, and runs the real tool on it, in headless Chrome. Prints
 * PASS or FAIL.
 *
 * Usage: node probes/screenshot-collapsed.mjs [--chrome <path>]
 */

import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const CHROME = args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const dir = mkdtempSync(join(tmpdir(), "collapsed-"))
const bundled = await build({
  stdin: {
    contents: `
      import { viewScreenshot } from ${JSON.stringify(join(here, "..", "tools", "screenshot.js"))}
      const out = document.getElementById("out")
      const report = (v) => (out.textContent = JSON.stringify(v))
      ;(async () => { try {
        const body = document.getElementById("collapsed")      // display:none, as a collapsed transcript view is
        const container = document.createElement("div")
        container.className = "agent-mount"
        container.innerHTML = "<h1 style='color:crimson'>Mounted view</h1><p>Hello from inside</p>"
        body.append(container)
        const before = [container.clientWidth, container.clientHeight]
        const result = await viewScreenshot.execute({ mountId: "m" }, { getMount: () => ({ container }) })
        report({ before, text: result.text, image: result.image.slice(0, 22), imageLength: result.image.length, backInPlace: container.parentElement === body, holderGone: !document.querySelector(".agent-mount-holder") })
      } catch (e) { report({ error: String(e.message ?? e) }) } })()
    `,
    resolveDir: here,
    loader: "js",
  },
  bundle: true,
  format: "iife",
  write: false,
})
writeFileSync(join(dir, "page.html"), `<!doctype html><meta charset=utf-8><body><div id="collapsed" style="display:none"></div><pre id="out"></pre><script>${bundled.outputFiles[0].text.replace(/<\/script/g, "<\\/script")}</script>`)

const dom = execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${join(dir, "profile")}`, "--virtual-time-budget=8000", "--dump-dom", `file://${join(dir, "page.html")}`], { encoding: "utf8", timeout: 60000 })
const report = JSON.parse(dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
console.log(report)
const ok = !report.error && report.before.join("×") === "0×0" && /^Captured \d+×\d+/.test(report.text) && report.image.startsWith("data:image/jpeg") && report.backInPlace && report.holderGone
console.log(ok ? "PASS" : "FAIL")
process.exit(ok ? 0 : 1)
