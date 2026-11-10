// A camber-hull doc from one of camber's example files, at REAL SIZE, as
// camber's own datatype would store it, printed as JSON. Run by
// publish-examples.mjs (and rig-run.mjs) with camber's own tsx, against
// camber's SOURCE (a dev-time borrow, like the probes' use of camber's
// build: no package imports another):
//
//   <camber>/node_modules/.bin/tsx probes/camber-hull-doc.mts <camber> <example.json> <title> [<loa m>]
//
// The doc is CamberHullDatatype.init (a title and upstream's default design),
// its hull keys then replaced by the example's stored form: storedFormOf, the
// on-disk hull camber writes for a document (a v1 example is converted to v2
// by upstream's own parser, exactly as camber does before its first edit).
// With a length, the hull is then put in metres and scaled to that length
// overall by camber's own commands, as a designer does in camber
// (setUnit m with rescale, then setLoa): the doc is the boat at real size, so
// anything reading it at camber's default "document size" gets a real boat.
// No weight book, as for any design without an estimate.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const [camber, example, title, loaArg] = process.argv.slice(2);
if (!camber || !example || !title) throw new Error("usage: camber-hull-doc.mts <camber> <example.json> <title> [<loa m>]");
const loaM = loaArg == null ? null : Number(loaArg);
if (loaM != null && !(loaM > 0)) throw new Error(`a length overall must be a positive number of metres, not ${loaArg}`);
const src = (p: string) => import(join(camber, "patchwork/src", p));
const { CamberHullDatatype } = await src("datatype.ts");
const { partsOfDoc, readParts, storedFormOf } = await src("docFormat.ts");
const { V2_HULL_KEYS } = await src("types.ts");
const core = (p: string) => import(join(camber, "src/core", p));
const { interpretHullCommand, rejected } = await core("commands.ts");
const { assemble } = await core("runtime.ts");
const { buildJson } = await core("json.ts");
const { loa } = await core("hull.ts");

const raw = JSON.parse(readFileSync(join(camber, "examples", example), "utf8"));
const parts = partsOfDoc(raw);
const read = readParts(parts);
if (!read.ok) throw new Error(`camber can't read ${example}: ${read.error}`);
let hull = storedFormOf(parts) ?? parts.hull;

if (loaM != null) {
  let state = read.state.hull;
  for (const cmd of [{ type: "setUnit", unit: "m", rescale: true }, { type: "setLoa", length: loaM }]) {
    const out = interpretHullCommand(assemble(state), cmd);
    if (rejected(out)) throw new Error(`camber refused ${cmd.type}: ${out.rejected}`);
    state = out.state;
  }
  if (state.unit !== "m" || Math.abs(loa(state) - loaM) > 1e-9 * loaM) throw new Error(`the hull isn't ${loaM} m in metres: ${loa(state)} ${state.unit}`);
  hull = JSON.parse(buildJson(state));
}

const doc: Record<string, unknown> = { "@patchwork": { type: "camber-hull" } };
CamberHullDatatype.init(doc);
for (const k of V2_HULL_KEYS) delete doc[k];
Object.assign(doc, hull);
CamberHullDatatype.setTitle(doc, title);

// what camber reads back from the doc must be what it would store: nothing left to convert
const again = partsOfDoc(doc);
if (!readParts(again).ok || storedFormOf(again) !== null) throw new Error("the doc isn't in camber's stored form");
process.stdout.write(JSON.stringify(doc));
