// Quick Open's parts without the palette: which key opens it, where a choice
// goes, the order open tabs are listed in, how names match, and the walk of
// the folder tree. Each is checked case by case.

import {
  generateAutomergeUrl,
  initSubduction,
  Repo,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import { beforeAll, describe, expect, it } from "vitest";
import {
  isQuickOpenKey,
  matchName,
  openTabUrls,
  placementFor,
  rankItems,
  walkFolders,
  type QuickItem,
} from "./quickOpenItems";
import type { LayoutNode, LeafNode, PanelView } from "./types";

describe("the key", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
  const cases: { name: string; init: KeyboardEventInit; mac: boolean; other: boolean }[] = [
    { name: "⌘P", init: { key: "p", metaKey: true }, mac: true, other: false },
    { name: "Ctrl-P", init: { key: "p", ctrlKey: true }, mac: false, other: true },
    { name: "Ctrl-P, caps lock", init: { key: "P", ctrlKey: true }, mac: false, other: true },
    { name: "⌘Ctrl-P", init: { key: "p", metaKey: true, ctrlKey: true }, mac: false, other: false },
    { name: "⇧⌘P", init: { key: "P", metaKey: true, shiftKey: true }, mac: false, other: false },
    { name: "⌥⌘P", init: { key: "π", metaKey: true, altKey: true }, mac: false, other: false },
    { name: "P alone", init: { key: "p" }, mac: false, other: false },
    { name: "⌘O", init: { key: "o", metaKey: true }, mac: false, other: false },
  ];
  for (const c of cases) {
    it(`${c.name}: ${c.mac ? "opens" : "doesn't"} on a Mac, ${c.other ? "opens" : "doesn't"} elsewhere`, () => {
      expect(isQuickOpenKey(key(c.init), true)).toBe(c.mac);
      expect(isQuickOpenKey(key(c.init), false)).toBe(c.other);
    });
  }
});

describe("where a choice goes", () => {
  it.each([
    [false, false, undefined],
    [true, false, "stack"],
    [false, true, "horizontal"],
    [true, true, "vertical"],
  ] as const)("shift %s, alt %s: %s", (shiftKey, altKey, want) => {
    expect(placementFor({ shiftKey, altKey })).toBe(want);
  });
});

describe("the open tabs, in order", () => {
  const [A, B, C, D, E] = [0, 1, 2, 3, 4].map(() => generateAutomergeUrl());
  const leaf = (id: string, tabs: PanelView[], shown = 0): LeafNode => {
    const rest = tabs.filter((_, i) => i !== shown);
    return { kind: "leaf", id, view: tabs[shown], ...(rest.length ? { stack: rest, stackAt: shown } : {}) };
  };
  // folder | left: A [B] C | right: [D] A | bottom: empty
  const layout: LayoutNode = {
    kind: "split",
    id: "s0",
    direction: "horizontal",
    sizes: [20, 80],
    children: [
      { kind: "leaf", id: "folder", view: { role: "root-folder" } },
      {
        kind: "split",
        id: "s1",
        direction: "vertical",
        sizes: [50, 50],
        children: [
          {
            kind: "split",
            id: "s2",
            direction: "horizontal",
            sizes: [50, 50],
            children: [leaf("left", [{ url: A }, { url: B }, { url: C }], 1), leaf("right", [{ url: D }, { url: A }])],
          },
          leaf("bottom", [{}]),
        ],
      },
    ],
  };

  it("with no focus, panels in layout order, the showing tab first", () => {
    expect(openTabUrls(layout, [])).toEqual([B, A, C, D]);
  });
  it("the most recently focused panel first, a document once", () => {
    expect(openTabUrls(layout, ["left", "right"])).toEqual([D, A, B, C]);
  });
  it("panels never focused come after the focused ones", () => {
    expect(openTabUrls(layout, ["folder", "right"])).toEqual([D, A, B, C]);
  });
  it("nothing open, nothing listed", () => {
    expect(openTabUrls(null, [])).toEqual([]);
    expect(openTabUrls(leaf("only", [{}]), ["only"])).toEqual([]);
  });
  it("lists a url however many panels hold it", () => {
    const twice: LayoutNode = {
      kind: "split",
      id: "s",
      direction: "horizontal",
      sizes: [50, 50],
      children: [leaf("x", [{ url: E }]), leaf("y", [{ url: E }])],
    };
    expect(openTabUrls(twice, [])).toEqual([E]);
  });
});

describe("matching a name", () => {
  const cases: { query: string; name: string; hits: number[] | null }[] = [
    { query: "", name: "Anything", hits: [] },
    { query: "plan", name: "Sailing plan", hits: [8, 9, 10, 11] },
    { query: "PLAN", name: "Sailing plan", hits: [8, 9, 10, 11] },
    { query: "sail plan", name: "Sailing plan", hits: [0, 1, 2, 3, 8, 9, 10, 11] },
    { query: "sp", name: "Sailing plan", hits: [0, 8] },
    { query: "rs", name: "riggingSpec", hits: [0, 7] },
    { query: "xyz", name: "Sailing plan", hits: null },
    { query: "nalp", name: "Sailing plan", hits: null },
  ];
  for (const c of cases) {
    it(`"${c.query}" in "${c.name}": ${c.hits ? c.hits.join(",") : "no match"}`, () => {
      expect(matchName(c.query, c.name)?.hits ?? null).toEqual(c.hits);
    });
  }
});

