// Publish the example scene to a real sync server and print its Patchwork URL.
//
//   node probes/publish-example-scene.mjs --geom <…/frontend/public> [--scene probes/solander-scene.example.json] [--sync wss://…]
//
// Every run makes NEW docs on the sync server (378 file docs + a scene, ~13 MB),
// with no dedupe across runs.
//
// make-example-scene.mjs writes a doc whose sourceUrls are `pending:glb:<set>/<file>`
// placeholders; solander-probe.html rewrites those into fake in-memory docs. This
// does the real thing: one file doc per GLB on the sync server, the scene doc
// pointing at them, and a URL you can open.
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Repo, initSubduction } from "@automerge/automerge-repo"

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
)
if (!args.geom) { console.error("need --geom <the site's frontend/public>"); process.exit(1) }

const SETS = { main: "models-1789414952", battery: "models-battery-1789233002", jig: "models-jig-1761244560" }
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com"
const geom = resolve(args.geom)
const scenePath = resolve(args.scene ?? "probes/solander-scene.example.json")
const doc = JSON.parse(readFileSync(scenePath, "utf8"))

await initSubduction()
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
const create = (value) => (repo.create2 ? repo.create2(value) : repo.create(value))
console.log(`connected to ${SYNC}`)

// One file doc per GLB, made once per distinct placeholder.
const made = new Map()
const pendings = [...new Set(Object.values(doc.objects).map((o) => o.sourceUrl).filter((u) => typeof u === "string" && u.startsWith("pending:")))]
console.log(`${pendings.length} GLBs to upload`)

let bytesTotal = 0
for (const [i, pending] of pendings.entries()) {
  const key = decodeURIComponent(pending.slice("pending:".length))
  const m = /^glb:(main|battery|jig)\/(.+)$/.exec(key)
  if (!m) throw new Error(`unrecognised placeholder: ${key}`)
  const [, set, file] = m
  const content = new Uint8Array(readFileSync(resolve(geom, SETS[set], file)))
  bytesTotal += content.byteLength
  const handle = await create({
    "@patchwork": { type: "file" },
    name: file,
    extension: "glb",
    mimeType: "model/gltf-binary",
    content,
  })
  made.set(pending, handle.url)
  if ((i + 1) % 25 === 0 || i + 1 === pendings.length) {
    console.log(`  ${i + 1}/${pendings.length}  (${(bytesTotal / 1e6).toFixed(1)} MB)`)
  }
}

for (const o of Object.values(doc.objects)) if (made.has(o.sourceUrl)) o.sourceUrl = made.get(o.sourceUrl)
const scene = await create(doc)
console.log(`scene doc ${scene.url}`)

// Push everything to the server before exiting, then prove it is there by
// asking for it again from a repo that has never seen it.
console.log("flushing to the sync server…")
await repo.flush?.()
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)))

const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))])
const FIND_MS = Number(args.timeout ?? 30000)

// Every doc, not a sample: a scene that points at one missing file doc is a
// broken scene, and the URL must not be handed out as if it worked.
let fetchedDoc = null
try {
  fetchedDoc = (await within(FIND_MS, checker.find(scene.url))).doc()
} catch (err) {
  console.error(`scene doc did not come back: ${err?.message ?? err}`)
}
const expected = Object.keys(doc.objects).length
const sceneOk = !!fetchedDoc && Object.keys(fetchedDoc.objects ?? {}).length === expected
if (fetchedDoc && !sceneOk) console.error(`scene doc came back with ${Object.keys(fetchedDoc.objects ?? {}).length} objects, expected ${expected}`)

const urls = [...made.values()]
const missing = []
let next = 0
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        const d = (await within(FIND_MS, checker.find(url))).doc()
        if (!d?.content?.byteLength) missing.push(`${url} (no content)`)
      } catch (err) {
        missing.push(`${url} (${err?.message ?? err})`)
      }
    }
  })
)
console.log(`verified from a fresh repo: scene ${sceneOk ? "ok" : "MISSING"}, ${urls.length - missing.length}/${urls.length} file docs with content`)

if (args.out) writeFileSync(resolve(args.out), JSON.stringify(doc, null, 2))
if (!sceneOk || missing.length) {
  for (const m of missing.slice(0, 20)) console.error(`  missing ${m}`)
  if (missing.length > 20) console.error(`  … and ${missing.length - 20} more`)
  console.error(`\nNOT verified: ${scene.url} is incomplete on ${SYNC}. Re-run, or raise --settle.`)
  process.exit(1)
}
console.log(`\n  https://patchwork.inkandswitch.com/#doc=${scene.url}\n`)
process.exit(0)
