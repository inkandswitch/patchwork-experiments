// Drives the harness in headless Chromium on the native notebook, on an
// Automerge doc: a Pyodide cell run, Python reading and writing Patchwork
// files, remote edits, drafts, comparing (native), history views, and no requests leaving
// the origin.
//
//   pnpm build && vite build --config dev/vite.config.ts && node dev/e2e.mjs [native]
import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright-core"

const SUITES = new Set(process.argv.length > 2 ? process.argv.slice(2) : ["native"])
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
  const watch = page => {
    page.on("request", request => {
      const url = request.url()
      if (!url.startsWith(ORIGIN) && !url.startsWith("blob:") && !url.startsWith("data:")) external.push(url)
    })
    page.on("console", message => {
      if (message.type() === "error" || message.type() === "warning") console.log(`  [${message.type()}] ${message.text()}`)
    })
    page.on("pageerror", error => console.log(`  [pageerror] ${error.message}`))
    return page
  }
  watch(page)

  if (SUITES.has("native")) {
    console.log("native:")
    await nativeSuite(context, watch)
  }

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

/** The Patchwork-native notebook (native/), in the page itself rather than an iframe. */
async function nativeSuite(context, watch) {
  const page = watch(await context.newPage())
  const cells = ".pwnb-cell"

  await step("starts the Pyodide kernel without the JupyterLite app", async () => {
    const check = watch(await context.newPage())
    await check.goto(`${ORIGIN}/dist/kernel.html`)
    const result = await check.evaluate(() => window.kernelCheck)
    expect(result.sum.messages.some(m => m.type === "execute_result" && m.content.data["text/plain"] === "2"), `1 + 1 gave ${JSON.stringify(result.sum)}`)
    expect(JSON.stringify(result.patchwork.messages).includes('"patchwork"'), `import patchwork gave ${JSON.stringify(result.patchwork)}`)
    expect(result.completion.matches.includes("os"), `completions were ${JSON.stringify(result.completion)}`)
    await check.close()
  })

  await step("opens the notebook", async () => {
    await page.goto(`${ORIGIN}/dist/harness.html`)
    await page.waitForSelector(`${cells} .cm-content`, { timeout: 30_000 })
  })

  await step("runs a cell in Pyodide and stores source and output in the doc", async () => {
    await page.click(`${cells} .cm-content`)
    await page.keyboard.type("print(6 * 7)")
    await page.keyboard.press("Shift+Enter")
    await page.waitForSelector(".pwnb-output:has-text('42')", { timeout: 180_000 })
    const cell = await page.evaluate(() => {
      const { cells } = window.harness.handle.doc()
      return { source: String(cells[0].source), outputs: JSON.parse(JSON.stringify(cells[0].outputs)), count: cells[0].execution_count }
    })
    expect(cell.source === "print(6 * 7)", `source was ${JSON.stringify(cell.source)}`)
    expect(cell.outputs.length === 1 && cell.outputs[0].output_type === "stream" && cell.outputs[0].text === "42\n", `outputs were ${JSON.stringify(cell.outputs)}`)
    expect(typeof cell.count === "number", `execution_count was ${cell.count}`)
    expect(await page.textContent(`${cells} >> nth=0 >> .pwnb-prompt`) === `[${cell.count}]:`, "the prompt doesn't show the execution count")
  })

  await step("shows edits made to the doc by someone else", async () => {
    await page.evaluate(() => {
      const { A, handle } = window.harness
      handle.change(doc => A.splice(doc, ["cells", 0, "source"], 0, 0, "# remote\n"))
    })
    await page.waitForSelector(`${cells} .cm-content:has-text('# remote')`, { timeout: 5_000 })
  })

  const folderUrl = await page.evaluate(() => {
    const { repo } = window.harness
    const file = repo.create({ "@patchwork": { type: "file" }, name: "data.csv", extension: "csv", mimeType: "text/csv", content: "a,b\n1,2\n" })
    const folder = repo.create({ "@patchwork": { type: "folder" }, title: "data", docs: [{ name: "data.csv", type: "file", url: file.url }] })
    return folder.url
  })

  await step("lets Python read and write Patchwork files", async () => {
    await runNativeCell(page, [
      "import patchwork",
      `path = await patchwork.mount(${JSON.stringify(folderUrl)})`,
      "print(open(f'{path}/data.csv').read().replace(chr(10), '|'))",
      "open(f'{path}/out.txt', 'w').write('hello from python')",
    ].join("\n"))
    await page.waitForSelector(".pwnb-output:has-text('a,b|1,2|')", { timeout: 60_000 })
    const out = await page.evaluate(async url => {
      const { repo } = window.harness
      const folder = await repo.find(url)
      for (let i = 0; i < 100; i++) {
        const link = folder.doc().docs.find(link => link.name === "out.txt")
        if (link) return String((await repo.find(link.url)).doc().content)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return null
    }, folderUrl)
    expect(out === "hello from python", `out.txt was ${JSON.stringify(out)}`)
  })

  await step("streams, overwrites with \\r and shows errors", async () => {
    await runNativeCell(page, "import sys\nfor i in range(3): print(f'step {i}', end='\\r')\nprint('finished')\nprint('to stderr', file=sys.stderr)\n1/0")
    await page.waitForSelector(".pwnb-output:has-text('ZeroDivisionError')", { timeout: 30_000 })
    const outputs = await page.evaluate(() => {
      const cell = window.harness.handle.doc().cells.find(cell => String(cell.source).includes("step {i}"))
      return JSON.parse(JSON.stringify(cell.outputs))
    })
    const stdout = outputs.find(output => output.name === "stdout")
    expect(stdout?.text === "finished\n", `stdout was ${JSON.stringify(stdout?.text)}`)
    expect(outputs.some(output => output.name === "stderr"), "no stderr output")
    expect(outputs.some(output => output.output_type === "error" && output.ename.includes("ZeroDivisionError")), `outputs were ${JSON.stringify(outputs)}`)
  })

  await step("renders matplotlib figures and pandas tables", async () => {
    await runNativeCell(page, "import matplotlib.pyplot as plt\nplt.plot([1, 3, 2])\nplt.show()")
    await page.waitForSelector(".pwnb-output .jp-RenderedImage img", { timeout: 180_000 })
    await runNativeCell(page, "import pandas as pd\npd.DataFrame({'a': [1, 2], 'b': [3, 4]})")
    await page.waitForSelector(".pwnb-output table", { timeout: 120_000 })
  })

  await step("renders markdown cells", async () => {
    await page.click(`${cells} >> nth=-1`)
    await page.keyboard.press("Escape")
    await page.keyboard.press("b")
    await page.keyboard.press("m")
    await page.keyboard.press("Enter")
    await page.keyboard.insertText("# A heading\n\nsome *text*")
    await page.keyboard.press("Shift+Enter")
    await page.waitForSelector(".pwnb-markdown h1:has-text('A heading')", { timeout: 5_000 })
    const type = await page.evaluate(() => String(window.harness.handle.doc().cells.at(-2).cell_type))
    expect(type === "markdown", `cell type was ${type}`)
  })

  await page.screenshot({ path: join(ROOT, ".cache/e2e-native.png"), fullPage: true })

  await step("adds, moves and deletes cells from the keyboard", async () => {
    const count = () => page.evaluate(() => window.harness.handle.doc().cells.length)
    const ids = () => page.evaluate(() => window.harness.handle.doc().cells.map(cell => String(cell.id)))
    await page.click(`${cells} >> nth=0 >> .pwnb-prompt`)
    const before = await count()
    await page.keyboard.press("b")
    await page.waitForFunction(n => window.harness.handle.doc().cells.length === n + 1, before)
    const [first, second] = await ids()
    await page.keyboard.press("k")
    await page.keyboard.press("x")
    await page.keyboard.press("v")
    const moved = await ids()
    expect(moved[0] === second && moved.length === before + 1, `cut and paste gave ${JSON.stringify(moved.slice(0, 3))} from ${JSON.stringify([first, second])}`)
    // back to the new, empty cell, and delete it
    await page.keyboard.press("k")
    await page.keyboard.press("d")
    await page.keyboard.press("d")
    await page.waitForFunction(n => window.harness.handle.doc().cells.length === n, before)
  })

  await step("inserts, runs, copies, pastes and cuts cells from the toolbar", async () => {
    const tool = title => page.click(`.pwnb-tool[title^='${title}']`)
    const doc = () => page.evaluate(() => JSON.parse(JSON.stringify(window.harness.handle.doc().cells)))
    await page.click(`${cells} >> nth=0 >> .pwnb-prompt`)
    const before = (await doc()).length
    await tool("Insert a cell below")
    await page.keyboard.press("Enter")
    await page.keyboard.insertText("print('from the toolbar')")
    await page.keyboard.press("Escape")
    await tool("Run this cell")
    await page.waitForSelector(".pwnb-output:has-text('from the toolbar')", { timeout: 30_000 })
    const inserted = (await doc())[1]
    expect(inserted.source === "print('from the toolbar')" && inserted.outputs.length === 1, `inserted ${JSON.stringify(inserted)}`)

    await page.click(`${cells} >> nth=1 >> .pwnb-prompt`)
    await tool("Copy this cell")
    await tool("Paste cells")
    let after = await doc()
    expect(after.length === before + 2 && after[2].source === inserted.source && after[2].id !== inserted.id, `paste gave ${JSON.stringify(after.map(cell => cell.source))}`)
    await page.selectOption(".pwnb-cell-type", "markdown")
    after = await doc()
    expect(after[2].cell_type === "markdown" && !("outputs" in after[2]), `cell type gave ${JSON.stringify(after[2])}`)
    await tool("Cut this cell")
    await page.click(`${cells} >> nth=1 >> .pwnb-prompt`)
    await tool("Cut this cell")
    after = await doc()
    expect(after.length === before, `cut left ${after.length} cells, not ${before}`)
  })

  await step("undoes and redoes typing", async () => {
    await page.click(`${cells} .cm-content >> nth=0`)
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type("  # typed")
    await page.waitForTimeout(700)
    const typed = await firstSource(page)
    await page.keyboard.press("ControlOrMeta+z")
    await page.waitForTimeout(300)
    const undone = await firstSource(page)
    expect(typed.endsWith("  # typed") && !undone.includes("# typed"), `typed ${JSON.stringify(typed)}, undone ${JSON.stringify(undone)}`)
  })

  await step("writes cells the JupyterLab tool reads (nbformat, by schema)", async () => {
    const doc = await page.evaluate(() => JSON.parse(JSON.stringify(window.harness.handle.doc())))
    for (const cell of doc.cells) {
      expect(typeof cell.id === "string" && cell.id && typeof cell.source === "string" && typeof cell.metadata === "object", `cell ${JSON.stringify(cell).slice(0, 200)}`)
      expect(["code", "markdown", "raw"].includes(cell.cell_type), `cell_type ${cell.cell_type}`)
      if (cell.cell_type === "code") expect(Array.isArray(cell.outputs) && "execution_count" in cell, `code cell ${JSON.stringify(cell).slice(0, 200)}`)
      else expect(!("outputs" in cell), `${cell.cell_type} cell has outputs`)
      for (const output of cell.outputs ?? []) expect(typeof output.output_type === "string", `output ${JSON.stringify(output).slice(0, 200)}`)
    }
  })

  await step("follows draft switches and history scrubbing in place", async () => {
    await page.evaluate(() => {
      const { repo, handle, shown } = window.harness
      const draft = repo.clone(handle)
      draft.change(doc => { doc.cells[0].source = "on a draft" })
      window.harness.draft = draft
      shown.swap(draft)
    })
    await page.waitForSelector(`${cells} .cm-content:has-text('on a draft')`, { timeout: 5_000 })
    await page.click(`${cells} .cm-content >> nth=0`)
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
    await page.waitForSelector(".pwnb-read-only .cm-content[contenteditable='false']", { timeout: 5_000 })
    const past = await page.textContent(`${cells} .cm-content`)
    expect(!past.includes("after the checkpoint") && !past.includes("draft"), `history showed ${JSON.stringify(past)}`)

    await page.evaluate(() => window.harness.shown.swap(window.harness.handle))
    await page.waitForSelector(`${cells} .cm-content:has-text('after the checkpoint')`, { timeout: 5_000 })
    expect((await page.locator(".pwnb-read-only").count()) === 0, "the notebook stayed read-only")
  })

  await step("marks what the checked-out draft changed since it parted from main (stacked)", async () => {
    await page.evaluate(() => {
      const { A, repo, handle, shown, compare } = window.harness
      const draft = repo.clone(handle)
      draft.change(doc => {
        A.splice(doc, ["cells", 0, "source"], 0, 0, "# drafted\n")
        A.splice(doc, ["cells", 0, "source"], "# drafted\nafter ".length, "the ".length)
        doc.cells.deleteAt(doc.cells.length - 1)
        doc.cells.push({ id: "drafted-cell", cell_type: "code", source: "print('new')", metadata: {}, outputs: [], execution_count: null })
      })
      // Main goes on after the draft parted from it; that isn't the draft's change.
      handle.change(doc => {
        doc.cells.push({ id: "main-cell", cell_type: "code", source: "print('main')", metadata: {}, outputs: [], execution_count: null })
      })
      window.harness.draft = draft
      shown.swap(draft)
      compare(handle, { mode: "stacked" })
    })
    await page.waitForSelector(`${cells}.pwnb-diff-added .cm-content:has-text("print('new')")`, { timeout: 5_000 })
    await page.waitForSelector(`${cells}.pwnb-diff-changed .pwnb-diff-insertion:has-text('# drafted')`, { timeout: 5_000 })
    await page.waitForSelector(`${cells}.pwnb-diff-changed .pwnb-diff-deletion:has-text('the ')`, { timeout: 5_000 })
    expect((await page.locator(".pwnb-ghost-removed").count()) === 1, "the removed cell isn't shown where it was")
    expect((await page.locator("[data-ghost-id='main-cell']").count()) === 0, "main's later cell was marked as the draft's")
    expect((await page.locator(".pwnb-read-only").count()) === 0, "stacked made the notebook read-only")
    await page.screenshot({ path: join(ROOT, ".cache/e2e-native-stacked.png"), fullPage: true })

    await page.click(`${cells}.pwnb-diff-changed .cm-content`)
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type(" # more")
    await page.waitForSelector(".pwnb-diff-insertion:has-text('# more')", { timeout: 5_000 })

    await page.evaluate(() => window.harness.compare(window.harness.handle, { mode: "stacked", collapsed: true }))
    await page.waitForSelector(".pwnb-folded:has-text('unchanged cell')", { timeout: 5_000 })
    const hidden = await page.locator(`${cells}[hidden]`).count()
    expect(hidden > 0, "no cells were folded")
    await page.click(".pwnb-folded >> nth=0")
    await page.waitForFunction(count => document.querySelectorAll(".pwnb-cell[hidden]").length < count, hidden, { timeout: 5_000 })
    await page.evaluate(() => window.harness.compare(window.harness.handle, { mode: "stacked" }))
    await page.waitForFunction(() => !document.querySelector(".pwnb-folded"), null, { timeout: 5_000 })
  })

  await step("shows both versions combined, read-only, in the drafts' colours", async () => {
    await page.evaluate(() => window.harness.compare(window.harness.handle, { mode: "inline" }))
    await page.waitForSelector(".pwnb-read-only", { timeout: 5_000 })
    await page.waitForSelector(`${cells}.pwnb-ours .cm-content:has-text("print('new')")`, { timeout: 5_000 })
    await page.waitForSelector(`${cells}.pwnb-differs .pwnb-ours-line:has-text('# drafted')`, { timeout: 5_000 })
    await page.waitForSelector(`${cells}.pwnb-differs .pwnb-theirs-lines:has-text('after the checkpoint')`, { timeout: 5_000 })
    // Main's cells the draft doesn't have: the one it removed, and the one main added since.
    await page.waitForSelector("[data-ghost-id='main-cell'].pwnb-ghost-theirs", { timeout: 5_000 })
    expect((await page.locator(".pwnb-ghost-theirs").count()) === 2, "main's cells aren't both shown")
    expect((await page.locator(".pwnb-legend:has-text('Draft'):has-text('Main')").count()) === 1, "no legend naming the drafts")
    expect((await page.locator(".pwnb-cell .cm-content[contenteditable='true']").count()) === 0, "combined could be edited")
    await page.screenshot({ path: join(ROOT, ".cache/e2e-native-combined.png"), fullPage: true })

    await page.evaluate(() => window.harness.compare(window.harness.handle, { mode: "inline", merging: true }))
    await page.waitForSelector(".pwnb.pwnb-merging", { timeout: 5_000 })
  })

  await step("shows both versions side by side, a row per cell, scrolling together", async () => {
    await page.evaluate(() => window.harness.compare(window.harness.handle, { mode: "side-by-side" }))
    await page.waitForSelector(".pwnb-cells.pwnb-side", { timeout: 5_000 })
    const changed = ".pwnb-row:has(.pwnb-differs-line:has-text('# drafted'))"
    await page.waitForSelector(`${changed} .pwnb-their-cell.pwnb-side-differs .pwnb-differs-line:has-text('after the checkpoint')`, { timeout: 5_000 })
    await page.waitForSelector(`.pwnb-row:has(.pwnb-their-cell) ${cells}.pwnb-side-differs`, { timeout: 5_000 })
    await page.waitForSelector(`${cells}.pwnb-side-added .cm-content:has-text("print('new')")`, { timeout: 5_000 })
    // Main added this one since the drafts parted, and the draft removed the other.
    await page.waitForSelector("[data-their-cell-id='main-cell'].pwnb-side-added", { timeout: 5_000 })
    expect((await page.locator(".pwnb-their-cell.pwnb-side-removed").count()) === 1, "the cell the draft removed isn't marked on main's side")
    expect((await page.locator(".pwnb-side-headings:has-text('Draft'):has-text('Main')").count()) === 1, "no headings naming the drafts")
    expect((await page.locator(".pwnb-their-cell .cm-content[contenteditable='true']").count()) === 0, "main's side could be edited")
    expect((await page.locator(".pwnb-cell:not(.pwnb-their-cell) .cm-content[contenteditable='true']").count()) > 0, "the draft's side couldn't be edited")
    await page.screenshot({ path: join(ROOT, ".cache/e2e-native-side-by-side.png"), fullPage: true })
  })

  await step("marks everything as added when main doesn't have the notebook", async () => {
    await page.evaluate(() => window.harness.compare("missing", { mode: "side-by-side" }))
    await page.waitForFunction(
      () => [...document.querySelectorAll(".pwnb-cell")].every(cell => cell.classList.contains("pwnb-side-added")),
      null,
      { timeout: 5_000 },
    )
    await page.evaluate(() => {
      window.harness.shown.swap(window.harness.handle)
      window.harness.compare(null)
    })
    await page.waitForFunction(
      () => !document.querySelector(".pwnb-diff-added, .pwnb-diff-changed, .pwnb-ghost, .pwnb-diff-insertion, .pwnb-ours, .pwnb-differs, .pwnb-their-cell, .pwnb-side-added"),
      null,
      { timeout: 5_000 },
    )
    expect((await page.locator(".pwnb-read-only").count()) === 0, "the notebook stayed read-only")
  })

  await step("shows an earlier version read-only, without a kernel", async () => {
    const { url, heads, source } = await page.evaluate(() => {
      const { handle } = window.harness
      return { url: handle.url, heads: handle.heads().join(","), source: String(handle.doc().cells[0].source) }
    })
    await page.evaluate(() => window.harness.handle.change(doc => { doc.cells[0].source = "changed later" }))
    const history = watch(await context.newPage())
    await history.goto(`${ORIGIN}/dist/harness.html?doc=${url}&heads=${heads}`)
    await history.waitForSelector(`${cells} .cm-content:has-text(${JSON.stringify(source.split("\n")[0])})`, { timeout: 30_000 })
    await history.waitForSelector(".pwnb-read-only .cm-content[contenteditable='false']", { timeout: 5_000 })
    const text = await history.textContent(`${cells} .cm-content`)
    expect(!text.includes("changed later"), `history showed ${JSON.stringify(text)}`)
    expect((await history.locator(".pwnb-status:has-text('Read-only')").count()) === 1, "no read-only badge")
    expect((await history.locator(".pwnb-toolbar button").count()) === 0, "run buttons on a read-only notebook")
    await history.close()
  })

  await page.close()
}

/** Adds a code cell at the end in command mode, then types and runs `code`. */
async function runNativeCell(page, code) {
  await page.click(".pwnb-cell >> nth=-1 >> .pwnb-prompt")
  await page.keyboard.press("b")
  await page.keyboard.press("Enter")
  await page.keyboard.insertText(code)
  await page.keyboard.press("Shift+Enter")
}

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

async function firstSource(page) {
  return page.evaluate(() => String(window.harness.handle.doc().cells[0].source))
}

/** $CHROME_PATH, else Playwright's headless shell (macOS or Linux cache), else an installed Chrome. */
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
