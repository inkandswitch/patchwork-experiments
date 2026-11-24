// The published boats, for "New from…" and the validation suite. Each JSON
// is a rig-design doc plus `published` (reference figures with tolerances,
// polar targets, source disagreements) and `sources` (URL or book, page,
// retrieved date, and whether it was actually fetched). See README.md.

import catalina30 from "./catalina-30.json";
import j24 from "./j24.json";
import laser from "./laser-ilca7.json";
import sloop12m from "./sloop-12m.json";
import j70 from "./j70.json";
import farr40 from "./farr40.json";
import soling from "./soling.json";
import folkboat from "./folkboat.json";
import cal40 from "./cal40.json";
import contessa32 from "./contessa32.json";
import hr40c from "./hr40c.json";
import dinghy470 from "./dinghy-470.json";

/** In menu order. */
export const FIXTURES = [
  { id: "sloop-12m", label: "12 m sloop (stock)", fixture: sloop12m },
  { id: "catalina-30", label: "Catalina 30 (masthead)", fixture: catalina30 },
  { id: "j24", label: "J/24 (fractional)", fixture: j24 },
  { id: "laser-ilca7", label: "Laser / ILCA 7 (cat)", fixture: laser },
  // added 2026-11-10 (make-fleet-fixtures.mjs.txt): real boats for the balance question
  { id: "j70", label: "J/70 (fractional sportboat)", fixture: j70 },
  { id: "farr40", label: "Farr 40 OD (fractional racer)", fixture: farr40 },
  { id: "soling", label: "Soling (fractional keelboat)", fixture: soling },
  { id: "folkboat", label: "Nordic Folkboat (long keel)", fixture: folkboat },
  { id: "cal40", label: "Cal 40 (masthead)", fixture: cal40 },
  { id: "contessa32", label: "Contessa 32 (masthead)", fixture: contessa32 },
  { id: "hr40c", label: "Hallberg-Rassy 40C (cruiser)", fixture: hr40c },
  { id: "dinghy-470", label: "470 (fractional dinghy)", fixture: dinghy470 },
];

/** The boats that exist: every fixture but the stock sloop, which is sailing's lumped model read as a rig. */
export const REAL_BOATS = FIXTURES.filter((f) => f.id !== "sloop-12m");

/** The doc part of a fixture: everything but `published`. */
export function fixtureDoc(fixture) {
  const { published, ...doc } = fixture;
  return JSON.parse(JSON.stringify(doc));
}
