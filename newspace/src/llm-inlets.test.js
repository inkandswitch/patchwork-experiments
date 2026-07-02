import { describe, it, expect } from "vitest";
import { promptVars, llmInlets, promptOutlets, llmOutlets, parseOutletBlocks, outletConsumers, schemaSpec, schemaRule, validateAgainst, validationPlan } from "./llm-inlets.js";
import { anySchema, numberSchema, stringSchema, fileSchema, paramsSchema, objectSchema, arraySchema, bangSchema } from "./ops.js";

describe("promptVars / llmInlets — {{var}} → text inlets", () => {
  it("extracts unique var names in order", () => {
    expect(promptVars("hi {{name}}, you are {{age}} and {{name}} again")).toEqual(["name", "age"]);
  });
  it("ignores whitespace inside the braces", () => {
    expect(promptVars("{{ foo }} {{bar}}")).toEqual(["foo", "bar"]);
  });
  it("empty / nullish prompt → no vars", () => {
    expect(promptVars("")).toEqual([]);
    expect(promptVars(undefined)).toEqual([]);
    expect(promptVars("no holes here")).toEqual([]);
  });
  it("always exposes in/prompt/bang, then one text inlet per var", () => {
    const defs = llmInlets({ prompt: "translate {{text}} to {{lang}}" });
    expect(defs.map((d) => d.name)).toEqual(["in", "prompt", "bang", "text", "lang"]);
    const text = defs.find((d) => d.name === "text");
    expect(text.type).toBe("text");
    expect(text.schema).toBeTruthy(); // a Standard Schema
  });
  it("no config → just the three fixed inlets", () => {
    expect(llmInlets().map((d) => d.name)).toEqual(["in", "prompt", "bang"]);
  });
});

describe("promptOutlets / llmOutlets — @out → outlets", () => {
  it("declares an outlet per `@out name` / `@outlet name` line", () => {
    const p = "do the thing\n@out summary\n@outlet keywords\n@out summary";
    expect(promptOutlets(p)).toEqual(["summary", "keywords"]);
  });
  it("only matches at line start (not mid-sentence @out)", () => {
    expect(promptOutlets("talk about @out things inline")).toEqual([]);
  });
  it("always exposes out + think, then the declared extras", () => {
    const defs = llmOutlets({ prompt: "@out a\n@out b" });
    expect(defs.map((d) => d.name)).toEqual(["out", "think", "a", "b"]);
  });
  it("no declarations → out + think only", () => {
    expect(llmOutlets({ prompt: "plain" }).map((d) => d.name)).toEqual(["out", "think"]);
    expect(llmOutlets().map((d) => d.name)).toEqual(["out", "think"]);
  });
});

describe("parseOutletBlocks — split a labelled response", () => {
  it("splits on [[outlet:NAME]] markers", () => {
    const text = "[[outlet:out]]\nhello\n[[outlet:notes]]\nsome notes";
    expect(parseOutletBlocks(text)).toEqual({ out: "hello", notes: "some notes" });
  });
  it("text before the first marker lands on out", () => {
    expect(parseOutletBlocks("just a plain answer")).toEqual({ out: "just a plain answer" });
  });
  it("leading text plus a marker both keep their place", () => {
    const text = "preamble\n[[outlet:notes]]\nN";
    expect(parseOutletBlocks(text)).toEqual({ out: "preamble", notes: "N" });
  });
  it("tolerates whitespace in the marker", () => {
    expect(parseOutletBlocks("[[ outlet: foo ]]\nbar")).toEqual({ foo: "bar" });
  });
  it("merges repeated outlet names with a newline", () => {
    const text = "[[outlet:a]]\none\n[[outlet:a]]\ntwo";
    expect(parseOutletBlocks(text)).toEqual({ a: "one\ntwo" });
  });
  it("empty input → empty object", () => {
    expect(parseOutletBlocks("")).toEqual({});
    expect(parseOutletBlocks(undefined)).toEqual({});
  });
});

