/**
 * Read a package document's files from the command line.
 *
 * When the agent reports "32 tests passed", that is a claim about tests you
 * have not seen. This prints what it actually wrote, so the claim can be
 * checked — a suite of vacuous assertions passes just as readily as a real one.
 *
 * Usage: node probes/read-package.mjs automerge:<packageUrl> [nameFilter]
 */

import { Repo, initSubduction, setSubductionLogLevel } from "@automerge/automerge-repo"

const SYNC = process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com"
const [packageUrl, filter] = process.argv.slice(2)

if (!packageUrl) {
  console.error("Usage: node probes/read-package.mjs automerge:<packageUrl> [nameFilter]")
  process.exit(2)
}

await initSubduction()
try {
  setSubductionLogLevel("error")
} catch {
  /* older builds do not expose it */
}

const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
const pattern = filter ? new RegExp(filter, "i") : null

const walk = async (url, prefix) => {
  const doc = (await repo.find(url)).doc()
  if (Array.isArray(doc?.docs)) {
    for (const entry of doc.docs) await walk(entry.url, prefix ? `${prefix}/${entry.name}` : entry.name)
    return
  }
  if (!doc || !("content" in doc)) return

  const text = String(doc.content ?? "")
  if (pattern && !pattern.test(prefix)) {
    console.log(`  ${prefix} · ${text.length} chars (filtered out)`)
    return
  }
  console.log(`\n===== ${prefix} · ${text.length} chars =====\n${text}`)
}

await walk(packageUrl, "")
await new Promise((r) => setTimeout(r, 1500))
process.exit(0)
