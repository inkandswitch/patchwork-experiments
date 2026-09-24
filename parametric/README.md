# Parametric

One Patchwork document type for parametric graphics. A document stores parameter values and
a reference to the source file that draws them; this package's tool builds the controls
from the document's schema and draws the picture through the source's `render()`.

- `DATATYPE.md` is the design: the document shape, the source-file contract, and why.
- `sources/` holds one source per graphic (harmonograph, catenoid, grids, coln-type). It is
  its own pushwork repo, published at `automerge:3SMAP2oETW1tbwddHTkf6f9JpxTs`.
- `parametric.js`, `datatype.js`, `tool.js` are the bundleless package, published at
  `automerge:3CBGscMZdpregYqu2HDEZFQRjzF9`.
- `dev/harness.html` drives a source outside Patchwork. `dev/serve.mjs` serves this folder
  to a local host.

## Use it in Patchwork

1. Open Patchwork, click **Packages**, paste `automerge:3CBGscMZdpregYqu2HDEZFQRjzF9`, confirm.
2. Create a **Parametric** document from the new-document menu. It opens on the
   harmonograph source and copies that source's parameters into the document.
3. Switch sources with the file picker in the docket at the bottom. Values you have set
   stay in the document; the new source's parameters replace the old ones.
4. Select the **Sketches** theme in Settings for the intended look. The theme package is
   `../../patchwork-pkg-lattice/sketches-theme/`.

## Develop

```sh
node dev/serve.mjs                                 # this folder at :5198, CORS, no-store
cd ../../patchwork-pkg-lattice/host && pnpm exec vite --port 5183
```

In the host's console, once, then reload:

```js
localStorage.setItem("systemPackageListURL",
  "/modules.json,http://localhost:5198/dev/modules.json,http://localhost:5199/dev/modules.json")
```

The third list is lattice's, which carries the Sketches theme; start `node dev/serve.mjs`
there too if you want it. A query string on the vite dev server 404s, so use localStorage.
Remove the published copy from the Packages panel while developing, or it shadows the
HTTP one.

Edit a source in `sources/`, then `pushwork sync` there (twice if it does not show up).
Every document referencing that file re-imports it on the next change.

Publish the tool from this folder with `pushwork sync`. `.pushworkignore` keeps `sources/`,
`dev/` and the design note out of the package.

## Check

```sh
npm run check     # syntax for the package, then the contract check over every source
```
