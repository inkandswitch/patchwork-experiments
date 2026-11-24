# 3D Model Viewer

View 3D files in Patchwork, and use Rhino `.3dm` files in a scene.

There is no build step: the package is plain ES modules and `index.js` is its
entry.

```
pnpm install && pnpm test
```

## What it registers

| type | id | for |
|---|---|---|
| `patchwork:tool` | `model-viewer` | a file document that is a `glb`, `gltf`, `stl`, `3mf`, `3dm`, `obj` or `ply` |
| `scene:source` | `file-3dm` | a Rhino `.3dm` file document, built into a GLB for the `scene` package |

`index.js` is metadata only, so a host can read it in a worker; each plugin's
code loads on first use.

## The viewer

`tool.js` orbits the model, with **Fit**, **Wireframe** and **Grid**. A model
that has layers (a `.3dm`, or a GLB that declares them) gets a **Layers**
panel. Its ticks start as the file has them and belong to this view: they are
not saved.

`load.js` is the one place that knows formats: bytes and an extension in, a
three.js object out, Y-up (STL, 3MF and PLY are Z-up and are turned).

## Rhino 3dm to GLB

`convert3dm(bytes, params, name)` in `source.js` returns
`{ kind: "glb", glb, meta: { bounds, notes } }`: Y-up, in metres, one mesh per
layer and colour.

- **Units** come from the file, or from the `unit` param when it is not
  `auto`. A file whose unit system has no known scale says so in its notes.
- **Layers.** Every layer with geometry is built, hidden ones too, and
  declared in the GLB (`layers.js`): the glTF scene's `extras.layers` lists
  them, and each node's `extras.layer` names its own. Showing or hiding a
  layer is then a display change, not a rebuild.
- **Hidden objects** are left out unless the `hidden` param asks for them.
- **Geometry.** A mesh is used as it is, and a SubD by its control net. A Brep
  face or an extrusion uses the render mesh the file carries; a face or
  surface without one is sampled on a grid, untrimmed, and the notes count
  how many were approximated.
- **Blocks** are expanded, to eight levels. Each part keeps its own layer and
  colour; a by-parent part takes the block's.
- **A truncated file** is reported as truncated, with how much is missing.

The conversion runs in a module worker when the page can start one
(`offthread.js`, `convert-worker.js`) and on the main thread otherwise.

`glb.js` is a small GLB encoder: indexed triangle meshes with normals and a
flat colour each, one node per mesh. `layers.js` is the `scene` package's kit
file, copied whole.

## What it fetches at run time

- three.js 0.180.0 and its loaders, from esm.sh, on first use (`three.js`).
- rhino3dm 8.35.0, its JavaScript and its WebAssembly, from jsDelivr, the
  first time a `.3dm` is read (`source.js`).

The tests run the same rhino3dm from `node_modules` and check that the two
versions match.
