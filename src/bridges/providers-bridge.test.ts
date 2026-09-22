import { describe, it, expect } from "vitest";
import { transferablesIn, ALLOWED_PROVIDERS } from "./providers-bridge.js";

describe("transferablesIn", () => {
  it("finds the stream pair a worker provider answers with", () => {
    // The load-bearing case: without this, relaying a worker connection throws
    // DataCloneError, because streams cannot be structured-cloned.
    const readable = new ReadableStream();
    const writable = new WritableStream();
    const found = transferablesIn({ readable, writable });
    expect(found).toHaveLength(2);
    expect(found).toContain(readable);
    expect(found).toContain(writable);
  });

  it("returns nothing for values that clone fine", () => {
    // Every other bridged provider answers with plain data; those must keep
    // relaying with an empty transfer list rather than paying for a walk.
    expect(transferablesIn("automerge:abc")).toEqual([]);
    expect(transferablesIn(["automerge:abc", "automerge:def"])).toEqual([]);
    expect(transferablesIn({ url: "automerge:abc", heads: [] })).toEqual([]);
    expect(transferablesIn(null)).toEqual([]);
    expect(transferablesIn(undefined)).toEqual([]);
    expect(transferablesIn(42)).toEqual([]);
  });

  it("does not recurse into nested objects", () => {
    // Deliberate: a provider transfers what it puts at the top level of the
    // value. Walking arbitrary depth risks detaching an object the sender still
    // holds a live reference to.
    const nested = { inner: { readable: new ReadableStream() } };
    expect(transferablesIn(nested)).toEqual([]);
  });

  it("picks up ports and buffers too", () => {
    const { port1 } = new MessageChannel();
    const buffer = new ArrayBuffer(8);
    expect(transferablesIn({ port: port1, buffer })).toHaveLength(2);
  });
});

describe("ALLOWED_PROVIDERS", () => {
  it("includes the worker channel", () => {
    // Worker connections are relayed by the providers bridge; there is no
    // separate worker bridge and no `shared-workers` attribute any more.
    expect(ALLOWED_PROVIDERS).toContain("patchwork:worker-channel");
  });
});
