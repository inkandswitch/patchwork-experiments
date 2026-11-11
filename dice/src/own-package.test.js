import { describe, it, expect, vi } from "vitest";

const registered = { "patchwork:datatype": [], "patchwork:tool": [] };
vi.mock("@inkandswitch/patchwork-plugins", () => ({ getRegistry: (type) => ({ filter: (fn) => (registered[type] ?? []).filter(fn) }) }));
import { ownImportUrl, diePatchwork, shareableImportUrl } from "./own-package.js";

const A = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
const HEAD = "H".repeat(48);

describe("this package's URL on the die docs made here", () => {
  it("an automerge URL goes on bare, whatever heads it was registered at; a public https URL as it is", () => {
    for (const [url, want] of [
      [A, A],
      [`${A}#${HEAD}`, A],
      [`${A}#${HEAD}|${HEAD}`, A],
      ["https://tools.example.com/scene/", "https://tools.example.com/scene/"],
      ["https://tools.example.com/scene/index.js#v2", "https://tools.example.com/scene/index.js"],
    ]) {
      expect([url, shareableImportUrl(url)]).toEqual([url, want]);
      expect(diePatchwork(url)).toEqual({ type: "die", suggestedImportUrl: want });
    }
  });

  it("what another viewer couldn't load is left off: the doc still says it's a die", () => {
    for (const url of [
      "http://localhost:5173/",
      "http://tools.example.com/scene/",
      "https://localhost:5173/",
      "https://127.0.0.1/x",
      "https://192.168.1.4/x",
      "https://10.1.2.3/x",
      "https://172.20.0.1/x",
      "https://my-mac.local/x",
      "https://devbox/x",
      "https://[::1]/x",
      "https://me:pw@tools.example.com/",
      "blob:https://tools.example.com/1",
      "data:text/javascript,1",
      "javascript:alert(1)",
      "./dist/index.js",
      `${A}/dist/index.js`,
      "automerge:not-an-id",
      "",
      null,
      undefined,
      7,
    ]) {
      expect([url, shareableImportUrl(url)]).toEqual([url, null]);
      expect(diePatchwork(url)).toEqual({ type: "die" });
    }
  });

  it("is read from the registry: the die datatype's importUrl, else the die tool's, else nothing", async () => {
    expect(await ownImportUrl()).toBeNull();
    registered["patchwork:tool"] = [{ id: "other", importUrl: "automerge:x" }, { id: "die", importUrl: `${A}#${HEAD}` }];
    expect(await ownImportUrl()).toBe(`${A}#${HEAD}`);
    registered["patchwork:datatype"] = [{ id: "die", importUrl: "https://tools.example.com/scene/" }];
    expect(await ownImportUrl()).toBe("https://tools.example.com/scene/");
    registered["patchwork:datatype"] = [{ id: "die" }]; // registered without one: the tool's
    expect(await ownImportUrl()).toBe(`${A}#${HEAD}`);
  });
});
