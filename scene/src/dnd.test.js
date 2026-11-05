import { describe, it, expect } from "vitest";
import { parseAutomergeLink, parseAutomergeUrl, parsePatchworkDrop } from "./dnd.js";

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

// real heads, as automerge-repo 2.6 writes them (base58check change hashes)
const H1 = "MZke2MePENdwYFcp4a4Q61S1uEQtJDadpkQc9B6Q78CXrpy4q";
const H2 = "46KZ97np45viJ2uviPP9eF3xs5k6SnwezMe6v1XXfgj2A9hPe";

describe("parseAutomergeLink", () => {
  it("reads heads from an automerge URL (stringifyAutomergeUrl form)", () => {
    expect(parseAutomergeLink(`automerge:${ID}#${H1}`)).toEqual({ url: `automerge:${ID}`, heads: [H1] });
    expect(parseAutomergeLink(`automerge:${ID}#${H1}|${H2}`)).toEqual({ url: `automerge:${ID}`, heads: [H2, H1].sort() });
    expect(parseAutomergeLink(`automerge:${ID}/a/b#${H1}`)).toEqual({ url: `automerge:${ID}`, heads: [H1] });
  });
  it("reads heads from a Patchwork link", () => {
    expect(parseAutomergeLink(`https://patchwork.inkandswitch.com/#doc=automerge:${ID}#${H1}&tool=scene`)).toEqual({ url: `automerge:${ID}`, heads: [H1] });
    expect(parseAutomergeLink(`https://x.y/#doc=${ID}&heads=${H1}|${H2}`)).toEqual({ url: `automerge:${ID}`, heads: [H2, H1].sort() });
    expect(parseAutomergeLink(`https://x.y/?doc=automerge%3A${ID}%23${H1}%7C${H2}`)).toEqual({ url: `automerge:${ID}`, heads: [H2, H1].sort() });
  });
  it("follows the latest when there are no heads, or they don't look like heads", () => {
    expect(parseAutomergeLink(`automerge:${ID}`)).toEqual({ url: `automerge:${ID}`, heads: null });
    expect(parseAutomergeLink(`automerge:${ID}#`)).toEqual({ url: `automerge:${ID}`, heads: null });
    expect(parseAutomergeLink(`automerge:${ID}#heads|abc`)).toEqual({ url: `automerge:${ID}`, heads: null });
    expect(parseAutomergeLink(`automerge:${ID}#${H1}|nope`)).toEqual({ url: `automerge:${ID}`, heads: null });
    expect(parseAutomergeLink(ID)).toEqual({ url: `automerge:${ID}`, heads: null });
    expect(parseAutomergeLink("hello")).toBeNull();
  });
  it("parseAutomergeUrl still strips the heads", () => {
    expect(parseAutomergeUrl(`automerge:${ID}#${H1}`)).toBe(`automerge:${ID}`);
  });
});

describe("parsePatchworkDrop", () => {
  it("carries heads through, and keeps two versions of one doc apart", () => {
    const items = parsePatchworkDrop(dt({ "text/x-patchwork-urls": JSON.stringify([`automerge:${ID}#${H1}`, `automerge:${ID}#${H1}`, `automerge:${ID}`]) }));
    expect(items).toEqual([
      { url: `automerge:${ID}`, heads: [H1], name: undefined, type: undefined },
      { url: `automerge:${ID}`, name: undefined, type: undefined },
    ]);
  });
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
