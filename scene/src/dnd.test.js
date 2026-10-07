import { describe, it, expect } from "vitest";
import { parseAutomergeUrl, parsePatchworkDrop } from "./dnd.js";

const ID = "2j9knn3DsFnFYDFvXkyMu4UHyp7u";

const dt = (data) => ({ types: Object.keys(data), getData: (t) => data[t] ?? "" });

describe("parseAutomergeUrl", () => {
  it("accepts the shapes people paste", () => {
    expect(parseAutomergeUrl(`automerge:${ID}`)).toBe(`automerge:${ID}`);
    expect(parseAutomergeUrl(`  automerge:${ID}#heads|abc `)).toBe(`automerge:${ID}`);
    expect(parseAutomergeUrl(`https://patchwork.inkandswitch.com/#doc=${ID}`)).toBe(`automerge:${ID}`);
    expect(parseAutomergeUrl(`https://x.y/?docUrl=automerge%3A${ID}`)).toBe(`automerge:${ID}`);
    expect(parseAutomergeUrl(ID)).toBe(`automerge:${ID}`);
  });
  it("rejects junk", () => {
    expect(parseAutomergeUrl("hello")).toBeNull();
    expect(parseAutomergeUrl("")).toBeNull();
    expect(parseAutomergeUrl("automerge:0OIl")).toBeNull();
  });
});

describe("parsePatchworkDrop", () => {
  it("reads the structured payload", () => {
    const items = parsePatchworkDrop(
      dt({ "text/x-patchwork-dnd": JSON.stringify({ source: "sideboard", items: [{ url: `automerge:${ID}`, name: "Hull", type: "camber-hull" }] }) }),
    );
    expect(items).toEqual([{ url: `automerge:${ID}`, name: "Hull", type: "camber-hull" }]);
  });
  it("falls back to the url list, then plain text", () => {
    expect(parsePatchworkDrop(dt({ "text/x-patchwork-urls": JSON.stringify([`automerge:${ID}`]) }))[0].url).toBe(`automerge:${ID}`);
    expect(parsePatchworkDrop(dt({ "text/plain": `automerge:${ID}` }))[0].url).toBe(`automerge:${ID}`);
    expect(parsePatchworkDrop(dt({ "text/plain": "just words" }))).toEqual([]);
  });
});
