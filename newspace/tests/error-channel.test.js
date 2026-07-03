import { describe, it, expect } from "vitest";
import { errorOp, isError, isSnapshot } from "../src/ops.js";
import { Source } from "../src/opstreams.js";

describe("error op vocabulary", () => {
  it("errorOp wraps a message; isError recognises it", () => {
    const op = errorOp("boom");
    expect(op).toEqual({ type: "error", error: "boom" });
    expect(isError(op)).toBe(true);
    expect(isError({ type: "snapshot", value: 1 })).toBe(false);
  });
  it("errorOp unwraps an Error's message", () => {
    expect(errorOp(new Error("nope")).error).toBe("nope");
  });
  it("an error op is neither a snapshot nor a value op", () => {
    const e = errorOp("x");
    expect(isSnapshot(e)).toBe(false);
  });
});

describe("Source error channel", () => {
  it("pushError sets .error and emits an error op to live subscribers", () => {
    const s = new Source(5);
    const ops = [];
    s.connect((op) => ops.push(op));
    s.pushError("failed");
    expect(s.error).toBe("failed");
    expect(ops.at(-1)).toEqual({ type: "error", error: "failed" });
    expect(s.value).toBe(5); // last good value preserved
  });
  it("a fresh push clears the error", () => {
    const s = new Source(1);
    s.pushError("bad");
    expect(s.error).toBe("bad");
    s.push(2);
    expect(s.error).toBe(null);
    expect(s.value).toBe(2);
  });
  it("late subscribers receive the current error too", () => {
    const s = new Source(0);
    s.pushError("earlier");
    const ops = [];
    s.connect((op) => ops.push(op));
    // first the snapshot, then the sticky error
    expect(ops.some((o) => isSnapshot(o))).toBe(true);
    expect(ops.some((o) => isError(o) && o.error === "earlier")).toBe(true);
  });
});
