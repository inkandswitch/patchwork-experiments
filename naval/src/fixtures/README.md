# Validation fixtures

Twelve boats: the four below (2026-11-06) and [eight more](#the-2026-11-10-fleet)
added on 2026-11-10 to put the balance model in front of more real boats.

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

## The 2026-11-10 fleet

Eight more real boats, written by `make-fleet-fixtures.mjs.txt` (which, unlike
the older generator, is the authority for its JSON: nothing is edited
afterwards). Same shape as above, plus `published.balance`: where the mast
and the keel's leading edge came from (`given`, or `estimated` with how and
±), the real waterline's forward end where a drawing gives it, a PHRF number
with its list, and how much the boat's balance reading is worth (`weight`).
`src/validation-fleet.test.js` reads them as a fleet.

| Fixture | Rig, keel | Mast position | Keel position and planform | Weight |
|---|---|---|---|---|
| `j70.json` | fractional, lifting fin and bulb | ORC: SFJ + J | read off the class rules' inboard profile (±0.03 m); tip chord, sweep and bulb not sourced | good |
| `farr40.json` | fractional, fin and bulb | ORC and class rule: SFJ 0 + J | read off Farr's vector profile (scale checks to 0.01 m; ±0.07 m against the class rule) | good |
| `soling.json` | fractional, fin | ORC: SFJ + J; class rule from the breakwater | read off the class measurement diagram, from the same breakwater datum (±0.06 m) | good |
| `folkboat.json` | fractional, long keel | class rule: 800 mm + 1990–2000 mm | dimensioned on the official 1:10 plan; the canoe body / keel split (Tc 0.42 m) is a choice | good |
| `cal40.json` | masthead, long-chord fin | Lapworth's sail plan: J, tack at the stemhead | read off Lapworth's dimensioned lines (±0.03 m; root corner ±0.1 m) | good |
| `contessa32.json` | masthead, fin, skeg rudder | read off the brochure profile (±0.08 m) | the same profile (±0.1 m); the keel blends into the hull | fair |
| `hr40c.json` | fractional, fin (sump and bulb), twin rudders | read off the builder's section (±0.04 m) | the same section; I and P off a rendering (±0.5 m) | low |
| `dinghy-470.json` | fractional, centreboard | class rule: the partner's ends | class rule: the pivot and the board's planform | fair (no band applies) |

Not fetched for any of them: sailboatdata.com (HTTP 403); its ratios are quoted
from sites that reproduce its table, named per figure. Two things are solved by
the generator with the tool's own model and written as numbers: BWL where a
source gives a waterplane figure but no BWL (ORC's "sink" for the J/70, Farr 40
and Soling; the Wolfson report's BM for the Contessa 32), and the keel's span,
so the draft is the published one.

### What the fleet found

Measured 2026-11-10. Each disagreement is pinned in the test or the fixture
(a ratchet either way), not asserted away.

- **Ratios** (SA/D, D/L, ballast ratio, hull speed, and capsize screening
  worked from the doc) match the published tables on all seven keelboats to
  the printed precision.
- **The lead on real keels.** The 19.5% (Catalina 30) and 16.2% (J/24) that
  started this are not evidence about the band: those keels were *placed*
  with their quarter chords over the LCB, the first guess's rule. On the
  seven boats with a band and a sourced keel the extended-keel lead reads
  Farr 40 5.4, Soling 4.6, HR 40C 3.8 (all inside 3–7%), Cal 40 10.4 (5–9%),
  J/70 11.5 (3–7%), Contessa 32 15.9 (5–9%), Folkboat 16.5 (10–14%, on the
  canoe-and-keel centroid). Three of seven in band; the rest above, by 1.4 to
  6.9 points. The best single shift of every band is +3.2 points and still
  leaves a spread (SD) of 3.8; no CLR definition does better (whole-profile
  centroid: +13.6, SD 5.2; foils' hydrodynamic centre: +13.7, SD 6.7).
- **Real keels are forward of the LCB.** The first guess, which puts the
  keel's quarter chord over the LCB and then moves the mast, lands the mast
  0.8–1.8 m aft of the real one on every keelboat (9–20% of LWL), mostly
  because its fin is 0.9–1.5 m aft of the real one (0.2 m on the J/70). With
  the real rig over the real keel, the band's middle would move the mast
  −0.14 to +0.65 m (Farr 40 +0.04, Soling −0.02, HR 40C −0.14, Folkboat
  +0.28, Cal 40 +0.32, J/70 +0.41, Contessa 32 +0.65).
- **Helm.** On the six fin-keel boats with sourced keels the VPP reads −2.6°
  to +2.1° (mean −1.0°): slight lee helm where such boats carry a few degrees
  of weather helm. The Folkboat reads 5.2° weather.
- **The synthetic hull's waterline.** Its forward end is always 0.6·(LOA −
  LWL) aft of the stem: 0.50 m too far aft on the Farr 40, 0.27 m on the Cal
  40, 0.30 m on the HR 40C (right on the Folkboat and Contessa 32). It
  doesn't enter the extended-keel lead; it does move the hull under the rig
  for the whole-profile CLR, the LCB and the helm.
- **Stability.** Farr 40 RM at 1° −6.8% and LPS 131.4° against ORC's 131.4°;
  HR 40C RM at 30° −0.8% and AVS 125.6° against Frers' 125.5° (on a BWL that
  is only a proportion, so partly luck); Contessa 32 GM −0.8% and maximum GZ
  +4% against the Wolfson report (BWL solved from its BM). Known gaps, pinned:
  the angle of vanishing stability on the J/70 (126.7° against ORC's 100.0°),
  the Soling (132.3° against 113.0°) and the Contessa 32 (137.4° against
  156°): the synthetic hull is decked flat at the sheer, with no cockpit and
  no coachroof. RM at 1° is +16% (J/70) and +10% (Soling).
- **BWL from ORC's sink.** The same arithmetic on the J/24's certificate
  (8.53 kg/mm) gives a waterplane of 8.32 m² against the fixture's 9.41 m²
  on its estimated BWL of 2.30 m: independent support for that fixture's
  known RM gap being its BWL. (The J/24 fixture is not changed.)
- **Polars.** Against ORC: Farr 40 12/12 compared speeds within 4%; J/70 and
  Soling 11/12 within 8% (beat VMG at 8 kn +10.5% and +11.7%). Against Frers'
  VPP the HR 40C's reaching is within 7% and her beat VMG 10–13% over. All
  four point higher than their references at 12 and 16 kn (3–7°), as the
  J/24 does.
- **PHRF order.** Over the eight boats with a number (three lists), the
  model's order matches PHRF's but for the J/24 and Catalina 30 swapping
  (Spearman's ρ 0.98). Ordinal only.
- **Wetted area.** With the keel and rudder (2 × planform) ours is within
  +1.3% (J/70), −4.9% (Farr 40) and +5.4% (Soling) of ORC's.
