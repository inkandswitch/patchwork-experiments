// H8 (scene/NATIVE.md, "World time"): a pause changes no actor or
// liveness outcome. Dice, lots and the cup run on actor time (their loops)
// and liveness (the stage's time, api.now and api.after: THROW,
// TOLD, lots' deadlines), never on the doc's world time, so pausing the world
// can't reach any of their protocols: by construction, as long as nothing
// here reads the world clock (the "clock" service's t, running, pause, resume,
// process, computer). This holds them to that. The one channel a pause does use, a doc change (the clock's
// fields) that runs every view's update() again, is run for real on a roll
// in extension.test.js ("H8: a pause, at every frame of a roll").
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src/dice"); // (vitest runs from the package)
// (api.now, after and frame are the stage's time, which never pauses: allowed)
const WORLD_CLOCK = [/\buse\(\s*["'`]clock["'`]\s*\)/, /\bclock\s*\.\s*(t|running|pause|resume|process|computer)\s*\(/, /claims\??\.\s*clock\b/, /\bclaims\[\s*["']clock["']\s*\]/, /\b(doc|d)\(?\)?\??\.clock\b/];

describe("H8: dice, lots and the cup never read the world's clock", () => {
  it("tells the world's clock from the stage's time", () => {
    const flagged = (text) => WORLD_CLOCK.some((re) => re.test(text));
    for (const yes of ['api.use("clock").t()', "clock.running()", "clock.process({})", "const c = api.use('clock');", "doc.clock.t"]) expect(flagged(yes), yes).toBe(true);
    for (const no of ["api.now()", "api.after(250, act)", "api.frame(fn)", 'api.use("claims")']) expect(flagged(no), no).toBe(false);
  });
  const files = readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  it(`in all ${files.length} source files`, () => {
    expect(files).toEqual(expect.arrayContaining(["extension.js", "cup-extension.js", "lots.js", "lots-ext.js", "lots-run.js", "roll.js"]));
    const found = [];
    for (const f of files) {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const re of WORLD_CLOCK) if (re.test(text)) found.push(`${f}: ${re}`);
    }
    expect(found).toEqual([]);
  });
});
