# Parametric sources

One ES module per graphic. Each exports the template (`version`, `params`, `output`,
`presets`, `titleTemplate`) and the code (`render`, and optionally `extent`, `notes`,
`interact`, `migrate`) described in `../DATATYPE.md`.

| File | Lifted from |
|---|---|
| `harmonograph.js` | `harmonograph/index.html` |
| `catenoid.js` | `catenoid/index.html` |
| `grids.js` | `patchwork-pkg-lattice/grid-builder/render.js` plus thing-grids HEAD |
| `coln-type.js` | `coln-type/src/js/*.js` |

## Try one

```sh
cd ..                       # parametric/
python3 -m http.server 5180
open http://localhost:5180/dev/harness.html?src=harmonograph.js
```

`dev/harness.html` is a test fixture, not the renderer.

## Publish

This directory is a pushwork repo. It is not an artifact directory, so file entries stay
unpinned and edits made in Patchwork's file tool reach every document that references them.

```sh
npm run check
pushwork init .    # first time only; mirror the printed URL into package.json under pushwork.url
pushwork sync
```

A parametric document references a source as `{ url: <this directory's automerge: URL>,
path: "harmonograph.js" }`.
