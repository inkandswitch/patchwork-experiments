/**
 * Probe P7: do the size caps fit through the sync server?
 *
 * A snapshot holds up to 20 MB (tools/capture.js MAX_SNAPSHOT_BYTES) and a
 * kept PDF up to 30 MB (tools/sources.js MAX_PDF_BYTES), each in one
 * document written in one change. If the sync server refuses or drops a
 * message that size, a capture is kept on the machine that made it and
 * nowhere else, silently. This writes one document of each size from one
 * repo and reads it back through a second repo that shares nothing with the
 * first but the server, comparing the bytes.
 *
 * Usage: node probes/sync-size.mjs [--sync wss://…] [--sizes 20,30] [--timeout 300]
 */

import { createHash } from "node:crypto"
import { Repo, initSubduction } from "@automerge/automerge-repo"

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const SYNC = option("sync", "wss://subduction.sync.inkandswitch.com")
const SIZES = option("sizes", "20,30").split(",").map(Number)
const TIMEOUT = Number(option("timeout", "300")) * 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (bytes) => createHash("sha256").update(bytes).digest("hex")

await initSubduction()
const writer = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
const reader = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })

let failed = false
for (const mb of SIZES) {
  // Incompressible, so nothing on the way can make it smaller than it is.
  const bytes = new Uint8Array(mb * 1024 * 1024)
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, bytes.length)))
  const started = Date.now()
  const handle = writer.create({})
  handle.change((d) => {
    d["@patchwork"] = { type: "file" }
    d.name = `p7-${mb}mb.bin`
    d.content = bytes
  })
  console.log(`${mb} MB written as ${handle.url}`)

  let got = null
  while (!got && Date.now() - started < TIMEOUT) {
    try {
      const found = await reader.find(handle.url)
      const content = found.doc()?.content
      if (content?.byteLength === bytes.byteLength) got = content
    } catch {
      /* not there yet */
    }
    if (!got) await sleep(2000)
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (!got) {
    console.log(`FAIL ${mb} MB did not arrive through ${SYNC} within ${TIMEOUT / 1000} s`)
    failed = true
  } else if (hex(got) !== hex(bytes)) {
    console.log(`FAIL ${mb} MB arrived changed`)
    failed = true
  } else {
    console.log(`ok   ${mb} MB arrived intact in ${seconds} s`)
  }
}
process.exit(failed ? 1 : 0)
