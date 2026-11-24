import { describe, it, expect } from "vitest";
import { SceneRenderDatatype, newRenderDoc } from "./datatype.js";

describe("scene-render datatype", () => {
  it("titles a render so it isn't confused with its source, and round-trips a rename", () => {
    const doc = newRenderDoc({ title: "Daysailer hull", parent: "automerge:x", providerId: "p" });
    expect(SceneRenderDatatype.getTitle(doc)).toBe("Daysailer hull (3D render)");
    SceneRenderDatatype.setTitle(doc, "Hull B (3D render)");
    expect(doc.title).toBe("Hull B");
    SceneRenderDatatype.setTitle(doc, "Plain");
    expect(doc.title).toBe("Plain");
    expect(SceneRenderDatatype.getTitle({})).toBe("Scene render");
  });
});
