import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";

describe("the test harness", () => {
  it("mounts a stage with an extension from a kit, and routes a click to it", async () => {
    const clicks = [];
    const module = { create: (api) => ({ input: { click: (ev) => (clicks.push(ev.x), true) } }) };
    const s = await mountStage({ extensions: [{ meta: { id: "t.click" }, module }], kits: [{ id: "model", extensions: ["t.click"] }], doc: { objects: { a: object() } } });
    expect(s.local.get().running.map((r) => r.id)).toEqual(["t.click"]);
    expect(s.api("t.click")).toBeTruthy();
    s.click(12, 8);
    expect(clicks).toEqual([12]);
    s.unmount();
  });
});
