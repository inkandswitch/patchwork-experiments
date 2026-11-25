/**
 * Probe P3: web_capture in node keeps a PDF byte for byte, and a page whole.
 *
 * Runs the real tool, through a guarded fetch built as the agent's node
 * runner builds one (redirects checked hop by hop, every address a name
 * resolves to checked), into an in-memory repo, then:
 *
 *   - for a PDF (an arXiv paper by default), fetches it again independently
 *     and compares the kept bytes with those: equal, and the same sha256 the
 *     document records. Checking only `%PDF` would pass a body corrupted after
 *     its first bytes, which is what decoding it as text does.
 *   - for a page, prints the result and the tally, and checks that the stored
 *     page names nothing but its own blobs and the absolute URLs of what was
 *     not kept, and that its export loads nothing but data: URLs and those.
 *
 * Usage: node probes/capture-node.mjs [--pdf URL] [--page URL] [--render false]
 */

import { createHash } from "node:crypto"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { lookup } from "node:dns/promises"
import { guardedFetch, SYNC_SERVERS } from "../guard.js"
import { webCapture } from "../web-capture.js"
import { render } from "../capture/freeze.js"
import { parseNi } from "../capture/bytes.js"
import { scanHtml } from "../capture/scan.js"
import { pageLinks, withoutFragment } from "../capture/links.js"

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const PDF = option("pdf", "https://arxiv.org/pdf/1706.03762")
const PAGE = option("page", "https://www.inkandswitch.com/")
const RENDER = option("render", "true") !== "false"

await initSubduction()
const repo = new Repo({ network: [] })
// As the agent's node-fetch.mjs builds it: this package cannot import the agent.
const fetchImpl = guardedFetch({ fetch: (url, init) => fetch(url, init), deny: SYNC_SERVERS, direct: true, lookup: (host) => lookup(host, { all: true }) })
const ctx = { repo, direct: true, fetchImpl, session: { doc: () => ({ made: [] }) } }
const hex = (bytes) => createHash("sha256").update(bytes).digest("hex")
let failed = false
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) failed = true
}

console.log(`P3: ${PDF}`)
const pdf = await webCapture.execute({ url: PDF }, ctx)
console.log(pdf.text.split("\n")[0])
const kept = (await repo.find(pdf.doc.url)).doc()
const again = new Uint8Array(await (await fetch(PDF)).arrayBuffer())
check(kept.mimeType === "application/pdf", "kept as a PDF file")
check(kept.content.byteLength === again.byteLength, `same length (${kept.content.byteLength} and ${again.byteLength})`)
check(hex(kept.content) === hex(again), "same bytes as an independent fetch")
check(kept.capture.sha256 === hex(kept.content), "the recorded sha256 is the bytes'")

console.log(`\nA page: ${PAGE} (render ${RENDER})`)
const page = await webCapture.execute({ url: PAGE, render: RENDER, again: true }, ctx)
console.log(page.text)
const snapshot = (await repo.find(page.doc.url)).doc()
const notKept = new Set(Object.entries(snapshot.resources).filter(([, r]) => r.outcome !== "ok").map(([u]) => u))
const loadsOf = (html) => pageLinks(scanHtml(html), snapshot.base).filter((l) => !l.policy && !l.nav && !l.bad)
const stored = loadsOf(new TextDecoder().decode(snapshot.html))
const named = stored.filter((l) => l.url.startsWith("ni:"))
check(named.every((l) => snapshot.blobs[parseNi(withoutFragment(l.url))?.sha256]), `the stored page names only its own blobs (${named.length} such)`)
check(stored.filter((l) => !l.url.startsWith("ni:")).every((l) => notKept.has(withoutFragment(l.url))), "and otherwise only what was not kept")
const frozen = render(snapshot, { export: true })
const loads = loadsOf(frozen)
check(loads.every((l) => notKept.has(withoutFragment(l.url))), `the export loads only what was not kept (${loads.length} such)`)
check(frozen === render(snapshot, { export: true }), "exporting twice is byte-identical")
console.log(`export: ${frozen.length} chars`)

process.exit(failed ? 1 : 0)
