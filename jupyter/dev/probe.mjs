// Runs dev/probe.ts in headless Chromium: notebook_run on a notebook that
// imports a register and another notebook, headless, outputs written.
//
//   pnpm build && vite build --config dev/vite.config.ts && node dev/probe.mjs
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"

const PORT = 8766
const ROOT = new URL("..", import.meta.url).pathname
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" })
const browser = await chromium.launch({ executablePath: chromiumPath() })
let failed = false
const expect = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`)
  if (!ok) failed = true
}
try {
  await new Promise(resolve => setTimeout(resolve, 500))
  const page = await browser.newPage()
  page.on("console", m => (m.type() === "error" ? console.log(`  [console] ${m.text()}`) : null))
  page.on("pageerror", e => console.log(`  [pageerror] ${e.message}`))
  await page.goto(`http://127.0.0.1:${PORT}/dist/probe.html`)
  const r = await page.evaluate(() => window.probe)
  if (r.error) throw new Error(r.error)
  console.log(r.report)
  console.log("--- check after a rename:\n" + r.afterRename)
  console.log("--- check after a change:\n" + r.afterChange)
  console.log("--- rerun of cell 3:\n" + r.rerun)
  expect(/2 ok in/.test(r.report), "notebook_run ran both code cells")
  expect(r.outputs[1] === "str kg\n", `an ImmutableString arrives in Python as str (${JSON.stringify(r.outputs[1])})`)
  expect(r.outputs[2] === "boat_drag_N 979.6\n", `the register and Model 1's function were importable, Model 1's print stayed out (${JSON.stringify(r.outputs[2])})`)
  expect(JSON.stringify(r.counts) === "[null,1,2]", `execution counts written (${JSON.stringify(r.counts)})`)
  expect(/Result lines \(id value\), 1:\n  boat_drag_N 979\.6/.test(r.report), "the report lists the result line")
  expect(r.run.status === "ok" && r.run.by === "agent" && r.run.imports.length === 2, "the run is recorded with both imports")
  expect(r.run.imports.find(i => i.name === "reg")?.as === "hook" && r.run.imports.find(i => i.name === "model_1")?.as === "notebook", "the register came through its datatype, Model 1 as its code cells")
  const reads = r.run.reads.map(x => `${x.as}:${x.paths.map(p => p.path.join(".")).join(",")}`).sort()
  expect(JSON.stringify(reads) === JSON.stringify(["json:boat_speed_kn", "raw:entries.boat_mass_kg.unit"]), `the reads are recorded by path (${JSON.stringify(reads)})`)
  expect(/It is up to date/.test(r.afterRename), "renaming the register doesn't make it stale")
  expect(/It is stale: "Nootka assumptions \(renamed\)" changed/.test(r.afterChange), "a changed value makes it stale, and says which document")
  expect(/It was stale/.test(r.rerun) && r.outputsAfter[2] === "boat_drag_N 1046.6\n", `a rerun of one cell carries on in the same kernel and reads the new value (${JSON.stringify(r.outputsAfter[2])})`)
} catch (error) {
  failed = true
  console.log(`FAIL ${error.message}`)
} finally {
  await browser.close()
  server.kill()
}
process.exit(failed ? 1 : 0)

function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  for (const cache of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")]) {
    if (!existsSync(cache)) continue
    const dir = readdirSync(cache).find(name => name.startsWith("chromium_headless_shell-"))
    if (!dir) continue
    const base = join(cache, dir)
    const platform = readdirSync(base).find(name => name.startsWith("chrome-headless-shell"))
    if (platform) return join(base, platform, "chrome-headless-shell")
  }
  const installed = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync)
  if (installed) return installed
  throw new Error("No Chromium found; set CHROME_PATH")
}
