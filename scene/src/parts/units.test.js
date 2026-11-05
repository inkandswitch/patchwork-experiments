import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage } from "../test/stage-harness.js";
import units from "./units.js";
import { UNIT_OPTIONS } from "../units.js";

const mount = (doc = {}) => mountStage({ extensions: [{ meta: { id: "scene.units" }, module: units }], doc });

describe("scene.units", () => {
  it("offers the units as a picker for the scene, valued from the pref (the doc's view.units as the suggestion)", async () => {
    const s = await mount({ view: { units: "cm" } });
    const c = s.instance("scene.units").commands.find((k) => k.id === "units");
    expect(c.name).toBe("Units");
    const st = c.state(null, { scene: s.api("scene.units").scene(), local: s.local.get() });
    expect(st.value).toBe("cm");
    expect(st.choices.map((o) => o.value)).toEqual(UNIT_OPTIONS.map((o) => o.value));
    expect(c.state("a", {})).toBe(null);
    s.unmount();
  });

  it("sets this viewer's units pref, never the doc's; ignores what isn't a unit", async () => {
    const s = await mount();
    const api = s.api("scene.units");
    expect(api.run({ ext: "scene.units", command: "units", target: null, value: "mm" })).toBe(true);
    expect(s.local.get().prefs.units).toBe("mm");
    expect(s.doc().view.units).toBe("m");
    expect(api.pref("units", "m")).toBe("mm");
    api.run({ ext: "scene.units", command: "units", target: null, value: "furlong" });
    expect(s.local.get().prefs.units).toBe("mm");
    // not for an object
    expect(api.run({ ext: "scene.units", command: "units", target: "a", value: "cm" })).toBe(false);
    s.unmount();
  });
});
