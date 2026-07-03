import { describe, it, expect } from "vitest";
import { docUrlOf } from "../src/patchwork-tool.js";
import { automergeOpstream } from "../src/opstreams.js";
import { makeRepo, flush } from "./test-harness.js";

describe("docUrlOf (empty tool reads the doc url from a wired stream)", () => {
  it("reads url / docUrl / automergeUrl aliases from the complement", () => {
    expect(docUrlOf({ complement: { url: "automerge:abc" } })).toBe("automerge:abc");
    expect(docUrlOf({ complement: { docUrl: "automerge:def" } })).toBe("automerge:def");
    expect(docUrlOf({ complement: { automergeUrl: "automerge:ghi" } })).toBe("automerge:ghi");
  });
  it("null when there's no url (an unwired / non-automerge stream)", () => {
    expect(docUrlOf(null)).toBe(null);
    expect(docUrlOf({ complement: {} })).toBe(null);
    expect(docUrlOf({})).toBe(null);
  });
  it("an automerge opstream carries its url, so a tool can mount it", async () => {
    const repo = makeRepo();
    const h = repo.create();
    h.change((d) => Object.assign(d, { title: "x" }));
    await flush();
    expect(docUrlOf(automergeOpstream(h))).toBe(h.url);
  });
});
