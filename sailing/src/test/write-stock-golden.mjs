// Records the stock boats' runs (stock-runs.js) as stock-golden.json. Run
// it only to change the stock physics on purpose: stock-golden.test.js
// holds every later build to this file, bit for bit.
import { writeFileSync } from "node:fs";
import { stockRuns } from "./stock-runs.js";

writeFileSync(new URL("./stock-golden.json", import.meta.url), JSON.stringify(stockRuns(), null, 1) + "\n");
console.log("wrote stock-golden.json");
