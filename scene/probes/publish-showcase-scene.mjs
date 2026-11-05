// Publish the geometry showcase to a real sync server and print its URL.
//
//   node probes/publish-showcase-scene.mjs [--sync wss://…] [--settle 8000]
//
// Makes NEW docs on every run (no dedupe): an implicit sculpture (twisted
// strands), tower and hull, an OpenSCAD plinth that imports the sculpture, a flow field whose body
// is the hull's scene render, an About note, a render doc per object, and the
// scene. Nothing is built here: the first scene to open builds every render
// (the hull first; the flow follows once the hull's GLB exists).
//
// Docs of other packages' datatypes are written by shape (see each package's
// datatype.js); this script imports their sources only for example text and
// param defaults, at runtime, from this checkout.
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { newRenderDoc } from "../src/datatype.js"
import { defaultParams } from "../src/staleness.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../..")
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
)
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com"

const { EXAMPLES } = await import(resolve(repoRoot, "implicit/src/examples.js"))
const implicitPlugins = (await import(resolve(repoRoot, "implicit/src/index.js"))).plugins
const flowPlugins = (await import(resolve(repoRoot, "flow-field/src/index.js"))).plugins
const specs = (plugins, id) => plugins.find((p) => p.type === "scene:source" && p.id === id).params
const example = (id) => EXAMPLES.find((e) => e.id === id)

await initSubduction()
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] })
const create = async (value) => (await (repo.create2 ? repo.create2(value) : repo.create(value)))
const made = []
const make = async (value) => {
  const h = await create(value)
  made.push(h.url)
  return h.url
}
console.log(`connected to ${SYNC}`)

// ─── sources ───────────────────────────────────────────────────────────────
const implicitDoc = (title, ex, notes = "") => ({
  "@patchwork": { type: "implicit-surface" },
  title,
  source: ex.source,
  bounds: { min: [...ex.bounds.min], max: [...ex.bounds.max] },
  notes,
})
// Not the gyroid example: a gyroid lattice meshes to ~20 MB at a resolution that
// looks good, too heavy for a first open. The strands are under 1 MB at 96.
const strands = {
  source: readFileSync(resolve(here, "showcase/strands.sdf"), "utf8"),
  bounds: { min: [-0.1, -0.17, -0.1], max: [0.1, 0.17, 0.1] },
}
const sculpture = await make(implicitDoc("Twisted strands", strands))
const tower = await make(implicitDoc("Twisted tower", example("tower")))
const hull = await make(implicitDoc("Hull", example("hull")))
const plinth = await make({
  "@patchwork": { type: "openscad" },
  title: "Plinth",
  source: readFileSync(resolve(here, "showcase/plinth.scad"), "utf8"),
  imports: [{ name: "sculpture", docUrl: sculpture, label: "Twisted strands" }],
})
const about = await make({
  "@patchwork": { type: "file" },
  name: "About the geometry showcase.md",
  extension: "md",
  mimeType: "text/markdown",
  content: readFileSync(resolve(here, "showcase/about.md"), "utf8"),
})

// ─── renders (the hull's first: the flow field links to it) ───────────────
const render = (title, parent, providerId, params) => make(newRenderDoc({ title, parent, providerId, params }))
const implicitParams = (over) => ({ ...defaultParams(specs(implicitPlugins, "implicit-mesh")), ...over })
const rSculpture = await render("Twisted strands", sculpture, "implicit-mesh", implicitParams({ resolution: 96, finish: "metal" }))
const rTower = await render("Twisted tower", tower, "implicit-mesh", implicitParams({ resolution: 112, finish: "satin" }))
const rHull = await render("Hull", hull, "implicit-mesh", implicitParams({ resolution: 112, finish: "satin" }))
const rPlinth = await render("Plinth", plinth, "openscad-model", { unit: "mm" })

// The hull is 1.12 m, bow at +X, Y up; the flow's floating frame is x along,
// y across, z up, with the waterline at z = 0 (the hull's y = 0).
const flow = await make({
  "@patchwork": { type: "flow-field" },
  title: "Flow past the hull",
  freestream: { speed: 2, headingDeg: 180 }, // from the bow towards the stern
  elements: {},
  domain: { min: [-0.9, -0.32, -0.25], max: [0.9, 0.32, 0.05] },
  seeds: { count: 9 },
  body: { url: rHull, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 140 },
})
const flowParams = (id, over) => ({ ...defaultParams(specs(flowPlugins, id)), ...over })
const rStream = await render("Flow past the hull", flow, "flow-field-streamlines",
  flowParams("flow-field-streamlines", { rakeRows: 2, seedHeight: -0.04, rowSpacing: 0.08, step: 0.01, maxSteps: 400, tubeRadius: 0.005 }))
const rSlice = await render("Flow past the hull", flow, "flow-field-slice",
  flowParams("flow-field-slice", { height: -0.06, resolution: 140, fade: 0.3 }))

