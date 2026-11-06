# Test fixtures

Two unmodified GLB files from the Solander 38 website
(github.com/risingtideresearch/solander-38-website @ 15ae34a), copied from
`scene/src/test/fixtures/`. They check that a GLB body is read the way the
scene reads it: EXT_meshopt_compression + KHR_mesh_quantization, node
transforms (a quantized mesh under a scaling node), and one mesh used by
several nodes.

| file | original name |
|---|---|
| `solander-freezer.glb` | `models-1789414952/OUTFITTING_INTERIOR__Isotherm Drawer 55 – Frost Free Freezer.glb` (one mesh) |
| `solander-battery-cell.glb` | `models-battery-1789233002/BATTERY MODULE V2__BATTERY CELL BASE__CELL.glb` (one mesh used by 8 nodes) |

3D assets © Rising Tide Research Foundation (solander38.com), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
