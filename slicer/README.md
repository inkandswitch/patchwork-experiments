# slicer

An FDM slicer for Patchwork. A **slice job** points at a 3D model — preferably
a scene object's render — keeps its settings in the document, re-slices when
the geometry changes, and saves the G-code as a file document that says where
it came from.

```
pnpm install && pnpm build && pnpm test
```

This package supersedes `bambu-slicer` (retired): it registers the same
`slice-job` datatype, so bambu-slicer's documents open here and are migrated on
read, and it carries bambu-slicer's `prepare_slice` agent tool. It also keeps
the old `patchwork-slicer` tool id, so existing pins and "open with" choices
still resolve.

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `slice-job` | a slice job (listed) |
| `patchwork:tool` | `patchwork-slicer` | `slice-job` docs, and `file` docs holding a GLB or STL (quick slice) |
| `agent:tool` | `prepare_slice` | make or re-point a slice job, set its settings, optionally slice now |

## Slicing a scene object

1. Make a **Slice job** (new document menu), open it.
2. Drag the object's row from a scene's **outline** onto the slicer. (The
   slicer reads the scene's `application/x-scene-object` row payload and looks
   up that object's `renderUrl`; for an object shown straight from a GLB file
   it takes the file.) Or paste the render's automerge link anywhere in the
   slicer, or into the **Link** field. Sidebar drags (`text/x-patchwork-dnd`,
   `text/x-patchwork-urls`, `text/plain`) of a render, GLB or STL work too.
3. With **Re-slice automatically** on (the default), it slices at once, and
   again whenever the scene rebuilds that object or you change a setting.

A whole scene, an OpenSCAD document, or anything else is refused with a note
saying what to drop instead. (OpenSCAD: add it to a scene, then drag its row.)

On a raw GLB/STL `file` document the tool is a **quick slice**: settings live
only in the open view and nothing is written. **Make slice job** creates a
`slice-job` pointing at that file, with the settings you chose, and opens it.

## The source, and when it re-slices

The source is read, never written.

- **Scene render** (preferred). Read through the kit's `render-read.js`, so you
  slice exactly the geometry the scene shows, built with the scene's params.
  The job's source key is `renderKey(render)` — the render's `glbUrl` — so it
  re-slices only when the scene writes a new GLB. Status writes
  ("building"/"idle"), renames, and rebuilds whose bytes didn't change (the
  scene keeps the same GLB doc for those) do nothing.
- **GLB / STL file.** Watched by heads; when they change, the bytes are hashed,
  and the key is that hash. So renaming the file doesn't re-slice; new content
  does.

Each source change or settings change is debounced (0.9 s / 0.6 s; a job that
was never sliced goes at once). With auto off, the status says **Out of date**
and why, and **Slice now** does it. Whether it is stale is worked out from
`builtFrom` in the doc, so it survives a reload and every peer agrees.