describe("outletConsumers — who does our outlet feed?", () => {
  const items = [
    { id: "n1", kind: "editor", editorId: "inspector", inlets: { in: { node: "llm1", outlet: "out" } } },
    { id: "n2", kind: "editor", editorId: "code", inlets: { content: { url: "automerge:x", path: [] } } },
    { id: "n3", kind: "editor", editorId: "code2", inlets: { content: { node: "llm1", outlet: "think" } } },
    { id: "n4", kind: "editor", editorId: "cut", inlets: { in: null } }, // unwire tombstone
    { id: "s1", kind: "stroke" },
    null,
  ];
  it("finds the inlets wired to {node, outlet}", () => {
    expect(outletConsumers(items, "llm1", "out")).toEqual([{ item: items[0], inlet: "in" }]);
    expect(outletConsumers(items, "llm1", "think")).toEqual([{ item: items[2], inlet: "content" }]);
  });
  it("ignores url wirings, tombstones, non-editors, other nodes, and nullish items", () => {
    expect(outletConsumers(items, "nobody", "out")).toEqual([]);
    expect(outletConsumers(null, "llm1")).toEqual([]);
    expect(outletConsumers(undefined, "llm1")).toEqual([]);
  });
});

describe("schemaSpec — a readable spec derived from a Standard Schema", () => {
  it("probes a discriminating schema for its own rejection message", () => {
    expect(schemaSpec(numberSchema())).toBe("expected a number");
    expect(schemaSpec(stringSchema())).toBe("expected a string");
    expect(schemaSpec(arraySchema(numberSchema()))).toBe("expected an array");
    expect(schemaSpec(fileSchema())).toContain("file snapshot");
    expect(schemaSpec(objectSchema({ a: numberSchema() }))).toContain("object matching the shape");
  });
  it("no derivable constraint (anySchema / bang / no schema) → null", () => {
    expect(schemaSpec(anySchema())).toBe(null);
    expect(schemaSpec(bangSchema())).toBe(null);
    expect(schemaSpec(null)).toBe(null);
    expect(schemaSpec({})).toBe(null); // not a Standard Schema
  });
  it("a paramsSchema-style schema describes its .fields", () => {
    const s = paramsSchema([
      { key: "size", label: "Size", type: "number", default: 4 },
      { key: "mode", label: "Mode", type: "select", options: ["a", "b"] },
    ]);
    const spec = schemaSpec(s);
    expect(spec).toContain('"size": number');
    expect(spec).toContain('"mode": string (one of: a, b)');
  });
});

describe("schemaRule — the prompt line for a spec", () => {
  it("wraps a spec; empty without one", () => {
    expect(schemaRule("expected a number")).toContain("expected a number");
    expect(schemaRule("x")).toContain("MUST");
    expect(schemaRule(null)).toBe("");
    expect(schemaRule("")).toBe("");
  });
});

describe("validateAgainst / validationPlan — validate, retry once, never emit garbage", () => {
  it("valid → emit (no schema also emits as-is)", () => {
    expect(validationPlan(numberSchema(), 42, 0)).toEqual({ action: "emit", value: 42 });
    expect(validationPlan(null, "anything", 0)).toEqual({ action: "emit", value: "anything" });
  });
  it("first failure → retry, with the validation issues in the appendix", () => {
    const plan = validationPlan(numberSchema(), "not a number", 0);
    expect(plan.action).toBe("retry");
    expect(plan.message).toBe("expected a number");
    expect(plan.appendix).toContain("expected a number");
    expect(plan.appendix).toContain("did not match");
  });
  it("a failing retry (attempt exhausted) → error", () => {
    const plan = validationPlan(numberSchema(), "still not", 1);
    expect(plan.action).toBe("error");
    expect(plan.message).toContain("expected a number");
    expect(plan.issues).toBeTruthy();
  });
  it("validateAgainst reports issues with a joined message", () => {
    const bad = validateAgainst(objectSchema({ a: numberSchema() }), { a: "x" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("object matching the shape");
    const ok = validateAgainst(stringSchema(), "hi");
    expect(ok).toEqual({ ok: true, value: "hi" });
  });
  it("a throwing validator fails safe (→ retry/error, not a crash)", () => {
    const throwing = { "~standard": { version: 1, vendor: "t", validate: () => { throw new Error("boom"); } } };
    const r = validateAgainst(throwing, 1);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("boom");
  });
});
