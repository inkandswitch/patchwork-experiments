// Publish a boat that is also an arena level, and print its Patchwork URL.
//
//   node probes/publish-boat-level.mjs [--sync wss://…] [--settle 8000]
//   node probes/publish-boat-level.mjs --dry-run
//
// The showcase's hull (implicit's "hull" example), scaled up to a 12 m boat
// floating in the arena's floor at its waterline, with targets on its bow
// deck and cabin roof and a couple on the floor around it, and spawn points
// on the aft deck and on the floor. Everything that isn't the hull is the
// arena's own blocks (one GLB file doc per kind, named in the level trait, as
// the arena's editing would make them).
//
// It starts in edit (`view.activity` "edit": it's a boat first); because it
// has arena traits, play is available too, and the scene's switch offers
// Play | Edit. The level trait carries the arena's look, so playing it has
// the sky, haze and sun.
//
// Makes NEW docs on every run (no dedupe). The hull's render is built by the
// first scene to open it, as in the showcase. --dry-run makes the docs in a
// repo with no network and checks them, but publishes nothing.
//
// Docs of other packages are written by shape; their sources (implicit's
// example and param specs, the arena's blocks) are imported at runtime from
// this checkout, as publish-showcase-scene.mjs does.
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { newRenderDoc, DEFAULT_VIEW } from "../src/datatype.js"
import { defaultParams } from "../src/staleness.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
)
const DRY = !!args["dry-run"]
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com"

const { EXAMPLES } = await import(resolve(repoRoot, "implicit/src/examples.js"))
const implicitPlugins = (await import(resolve(repoRoot, "implicit/src/index.js"))).plugins
const { kindGLB, kindKey, levelObject, writeLevelTrait, LEVEL } = await import(resolve(repoRoot, "arena/src/layout.js"))
const { KINDS } = await import(resolve(repoRoot, "arena/src/level.js"))

await initSubduction()
const repo = DRY ? new Repo({ network: [] }) : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
if (!DRY) console.log(`connected to ${SYNC}`)
const made = []
const make = async (value) => {
  const h = await repo.create2(value)
  made.push(h.url)
  return h.url
}

// ─── the hull: implicit's example, rendered as in the showcase ───────────────
const ex = EXAMPLES.find((e) => e.id === "hull")
const hull = await make({
  "@patchwork": { type: "implicit-surface" },
  title: "Hull",
  source: ex.source,
  bounds: { min: [...ex.bounds.min], max: [...ex.bounds.max] },
  notes: "",
})
const spec = implicitPlugins.find((p) => p.type === "scene:source" && p.id === "implicit-mesh").params
// at 12 m a cell is about 7 cm at the finest resolution there is
const rHull = await make(newRenderDoc({ title: "Hull", parent: hull, providerId: "implicit-mesh", params: { ...defaultParams(spec), resolution: 160, finish: "satin" } }))

// ─── the arena's blocks: one GLB doc per kind used ───────────────────────────
const urls = {}
const drawn = {}
for (const kind of ["floor", "target", "spawn"]) {
  urls[kind] = drawn[kindKey(kind)] = await make({
    "@patchwork": { type: "file" },
    name: `${KINDS[kind].name}.glb`,
    extension: "glb",
    mimeType: "model/gltf-binary",
    content: kindGLB(kind),
  })
}

// ─── the scene ─────────────────────────────────────────────────────────────
// The hull's frame is implicit's: bow at +X, Y up, waterline at y = 0, deck cut
// flat at y = 0.04, a deckhouse 0.21 aft to 0.01 forward, 0.09 high. At ×12 the
// deck is 0.48 m above the floor (a hop up) and the cabin roof 1.08 m.
const S = 12
const DECK = 0.04 * S + 0.005
const ROOF = 0.09 * S + 0.005
const T = (position, yaw = 0) => ({ position, rotation: [0, yaw, 0], scale: 1 })
// The yaw that faces (dx, dz): a target's board faces its local -Z, and a
// player starts looking down a spawn point's local -Z (arena play.js spawn).
const facing = (dx, dz) => Math.atan2(-dx, -dz)
const blocks = [
  { kind: "floor", name: "Floor", transform: T([0, 0, 0]) },
  { kind: "target", name: "Bow target", transform: T([3.4, DECK, 0], facing(-1, 0)), traits: { "arena.target": {} } },
  { kind: "target", name: "Cabin roof target", transform: T([-1.2, ROOF, 0], facing(-1, 0)), traits: { "arena.target": {} } },
  { kind: "target", name: "Dockside target 1", transform: T([9, 0, -7], facing(-9, 7)), traits: { "arena.target": {} } },
  { kind: "target", name: "Dockside target 2", transform: T([-10, 0, 8], facing(10, -8)), traits: { "arena.target": {} } },
  { kind: "target", name: "Dockside target 3", transform: T([12, 0, 6], facing(-12, -6)), traits: { "arena.target": {} } },
  { kind: "spawn", name: "Aft deck spawn", transform: T([-4.3, DECK, 0], facing(1, 0)), traits: { "arena.spawn": {} } },
  { kind: "spawn", name: "Dockside spawn", transform: T([0, 0, 12], facing(0, -1)), traits: { "arena.spawn": {} } },
]

const objects = {
  hull: {
    kind: "object", name: "Hull", group: null, parent: null, sourceUrl: hull, providerId: "implicit-mesh", renderUrl: rHull,
    visible: true, color: "#f1efe9", opacity: 1, wireframe: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: S },
  },
  gLevel: { kind: "group", name: "Arena", group: null, visible: true, opacity: 1 },
}
const order = ["hull", "gLevel"]
blocks.forEach((b, i) => {
  const id = `o${i}`
  objects[id] = levelObject(b, urls[b.kind], "gLevel")
  order.push(id)
})
const traits = {}
writeLevelTrait({ traits }, drawn)
traits[LEVEL].look = "arena"

const sceneDoc = {
  "@patchwork": { type: "scene" },
  title: "Boat level",
  objects,
  order,
  dimensions: {},
  traits,
  view: { ...DEFAULT_VIEW, activity: "edit", home: { position: [15, 9, 15], target: [0, 0.5, 0] } },
}
const scene = await make(sceneDoc)
console.log(`scene ${scene}: a ${S} m hull, ${blocks.length} arena blocks, starts in ${sceneDoc.view.activity}`)

if (DRY) {
  console.log(`dry run: ${made.length} docs (nothing published)`)
  process.exit(0)
}

// ─── flush, then prove every doc is there from a repo that has never seen it ──
await repo.flush?.()
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)))
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))])
const missing = []
for (const url of made) {
  try {
    const d = (await within(30000, checker.find(url))).doc()
    if (!d || !Object.keys(d).length) missing.push(`${url} (empty)`)
    else if (url === scene && d.view?.activity !== "edit") missing.push(`${url} (came back without view.activity "edit")`)
  } catch (err) {
    missing.push(`${url} (${err?.message ?? err})`)
  }
}
console.log(`verified ${made.length - missing.length}/${made.length} docs from a fresh repo`)
if (missing.length) {
  for (const m of missing) console.error(`  missing ${m}`)
  console.error(`\nNOT verified: re-run, or raise --settle.`)
  process.exit(1)
}
console.log(`\n  https://patchwork.inkandswitch.com/#doc=${scene}\n`)
process.exit(0)
