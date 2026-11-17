// The plugin metadata: what the host reads in a worker, without loading anything.
import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";
import { DIE, PROVIDER } from "./ids.js";

const of = (type) => plugins.filter((p) => p.type === type);

describe("the dice package's plugins", () => {
  it("every one survives structuredClone but for load(), as the worker needs", () => {
    for (const p of plugins) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
    }
  });

  it("are a datatype and a tool for die docs, a scene source for them, the dice, cup and lots extensions, a template and the parts", () => {
    expect(of("patchwork:datatype").map((p) => p.id)).toEqual(["die"]);
    expect(of("patchwork:tool")).toMatchObject([{ id: "die", supportedDatatypes: ["die"] }]);
    expect(of("scene:source")).toMatchObject([{ id: PROVIDER, supportedDatatypes: ["die"], content: "built" }]);
    expect(of("scene:extension").map((p) => p.id)).toEqual(["dice", "dice.cup", "dice.lots"]);
    // nothing here is anyone else's: no plugin, trait or metadata of another package's
    expect(JSON.stringify(plugins.map(({ load, ...m }) => m))).not.toMatch(/keep\.|"lots":/);
    expect(of("scene:template").map((p) => p.id)).toEqual(["dice.liars-dice"]);
    expect(of("tabletop:game").map((p) => p.id)).toEqual(["liars-dice"]);
    expect(new Set(plugins.map((p) => `${p.type}/${p.id}`)).size).toBe(plugins.length);
  });

  it("the dice, cup and lots extensions run by their traits alone, whatever anyone is doing; the dice extension lays out dropped die docs; who shook a cup, what's under it, its draw and any round don't copy", () => {
    const [dice, cup, lots] = of("scene:extension");
    expect([dice.traits, cup.traits, lots.traits]).toEqual([[DIE], ["dice.cup"], [DIE, "dice.cup"]]);
    for (const p of [dice, cup, lots]) for (const k of ["activities", "requires", "always", "general"]) expect(k in p).toBe(false);
    expect(dice.drops).toEqual(["die"]);
    // the die trait holds nothing: no fields to write
    expect(dice.describes[DIE]).toMatchObject({ name: "Die", on: "object" });
    expect(dice.describes[DIE].fields).toBeUndefined();
    expect(dice.describes[DIE].runtime).toEqual(["round"]);
    expect(cup.describes["dice.cup"].runtime).toEqual(["holder", "roll", "round"]);
    // lots have no trait of their own: a round lives in its die's or cup's trait
    expect(lots.describes).toBeUndefined();
  });
});
