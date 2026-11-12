// The plugin metadata: what the host reads in a worker, without loading anything.
import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";
import { DIE, PROVIDER } from "./ids.js";
import * as parts from "./parts.js";
import { PRESETS } from "./die.js";

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
    expect(of("scene:source")).toMatchObject([{ id: PROVIDER, supportedDatatypes: ["die"] }]);
    expect(of("scene:extension").map((p) => p.id)).toEqual(["dice", "dice.cup", "dice.lots"]);
    // nothing here is anyone else's: no plugin, trait or metadata of another package's
    expect(JSON.stringify(plugins.map(({ load, ...m }) => m))).not.toMatch(/keep\.|"lots":/);
    expect(of("scene:template").map((p) => p.id)).toEqual(["dice.liars-dice"]);
    expect(new Set(plugins.map((p) => `${p.type}/${p.id}`)).size).toBe(plugins.length);
  });

  it("each loads what it says", async () => {
    expect((await of("patchwork:datatype")[0].load()).init).toBeTypeOf("function");
    expect(await of("patchwork:tool")[0].load()).toBeTypeOf("function");
    expect((await of("scene:source")[0].load()).build).toBeTypeOf("function");
    const ext = await of("scene:extension")[0].load();
    expect(ext.create).toBeTypeOf("function");
    expect(ext.drop).toBeTypeOf("function");
    expect((await of("scene:extension")[1].load()).create).toBeTypeOf("function");
    expect((await of("scene:extension")[2].load()).create).toBeTypeOf("function");
    expect((await of("scene:template")[0].load()).create).toBeTypeOf("function");
  });

  it("the cup extension is an audience policy: no activities, so it holds whatever anyone is doing; who shook it, what's under it and its draw don't copy", () => {
    const cup = of("scene:extension")[1];
    expect(cup.traits).toEqual(["dice.cup"]);
    expect(cup.activities).toBeUndefined();
    expect(cup.describes["dice.cup"].runtime).toEqual(["holder", "roll", "round"]);
    expect(cup.requires.indexOf("scene.use")).toBeLessThan(cup.requires.indexOf("scene.keys"));
  });

  it("lots run wherever there's a die or a cup, in every activity (a member's client answers whatever its viewer is doing), with no trait of their own: a round lives in its die's or cup's trait and doesn't copy", () => {
    const lots = of("scene:extension")[2];
    expect(lots.id).toBe("dice.lots");
    expect(lots.traits).toEqual([DIE, "dice.cup"]);
    expect(lots.activities).toBeUndefined();
    expect(lots.describes).toBeUndefined();
    expect(of("scene:extension")[0].describes[DIE].runtime).toEqual(["round"]);
  });

  it("the extension runs for the die trait, in play and edit, lays out dropped die docs, describes its trait, and requires what playing needs, the use prompt before the key map", () => {
    const ext = of("scene:extension")[0];
    expect(ext.traits).toEqual([DIE]);
    expect(ext.activities).toEqual(["play", "edit"]);
    expect(ext.drops).toEqual(["die"]);
    expect(ext.describes[DIE]).toMatchObject({ name: "Die", on: "object" });
    // the trait holds nothing: no fields to write
    expect(ext.describes[DIE].fields).toBeUndefined();
    expect(ext.requires).toEqual(["scene.hand", "scene.use", "scene.keys", "scene.menu", "scene.notices"]);
    expect(ext.requires.indexOf("scene.use")).toBeLessThan(ext.requires.indexOf("scene.keys"));
  });

  it("the parts: Die first, then the usual dice, all under Dice, each bringing the die trait and loading a part; then a cup and a pool", async () => {
    const all = of("scene:part");
    expect(all.map((p) => p.id).slice(-2)).toEqual(["dice.cup", "dice.pool"]);
    for (const p of all.slice(-2)) expect((await p.load()).create).toBeTypeOf("function");
    const bin = all.slice(0, -2);
    expect(bin.map((p) => p.id)).toEqual(["dice.die", "dice.d4", "dice.d8", "dice.d10", "dice.percentile", "dice.d12", "dice.d20", "dice.coin", "dice.plus-minus", "dice.doubling"]);
    expect(bin[0].name).toBe("Die");
    for (const p of bin) {
      expect(p.category).toBe("Dice");
      expect(p.traits).toEqual([DIE]);
      expect(p.description).toBeTruthy();
      expect((await p.load()).create).toBeTypeOf("function");
    }
    // a d6, a d20, a coin and a symbol die are among them
    expect(await bin.find((p) => p.id === "dice.die").load()).toBe(parts.d6);
    expect(await bin.find((p) => p.id === "dice.d20").load()).toBe(parts.d20);
    expect(await bin.find((p) => p.id === "dice.coin").load()).toBe(parts.coin);
    expect(await bin.find((p) => p.id === "dice.plus-minus").load()).toBe(parts.plusMinus);
    expect(PRESETS["plus-minus"]).toBeTruthy();
  });
});
