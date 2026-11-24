// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage } from "../test/stage-harness.js";
import units from "./units.js";

const mount = (doc = {}) => mountStage({ editor: true, natives: true,  extensions: [{ meta: { id: "scene.units" }, module: units }], doc });

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

  it("Snap: a toggle of this viewer's snap pref, following the doc's suggestion until this viewer chooses; never the doc", async () => {
    let s = await mount();
    const api = s.api("scene.units");
    const state = () => s.instance("scene.units").commands.find((c) => c.id === "snap").state(null);
    expect(state()).toMatchObject({ checked: true });
    const docSnap = s.doc().view?.snap;
    api.run({ ext: "scene.units", command: "snap", target: null });
    expect([s.local.get()["scene.prefs"].snap, state().checked]).toEqual([false, false]);
    api.run({ ext: "scene.units", command: "snap", target: null, value: true });
    expect([s.local.get()["scene.prefs"].snap, s.doc().view?.snap]).toEqual([true, docSnap]);
    s.unmount();
    s = await mount({ view: { snap: false } });
    expect(s.instance("scene.units").commands.find((c) => c.id === "snap").state(null)).toMatchObject({ checked: false });
    s.unmount();
  });
});
