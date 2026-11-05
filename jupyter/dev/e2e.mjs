// Drives the harness in headless Chromium: the real Notebook UI on an
// Automerge doc, a Pyodide cell run, Python reading and writing Patchwork
// files, remote edits, history views, and no requests leaving the origin.
//
//   pnpm build && vite build --config dev/vite.config.ts && node dev/e2e.mjs
import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"

const PORT = 8765
const ORIGIN = `http://127.0.0.1:${PORT}`
const ROOT = new URL("..", import.meta.url).pathname

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const failures = []

try {
  await new Promise(resolve => setTimeout(resolve, 500))
  const context = await browser.newContext()
  const page = await context.newPage()
  const external = []
  page.on("request", request => {
    const url = request.url()
    if (!url.startsWith(ORIGIN) && !url.startsWith("blob:") && !url.startsWith("data:")) external.push(url)
  })
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "warning") console.log(`  [${message.type()}] ${message.text()}`)
  })
  page.on("pageerror", error => console.log(`  [pageerror] ${error.message}`))

  await step("opens the notebook", async () => {
    await page.goto(`${ORIGIN}/dist/harness.html`)
    const frame = await notebookFrame(page)
    await frame.waitForSelector(".jp-Notebook .jp-Cell .cm-content", { timeout: 60_000 })
  })
  const frame = await notebookFrame(page)

  await step("runs a cell in Pyodide and stores source and output in the doc", async () => {
    await frame.click(".jp-Cell .cm-content")
    await page.keyboard.type("print(6 * 7)")
    await page.keyboard.press("Shift+Enter")
    await frame.waitForSelector(".jp-OutputArea-output:has-text('42')", { timeout: 180_000 })
    const cell = await page.evaluate(() => {
      const { cells } = window.harness.handle.doc()
      return { source: String(cells[0].source), outputs: JSON.parse(JSON.stringify(cells[0].outputs)) }
    })
    expect(cell.source === "print(6 * 7)", `source was ${JSON.stringify(cell.source)}`)
    expect(JSON.stringify(cell.outputs).includes("42"), `outputs were ${JSON.stringify(cell.outputs)}`)
  })

  await step("shows edits made to the doc by someone else", async () => {
    await page.evaluate(() => {
      const { A, handle } = window.harness
      handle.change(doc => A.splice(doc, ["cells", 0, "source"], 0, 0, "# remote\n"))
    })
    await frame.waitForSelector(".jp-Cell .cm-content:has-text('# remote')", { timeout: 5_000 })
  })

  const folderUrl = await page.evaluate(() => {
    const { repo } = window.harness
    const file = repo.create({ "@patchwork": { type: "file" }, name: "data.csv", extension: "csv", mimeType: "text/csv", content: "a,b\n1,2\n" })
    const folder = repo.create({ "@patchwork": { type: "folder" }, title: "data", docs: [{ name: "data.csv", type: "file", url: file.url }] })
    return folder.url
  })

  await step("lets Python read and write Patchwork files", async () => {
    await runCell(
      page,
      frame,
      [
        "import patchwork",
        `path = await patchwork.mount(${JSON.stringify(folderUrl)})`,
        "print(open(f'{path}/data.csv').read().replace(chr(10), '|'))",
        "open(f'{path}/out.txt', 'w').write('hello from python')",
        "with open(f'{path}/data.csv', 'a') as f: f.write('3,4\\n')",
      ].join("\n"),
    )
    await frame.waitForSelector(".jp-OutputArea-output:has-text('a,b|1,2|')", { timeout: 60_000 })
    const result = await page.evaluate(async url => {
      const { repo } = window.harness
      const folder = await repo.find(url)
      for (let i = 0; i < 100; i++) {
        const links = folder.doc().docs
        const out = links.find(link => link.name === "out.txt")
        const data = await repo.find(links.find(link => link.name === "data.csv").url)
        if (out && String(data.doc().content).includes("3,4")) {
          const outDoc = await repo.find(out.url)
          return { out: String(outDoc.doc().content), data: String(data.doc().content) }
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return { links: JSON.parse(JSON.stringify(folder.doc().docs)) }
    }, folderUrl)
    if (!result.out) result.outputs = await frame.locator(".jp-OutputArea").allTextContents()
    expect(result.out === "hello from python", `out.txt: ${JSON.stringify(result)}`)
    expect(result.data === "a,b\n1,2\n3,4\n", `data.csv: ${JSON.stringify(result)}`)
  })

  await page.screenshot({ path: join(ROOT, ".cache/e2e.png") })

  await step("undoes and redoes typing", async () => {
    await frame.click(".jp-Cell .cm-content >> nth=0")
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type("  # typed")
    await page.waitForTimeout(700)
    const typed = await firstSource(page)
    await page.keyboard.press("ControlOrMeta+z")
    await page.waitForTimeout(300)
    const undone = await firstSource(page)
    expect(typed.endsWith("  # typed") && !undone.includes("# typed"), `typed ${JSON.stringify(typed)}, undone ${JSON.stringify(undone)}`)
  })

  await step("follows draft switches and history scrubbing in place", async () => {
    const iframe = await frame.frameElement()
    await page.evaluate(() => {
      const { A, repo, handle, shown } = window.harness
      const draft = repo.clone(handle)
      draft.change(doc => { doc.cells[0].source = "on a draft" })
      window.harness.draft = draft
      shown.swap(draft)
    })
    await frame.waitForSelector(".jp-Cell .cm-content:has-text('on a draft')", { timeout: 5_000 })
    await frame.click(".jp-Cell .cm-content >> nth=0")
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type(" edited")
    await page.waitForTimeout(500)
    const edits = await page.evaluate(() => ({
      draft: String(window.harness.draft.doc().cells[0].source),
      main: String(window.harness.handle.doc().cells[0].source),
    }))
    expect(edits.draft === "on a draft edited", `draft was ${JSON.stringify(edits.draft)}`)
    expect(!edits.main.includes("draft"), `main was ${JSON.stringify(edits.main)}`)

    await page.evaluate(() => {
      const { handle, shown } = window.harness
      const heads = handle.heads()
      handle.change(doc => { doc.cells[0].source = "after the checkpoint" })
      shown.swap(handle.view(heads))
    })
    await frame.waitForSelector(".jp-Cell .cm-editor.jp-mod-readOnly", { timeout: 5_000 })
    const past = await frame.textContent(".jp-Cell .cm-content")
    expect(!past.includes("after the checkpoint") && !past.includes("draft"), `history showed ${JSON.stringify(past)}`)

    await page.evaluate(() => window.harness.shown.swap(window.harness.handle))
    await frame.waitForSelector(".jp-Cell .cm-content:has-text('after the checkpoint')", { timeout: 5_000 })
    expect((await frame.locator(".cm-editor.jp-mod-readOnly").count()) === 0, "cells stayed read-only")
    expect(await iframe.evaluate(node => node.isConnected), "the iframe was replaced")
  })

  await step("shows an earlier version read-only", async () => {
    const { url, heads, source } = await page.evaluate(() => {
      const { handle } = window.harness
      return { url: handle.url, heads: handle.heads().join(","), source: String(handle.doc().cells[0].source) }
    })
    await page.evaluate(() => window.harness.handle.change(doc => { doc.cells[0].source = "changed later" }))
    const history = await context.newPage()
    history.on("pageerror", error => console.log(`  [history pageerror] ${error.message}`))
    history.on("console", message => message.type() === "error" && console.log(`  [history error] ${message.text()}`))
    await history.goto(`${ORIGIN}/dist/harness.html?doc=${url}&heads=${heads}`)
    const historyFrame = await notebookFrame(history)
    await historyFrame.waitForSelector(`.jp-Cell .cm-content:has-text(${JSON.stringify(source.split("\n")[0])})`, { timeout: 60_000 })
    await historyFrame.waitForSelector(".jp-Cell .cm-editor.jp-mod-readOnly", { timeout: 5_000 })
    const text = await historyFrame.textContent(".jp-Cell .cm-content")
    expect(!text.includes("changed later"), `history showed ${JSON.stringify(text)}`)
    await history.close()
  })

  await step("imports an .ipynb picked from File › Import Notebook…", async () => {
    const notebook = {
      nbformat: 4,
      nbformat_minor: 4,
      metadata: { kernelspec: { name: "python", display_name: "Python" } },
      cells: [
        { cell_type: "markdown", metadata: {}, source: ["# Imported\n", "from disk"] },
        { cell_type: "code", metadata: {}, execution_count: 1, source: "1 + 1", outputs: [{ output_type: "execute_result", execution_count: 1, metadata: {}, data: { "text/plain": "2" } }] },
      ],
    }
    await frame.click(".lm-MenuBar-itemLabel:text-is('File')")
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      frame.click(".lm-Menu-itemLabel:text-is('Import Notebook…')"),
    ])
    await chooser.setFiles({ name: "Analysis.ipynb", mimeType: "application/x-ipynb+json", buffer: Buffer.from(JSON.stringify(notebook)) })
    const imported = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const handle = Object.values(window.harness.repo.handles).find(h => h.isReady() && h.doc()?.title === "Analysis")
        if (handle) return JSON.parse(JSON.stringify(handle.doc()))
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return null
    })
    expect(imported, "no notebook document was created")
    expect(imported["@patchwork"]?.type === "jupyter-notebook", `type was ${JSON.stringify(imported["@patchwork"])}`)
    expect(imported.cells.length === 2 && imported.cells[0].source === "# Imported\nfrom disk", `cells were ${JSON.stringify(imported.cells)}`)
    expect(JSON.stringify(imported.cells[1].outputs).includes('"2"'), `outputs were ${JSON.stringify(imported.cells[1].outputs)}`)
    expect(imported.cells.every(cell => typeof cell.id === "string" && cell.id.length > 0), "cells are missing ids")
  })

  await step("has no links to the tree or lab pages, which aren't shipped", async () => {
    const links = await frame.locator("a[href$='/tree'], a[href$='/lab']").evaluateAll(nodes => nodes.map(node => node.outerHTML.slice(0, 200)))
    expect(links.length === 0, `found ${links.join(", ")}`)
    await frame.click(".lm-MenuBar-itemLabel:text-is('File')")
    const labels = await frame.locator(".lm-Menu-itemLabel").allTextContents()
    await page.keyboard.press("Escape")
    expect(!labels.includes("Open…"), `File menu has ${JSON.stringify(labels)}`)
  })

  await step("loads nothing from other origins", async () => {
    const unique = [...new Set(external)].filter(url => !url.startsWith("ws://127.0.0.1:9"))
    expect(unique.length === 0, `external requests: ${unique.join(", ")}`)
  })
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.log(`\n${failures.length} failed`)
  process.exit(1)
}
console.log("\nall passed")

