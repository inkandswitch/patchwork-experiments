// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage } from "../test/stage-harness.js";
import units from "./units.js";

const mount = (doc = {}) => mountStage({ extensions: [{ meta: { id: "scene.units" }, module: units }], doc });

describe("scene.units", () => {
  it("sets this viewer's units pref, never the doc's; ignores what isn't a unit", async () => {
    const s = await mount();
    const api = s.api("scene.units");
    expect(api.run({ ext: "scene.units", command: "units", target: null, value: "mm" })).toBe(true);
    expect(s.local.get()["scene.prefs"].units).toBe("mm");
    expect(s.doc().view.units).toBe("m");
    expect(api.use("prefs").get("units", "m")).toBe("mm");
    api.run({ ext: "scene.units", command: "units", target: null, value: "furlong" });
    expect(s.local.get()["scene.prefs"].units).toBe("mm");
    // not for an object
    expect(api.run({ ext: "scene.units", command: "units", target: "a", value: "cm" })).toBe(false);
    s.unmount();
  });
});
