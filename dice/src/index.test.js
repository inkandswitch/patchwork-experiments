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

  it("are a datatype and a tool for die docs, a scene source for them, the dice and cup extensions, a template and the parts", () => {
    expect(of("patchwork:datatype").map((p) => p.id)).toEqual(["die"]);
    expect(of("patchwork:tool")).toMatchObject([{ id: "die", supportedDatatypes: ["die"] }]);
    expect(of("scene:source")).toMatchObject([{ id: PROVIDER, supportedDatatypes: ["die"] }]);
    expect(of("scene:extension").map((p) => p.id)).toEqual(["dice", "dice.cup"]);
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
    expect((await of("scene:template")[0].load()).create).toBeTypeOf("function");
  });

  it("the cup extension is an audience policy: no activities, so it holds whatever anyone is doing; who shook it and what's under it don't copy", () => {
    const cup = of("scene:extension")[1];
    expect(cup.traits).toEqual(["dice.cup"]);
    expect(cup.activities).toBeUndefined();
    expect(cup.describes["dice.cup"].runtime).toEqual(["holder", "roll"]);
    expect(cup.requires.indexOf("scene.use")).toBeLessThan(cup.requires.indexOf("scene.keys"));
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
