# Validation fixtures

Four published boats, each a rig-design doc (the "New from…" menu loads the
doc part) plus a `published` block that `validation.test.js` checks against.
All were retrieved on 2026-11-06. `make-fixtures.mjs.txt` writes the JSON
from the quoted figures, with exact ft/lb → SI conversions.

| Fixture | Rig | Primary sources (fetched) | Not fetched |
|---|---|---|---|
| `sloop-12m.json` | fractional | sailing's `SLOOP`, copied (must equal `STOCK_SLOOP`) | — |
| `catalina-30.json` | masthead | Good Old Boat sail data; Wikipedia; PHRF of the Alamo list | SBO spec PDF (TLS error), sailboatdata.com (HTTP 403) |
| `j24.json` | fractional | ORC International One Design certificate 2021 (sample); Good Old Boat; Wikipedia; PHRF of the Alamo | sailboatdata.com (HTTP 403) |
| `laser-ilca7.json` | cat | Wikipedia; Day (2017) and the ILCA class rules, both via lofilobzik/sail's transcription | the ILCA rules PDF and Day's paper were not opened directly |

## Shape

- **Doc fields** are SI. `prov` marks every field no source gave as
  `estimated`, and the tool shows those fields with "est.".
- **`sources[]`** entries have `{ id, what, cite, url, retrieved, fetched, note?, quoted? }`.
  `fetched: false` says that the source was named but could not be retrieved, and `note` says why.
- **`published.figures[]`** entries have `{ id, label, value, unit, tol, source, work?, condition?, estimatedInputs?, assert?, knownGap? }`.
  - `work` shows the hand arithmetic wherever a source gives the inputs but not the ratio.
  - `condition` names an entry in `published.conditions`, for example ORC's measured displacement plus crew.
  - `knownGap` is used where the model misses the stated tolerance. It records the measured miss, a looser bound the test still holds it to, and the reason.
  - `assert: false` prints a figure without comparing it, and `why` explains.
- **`published.polar`** holds the speed target and its tolerance. The J/24 uses the ORC certificate. The Catalina 30 uses a PHRF-relative target. The Laser uses Day's VPP at 9 kn.
- **`published.disagreements[]`** lists, for each figure the sources disagree on, every value with its source, and which value was used.

## What the suite found

Measured 2026-11-06, after the review pass (Savitsky friction on λb²/cos β
with ΔC_f; induced drag on the horizontal side force; the fractional lead
band 3–7%).

- **Sail plans and ratios** match by hand to within 0.1%: SA, SA/D, D/L, the ballast ratio and hull speed. The J/24's measured main (15.66 m²) and genoa (18.78 m²) also match.
- **Round trips** (`roundTrip`): rows whose value is one of the doc's own inputs are printed apart, as checks of the generators, not as validation: the Laser's Cp, Cm, BWL and Tc (all from Day's Table 2, which the synthetic hull is built from) and the J/24's and Catalina 30's draft (their keel spans are estimated to reach it).
- **J/24 speeds against ORC** are within 8% from 52° to 90° and for beat VMG, at 8, 12 and 16 kn.
  - Known gap: she points 7.8° (12 kn) and 9.0° (16 kn) higher than ORC. Held by a ratchet of ±1.5° on those measured values.
  - Downwind is printed but not compared, because ORC's figures include a spinnaker and the VPP has none.
- **Laser against Day's VPP** is within 7.5% at 9 kn. She planes on a reach at 16 kn true, 100°: 13.0 kn at trim 1.5° (below Savitsky's 2°, flagged), against an *estimated* 12 kn ±25% target (no measured figure could be fetched; see `laser-reach-anecdotal`).
- **Catalina 30 beat VMG** is 11–12% over its PHRF-relative target at 8 and 12 kn. At 16 kn it is 16.5% over, a known gap held by a ±2-point ratchet.
- **J/24 righting moment at 1°** is 36.9 kg·m, 37% above ORC's 27 kg·m: a known gap, ratcheted at ±3% of 36.9. GM 1.81 m against ORC's implied 1.22 m. BWL 2.05–2.10 m (−9 to −11%) would close it at the same VCG; closing it with VCG alone would need G 0.59 m higher, which isn't credible, so the estimated BWL is the likelier culprit.
- **Known gap: helm.** With each keel's quarter chord over the LCB (an estimate, because no source gives keel position), the VPP reads lee helm on the Catalina 30 (3.5°) and the J/24 (5.3°). Their leads are 19.5% and 16.2%, against (estimated, secondhand) bands of 5–9% and 3–7%.
  - Either the real keels sit further forward than the LCB, or the band and CLR convention (quoted secondhand) or the VPP's yaw balance is off. The VPP leaves out the hull's heel-induced side force and yaw moment (spec §6.4), which biases it toward lee helm as heel grows.
  - The Laser, the only fixture whose blade and mast positions come from a source, reads weather helm of 1.4°; the stock 12 m sloop 0.6°.
