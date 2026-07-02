# Plugin registry shards

`src/index.jsx` preserves the final plugin order, but high-churn groups live here
so separate work can land without everyone editing the same registry file.

- `layers.js`: layer coordinate-space and layer-kind plugins.
- `brushes.js`: built-in and contributed brush plugins.
- `contributed-nodes.js`: self-contained node, source, lens, and overlay plugins.
- `lenses.js`: pure wire lenses and media adapter lenses.
- `layout-tools.js`: layout descriptors, Patchwork tool adapters, datatypes, and
  the reusable Sketchy component/tool registrations.

Keep inline descriptors in `index.jsx` only when they still share local helpers or
schemas there. When a group gets stable enough to own its imports, move it into a
shard and export one ordered array.
