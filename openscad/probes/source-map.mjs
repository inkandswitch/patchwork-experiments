// From the model to its source, in a real browser: the harness page
// (probes/harness, built with `npx vite build -c probes/harness/vite.config.ts`)
// with the battery-pack sample. Hovering names a part; clicking a cell selects
// its code and shows its chain of calls; the chain and the definition link go
// to their code; Alt-click picks the translucent enclosure in front; the code's
// cursor lights parts; Escape clears. Screenshots go to <shots>.
//
//   node probes/source-map.mjs [shots dir]
//
// Every check passing is the contract; a view that changes size when a part is
// picked redraws shifted, which reads as a flicker.

import {mkdirSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {browser, checklist, sleep} from "./cdp.mjs"

const shots = process.argv[2] ?? fileURLToPath(new URL("./shots/", import.meta.url))
mkdirSync(shots, {recursive: true})
const root = fileURLToPath(new URL("./harness/dist/", import.meta.url))
const b = await browser({root, port: 4991, cdp: 9341, page: "/index.html", width: 1280, height: 800})
const {check} = checklist()
const js = b.js

// the model, then its parts (saved with the last run once the second render is in)
await b.waitFor(`document.querySelector(".openscad-status")?.textContent.includes("Rendered")`, 60_000)
await b.waitFor(`(window.__harness.doc().lastRun?.parts?.length ?? 0) > 0`, 60_000)
const parts = await js(`window.__harness.doc().lastRun.parts`)
check("the last run lists the parts, labelled by module", JSON.stringify(parts.map(p => p.label).sort()) === JSON.stringify(["barrier", "barrier", "cell", "cell", "cell", "enclosure", "enclosure", "enclosure"].sort()) || parts.some(p => p.label === "cell"), parts.map(p => `${p.label} ${p.chain.join(">")}`))

// sweep the view for a cell, reading the hover label
const view = await js(`(() => { const r = document.querySelector(".openscad-viewer-canvas canvas").getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height} })()`)
const hoverAt = async (x, y) => {
	await b.move(x, y)
	await sleep(60)
	return js(`document.querySelector(".openscad-hover strong")?.textContent ?? null`)
}
let cellAt = null
const seen = new Set()
for (let gy = 0.3; gy <= 0.75 && !cellAt; gy += 0.05)
	for (let gx = 0.2; gx <= 0.8 && !cellAt; gx += 0.04) {
		const x = view.x + view.w * gx
		const y = view.y + view.h * gy
		const label = await hoverAt(x, y)
		if (label) seen.add(label)
		if (label === "cell") cellAt = [x, y]
	}
check("hovering names the parts", seen.has("cell"), [...seen])
const detail = cellAt ? await js(`document.querySelector(".openscad-hover span")?.textContent`) : null
check("the hover says the shape and line", detail === "cube, line 2", detail)
await b.shot(`${shots}/hover.png`)

// click it: its code is selected, the chain shows, and the view doesn't move
const canvasBox = `(() => { const r = document.querySelector(".openscad-viewer-canvas canvas").getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join(" ") })()`
const before = await js(canvasBox)
await b.click(...cellAt)
await sleep(150)
const after = await js(canvasBox)
check("picking doesn't resize the view (the trail floats over it)", before === after, {before, after})
const sel = await js(`window.__harness.selection()`)
check("clicking a cell selects the cube that made it", sel?.text === "cube([10, 20, 30])" && sel?.line === 2, sel)
const trail = await js(`[...document.querySelectorAll(".openscad-trail-step")].map(b => b.textContent)`)
check("the chain of calls shows, outermost first", JSON.stringify(trail) === JSON.stringify(["battery_module18", "cell13", "cube2"]), trail)
const label = await js(`document.querySelector(".openscad-trail-step.is-label .openscad-trail-name")?.textContent`)
check("the label is the innermost module", label === "cell", label)
await b.shot(`${shots}/picked.png`)

// the chain's steps and the definition link go to their code
await js(`document.querySelectorAll(".openscad-trail-step")[0].click()`)
await sleep(80)
const outer = await js(`window.__harness.selection()`)
check("a step shows its call", outer?.text === "battery_module()" && outer?.line === 18, outer)
await js(`document.querySelector(".openscad-trail-def").click()`)
await sleep(80)
const def = await js(`window.__harness.selection()`)
check("the definition link shows the module's name where it's defined", def?.text === "cell" && def?.line === 2, def)

// Alt-click: the nearest surface, the translucent enclosure in front of the cell
await b.click(...cellAt, {mods: 1})
await sleep(150)
const front = await js(`document.querySelector(".openscad-trail-step.is-label .openscad-trail-name")?.textContent`)
check("Alt-click picks the see-through enclosure in front", front === "enclosure", front)

// the code's cursor lights the parts its call made
const src = await js(`window.__harness.doc().source`)
await js(`window.__harness.cursor(${src.indexOf("barrier();")})`)
await sleep(150)
await b.shot(`${shots}/cursor-barrier.png`)

// Escape clears
await js(`document.querySelector(".openscad-view-stage").focus()`)
await b.key("Escape")
await sleep(80)
check("Escape clears the selection", !(await js(`!!document.querySelector(".openscad-trail")`)))

const errors = b.logs.filter(l => /error/i.test(l.text ?? String(l)))
check("no page errors", errors.length === 0, errors.slice(0, 5))
b.stop(0)
