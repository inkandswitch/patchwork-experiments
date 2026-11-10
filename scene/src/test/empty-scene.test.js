import { describe, expect, it } from "vitest";
import { SceneDatatype } from "../datatype.js";
import { emptyScene } from "./empty-scene.js";

const init = () => {
  const doc = {};
  SceneDatatype.init(doc);
  return doc;
};

describe("emptyScene: the scene doc tests, probes and publish scripts write whole", () => {
  it("is exactly what the datatype's init makes, as a scene", () => {
    expect(emptyScene()).toEqual({ "@patchwork": { type: "scene" }, ...init() });
  });

  it("keeps every field init makes, whichever one is given", () => {
    const made = init();
    for (const key of Object.keys(made)) {
      const given = Array.isArray(made[key]) ? ["x"] : typeof made[key] === "object" ? { x: 1 } : "x";
      const doc = emptyScene({ [key]: given });
      expect(Object.keys(doc).sort()).toEqual(["@patchwork", ...Object.keys(made)].sort());
      // `view` is merged into init's; anything else is taken as given
      expect(doc[key]).toEqual(key === "view" ? { ...made.view, x: 1 } : given);
      for (const other of Object.keys(made)) if (other !== key) expect(doc[other]).toEqual(made[other]);
    }
  });

  it("merges @patchwork over the type; other fields go on top", () => {
    expect(emptyScene({ "@patchwork": { suggestedImportUrl: "automerge:x" } })["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: "automerge:x" });
    expect(emptyScene({ title: "T" })).toEqual({ "@patchwork": { type: "scene" }, ...init(), title: "T" });
  });

  it("makes fresh maps each time: two docs share nothing", () => {
    const a = emptyScene();
    const b = emptyScene();
    for (const key of Object.keys(init())) if (typeof a[key] === "object") expect(a[key]).not.toBe(b[key]);
  });
});
