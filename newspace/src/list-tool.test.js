import { describe, it, expect, afterEach } from "vitest";
import { makeRepo, makeSurface, flush } from "./test-harness.js";
import { ListTool } from "./list-tool.jsx";

// ListTool resolves the canvas complement via a repo; the harness repo works if
// exposed as globalThis.repo (the tool falls back to it).
afterEach(() => { delete globalThis.repo; });

describe("ListTool (the list layout)", () => {
  it("renders a row per folder doc, each a wireable port", async () => {
    const repo = makeRepo();
    globalThis.repo = repo;
    const { folder } = makeSurface(repo, {
      docs: [
        { url: "automerge:a", name: "Alpha", type: "essay" },
        { url: "automerge:b", name: "Beta", type: "file" },
      ],
    });
    const element = document.createElement("div");
    element.repo = repo;
    const cleanup = ListTool(folder, element);
    await flush();
    const rows = element.querySelectorAll("[data-automerge-url]");
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.automergeUrl).toBe("automerge:a");
    expect(rows[0].dataset.automergePath).toBe("[]"); // whole-doc port
    expect(element.textContent).toContain("Alpha");
    expect(element.textContent).toContain("Beta");
    cleanup();
  });

  it("surfaces the canvas complement — what the list isn't showing", async () => {
    const repo = makeRepo();
    globalThis.repo = repo;
    // makeSurface wires folder.newspace → the layout doc (the canvas complement)
    const { folder, layout } = makeSurface(repo, {
      docs: [{ url: "automerge:a", name: "Alpha", type: "essay" }],
      items: [
        { id: "i1", kind: "doc", url: "automerge:a", x: 10, y: 10, w: 100, h: 80 },
        { id: "s1", kind: "shape", type: "rectangle", x: 0, y: 0, w: 20, h: 20 },
      ],
    });
    void layout;
    const element = document.createElement("div");
    element.repo = repo;
    const cleanup = ListTool(folder, element);
    await flush();
    // the banner names the complement: 1 positioned doc, 2 items total
    const banner = element.textContent;
    expect(banner).toContain("canvas layout");
    expect(banner).toMatch(/1 positioned doc/);
    expect(banner).toMatch(/2 items/);
    // and the positioned doc's row is tagged "on canvas"
    expect(element.textContent).toContain("on canvas");
    cleanup();
  });

  it("shows 'empty folder' for a folder with no docs", async () => {
    const repo = makeRepo();
    globalThis.repo = repo;
    const { folder } = makeSurface(repo, { docs: [] });
    const element = document.createElement("div");
    element.repo = repo;
    const cleanup = ListTool(folder, element);
    await flush();
    expect(element.textContent).toContain("empty folder");
    cleanup();
  });
});
