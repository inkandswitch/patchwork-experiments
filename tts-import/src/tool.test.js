import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import TtsImportTool from "./tool.js";
import { TtsImportDatatype } from "./datatype.js";
import { plugins } from "./index.js";
import { FakeRepo } from "./test/fake-repo.js";

function mount(seed = {}) {
  const repo = new FakeRepo();
  const doc = { "@patchwork": { type: "tts-import" } };
  TtsImportDatatype.init(doc);
  const handle = repo.add({ ...doc, ...seed });
  const element = document.createElement("div");
  element.repo = repo;
  document.body.append(element);
  const opened = [];
  element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
  const cleanup = TtsImportTool(handle, element);
  return { handle, element, cleanup, opened };
}

describe("plugins", () => {
  it("are metadata only (the entry runs in a worker): no imports, only load() is a function", () => {
    expect(readFileSync(`${process.cwd()}/src/index.js`, "utf8")).not.toMatch(/^\s*import\s/m);
    for (const p of plugins) {
      for (const [k, v] of Object.entries(p)) if (k !== "load") expect(typeof v).not.toBe("function");
      expect(() => structuredClone({ ...p, load: undefined })).not.toThrow();
    }
    expect(plugins.map((p) => `${p.type}:${p.id}`)).toEqual(["patchwork:datatype:tts-import", "patchwork:tool:tts-import"]);
  });
});

describe("the datatype", () => {
  it("starts empty with default settings", () => {
    const d = {};
    TtsImportDatatype.init(d);
    expect(d).toMatchObject({ status: "empty", report: null, sceneUrl: null, scenes: [] });
    expect(d.settings.metresPerUnit).toBe(0.0254);
    expect(TtsImportDatatype.getTitle(d)).toBe("TTS import");
  });
});

describe("the tool", () => {
  it("offers a drop zone and settings, and writes settings to the doc", () => {
    const { element, handle, cleanup } = mount();
    expect(element.querySelector(".tts-import .drop")).toBeTruthy();
    expect(element.textContent).toContain("Drop a Tabletop Simulator mod here");
    const box = [...element.querySelectorAll(".settings input[type=checkbox]")][0];
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(handle.doc().settings.includeContents).toBe(false);
    cleanup();
    expect(element.querySelector(".tts-import")).toBeNull();
    expect(element.querySelector("style")).toBeNull();
  });

  it("shows a report with what's missing, and opens the table with the scene tool", () => {
    const report = {
      mod: { saveName: "Tiny", fileName: "x.json", objects: 17 },
      counts: { placed: 15, hidden: 3, kinds: 15, glbBytes: 120000, assets: { cache: 8, fetched: 0, missing: 1 }, seats: 1, skipped: { "3DText (not drawn)": 1 }, approximated: {}, byName: { Card: 4 } },
      assets: { a: { url: "https://example.invalid/x.obj", usedBy: ["Lost model"], source: null, error: "not in the dropped files" } },
      kinds: { k: { name: "Board", type: "tile", copies: 1, glbUrl: "automerge:glb", bytes: 2000 } },
      notes: {},
      warnings: [],
    };
    const { element, opened } = mount({ status: "done", report, sceneUrl: "automerge:scene", scenes: ["automerge:scene"] });
    expect(element.textContent).toContain("Missing assets (1)");
    expect(element.textContent).toContain("https://example.invalid/x.obj");
    expect(element.textContent).toContain("3DText (not drawn)");
    element.querySelector("button.primary").click();
    expect(opened).toEqual([{ url: "automerge:scene", toolId: "scene" }]);
  });

  it("shows an import's failure", () => {
    const { element } = mount({ status: "error", error: "No Tabletop Simulator save found" });
    expect(element.querySelector(".error").textContent).toContain("No Tabletop Simulator save found");
  });
});