// A Camber hull: camber's own default design (5 m, written by camber/patchwork's
// seedDoc, saved here as JSON), rendered at 1.6 m, with a flow linked to its render.
// camber-hull-surface's ParamSpec defaults (camber/patchwork/src/scene/params.ts):
const CAMBER_DEFAULTS = { sections: 96, girth: 6, size: "document", lengthMeters: 10, rake: true, origin: "waterline", transom: true, outline: true, stations: true, stationCount: 10, dwl: true }
const camber = await make({ "@patchwork": { type: "camber-hull" }, ...JSON.parse(readFileSync(resolve(here, "showcase/camber-hull.json"), "utf8")), title: "Camber hull" })
const rCamber = await render("Camber hull", camber, "camber-hull-surface", { ...CAMBER_DEFAULTS, size: "length", lengthMeters: 1.6 })
const camberFlow = await make({
  "@patchwork": { type: "flow-field" },
  title: "Flow past the camber hull",
  freestream: { speed: 2, headingDeg: 180 },
  elements: {},
  domain: { min: [-0.7, -0.5, -0.3], max: [2.3, 0.5, 0.05] },
  seeds: { count: 11 },
  body: { url: rCamber, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 160 },
})
const rCamberStream = await render("Flow past the camber hull", camberFlow, "flow-field-streamlines",
  flowParams("flow-field-streamlines", { rakeRows: 2, seedHeight: -0.04, rowSpacing: 0.09, step: 0.012, maxSteps: 500, tubeRadius: 0.006 }))
const rCamberSlice = await render("Flow past the camber hull", camberFlow, "flow-field-slice",
  flowParams("flow-field-slice", { height: -0.05, resolution: 140, fade: 0.3 }))

// ─── the scene ─────────────────────────────────────────────────────────────
const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale })
const group = (name, parent, transform, infoUrl = null) => ({
  kind: "group", name, parent, sourceUrl: null, providerId: null, renderUrl: null,
  visible: true, color: null, opacity: 1, wireframe: false, transform, infoUrl,
})
const object = (name, parent, sourceUrl, providerId, renderUrl, transform, color = null, extra = {}) => ({
  kind: "object", name, parent, sourceUrl, providerId, renderUrl,
  visible: true, color, opacity: 1, wireframe: false, transform, ...extra,
})

const objects = {
  // positions put each part's lowest point on the ground (see its render's bounds)
  gDisplay: group("Sculpture on a plinth", null, T([-0.55, 0, 0.35]), about),
  plinth: object("Plinth", "gDisplay", plinth, "openscad-model", rPlinth, T(), "#e6e1d8"),
  sculpture: object("Twisted strands", "gDisplay", sculpture, "implicit-mesh", rSculpture, T([0, 0.479, 0], [0, 0.4, 0]), "#b08d57"),
  tower: object("Twisted tower", null, tower, "implicit-mesh", rTower, T([0.25, 0.257, 0.3]), "#7f9cc4", { infoUrl: about }),
  gFlow: group("Hull in a flow", null, T([0.35, 0.42, -0.95]), about),
  hull: object("Hull", "gFlow", hull, "implicit-mesh", rHull, T(), "#f1efe9"),
  // attached to the hull: the flow is in the hull render's frame, so identity
  streamlines: object("Streamlines", "hull", flow, "flow-field-streamlines", rStream, T()),
  slice: object("Pressure slice", "hull", flow, "flow-field-slice", rSlice, T(), null, { opacity: 0.85 }),
  gCamber: group("Camber hull in a flow", null, T([-0.45, 0.22, -2.25]), about),
  camber: object("Camber hull", "gCamber", camber, "camber-hull-surface", rCamber, T(), "#efe9dc"),
  camberStreamlines: object("Streamlines", "camber", camberFlow, "flow-field-streamlines", rCamberStream, T()),
  camberSlice: object("Pressure slice", "camber", camberFlow, "flow-field-slice", rCamberSlice, T(), null, { opacity: 0.85 }),
}
const order = ["gDisplay", "plinth", "sculpture", "tower", "gFlow", "hull", "streamlines", "slice", "gCamber", "camber", "camberStreamlines", "camberSlice"]

// world = group · local; groups are translations only here. Anchors are vertices
// of the built meshes (bow and stern on the waterline; the plinth's floor and cap
// corners for the strands' bounds), so neither dimension reads "off surface".
const world = (g, p) => p.map((v, i) => v + objects[g].transform.position[i])
const anchor = (objectId, g, local) => ({ objectId, local, world: world(g, local) })
const dims = {
  hullLength: { a: anchor("hull", "gFlow", [0.4971, -0.005, -0.005]), b: anchor("hull", "gFlow", [-0.4983, -0.005, -0.005]), label: null },
  plinthHeight: { a: anchor("plinth", "gDisplay", [0.159, 0, 0.159]), b: anchor("plinth", "gDisplay", [0.149, 0.32, 0.149]), label: null },
}

const scene = await make({
  "@patchwork": { type: "scene" },
  title: "Geometry showcase",
  objects,
  order,
  dimensions: dims,
  view: { units: "mm", grid: true, axes: true, bounds: false },
  camera: { position: [3.9, 2.9, 3.4], target: [0.3, 0.22, -1.15] },
})
console.log(`scene ${scene}`)

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