async function step(name, fn) {
  const start = Date.now()
  try {
    await fn()
    console.log(`ok   ${name} (${Date.now() - start}ms)`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${error.message.split("\n")[0]}`)
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function notebookFrame(page) {
  for (let i = 0; i < 100; i++) {
    const frame = page.frames().find(frame => frame.name().startsWith("patchwork-jupyter:"))
    if (frame) return frame
    await page.waitForTimeout(100)
  }
  throw new Error("no notebook iframe")
}

async function runCell(page, frame, code) {
  await frame.click(".jp-Cell .cm-content >> nth=-1")
  await page.keyboard.press("Escape")
  await page.keyboard.press("b")
  await frame.click(".jp-Cell .cm-content >> nth=-1")
  await page.keyboard.insertText(code)
  await page.keyboard.press("Shift+Enter")
}

async function firstSource(page) {
  return page.evaluate(() => String(window.harness.handle.doc().cells[0].source))
}

function chromiumPath() {
  const cache = join(homedir(), "Library/Caches/ms-playwright")
  const dir = readdirSync(cache).find(name => name.startsWith("chromium_headless_shell-"))
  const base = join(cache, dir)
  const platform = readdirSync(base).find(name => name.startsWith("chrome-headless-shell"))
  return join(base, platform, "chrome-headless-shell")
}
