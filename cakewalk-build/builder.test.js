import { describe, expect, test } from "vitest";
import { summarise } from "./builder.js";

const counts = (over) => ({ created: 0, replaced: 0, unchanged: 0, removed: 0, referenced: 0, deleted: 0, relinked: 0, ...over });

describe("summarise", () => {
  test("says so when a build really did nothing", () => {
    expect(summarise({ counts: counts({ unchanged: 45 }) })).toBe("nothing changed, wrote nothing");
  });

  // Adopting a bare link or refreshing a pin rewrites a directory document without any file
  // changing. Counting only files reported that as "nothing changed, wrote nothing" while it was
  // writing — which is the one thing a build log must never say.
  test("counts directories rewritten even when no file changed", () => {
    expect(summarise({ counts: counts({ unchanged: 45, relinked: 3 }) })).toContain("3 directories relinked");
  });

  test("one directory is not three", () => {
    expect(summarise({ counts: counts({ relinked: 1 }) })).toContain("1 directory relinked");
  });

  test("stays quiet about relinking when there was none", () => {
    expect(summarise({ counts: counts({ created: 2 }) })).not.toContain("relinked");
  });
});
