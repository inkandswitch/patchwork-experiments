// notebook_run end to end in a page, with no notebook view mounted: a
// notebook that imports an assumptions register and another notebook, and
// loads the register with patchwork.load, run headless in Pyodide; then the
// register changes, in a value the run read and in one it didn't, and
// notebook_run's `check` says whether it is stale. dev/probe.mjs reads
// `window.probe`.
//
// The register's datatype is a stand-in with the same asSource contract as
// the assumptions package (`id = value` for "py", a flat object for "json"):
// this package can't import that one, and the hook is what's under test.
import { initializeWasm, Repo, type PeerId } from "@automerge/automerge-repo/slim"
// @ts-ignore — the default init is a wasm-bindgen runtime helper not in the .d.ts
import initSubduction, { MemorySigner } from "@automerge/automerge-subduction/slim"
import * as A from "@automerge/automerge/slim"
import automergeWasm from "@automerge/automerge/automerge.wasm?url"
import subductionWasm from "@automerge/automerge-subduction/wasm?url"
import { notebookRun } from "../src/agent-tool"

declare global {
  interface Window {
    probe: Promise<Record<string, unknown>>
  }
}

const I = (s: string) => new A.ImmutableString(s)
const code = (id: string, source: string) => ({ id: I(id), cell_type: I("code"), source, metadata: {}, outputs: [], execution_count: null })

/** The options each asSource call got: the notebook asks on its own behalf. */
const asked: Array<{ ext: string; for?: string }> = []
const registerType = {
  asSource(doc: any, ext: string, options?: { for?: string }) {
    asked.push({ ext, for: options?.for })
    const pairs = Object.entries(doc.entries ?? {}).map(([id, e]: any) => [id, e.value?.nominal] as const)
    if (ext === "py") return pairs.map(([id, v]) => `${id} = ${JSON.stringify(v)}`).join("\n") + "\n"
    if (ext === "json") return JSON.stringify(Object.fromEntries(pairs))
    return null
  },
}
const plugins = { getRegistry: (type: string) => (type === "patchwork:datatype" ? { get: (id: string) => (id === "assumptions" ? { id } : undefined), load: async (id: string) => (id === "assumptions" ? { module: registerType } : undefined) } : undefined) }

window.probe = (async () => {
  await Promise.all([initializeWasm(new Request(automergeWasm)), initSubduction(new Request(subductionWasm))])
  const repo = new Repo({ signer: MemorySigner.fromBytes(crypto.getRandomValues(new Uint8Array(32))), peerId: `patchwork-tab-${crypto.randomUUID()}` as PeerId, subductionWebsocketEndpoints: [] } as any)
  const make = (value: any) => {
    const handle = repo.create<any>()
    handle.change((d: any) => Object.assign(d, value))
    return handle
  }
  const register = make({
    "@patchwork": { type: I("assumptions") },
    title: I("Nootka assumptions"),
    entries: { boat_mass_kg: { unit: I("kg"), value: { nominal: 8330 } }, boat_speed_kn: { unit: I("kn"), value: { nominal: 8 } }, boat_drag_N: { unit: I("N"), value: { nominal: 0 } } },
  })
  const model1 = make({
    "@patchwork": { type: I("jupyter-notebook") },
    title: I("Model 1"),
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [code("m1a", "def drag_N(mass_kg, speed_kn):\n    return 0.0147 * mass_kg * speed_kn\nprint('model 1 ran')  # stays out of Model 2's output")],
  })
  const model2 = make({
    "@patchwork": { type: I("jupyter-notebook") },
    title: I("Model 2"),
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      { id: I("md"), cell_type: I("markdown"), source: "# Model 2", metadata: {} },
      code("c1", "import reg, model_1\nimport patchwork\nraw = patchwork.load(" + JSON.stringify(register.url) + ")\nunit = raw['entries']['boat_mass_kg']['unit']\nprint(type(unit).__name__, unit)"),
      code("c2", "d = model_1.drag_N(reg.boat_mass_kg, patchwork.load('reg', as_='json')['boat_speed_kn'])\nprint(f'boat_drag_N {d:.1f}')"),
    ],
  })
  const ctx = { repo, plugins }
  const started = performance.now()
  const report = await notebookRun.execute({ url: model2.url, link: [{ url: register.url, name: "reg" }, { url: model1.url }] }, ctx as any)
  const elapsed = Math.round(performance.now() - started)
  const doc = model2.doc()
  const run = JSON.parse(JSON.stringify(doc.metadata.patchwork.run))
  const outputs = doc.cells.map((c: any) => (c.outputs ?? []).map((o: any) => String(o.text ?? "")).join(""))
  const counts = doc.cells.map((c: any) => c.execution_count ?? null)

  // A change to an entry the run didn't read through load, but the import reads the register whole.
  register.change((d: any) => (d.title = "Nootka assumptions (renamed)"))
  const afterRename = await notebookRun.execute({ url: model2.url, check: true }, ctx as any)
  register.change((d: any) => (d.entries.boat_mass_kg.value.nominal = 8900))
  const afterChange = await notebookRun.execute({ url: model2.url, check: true }, ctx as any)
  const rerun = await notebookRun.execute({ url: model2.url, cells: [3] }, ctx as any)
  return { asked, notebook: model2.url, report, elapsed, run, outputs, counts, afterRename, afterChange, rerun, outputsAfter: model2.doc().cells.map((c: any) => (c.outputs ?? []).map((o: any) => String(o.text ?? "")).join("")) }
})().catch(error => ({ error: String(error?.stack ?? error) }))
