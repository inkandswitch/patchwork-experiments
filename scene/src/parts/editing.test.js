// @vitest-environment happy-dom
// whileHolding (STAGE.md, "Hands"): what a view plugin makes while a hand of
// a kind is held is made as the first is picked up (at once if one is held
// already) and disposed once as the last goes, however it goes.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { mountStage, settle } from "../test/stage-harness.js";
import { whileHolding } from "./holding.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

/** A view plugin that picks up hands: `kind` "k" unless told, with no escape of its own (Escape puts it down). */
const HANDS = { meta: { id: "t.hands", type: "scene:view" }, module: { create: () => ({}) } };
/** A view plugin whose chrome is made while a hand of kind "k" is held: each make and dispose logged. */
const chrome = (id, log) => ({
  meta: { id, type: "scene:view" },
  module: {
    create(api) {
      whileHolding(api, "k", () => {
        log.push("make");
        return () => log.push("dispose");
      });
      return {};
    },
  },
});

async function mount(log) {
  s = await mountStage({ extensions: [HANDS, chrome("t.chrome", log)] });
  const pick = (kind = "k") => s.api("t.hands").hand({ kind, name: kind, input: {} });
  return { pick };
}

describe("whileHolding", () => {
  it("made on the first pick-up of its kind, never for another kind; disposed once, on the last put-down", async () => {
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

  it("one plugin's makers for two kinds each follow their own (each of its watches hears its change)", async () => {
    const log = [];
    const TWO = {
      meta: { id: "t.two", type: "scene:view" },
      module: {
        create(api) {
          for (const kind of ["k", "j"]) whileHolding(api, kind, () => (log.push(`make ${kind}`), () => log.push(`dispose ${kind}`)));
          return {};
        },
      },
    };
    s = await mountStage({ extensions: [HANDS, TWO] });
    const pick = (kind) => s.api("t.hands").hand({ kind, name: kind, input: {} });
    const j = pick("j");
    const k = pick("k");
    j();
    k();
    expect(log).toEqual(["make j", "make k", "dispose j", "dispose k"]);
  });

  it("made at once by a plugin that starts while one is held", async () => {
    const log = [];
    const { pick } = await mount([]);
    const put = pick();
    getRegistry("scene:view").register({ type: "scene:view", id: "t.late", name: "t.late", load: async () => chrome("t.late", log).module });
    await settle();
    expect(log).toEqual(["make"]);
    put();
    expect(log).toEqual(["make", "dispose"]);
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
