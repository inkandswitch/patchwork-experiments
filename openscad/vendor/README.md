# Vendored OpenSCAD engine

`openscad-2026.11.20/` is OpenSCAD's official WebAssembly nightly, unchanged:
`openscad.js` (an Emscripten ES module whose default export makes an engine
instance) and `openscad.wasm`.

- Source: https://files.openscad.org/snapshots/OpenSCAD-2026.11.20-WebAssembly-web.zip
  (zip sha256 `f28ac9e3b6403655d10d925b50c50a243128572cf83bab011266b172a6c7742a`,
  checked against the `.sha256` published beside it)
- `--info`: OpenSCAD 2026.11.20 (git a70ba7bd), Manifold 3.5.4, CGAL 6.0.1,
  Clipper2 2.0.1, lib3mf. No fonts are bundled.
- Licence: GPL (OpenSCAD is GPL-2.0-or-later); source at https://github.com/openscad/openscad
  at the commit above.

It is vendored rather than loaded from a CDN because files.openscad.org
doesn't serve cross-origin requests, keeps nightlies only for about a year,
and the npm `openscad-wasm` package stopped at 0.0.4 (OpenSCAD 2025.07.18,
whose 3MF export crashes). The build copies these files into
`dist/openscad-2026.11.20/` after checking them against `SHA256SUMS`
(`vite.config.ts`).

## Updating

1. Download a newer `OpenSCAD-<date>-WebAssembly-web.zip` from
   https://files.openscad.org/snapshots/ and check it against its `.sha256`.
2. Unzip it into `vendor/openscad-<date>/`, write `SHA256SUMS` there
   (`shasum -a 256 openscad.js openscad.wasm > SHA256SUMS`), delete the old
   directory, and set `ENGINE_DIR` in `src/render/engineFiles.ts`.
3. Run the probes (`node probes/probe-server.mjs . 4456`, then open
   `/probes/formats-probe.html`, `/probes/color-probe.html` and
   `/probes/manifold-probe.html` after `pnpm build`).
4. Bump the scene provider's `version` in `src/index.ts`: a new engine can
   make different meshes from the same source.
