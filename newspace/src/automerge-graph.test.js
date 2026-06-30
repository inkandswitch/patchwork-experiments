// Integration: a REAL automerge doc driven through the graph (automergeOpstream +
// json-path/json-set). Catches regressions in the write/read translation, which is
// the load-bearing path for the store / automerge / template nodes.
import { describe, it, expect } from "vitest";
import { makeRepo, flush } from "./test-harness.js";
import { automergeOpstream } from "./opstreams.js";
import { jsonPathStream, writeOp, parsePath } from "./json-path.js";

async function doc(initial) {
  const repo = makeRepo();
  const h = repo.create();
  h.change((d) => Object.assign(d, initial));
  await flush();
  return h;
}

describe("automerge doc as an editable opstream", () => {
  it("writeOp sets a NESTED field, leaving siblings intact", async () => {
    const h = await doc({ title: "x", size: { w: 1, h: 2 } });
    const stream = automergeOpstream(h);
    stream.apply(writeOp(parsePath(".size.w"), 9));
    await flush();
    expect(h.doc().size.w).toBe(9);
    expect(h.doc().size.h).toBe(2);
    expect(h.doc().title).toBe("x");
  });

  it("writeOp sets a top-level field", async () => {
    const h = await doc({ n: 1 });
    automergeOpstream(h).apply(writeOp(parsePath(".n"), 42));
    await flush();
    expect(h.doc().n).toBe(42);
  });
});

describe("bidirectional json-path over an automerge doc", () => {
  it("writes the narrowed field back to the doc", async () => {
    const h = await doc({ a: { b: 1 }, keep: "z" });
    const narrowed = jsonPathStream(automergeOpstream(h), () => ".a.b");
    expect(narrowed.value).toBe(1);
    narrowed.apply({ type: "snapshot", value: 5 });
    await flush();
    expect(h.doc().a.b).toBe(5);
    expect(h.doc().keep).toBe("z");
  });

  it("remote edits flow OUT through json-path", async () => {
    const h = await doc({ n: 1 });
    const narrowed = jsonPathStream(automergeOpstream(h), () => ".n");
    h.change((d) => { d.n = 7; }); // another peer
    await flush();
    expect(narrowed.value).toBe(7);
  });

  it("path can be retargeted live (emit)", async () => {
    const h = await doc({ a: 1, b: 2 });
    let expr = ".a";
    const narrowed = jsonPathStream(automergeOpstream(h), () => expr);
    expect(narrowed.value).toBe(1);
    expr = ".b"; narrowed.emit();
    expect(narrowed.value).toBe(2);
  });
});
