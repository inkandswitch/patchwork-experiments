// Build an example scene doc from the Solander 38 site's GLB folder.
//
//   node probes/make-example-scene.mjs --geom <…/frontend/public> --out probes/solander-scene.example.json
//
// The importer's own output (plan/dry/scene.json) is what solander-run.mjs was
// measured against; this reconstructs a document of the same shape from the
// files themselves, so the probe can be run without it. The hierarchy is not
// invented: these GLBs carry their assembly path in the filename, separated by
// `__`, so `BODY__CTR BEAM__scuppers.glb` is the object "scuppers" inside the
// group "CTR BEAM" inside the group "BODY". Every leaf is a passthrough layer
// (renderUrl null, provider file-glb) — the scene shows the source bytes and
// never builds anything.
//
// Two things differ from the importer's doc, and both are stated rather than
// guessed at: ids are assigned here (the importer's are its own), and the
// default visibility is "the main set shown, battery and deck-jig hidden",
// which shows 135 objects where the recorded run showed 74.
import { readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
)
if (!args.geom) {
  console.error("need --geom <the site's frontend/public>")
  process.exit(1)
}
const geom = resolve(args.geom)
const out = resolve(args.out ?? "probes/solander-scene.example.json")

// The three exported sets, and whether each is shown when the scene opens.
//
// The battery set is wrapped in a group of its own. That is not decoration: it
// is the 129th group in the recorded run, the one the file hierarchy alone does
// not account for, and solander-probe.html reaches for it by name to time
// showing the battery. Its three roots are siblings underneath it, so one
// toggle shows or hides the lot.
const SETS = [
  { key: "main", dir: "models-1789414952", visible: true },
  { key: "battery", dir: "models-battery-1789233002", visible: false, wrap: "Battery (display)" },
  { key: "jig", dir: "models-jig-1761244560", visible: false },
]

const objects = {}
const order = []
const groupIds = new Map() // "set\0A\0B" -> id
let n = 0
const nextId = (prefix) => `${prefix}${String(++n).padStart(4, "0")}`

const base = (visible, parent, name) => ({
  name,
  sourceUrl: null,
  providerId: null,
  renderUrl: null,
  visible,
  color: null,
  opacity: 1,
  wireframe: false,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  parent,
})

/** The wrapper group for a set, when it has one. Made once, on first use. */
const wrapperFor = (set) => {
  if (!set.wrap) return null
  const key = `${set.key}\0\0wrap`
  if (!groupIds.has(key)) {
    const id = nextId("g")
    groupIds.set(key, id)
    objects[id] = { kind: "group", ...base(set.visible, null, set.wrap) }
    order.push(id)
  }
  return groupIds.get(key)
}

/** The group for a path, making it and its ancestors if they are new. */
const groupFor = (set, parts) => {
  const top = wrapperFor(set)
  let parent = top
  for (let i = 0; i < parts.length; i++) {
    const key = [set.key, ...parts.slice(0, i + 1)].join("\0")
    if (!groupIds.has(key)) {
      const id = nextId("g")
      groupIds.set(key, id)
      // Only the topmost group of a hidden set is hidden: hiding a group hides
      // everything below it, so marking the children too would be noise.
      const hideThis = i === 0 && !top ? set.visible : true
      objects[id] = { kind: "group", ...base(hideThis, parent, parts[i]) }
      order.push(id)
    }
    parent = groupIds.get(key)
  }
  return parent
}

for (const set of SETS) {
  const files = readdirSync(resolve(geom, set.dir)).filter((f) => f.endsWith(".glb")).sort()
  for (const file of files) {
    const parts = file.slice(0, -".glb".length).split("__")
    const name = parts.at(-1)
    const parent = groupFor(set, parts.slice(0, -1))
    const id = nextId("o")
    objects[id] = {
      kind: "object",
      ...base(true, parent, name),
      // What solander-probe.html rewrites into a file doc served from /geom/.
      sourceUrl: `pending:${encodeURIComponent(`glb:${set.key}/${file}`)}`,
      providerId: "file-glb",
    }
    order.push(id)
  }
}

const doc = {
  "@patchwork": { type: "scene" },
  title: "Solander 38",
  objects,
  order,
  dimensions: {},
  view: { units: "m", grid: true, axes: true, bounds: false },
  camera: null,
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(doc, null, 2))

const kinds = Object.values(objects)
const shown = kinds.filter((o) => o.kind === "object" && o.visible).length
console.log(`${out}`)
console.log(
  `  ${kinds.filter((o) => o.kind === "object").length} objects, ` +
    `${kinds.filter((o) => o.kind === "group").length} groups, ${kinds.length} total`
)
console.log(`  ${shown} objects shown before hidden groups are taken into account`)
