import { describe, it, expect } from "vitest";
import { promptVars, llmInlets, promptOutlets, llmOutlets, parseOutletBlocks } from "./llm-inlets.js";

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
