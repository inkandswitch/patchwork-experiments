# link/

How the rig aid gets a hull mesh from another document. Copied, not imported
(packages never import each other):

- `render-read.js` — the scene kit's render reader, copied whole from
  flow-field (canonical: patchwork-experiments/scene/src/render-read.js).
  Never edit this copy.
- `registry.js` — flow-field's late-bound `@inkandswitch/patchwork-plugins`.
- `glb-read.js` — flow-field's GLB reader (`mesh-section.js`: readGLB,
  decodeGLB, readAccessor, glbUnits, node transforms, instancing, meshopt) and
  `glb.js`'s parseGLB. Changed: `glbTriangles` returns glTF coordinates in
  metres, unmapped, because the rig aid applies the designer's bow/up frame.
- `vendor/meshopt_decoder.module.js` — meshoptimizer (MIT), via flow-field.
- `hull-link.js` — the render / file / source paths and provider matching
  from flow-field's `section.js`, returning a mesh instead of a section.
