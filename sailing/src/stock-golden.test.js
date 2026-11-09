// The stock boats sail bit for bit as they did before the rig contract
// path existed: everything it adds is gated on extras.rig. The golden
// file was recorded from the physics as it stood before (test/stock-runs.js
// says how to rewrite it, which is only for a deliberate change).
import { describe, it, expect } from "vitest";
import { stockRuns, stockSpecs } from "./test/stock-runs.js";
import { specKey } from "./sim.js";
import golden from "./test/stock-golden.json";

// JSON is how the golden was written: the same doubles, -0 as 0
const asWritten = (x) => JSON.parse(JSON.stringify(x));

describe("the stock boats, bit for bit", () => {
  const runs = stockRuns();

  it("the default Sloop sails exactly as she did", () => {
    expect(asWritten(runs.sloop)).toEqual(golden.sloop);
  });

  it('the stock hull with the "Mast and sail" part sails exactly as she did', () => {
    expect(asWritten(runs.mastAndSail)).toEqual(golden.mastAndSail);
  });

  it("their specs carry no contract, and their physics are keyed as before", () => {
    const { mastAndSail } = stockSpecs();
    expect(mastAndSail.rig).toBeUndefined();
    expect(specKey(mastAndSail)).toBe(JSON.stringify(mastAndSail));
  });

  it("the runs went somewhere: she's under way, not becalmed", () => {
    for (const run of Object.values(golden)) expect(run.marks.at(-1).read.speed).toBeGreaterThan(2);
  });
});
