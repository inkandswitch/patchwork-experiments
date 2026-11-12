import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";

// The arena's traits, as the scene's inspector offers them ("Add behaviour…").
const arena = plugins.find((p) => p.id === "arena");

describe("arena: describes its traits", () => {
  it("describes every trait it runs on, and nothing else, as plain data", () => {
    expect(Object.keys(arena.describes).sort()).toEqual([...arena.traits].sort());
    const { load, ...meta } = arena;
    expect(structuredClone(meta.describes)).toEqual(arena.describes);
  });

  it("the level is a scene trait whose look can be the arena's or a sky alone; targets and spawns go on objects", () => {
    const d = arena.describes;
    expect(d["arena.level"].on).toBe("scene");
    const look = d["arena.level"].fields.find((f) => f.key === "look");
    expect(look.kind).toBe("enum");
    // play.js gives an atmosphere for each of these (LOOKS), and none for the scene's own
    expect(look.options.map((o) => o.value)).toEqual(["", "arena", "sky"]);
    expect(d["arena.target"].on).toBe("object");
    expect(d["arena.spawn"].on).toBe("object");
    // a target's down and stand are not settings; who shot it is play state, which a copy leaves behind
    expect(d["arena.target"].fields).toBeUndefined();
    expect(d["arena.target"].runtime).toEqual(["down"]);
  });
});
