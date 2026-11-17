import { describe, expect, it } from "vitest";
import { wordDiff } from "../src/worddiff";

describe("wordDiff", () => {
  it("marks what only each version says, word by word", () => {
    expect(wordDiff("camera sees the whole plate", "camera covers the whole plate")).toBe(
      'camera <mark data-side="theirs">covers</mark><mark data-side="ours">sees</mark> the whole plate',
    );
  });

  it("keeps this version's markup and leaves out the other's own tags", () => {
    expect(wordDiff("<b>Assumption</b><br>printer unchanged", "<b>Assumption</b><br>setup is correct")).toBe(
      '<b>Assumption</b><br><mark data-side="theirs">setup is correct</mark><mark data-side="ours">printer unchanged</mark>',
    );
    expect(wordDiff("plain text", "<i>plain</i> text")).toBe("plain text");
  });

  it("puts in nothing for labels that say the same, or are too long to diff", () => {
    expect(wordDiff("same", "same")).toBeNull();
    const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    expect(wordDiff(long, long + " more")).toBeNull();
  });
});

describe("wordDiff against what a label was", () => {
  it("marks what the draft that changed it put in and took out, in its name", () => {
    expect(wordDiff("camera sees the whole plate", "camera covers the whole plate", "theirs")).toBe(
      'camera <mark data-side="theirs" data-op="removed">covers</mark><mark data-side="theirs" data-op="added">sees</mark> the whole plate',
    );
  });
});
