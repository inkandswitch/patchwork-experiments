// The published boats, for "New from…" and the validation suite. Each JSON
// is a rig-design doc plus `published` (reference figures with tolerances,
// polar targets, source disagreements) and `sources` (URL or book, page,
// retrieved date, and whether it was actually fetched). See README.md.

import catalina30 from "./catalina-30.json";
import j24 from "./j24.json";
import laser from "./laser-ilca7.json";
import sloop12m from "./sloop-12m.json";

/** In menu order. */
export const FIXTURES = [
  { id: "sloop-12m", label: "12 m sloop (stock)", fixture: sloop12m },
  { id: "catalina-30", label: "Catalina 30 (masthead)", fixture: catalina30 },
  { id: "j24", label: "J/24 (fractional)", fixture: j24 },
  { id: "laser-ilca7", label: "Laser / ILCA 7 (cat)", fixture: laser },
];

/** The doc part of a fixture: everything but `published`. */
export function fixtureDoc(fixture) {
  const { published, ...doc } = fixture;
  return JSON.parse(JSON.stringify(doc));
}