A slice that fails (a model bigger than the bed, a mesh that can't be read)
records `status: "error"`, the message, and `errorFrom` (the inputs it failed
on). It is not retried automatically until the source or settings change, so
auto mode doesn't loop on a bad model. A render the scene hasn't built yet is
*waiting*, not an error.

Two peers with the same job open don't both slice: whoever starts broadcasts
`{ type: "slice-job:slicing", key }` on the job and the others hold off for
30 s; if two slices of the same inputs still race, the second keeps the first's
result.

## Units

The slicer works in millimetres, Z up. In order of authority:

1. a **scene render** is Y-up metres by contract;
2. a **GLB** that says `asset.extras.units` (the kit encoder writes `"m"`) is in that unit, Y up;
3. an **STL** is in the `stlUnit` setting (default mm), `stlUp` up (default Z);
4. a **GLB** that doesn't say uses the `glbUnit` setting;
5. only if that is `auto`, a guess: glTF says metres, but a model more than 2
   units across is read as millimetres.

The panel always shows the unit used and why ("metres (scene render)",
"millimetres (guessed from size)" in warning colour). **Scale** applies after
units: 0.02 prints a 10 m hull as a 1:50, 200 mm model, and **Fit to bed** sets
it for you. A model bigger than the bed fails with its size in mm.

## Settings

All in `settings` on the job (see `src/settings-spec.js` for every key, range
and default). Groups: **Model** (`stlUnit`, `stlUp`, `glbUnit`, `scale`),
**Quality** (`layerHeight`, `firstLayerHeight`, `wallLoops`, `topLayers`,
`bottomLayers`, `infillDensity`, `supports`), **Material** (`filament`,
`nozzleTemp`, `bedTemp`, `fanSpeed`, `filamentDiameter`, `flow`), **Speed**
(`wallSpeed`, `infillSpeed`, `firstLayerSpeed`, `travelSpeed`, `retract`,
`retractSpeed`), **Printer** (`printer`, `bedX`, `bedY`, `bedZ` — a Bambu Lab
H2D by default — `nozzle`, `lineWidth`).

- Missing keys read as defaults; values are coerced and clamped to their spec
  on read, so a hand-edit or an agent can't push the slicer out of range.
- Changing the layer height changes only the layer height.
- Choosing a filament writes its nozzle, bed and fan values from one table
  (PLA 220/60/100 %, PETG 245/75/40 %, ABS 255/100/0, ASA 260/100/0, TPU
  230/45/60 %); they stay editable after.
- `supports` is recorded (and noted in the G-code) but supports are **not
  generated** yet.

## Output

- One current G-code **file doc** per job (`gcodeUrl`): `{ "@patchwork": {
  type: "file" }, name: "<title>.gcode", extension: "gcode", mimeType:
  "text/x-gcode", content: Uint8Array }`. A slice whose bytes hash the same as
  the current G-code (`builtFrom.gcodeHash`) keeps that doc; new bytes make a
  new immutable doc and repoint `gcodeUrl`. Superseded ones are orphaned.
- **Download G-code** saves it; **Open G-code** opens the file doc.
- The preview is drawn from the saved G-code (walls, solid, infill, with a
  layer slider), so it shows what the file says whoever sliced it. The viewer
  draws only when something changes or you move the camera; there is no
  standing animation loop.

### Provenance

The G-code starts with comments saying exactly what it was sliced from. There
are no timestamps, so the same inputs give the same bytes (that's what makes
the dedupe work); `builtAt` on the job says when.

```
; generated by Patchwork Slicer 3
; job = automerge:…
; source = automerge:…              the render or file
; source_kind = scene-render        or glb / stl
; source_key = automerge:… render:automerge:…   (renderKey, or the file's sha256)
; render_of = automerge:…           the scene object's own source doc
; units = m (render)
; scale = 1
; settings = {"bedTemp":60,…}       every effective setting, sorted
```

`readProvenance(text)` in `src/gcode.js` reads it back.

## Documents

### `slice-job`

```ts
{
  "@patchwork": { type: "slice-job" },
  title: string,
  source: AutomergeUrl | null,     // scene-render doc, or a GLB/STL file doc
  settings: { [key]: value },      // see Settings; missing = default
  auto: boolean,                   // re-slice by itself (default true)
  gcodeUrl: AutomergeUrl | null,
  builtFrom: {
    sourceKey: string,             // "<source url> <renderKey | sha256 of the file>"
    settingsKey: string,           // stable JSON of the effective settings
    sourceUrl: AutomergeUrl, sourceHeads: string[],   // for reference
    gcodeHash: string              // content hash of the G-code at gcodeUrl
  } | null,
  builtAt: number | null,
  status: "idle" | "slicing" | "error",
  error: string | null,
  errorFrom: { sourceKey, settingsKey } | null,  // inputs of the failed slice
  stats: { layers, timeSeconds, filamentMm, grams, lines, sizeMm: [x,y,z],
           triangles, openEdges, unit, unitSource, scale } | null,
  createdAt: string
}
```

- **Stale** iff `builtFrom` is null, or its `sourceKey` or `settingsKey`
  differs from now (`src/staleness.js`, pure). Title and `auto` aren't inputs.
- **bambu-slicer docs** (`modelUrl`, `settings.{layerHeight, infillDensity,
  supports, filament, nozzleTemp, bedTemp, printSpeed, wallLoops}`, top-level
  `printer`, `createdAt`) are read as: `modelUrl` → `source` when `source` is
  absent, `printer` → `settings.printer`, `printSpeed` → `settings.wallSpeed`.
  Nothing is rewritten; the first edit simply writes the new fields.

## `prepare_slice` (agent tool)

Input: `model` (automerge URL of a scene render — `objects[<id>].renderUrl` in
a scene doc — or a GLB/STL file doc), optional `job` (an existing job to
re-point), `title`, `auto`, `slice` (slice now and report the G-code URL), and
any setting by its key (`layerHeight`, `infillDensity`, `filament`, `scale`,
…). Every input is a URL, number, boolean or enum another tool can produce.
Returns the job's URL as `doc`. It runs in the worker and uses the same modules
as the tool.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe, no imports) |
| `src/datatype.js` | `slice-job`: init, `newJobDoc`, `normalizeJob` (migration on read) |
| `src/settings-spec.js`, `src/settings.js` | every setting and the filament table; defaults, coercion, aliases, `settingsKey` |
| `src/staleness.js` | pure: source keys, `staleReason`, `decide` (fresh / stale / slice now?), debounce |
| `src/source.js` | what a source is, its current key, loading it into print space |
| `src/units.js` | unit resolution, Y-up → Z-up, scale, fit to bed |
| `src/job.js` | one slice: model → toolpaths → G-code → file doc → job doc |
| `src/output.js` | the G-code file doc and hash dedupe |
| `src/gcode.js` | G-code and its provenance header |
| `src/slice.js`, `src/toolpaths.js`, `src/mesh.js`, `src/stl.js`, `src/glb-read.js` | the slicing engine (from the old patchwork-slicer): mesh → layers → walls, skins, infill (clipper-lib); STL and GLB readers |
| `src/gcode-preview.js`, `src/viewer.js` | the preview: G-code → segments; three.js, render on demand |
| `src/tool.js`, `src/styles.css` | the tool |
| `src/agent.js` | `prepare_slice` |
| `src/dnd.js`, `src/theme.js` | drops/pastes (+ scene outline rows) and theme colours, copied from scene |
| `src/render-read.js`, `src/glb.js` | **kit** files, verbatim copies of `scene/src/` (`node scripts/check-kit.mjs`); `glb.js` (the encoder) is only used by tests |
