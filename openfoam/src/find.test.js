import { describe, it, expect } from "vitest";
import { findWhenThere } from "./find.js";

const repoThatArrivesAfter = (n) => {
  let asked = 0;
  return { find: async () => (++asked <= n ? Promise.reject(new Error("unavailable")) : { doc: () => ({ ok: true }) }), asked: () => asked };
};
const noSleep = { sleep: async () => {} };

describe("findWhenThere", () => {
  it("returns at once when the doc is there", async () => {
    const r = repoThatArrivesAfter(0);
    expect((await findWhenThere(r, "u", noSleep)).doc()).toEqual({ ok: true });
    expect(r.asked()).toBe(1);
  });
  it("asks again until the doc arrives", async () => {
    const r = repoThatArrivesAfter(3);
    expect((await findWhenThere(r, "u", noSleep)).doc()).toEqual({ ok: true });
    expect(r.asked()).toBe(4);
  });
  it("gives up after its tries with the last error", async () => {
    const r = repoThatArrivesAfter(99);
    await expect(findWhenThere(r, "u", { ...noSleep, tries: 3 })).rejects.toThrow("unavailable");
    expect(r.asked()).toBe(3);
  });
  it("backs off, doubling, at most 8 s", async () => {
    const waits = [];
    await findWhenThere(repoThatArrivesAfter(99), "u", { tries: 7, wait: 500, sleep: async (ms) => waits.push(ms) }).catch(() => {});
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });
});
