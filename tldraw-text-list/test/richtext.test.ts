import { describe, expect, it } from "vitest";
import { type RichTextDoc, toPlain, toRichText } from "../src/richtext";

const para = (text?: string) =>
  text === undefined
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };

const doc = (...content: unknown[]): RichTextDoc =>
  ({ type: "doc", content }) as RichTextDoc;

describe("toPlain", () => {
  it("flattens a single paragraph", () => {
    expect(toPlain(doc(para("hello")))).toBe("hello");
  });

  it("joins paragraphs with newlines", () => {
    expect(toPlain(doc(para("a"), para("b"), para("c")))).toBe("a\nb\nc");
  });

  it("renders an empty paragraph as a blank line", () => {
    expect(toPlain(doc(para("a"), para(), para("b")))).toBe("a\n\nb");
  });

  it("treats hardBreak as a newline within a block", () => {
    expect(
      toPlain(
        doc({
          type: "paragraph",
          content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }],
        }),
      ),
    ).toBe("a\nb");
  });

  it("yields one line per list item (container nodes don't double-break)", () => {
    const list = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para("one")] },
        { type: "listItem", content: [para("two")] },
      ],
    };
    expect(toPlain(doc(list))).toBe("one\ntwo");
  });

  it("flattens headings as their own line", () => {
    expect(toPlain(doc({ type: "heading", content: [{ type: "text", text: "Title" }] }, para("body")))).toBe(
      "Title\nbody",
    );
  });

  it("returns empty string for null / undefined / malformed input", () => {
    expect(toPlain(null)).toBe("");
    expect(toPlain(undefined)).toBe("");
    expect(toPlain({ type: "doc" } as RichTextDoc)).toBe("");
  });
});

describe("toRichText", () => {
  it("makes one paragraph per line", () => {
    expect(toRichText("a\nb")).toEqual(doc(para("a"), para("b")));
  });

  it("makes empty lines into contentless paragraphs", () => {
    expect(toRichText("")).toEqual(doc(para()));
    expect(toRichText("a\n\nb")).toEqual(doc(para("a"), para(), para("b")));
  });
});

describe("round-trip text → rich → text is the identity", () => {
  const cases = [
    "",
    "hello",
    "a\nb\nc",
    "a\n\nb",
    "\nleading blank",
    "trailing blank\n",
    "   spaces   preserved   ",
    "unicode ✓ é 你好",
    "line\nwith • bullet glyph",
  ];
  for (const s of cases) {
    it(JSON.stringify(s), () => {
      expect(toPlain(toRichText(s))).toBe(s);
    });
  }
});

describe("round-trip is a stable fixed point", () => {
  it("rebuilding from flattened text reproduces the same doc", () => {
    for (const s of ["a", "a\nb", "a\n\n\nb", ""]) {
      const once = toRichText(s);
      const twice = toRichText(toPlain(once));
      expect(twice).toEqual(once);
    }
  });
});
