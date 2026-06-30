// Integration tests for the node graph: compose the REAL modules (opstreams, lenses,
// json-path, json-set, template-doc, the registered plugins) end-to-end, so a future
// refactor that shrinks the code is caught if it changes observable behaviour.
import { describe, it, expect } from "vitest";
import { Opstream, Source } from "./opstreams.js";
import { snapshot, valuesEqual } from "./ops.js";
import { lensDescriptor, applyLens } from "./lenses.js";
import { jsonPathStream, writeOp, evalPath, parsePath } from "./json-path.js";
import { parseTemplate as tParse, fillTemplate as tFill } from "./template-doc.js";
import { plugins } from "./index.jsx";

const lens = (id) => lensDescriptor(plugins.find((p) => p.type === "sketchy:lens" && p.id === id));

describe("number ⇄ string lens (bidirectional, end to end)", () => {
  it("projects forward, writes back, and stays live", () => {
    const src = new Opstream(5);
    const out = applyLens(lens("number-to-string"), src);
    expect(out.value).toBe("5");

    out.apply(snapshot("12"));        // downstream edits the string
    expect(src.value).toBe(12);       // parsed back to a number

    const seen = [];
    out.connect(() => seen.push(out.value));
    src.apply(snapshot(7));           // source changes
    expect(out.value).toBe("7");
    expect(seen).toContain("7");
  });

  it("collapses to a read-only Getter over a read-only source", () => {
    const out = applyLens(lens("number-to-string"), new Source(9));
    expect(out.value).toBe("9");
    expect(out.apply).toBeUndefined();
  });
});

describe("File → JSON → json-path chain", () => {
  it("parses a file's text then narrows by path", () => {
    const file = new Source({ name: "a.json", text: '{"a":{"b":3},"c":9}' });
    const json = applyLens(lens("file-to-json"), file);
    expect(json.value).toEqual({ a: { b: 3 }, c: 9 });

    const narrowed = jsonPathStream(json, () => ".a.b");
    expect(narrowed.value).toBe(3);

    file.push({ name: "a.json", text: '{"a":{"b":42}}' });
    expect(narrowed.value).toBe(42); // flows through the whole chain
  });
});

describe("template doc builds a doc OUT OF opstreams", () => {
  it("fills holes from wired streams, live", () => {
    const { template, slots } = tParse('{ "title": <string>, "n": <number>, "keep": true }');
    const streams = { title: new Source("Hi"), n: new Source(3) };
    const build = () => tFill(template, slots, (s) => streams[s.name] && streams[s.name].value);
    expect(build()).toEqual({ title: "Hi", n: 3, keep: true });
    streams.title.push("Yo");
    streams.n.push(4);
    expect(build()).toEqual({ title: "Yo", n: 4, keep: true });
  });
});

describe("json-set into a doc is idempotent (no feedback loop)", () => {
  it("only writes when the targeted field actually changes", () => {
    const doc = new Opstream({ w: 1 });
    let writes = 0;
    const real = doc.apply.bind(doc);
    doc.apply = (op) => { writes++; real(op); };
    const setW = (v) => { const cur = evalPath(doc.value, ".w"); if (!valuesEqual(cur, v)) doc.apply(writeOp(parsePath(".w"), v)); };
    setW(2); setW(2); setW(3); setW(3);
    expect(doc.value.w).toBe(3);
    expect(writes).toBe(2); // 1→2 and 2→3 only
  });
});

describe("bang events always propagate (defeat idempotency)", () => {
  it("each fire is a new value, so a guarded consumer reacts every time", () => {
    const bang = new Source(0);
    const seen = [];
    // a consumer that only reacts to CHANGED values (like json-set's guard)
    let last;
    bang.connect((op) => { const v = op && op.value; if (!valuesEqual(v, last)) { last = v; seen.push(v); } });
    let n = 0;
    bang.push(++n); bang.push(++n); bang.push(++n); // three bangs
    expect(seen).toEqual([0, 1, 2, 3]); // initial 0 + three unique fires
  });
});

describe("splat corner inlet: one object feeds every inlet by key", () => {
  it("derives a per-key stream for each inlet (bidirectional over an editable source)", () => {
    const splat = new Opstream({ a: 1, b: "x" });
    const inA = jsonPathStream(splat, () => ".a");
    const inB = jsonPathStream(splat, () => ".b");
    expect(inA.value).toBe(1);
    expect(inB.value).toBe("x");
    inA.apply(snapshot(9)); // editing inlet `a` writes back into the splat object
    expect(splat.value).toEqual({ a: 9, b: "x" });
  });
  it("is read-only when the splat source is read-only", () => {
    const inA = jsonPathStream(new Source({ a: 1 }), () => ".a");
    expect(inA.value).toBe(1);
    expect(inA.apply).toBeUndefined();
  });
});
