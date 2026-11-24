// @vitest-environment happy-dom
// whileEditing (EDITOR.md, "The Edit hand"): what a view plugin makes while
// the Edit hand is held is made as the first is picked up (at once if one is
// held already) and disposed once as the last goes, however it goes.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { mountStage, settle } from "../test/stage-harness.js";
import { whileEditing } from "./editing.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

/** A view plugin that picks up hands: of kind "edit" unless told, with no escape of its own (Escape puts it down). */
const HANDS = { meta: { id: "t.hands", type: "scene:view" }, module: { create: () => ({}) } };
/** A view plugin whose chrome is made while editing: each make and dispose logged. */
const chrome = (id, log, make = () => {}) => ({
  meta: { id, type: "scene:view" },
  module: {
    create(api) {
      whileEditing(api, () => {
        log.push("make");
        make(api);
        return () => log.push("dispose");
      });
      return {};
    },
  },
});

async function mount(log, make) {
  s = await mountStage({ extensions: [HANDS, chrome("t.chrome", log, make)] });
  return { pick: (kind = "edit") => s.api("t.hands").hand({ kind, name: kind, input: {} }) };
}

describe("whileEditing", () => {
  it("made on the first pick-up of the Edit hand, never for another kind; disposed once, on the last put-down", async () => {
    const log = [];
    const { pick } = await mount(log);
    const other = pick("other");
    expect(log).toEqual([]);
    const a = pick();
    const b = pick();
    expect(log).toEqual(["make"]);
    a();
    expect(log).toEqual(["make"]);
    b();
    expect(log).toEqual(["make", "dispose"]);
    other();
    pick()();
    expect(log).toEqual(["make", "dispose", "make", "dispose"]);
  });

  it("made at once by a plugin that starts while it is held", async () => {
    const log = [];
    const { pick } = await mount([]);
    const put = pick();
    getRegistry("scene:view").register({ type: "scene:view", id: "t.late", name: "t.late", load: async () => chrome("t.late", log).module });
    await settle();
    expect(log).toEqual(["make"]);
    put();
    expect(log).toEqual(["make", "dispose"]);
  });

  it("what a make that puts the hand down as it runs made goes at once", async () => {
    const log = [];
    // (Escape, pressed as it makes: the hand, which has no escape of its own, is put down)
    const { pick } = await mount(log, () => s.key("Escape", { code: "Escape" }));
    pick();
    expect([log, s.local.get().hands.length]).toEqual([["make", "dispose"], 0]);
  });

  // however the hand goes: Escape pops it, its plugin stops; and the maker's own plugin stopping
  it.each([
    ["Escape puts it down", () => s.key("Escape", { code: "Escape" })],
    ["the hand's plugin stops", () => s.uninstall("t.hands")],
    ["the maker's plugin stops", () => s.uninstall("t.chrome")],
  ])("disposed once when %s", async (_name, go) => {
    const log = [];
    const { pick } = await mount(log);
    const put = pick();
    expect(log).toEqual(["make"]);
    await go();
    await settle();
    expect(log).toEqual(["make", "dispose"]);
    put();
    expect(log).toEqual(["make", "dispose"]);
  });
});
