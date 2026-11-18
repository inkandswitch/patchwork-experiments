import { describe, it, expect, vi } from "vitest";

// the host's plugin registry: this package's plugins and a seats owner (test/stand-ins.js)
vi.mock("@inkandswitch/patchwork-plugins", async () => {
  const { plugins: own } = await import("../index.js");
  const { seatsPlugin } = await import("../test/stand-ins.js");
  const { fakeRegistry } = await import("../test/fakes.js");
  const byType = {};
  for (const p of [...own, seatsPlugin()]) (byType[p.type] ??= []).push(p);
  const registries = Object.fromEntries(Object.entries(byType).map(([t, list]) => [t, fakeRegistry(list)]));
  return { getRegistry: (type) => registries[type] ?? fakeRegistry([]) };
});
import GameLibraryTool from "./tool.js";
import { GameLibraryDatatype } from "./datatype.js";
import { FakeRepo } from "../test/fake-repo.js";
import { foldersOf, linksOf } from "./model.js";

const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const buttons = (root, text) => [...root.querySelectorAll("button")].filter((b) => b.textContent === text);

describe("the launcher (game-library tool)", () => {
  it("adds the built-in games, starts a game it opens, forks the session, and opens the library as a folder", async () => {
    const repo = new FakeRepo();
    const doc = { "@patchwork": { type: "game-library" } };
    GameLibraryDatatype.init(doc, repo);
    const lib = repo.add(doc);
    const element = document.createElement("div");
    element.repo = repo;
    const opened = [];
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    const cleanup = GameLibraryTool(lib, element);
    await until(() => element.textContent.includes("No games yet."));
    buttons(element, "Add the built-in games")[0].click();
    await until(() => element.querySelectorAll(".games-list li").length === 4);
    expect([...element.querySelectorAll(".games-list li strong")].map((e) => e.textContent)).toEqual(["Santorini", "Lost Cities", "Draw Dominoes", "Liar's dice"]);
    // Draw Dominoes offers its variants
    await until(() => element.querySelector("select.variant"));
    expect([...element.querySelector("select.variant").options].map((o) => o.textContent)).toEqual(["2 players", "3 players", "4 players"]);

    // New game: Lost Cities, opened in the scene tool, listed in Sessions
    buttons(element, "New game")[1].click();
    await until(() => opened.length === 1, 20_000);
    expect(opened[0].toolId).toBe("scene");
    const sessions = await repo.find(foldersOf(lib.doc()).sessions);
    expect(linksOf(sessions.doc()).map((l) => [l.type, l.url])).toEqual([["scene", opened[0].url]]);
    await until(() => element.querySelectorAll(".sessions-list li").length === 1);
    expect(element.querySelector(".sessions-list li").textContent).toMatch(/^Lost Cities, \d{4}-\d\d-\d\d \d\d:\d\d/);

    // Fork it: a second session, newest first, saying where it came from
    buttons(element, "Fork")[0].click();
    await until(() => element.querySelectorAll(".sessions-list li").length === 2);
    await until(() => /forked from Lost Cities/.test(element.querySelector(".sessions-list li").textContent));
    expect(element.querySelector(".sessions-list li").textContent).toMatch(/\(copy\)/);
    // and opens the copy
    expect(opened.at(-1)).toEqual({ url: linksOf(sessions.doc()).at(-1).url, toolId: "scene" });
    // Continue opens a session
    buttons(element, "Continue")[1].click();
    expect(opened.at(-1)).toEqual({ url: opened[0].url, toolId: "scene" });
    // and the library itself in the folder tool
    buttons(element, "Open as folder")[0].click();
    expect(opened.at(-1)).toEqual({ url: lib.url, toolId: "folder-viewer" });
    cleanup();
    expect(element.children).toHaveLength(0);
  }, 30_000);
});
