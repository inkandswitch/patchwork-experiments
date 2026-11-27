import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import TtsImportTool from "./tool.js";
import { TtsImportDatatype } from "./datatype.js";
import { plugins } from "../index.js";
import { FakeRepo } from "../test/fake-repo.js";

// the Tasks package's client, standing in: it knows of no work (tool-import.test.js asks it more)
getRegistry("patchwork:library").register({ type: "patchwork:library", id: "tasks-next", name: "Tasks client (stand-in)", load: async () => ({ watchWork: () => () => {} }) }, "test:tasks");

/** The tool mounted on an import doc (with `seed`), once it has the client. */
async function mount(seed = {}) {
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { handle, element, cleanup, opened };
}

describe("plugins", () => {
  it("are metadata only (the entry runs in a worker): no imports, only load() is a function", () => {
    expect(readFileSync(`${process.cwd()}/src/index.js`, "utf8")).not.toMatch(/^\s*import\s/m);
    for (const p of plugins) {
      for (const [k, v] of Object.entries(p)) if (k !== "load") expect(typeof v).not.toBe("function");
      expect(() => structuredClone({ ...p, load: undefined })).not.toThrow();
    }
    expect(plugins.filter((p) => p.id === "tts-import").map((p) => p.type)).toEqual(["patchwork:datatype", "patchwork:tool"]);
  });
});

describe("the datatype", () => {
  it("starts empty with default settings", () => {
    const d = {};
    TtsImportDatatype.init(d);
    expect(d).toMatchObject({ request: null, imported: null, games: [] });
    expect(d.settings).toEqual({ metresPerUnit: 0.0254, includeContents: true, fetchNow: false, flipObjX: true, maxObjects: 5000, maxStoredBytes: 32e6 });
    expect(d.settings.metresPerUnit).toBe(0.0254);
    expect(TtsImportDatatype.getTitle(d)).toBe("TTS import");
  });
});

describe("the tool", () => {
  it("offers a drop zone and settings, and writes settings to the doc", async () => {
    const { element, handle, cleanup } = await mount();
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

  it("shows a report with what's missing, and opens the game it made with the tabletop-game tool", async () => {
    const report = {
      mod: { saveName: "Tiny", fileName: "x.json", objects: 17 },
      counts: { placed: 15, pieces: 16, cards: 4, decks: 1, bags: 1, dice: 1, assets: { cache: 7, fetched: 0, missing: 1 }, seats: 1, skipped: { "3DText": 1 }, approximated: {}, byName: { Card: 4 } },
      assets: { a: { url: "https://example.invalid/x.obj", usedBy: ["Lost model"], source: null, error: "not in the dropped files" } },
      warnings: [],
    };
    const { element, opened } = await mount({ request: { id: "r", files: [], settings: {} }, imported: { id: "r", gameUrl: "automerge:game", report }, games: ["automerge:game"] });
    expect(element.textContent).toContain("Missing assets (1)");
    expect(element.textContent).toContain("https://example.invalid/x.obj");
    expect(element.textContent).toContain("3DText");
    expect(element.textContent).toContain("kinds of piece");
    element.querySelector("button.primary").click();
    expect(opened).toEqual([{ url: "automerge:game", toolId: "tabletop-game" }]);
  });

  it("shows an import's failure", async () => {
    const { element } = await mount({ request: { id: "r", files: [], settings: {} }, imported: { id: "r", error: "No Tabletop Simulator save found" } });
    expect(element.querySelector(".error").textContent).toContain("No Tabletop Simulator save found");
  });
});
