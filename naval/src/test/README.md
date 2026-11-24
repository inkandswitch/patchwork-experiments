# Test data

- `fixtures/camber/*.glb` — camber hulls built by camber's Patchwork wrapper
  (`camber/patchwork/src/scene/build.ts` `buildHullGlb`, "Scale to length"
  12 m, 64 sections, girth 6), camber main dee7de9. Four of the nine
  examples: three that float at their own design waterline, and
  `hull-default`, whose waterline is at the deck.
- `fixtures/camber/camber-hydro.json` — camber core's own `hydrostatics()`
  (240 sections) for every example at 12 m, the oracle for
  `link/hull-link.test.js`. Provenance is inside it.
- `fixtures/camber/make-camber-hydro.mts.txt` — the scratch script that made
  both, run once with camber's tsx. It imports camber's source and is not
  part of this package (hence `.txt`).
- `chartroom/` — copies of @risingtideresearch/chartroom v0.2.0
  `formats/hydrostatic-table/v1/examples/{box,upright-box}.json` and
  `fixtures/**` (the version camber pins), for `naval/statics.test.js`.
- `meshes.js` — boxes and cylinders with hand-worked answers.
- `patchwork-plugins-stub.js` — flow-field's registry stand-in (aliased in
  `vitest.config.ts`).
- `fixtures/delft-residuary-lofilobzik.json` — Keuning & Katgert (2008)
  Table 2, as transcribed from the paper's page image by lofilobzik/sail
  (`data/delft-residuary.json`, MIT licence), fetched 2026-11-06. The
  second, independent copy that `naval/resistance.js`'s table is checked
  against cell for cell (the first is aciceri/vela's, from Larsson,
  Eliasson & Orych's Fig 5.18).
- `contract-cases.js` — the boats the contract fixtures
  (`contract/v1/fixtures/valid/`) are built from (the four published boats,
  cuvature-kink at 12 m and 8 t with the first guess's rig, and the minimal
  Laser), the invalid fixtures' mutations, and the 9-significant-digit
  writer. `contract-fixtures.test.js` checks the committed fixtures against
  a fresh build and rewrites them with `RIG_WRITE_CONTRACT_FIXTURES=1`.
