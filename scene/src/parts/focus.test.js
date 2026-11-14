import { describe, it, expect } from "vitest";
import { enterState } from "./focus.js";
import { linkMark } from "./outline.js";
import { linkText } from "./inspector.js";

// every state a link can be in, as the view says (api.link): its role here, whether its doc is drawn, why it's closed
const LINKS = [null];
for (const role of ["acting", "mirror", "pinned"]) for (const open of [true, false]) LINKS.push({ role, open });
for (const reason of ["unavailable", "cycle", "unpinned"]) LINKS.push({ role: "closed", open: false, reason });

describe("what a link says it is, and whether it enters", () => {
  it("every link state: Enter only where its doc acts and is open, here or (a mirror) where it's live; every surface says something for every link and nothing for what isn't one", () => {
    for (const l of LINKS) {
      const e = enterState(l);
      if (!l) {
        expect([e, linkMark(l), linkText(l)]).toEqual([null, null, ""]);
        continue;
      }
      expect(!e.disabled).toBe((l.role === "acting" || l.role === "mirror") && l.open);
      expect(typeof e.title === "string" && e.title.length > 0).toBe(true);
      expect(linkMark(l).text).toBe({ acting: "linked", mirror: "shown again", pinned: "fixed", closed: "closed" }[l.role]);
      expect(linkText(l).length).toBeGreaterThan(0);
      // a pin says how to go inside it; a closed link says why it's closed
      if (l.role === "pinned") expect(e.title).toMatch(/Follow latest/);
      if (l.role === "closed") expect(e.title).toContain(l.reason);
    }
  });
});