describe("ranking", () => {
  const item = (name: string, open = false): QuickItem => ({
    url: generateAutomergeUrl(),
    name,
    open,
    path: "",
  });
  const names = (query: string, list: QuickItem[]) => rankItems(query, list).map((r) => r.item.name);

  it("nothing typed: everything, in the order given", () => {
    const list = [item("b"), item("a"), item("c")];
    expect(names("", list)).toEqual(["b", "a", "c"]);
  });
  it("a run beats scattered letters", () => {
    expect(names("log", [item("Long object graph"), item("Ship's log")])).toEqual(["Ship's log", "Long object graph"]);
  });
  it("the start of the name beats the start of a word beats the middle of one", () => {
    expect(names("rig", [item("Frigate"), item("Main rig"), item("Rigging")])).toEqual(["Rigging", "Main rig", "Frigate"]);
  });
  it("initials beat a run inside a word, and scattered letters", () => {
    expect(names("sp", [item("Wasp"), item("Sail plan")])).toEqual(["Sail plan", "Wasp"]);
    expect(names("spn", [item("Suspension"), item("Sail plan notes")])).toEqual(["Sail plan notes", "Suspension"]);
  });
  it("…but not a run starting a word", () => {
    expect(names("sp", [item("Sail plan"), item("Main spar")])).toEqual(["Main spar", "Sail plan"]);
  });
  it("every tier, in order", () => {
    // start of name, start of a word, initials, inside a word, scattered
    const list = ["oxsxpx", "Wasp", "Sail plan", "Main spar", "Spar"].map((n) => item(n));
    expect(names("sp", list)).toEqual(["Spar", "Main spar", "Sail plan", "Wasp", "oxsxpx"]);
  });
  it("of equal matches, the shorter name first", () => {
    expect(names("hull", [item("Hull lines"), item("Hull")])).toEqual(["Hull", "Hull lines"]);
  });
  it("ties keep the given order: open tabs first", () => {
    const open = item("Notes", true);
    const filed = item("Notes");
    expect(rankItems("notes", [open, filed]).map((r) => r.item)).toEqual([open, filed]);
  });
  it("shows at most the rows asked for", () => {
    const list = Array.from({ length: 80 }, (_, i) => item(`Doc ${i}`));
    expect(rankItems("doc", list, 50)).toHaveLength(50);
  });
});

describe("walking the folder tree", () => {
  let repo: Repo;
  beforeAll(async () => {
    await initSubduction();
    repo = new Repo({ network: [] });
  });

  const folder = (title: string) =>
    repo.create<{ title: string; docs: { name: string; type: string; url: AutomergeUrl }[] }>({
      title,
      docs: [],
    });

  it("breadth first, each folder once, with the folders it's in", async () => {
    // Home: Notes, Boats/ (Hull, Rig/ (Mast), Home again), Rig/ linked again, a lost folder
    const home = folder("Home");
    const boats = folder("Boats");
    const rig = folder("Rig");
    const [notes, hull, mast] = ["Notes", "Hull", "Mast"].map((title) => repo.create({ title }).url);
    const lost = generateAutomergeUrl();
    rig.change((d) => {
      d.docs.push({ name: "Mast", type: "essay", url: mast });
    });
    boats.change((d) => {
      d.docs.push({ name: "Hull", type: "essay", url: hull });
      d.docs.push({ name: "Rig", type: "folder", url: rig.url });
      d.docs.push({ name: "Home", type: "folder", url: home.url });
    });
    home.change((d) => {
      d.docs.push({ name: "Notes", type: "essay", url: notes });
      d.docs.push({ name: "Boats", type: "folder", url: boats.url });
      d.docs.push({ name: "Rig again", type: "folder", url: rig.url });
      d.docs.push({ name: "Lost", type: "folder", url: lost });
    });

    const levels: string[][] = [];
    const items = await walkFolders(repo, home.url, (found) => levels.push(found.map((i) => i.name)));
    expect(items.map((i) => [i.name, i.path])).toEqual([
      ["Notes", ""],
      ["Boats", ""],
      ["Rig again", ""],
      ["Lost", ""],
      ["Hull", "Boats"],
      ["Mast", "Rig again"],
    ]);
    // Reported as each level loads; the lost folder is skipped, not fatal.
    expect(levels[0]).toEqual(["Notes", "Boats", "Rig again", "Lost"]);
    expect(levels[levels.length - 1]).toHaveLength(6);
  }, 10_000);

  it("stops at the limit", async () => {
    const home = folder("Home");
    home.change((d) => {
      for (let i = 0; i < 10; i++) d.docs.push({ name: `Doc ${i}`, type: "essay", url: generateAutomergeUrl() });
    });
    const items = await walkFolders(repo, home.url, () => {}, undefined, 4);
    expect(items.map((i) => i.name)).toEqual(["Doc 0", "Doc 1", "Doc 2", "Doc 3"]);
  });

  it("stops when aborted", async () => {
    const home = folder("Home");
    const sub = folder("Sub");
    sub.change((d) => {
      d.docs.push({ name: "Deep", type: "essay", url: generateAutomergeUrl() });
    });
    home.change((d) => {
      d.docs.push({ name: "Sub", type: "folder", url: sub.url });
    });
    const abort = new AbortController();
    const items = await walkFolders(repo, home.url, () => abort.abort(), abort.signal);
    expect(items.map((i) => i.name)).toEqual(["Sub"]);
  });
});
