// The frame's half of the preview rule: where an open goes, and what counts as
// engaging with a document. A real in-memory repo and the real frame; panels
// are driven the way a tool drives them, by a click (whose modifiers the frame
// notes) followed by a bubbling `patchwork:open-document` from inside the
// panel, and a pointerdown into a document is engagement.
//
// The story, step by step, each checked against the stored layout:
//  - the folder opens A, B, C into the content panel: one tab, [C*];
//  - engage C; the folder opens D: C [D*];
//  - a link followed from D (the click is the only gesture): C [E*];
//  - engage E, then a link from E: C E [F*];
//  - Shift from the folder over the preview F keeps it: C E F [G*];
//  - Alt from the folder opens H beside the content panel, as a preview;
//  - a document already open is shown, not opened again;
//  - an open from the URL (the host dispatches those on the mount element) is
//    a link followed from the focused document panel, whichever that is;
//  - Back and Forward over address-bar edits are opens from the URL too;
//  - each open is one history entry recording its panel: Back shows a
//    document still open, and reopens one since replaced in its own panel;
//  - a new browser tab clones the layout and its focus, so a link pasted into
//    it lands in the panel you were last in;
//  - Quick Open (⌘P) lists open tabs then the folder tree, and opens a choice
//    where the folder would, or beside with Alt;
//  - the tab keys step through, pick and close the focused panel's tabs (or
//    the selected document's panel's, from the folder), and close a panel
//    with its last tab.
//
// The host's hash router runs throughout, after the site's router
// (`createRouter` in `@inkandswitch/patchwork`): every open that reaches the
// root element is written to `location.hash`, `doc=` as the full automerge
// URL, and the URL's `doc` is dispatched back on every `hashchange` and every
// `patchwork:mounted`. So each step above also checks that the replay lands on
// a document already open and changes nothing. `frame-host.test.tsx` mounts
// the frame inside a `<patchwork-view>`, as the site does.

import {
  initSubduction,
  isValidAutomergeUrl,
  isValidDocumentId,
  parseAutomergeUrl,
  Repo,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocumentId,
} from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import { Suspense, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leafTabs } from "./layout";
import { PatchworkFrame } from "./PatchworkFrame";
import type { LayoutNode, LeafNode, TilingLayoutDoc } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let repo: Repo;
let root: Root;
let element: HTMLDivElement;
let layout: DocHandle<TilingLayoutDoc>;
let account: DocHandle<{ rootFolderUrl: AutomergeUrl; currentLayoutUrl?: AutomergeUrl }>;
let unroute: () => void;
const docs = new Map<string, AutomergeUrl>();
const names = new Map<string, string>();

const leaves = (node: LayoutNode | null): LeafNode[] =>
  !node
    ? []
    : node.kind === "leaf"
      ? [node]
      : [...leaves(node.children[0]), ...leaves(node.children[1])];

/** Every content panel's tabs: names, `*` a preview, `[…]` showing. */
const panels = (): string[] =>
  leaves(layout.doc()!.layout)
    .filter((leaf) => leaf.view.role !== "root-folder")
    .map((leaf) => {
      const { tabs, active } = leafTabs(leaf);
      return tabs
        .map((tab, i) => {
          const label = tab.url ? `${names.get(tab.url)}${tab.preview ? "*" : ""}` : "∅";
          return i === active ? `[${label}]` : label;
        })
        .join(" ");
    });

const folderEl = () =>
  element.querySelector<HTMLElement>(
    `[data-leaf-id="${leaves(layout.doc()!.layout).find((l) => l.view.role)!.id}"] .tile-panel__content-inner`,
  )!;
/** The showing document of the content panel holding `name`. */
const docEl = (name: string) => {
  const leaf = leaves(layout.doc()!.layout).find((l) => l.view.url === docs.get(name))!;
  return element.querySelector<HTMLElement>(
    `[data-leaf-id="${leaf.id}"] .tile-panel__tab-content:not([hidden])`,
  )!;
};

const settle = () => act(() => sleep(20));

const engage = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  });
  await settle();
};

/** A tool's click that opens `name` from `el`, with modifiers. */
const open = async (
  el: HTMLElement,
  name: string,
  mods: { shiftKey?: boolean; altKey?: boolean; pointer?: boolean } = {},
  extra: Record<string, string> = {},
) => {
  await act(async () => {
    if (mods.pointer)
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, button: 0, ...mods }),
    );
    el.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        bubbles: true,
        composed: true,
        detail: { url: docs.get(name), ...extra },
      }),
    );
  });
  await settle();
};

// From the site's router (`@inkandswitch/patchwork`, src/router.ts).
const RAW_HASH_KEYS = new Set(["doc", "draft"]);
const HASH_KEY_ORDER = ["doc", "tool", "type", "title", "frame", "draft"];

function serializeHashParams(params: URLSearchParams): string {
  const keys = [...HASH_KEY_ORDER, ...params.keys()];
  const parts: string[] = [];
  const emitted = new Set<string>();
  for (const key of keys) {
    if (emitted.has(key)) continue;
    const value = params.get(key);
    if (!value) continue;
    emitted.add(key);
    parts.push(`${key}=${RAW_HASH_KEYS.has(key) ? value : encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

function docParamToUrl(docParam: string | null): AutomergeUrl | undefined {
  if (!docParam) return undefined;
  if (isValidAutomergeUrl(docParam as AutomergeUrl)) return docParam as AutomergeUrl;
  const documentId = docParam.replace(/^automerge:/, "");
  if (!isValidDocumentId(documentId)) return undefined;
  return stringifyAutomergeUrl({ documentId: documentId as DocumentId });
}

/**
 * The site's hash router (`createRouter` in `@inkandswitch/patchwork`), minus
 * retitling, older link shapes and frame switching: outbound opens set
 * `location.hash` (a history entry and a `hashchange`), and the URL's `doc` is
 * dispatched on the root element on every `hashchange` and
 * `patchwork:mounted`.
 */
const routeLikeTheHost = (rootElement: HTMLElement) => {
  const onOpen = (event: Event) => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const { url, toolId, title, type } = (event as CustomEvent).detail;
    params.delete("heads");
    params.set("doc", url);
    if (toolId) params.set("tool", toolId);
    else params.delete("tool");
    if (title) params.set("title", title);
    else params.delete("title");
    if (type) params.set("type", type);
    else params.delete("type");
    hashHistory.push(serializeHashParams(params));
  };
  const handleHashChange = () => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const url = docParamToUrl(params.get("doc"));
    if (!url) return;
    rootElement.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail: { url, toolId: params.get("tool") },
      }),
    );
  };
  rootElement.addEventListener("patchwork:open-document", onOpen);
  rootElement.addEventListener("patchwork:mounted", handleHashChange);
  window.addEventListener("hashchange", handleHashChange);
  return () => {
    rootElement.removeEventListener("patchwork:open-document", onOpen);
    rootElement.removeEventListener("patchwork:mounted", handleHashChange);
    window.removeEventListener("hashchange", handleHashChange);
  };
};

/**
 * The browser's session history over hash changes, which happy-dom doesn't
 * keep. Each entry is a hash and a state: assigning `location.hash` pushes
 * one (state `null`) unless the hash is unchanged, `pushState` pushes one,
 * `replaceState` rewrites the current one, and Back/Forward move along them,
 * restoring the state and firing `hashchange` when the hash differs.
 */
const hashHistory = (() => {
  type Entry = { hash: string; state: unknown };
  let entries: Entry[] = [{ hash: window.location.hash, state: null }];
  let at = 0;
  const replaceState = window.history.replaceState.bind(window.history);
  const add = (entry: Entry) => {
    entries = [...entries.slice(0, at + 1), entry];
    at = entries.length - 1;
  };
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replaceState(...args);
    entries[at] = { hash: window.location.hash, state: args[0] ?? null };
  };
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    replaceState(...args);
    add({ hash: window.location.hash, state: args[0] ?? null });
  };
  const go = (step: number) => {
    const from = entries[at].hash;
    at = Math.max(0, Math.min(entries.length - 1, at + step));
    replaceState(entries[at].state, "", entries[at].hash || "#");
    if (entries[at].hash !== from) window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  return {
    push(hash: string) {
      // Setting the hash it already has is no navigation at all (HTML spec,
      // the Location `hash` setter), as when the host's own replay of the
      // URL's `doc` reaches its open listener.
      if (`#${hash}` === window.location.hash) return;
      add({ hash: `#${hash}`, state: null });
      window.location.hash = hash;
    },
    back: () => go(-1),
    forward: () => go(1),
    /** How many entries there are up to and including the current one. */
    get depth() {
      return at + 1;
    },
  };
})();

/** Wait for the browser's `hashchange` (a task after the change) to land. */
const settleHash = () => act(() => sleep(50));

/** Edit the address bar: the URL's `doc` becomes `name`. */
const openFromUrl = async (name: string) => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.set("doc", docs.get(name)!);
  await act(async () => hashHistory.push(serializeHashParams(params)));
  await settleHash();
};

const back = async () => {
  await act(async () => hashHistory.back());
  await settleHash();
};
const forward = async () => {
  await act(async () => hashHistory.forward());
  await settleHash();
};

/** A tool finishing its mount somewhere in the frame. */
const toolMounted = async () => {
  await act(async () => {
    folderEl().dispatchEvent(
      new CustomEvent("patchwork:mounted", { bubbles: true, composed: true }),
    );
  });
  await settle();
};

/** Mount the frame on a fresh root element, routed like the host. */
const mount = async () => {
  element = document.createElement("div");
  document.body.append(element);
  unroute = routeLikeTheHost(element);
  root = createRoot(element);
  await act(async () => {
    root.render(
      <RepoContext.Provider value={repo}>
        <Suspense fallback={null}>
          <PatchworkFrame docUrl={account.url} element={element} />
        </Suspense>
      </RepoContext.Provider>,
    );
  });
  // The base providers never mount here, so wait out the frame's grace period.
  for (let i = 0; i < 60 && !element.querySelector(".tile-panel"); i++) {
    await act(() => sleep(100));
  }
};

const unmount = () => {
  act(() => root.unmount());
  unroute();
  element.remove();
};

/** Focus a panel the way a click into it does. */
const focus = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
  });
  await settle();
};

beforeAll(async () => {
  await initSubduction();
  repo = new Repo({ network: [] });
  for (const name of "ABCDEFGHIJK") {
    const handle = repo.create<{ title: string }>({ title: name });
    docs.set(name, handle.url);
    names.set(handle.url, name);
  }
  const folder = repo.create({ "@patchwork": { type: "folder" }, title: "Home", docs: [] });
  account = repo.create({ rootFolderUrl: folder.url });
  layout = repo.create<TilingLayoutDoc>({
    layout: {
      kind: "split",
      id: "split-0",
      direction: "horizontal",
      sizes: [20, 80],
      children: [
        { kind: "leaf", id: "leaf-folder", view: { role: "root-folder" } },
        { kind: "leaf", id: "leaf-content", view: {} },
      ],
    },
  });
  window.history.replaceState(null, "", `/#layout=${layout.url.slice(10)}`);
  await mount();
}, 15_000);

afterAll(() => {
  if (root) unmount();
});

describe("opening documents in the tiling frame", () => {
  it("renders the folder beside an empty content panel", () => {
    expect(element.querySelectorAll(".tile-panel")).toHaveLength(2);
    expect(panels()).toEqual(["[∅]"]);
  });

  it("clicking through the folder leaves one preview tab", async () => {
    await open(folderEl(), "A");
    await open(folderEl(), "B");
    await open(folderEl(), "C");
    expect(panels()).toEqual(["[C*]"]);
  });

  it("an engaged document stays when the folder opens another", async () => {
    await engage(docEl("C"));
    expect(panels()).toEqual(["[C]"]);
    await open(folderEl(), "D");
    expect(panels()).toEqual(["C [D*]"]);
  });

  it("a link followed from a preview replaces it: the click isn't engagement", async () => {
    await open(docEl("D"), "E", { pointer: true });
    expect(panels()).toEqual(["C [E*]"]);
  });

  it("a link followed from an engaged document stacks over it", async () => {
    await engage(docEl("E"));
    await open(docEl("E"), "F", { pointer: true });
    expect(panels()).toEqual(["C E [F*]"]);
  });

  it("the preview is shown in italic in the strip", () => {
    const italic = element.querySelectorAll(".tile-panel__tab--preview");
    expect(italic).toHaveLength(1);
    expect(italic[0].getAttribute("aria-selected")).toBe("true");
  });

  it("Shift keeps the preview it would have replaced", async () => {
    await open(folderEl(), "G", { shiftKey: true });
    expect(panels()).toEqual(["C E F [G*]"]);
  });

  it("Alt opens beside, as a preview, leaving the panel as it was", async () => {
    await open(folderEl(), "H", { altKey: true });
    expect(panels()).toEqual(["C E F [G*]", "[H*]"]);
  });

  it("a document already open is shown, not opened again", async () => {
    await open(folderEl(), "E");
    expect(panels()).toEqual(["C [E] F G*", "[H*]"]);
  });

  it("a URL open replaces the focused panel's preview, as a link would", async () => {
    await focus(docEl("H"));
    await openFromUrl("I");
    expect(panels()).toEqual(["C [E] F G*", "[I*]"]);
  });

  it("…and stacks over an engaged one, in whichever panel has focus", async () => {
    await engage(docEl("E"));
    await focus(docEl("E"));
    await openFromUrl("J");
    expect(panels()).toEqual(["C E [J*] F", "[I*]"]);
  });

  it("…and only shows a document already open", async () => {
    await openFromUrl("I");
    expect(panels()).toEqual(["C E [J*] F", "[I*]"]);
  });

  it("the host replaying the URL as a tool mounts changes nothing", async () => {
    await toolMounted();
    await toolMounted();
    expect(panels()).toEqual(["C E [J*] F", "[I*]"]);
  });

  it("Back and Forward over address-bar edits follow the same rule", async () => {
    await openFromUrl("K");
    expect(panels()).toEqual(["C E [J*] F", "[K*]"]);
    await back();
    expect(panels()).toEqual(["C E [J*] F", "[I*]"]);
    await forward();
    expect(panels()).toEqual(["C E [J*] F", "[K*]"]);
  });

  // Navigation history: each open is one entry, recording its panel.

  it("each open from the folder is one entry, and Back walks them as previews", async () => {
    await focus(docEl("K"));
    const before = hashHistory.depth;
    await open(folderEl(), "A");
    await open(folderEl(), "B");
    await open(folderEl(), "D");
    expect(panels()).toEqual(["C E [J*] F", "[D*]"]);
    expect(hashHistory.depth).toBe(before + 3);
    await back();
    expect(panels()).toEqual(["C E [J*] F", "[B*]"]);
    await back();
    expect(panels()).toEqual(["C E [J*] F", "[A*]"]);
    await back();
    expect(panels()).toEqual(["C E [J*] F", "[K*]"]);
    await forward();
    expect(panels()).toEqual(["C E [J*] F", "[A*]"]);
  });

  it("Back to a document still open only shows it, in its panel", async () => {
    await engage(docEl("A"));
    await open(folderEl(), "G");
    expect(panels()).toEqual(["C E [J*] F", "A [G*]"]);
    await back();
    expect(panels()).toEqual(["C E [J*] F", "[A] G*"]);
    await forward();
    expect(panels()).toEqual(["C E [J*] F", "A [G*]"]);
  });

  it("Back reopens a replaced document where it was, not where you are", async () => {
    await open(folderEl(), "I");
    expect(panels()).toEqual(["C E [J*] F", "A [I*]"]);
    // Focusing another panel rewrites the current entry (the URL names the
    // selected document), so Back goes to G, from before I was opened…
    await focus(docEl("J"));
    await back();
    // …and G, replaced by I since, comes back in its own panel, not J's.
    expect(panels()).toEqual(["C E [J*] F", "A [G*]"]);
  });

  it("focusing, and showing what's shown, add no entries; nor does the host", async () => {
    const before = hashHistory.depth;
    await focus(docEl("J"));
    await focus(docEl("G"));
    await open(folderEl(), "G");
    expect(hashHistory.depth).toBe(before);
    // An open carrying a title and type, which the host's router would write
    // into the hash, is still one entry.
    await open(folderEl(), "B", {}, { title: "Bee", type: "essay" });
    expect(panels()).toEqual(["C E [J*] F", "A [B*]"]);
    expect(hashHistory.depth).toBe(before + 1);
  });

  it("a new browser tab lands a link in the panel you were last in", async () => {
    // Without the focus carried over, the link would land in the first
    // content panel in tree order, the left one.
    const before = panels();
    expect(account.doc()!.currentLayoutUrl).toBe(layout.url);
    unmount();
    window.history.replaceState(
      null,
      "",
      `/#doc=${parseAutomergeUrl(docs.get("K")!).documentId}`,
    );
    await mount();
    await settleHash();
    const minted = new URLSearchParams(window.location.hash.slice(1)).get("layout");
    expect(minted).toBeTruthy();
    expect(`automerge:${minted}`).not.toBe(layout.url);
    layout = await repo.find<TilingLayoutDoc>(`automerge:${minted}` as AutomergeUrl);
    expect(before).toEqual(["C E [J*] F", "A [B*]"]);
    expect(panels()).toEqual(["C E [J*] F", "A [K*]"]);
  }, 15_000);

  // Quick Open (⌘P; Ctrl-P off a Mac).

  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const palette = () => element.querySelector<HTMLElement>(".tile-quick-open");
  const paletteInput = () => palette()!.querySelector("input")!;
  const quickOpenKey = (target: EventTarget) => {
    const event = new KeyboardEvent("keydown", {
      key: "p",
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const pressQuickOpen = async () => {
    let event!: KeyboardEvent;
    await act(async () => {
      event = quickOpenKey(document.activeElement ?? document.body);
    });
    await act(() => sleep(100)); // the folder walk
    return event;
  };
  const type = async (text: string) => {
    const input = paletteInput();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
  };
  const press = async (key: string, mods: { shiftKey?: boolean; altKey?: boolean } = {}) => {
    await act(async () => {
      paletteInput().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
      );
    });
    await settle();
  };
  const rows = () =>
    [...palette()!.querySelectorAll(".tile-quick-open__row")].map(
      (row) => row.querySelector(".tile-quick-open__name")!.textContent,
    );
  const chosen = () =>
    palette()!.querySelector('[aria-selected="true"] .tile-quick-open__name')?.textContent;

  it("⌘P lists open tabs, the focused panel's first, then the folder tree", async () => {
    // The folder tree: every document by name, G in a folder of its own.
    const sub = repo.create({
      "@patchwork": { type: "folder" },
      title: "Sub",
      docs: [{ name: "G", type: "essay", url: docs.get("G")! }],
    });
    const home = await repo.find<{ docs: { name: string; type: string; url: AutomergeUrl }[] }>(
      account.doc()!.rootFolderUrl,
    );
    home.change((d) => {
      for (const name of "ABCDEFHIJK") d.docs.push({ name, type: "essay", url: docs.get(name)! });
      d.docs.push({ name: "Sub", type: "folder", url: sub.url });
    });

    const key = await pressQuickOpen();
    expect(key.defaultPrevented).toBe(true); // not printing
    expect(document.activeElement).toBe(paletteInput());
    expect(rows()).toEqual(["K", "A", "J", "C", "E", "F", "B", "D", "H", "I", "Sub", "G"]);
    // It starts on the one before the document in front of you.
    expect(chosen()).toBe("A");
    const where = [...palette()!.querySelectorAll(".tile-quick-open__where")].map((w) => w.textContent);
    expect(where.slice(0, 6)).toEqual(Array(6).fill("open"));
    expect(where[where.length - 1]).toBe("Sub");
  });

  it("Enter opens the choice where the folder would, as one history entry", async () => {
    const before = hashHistory.depth;
    await type("d");
    expect(rows()).toEqual(["D"]);
    await press("Enter");
    expect(palette()).toBeNull();
    expect(panels()).toEqual(["C E [J*] F", "A [D*]"]);
    expect(hashHistory.depth).toBe(before + 1);
  });

  it("Alt+Enter opens it beside", async () => {
    await pressQuickOpen();
    await type("g");
    await press("Enter", { altKey: true });
    expect(panels()).toEqual(["C E [J*] F", "A [D*]", "[G*]"]);
  });

  it("a document already open is only shown", async () => {
    await pressQuickOpen();
    await type("e");
    await press("Enter");
    expect(panels()).toEqual(["C [E] J* F", "A [D*]", "[G*]"]);
  });

  it("⌘P again moves down; Escape closes it and gives focus back", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    await pressQuickOpen();
    const first = chosen();
    await act(async () => {
      quickOpenKey(paletteInput());
    });
    await settle();
    expect(chosen()).not.toBe(first);
    await press("Escape");
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(panels()).toEqual(["C [E] J* F", "A [D*]", "[G*]"]);
    button.remove();
  });

  it("a click elsewhere closes it", async () => {
    await pressQuickOpen();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await settle();
    expect(palette()).toBeNull();
  });

  // The tab keys (see `tabKeys.ts`), pressed wherever focus is.

  const tabKey = async (init: KeyboardEventInit, target: EventTarget = document.body) => {
    let event!: KeyboardEvent;
    await act(async () => {
      event = new KeyboardEvent("keydown", { bubbles: true, composed: true, cancelable: true, ...init });
      target.dispatchEvent(event);
    });
    await settle();
    return event;
  };
  const nextTab = { code: "BracketRight", key: "}", ctrlKey: true, shiftKey: true };
  const prevTab = { code: "BracketLeft", key: "{", ctrlKey: true, shiftKey: true };
  const tabNumber = (n: number) => ({ code: `Digit${n}`, key: `${n}`, ...(mac ? { ctrlKey: true } : { altKey: true }) });
  const closeTabKey = { code: "KeyW", key: mac ? "∑" : "w", altKey: true };
  const urlDoc = () => new URLSearchParams(window.location.hash.slice(1)).get("doc");
  const docUrl = (name: string) => docs.get(name)!;

  it("Ctrl+Shift+] and [ step through the focused panel's tabs, adding no history", async () => {
    const before = hashHistory.depth;
    expect(panels()[0]).toBe("C [E] J* F");
    expect((await tabKey(nextTab)).defaultPrevented).toBe(true);
    expect(panels()[0]).toBe("C E [J*] F");
    expect(urlDoc()).toBe(docUrl("J"));
    await tabKey(prevTab);
    await tabKey(prevTab);
    expect(panels()[0]).toBe("[C] E J* F");
    await tabKey(prevTab);
    expect(panels()[0]).toBe("C E J* [F]"); // round to the last
    expect(hashHistory.depth).toBe(before);
  });

  it("tab N by number, 9 the last", async () => {
    await tabKey(tabNumber(2));
    expect(panels()[0]).toBe("C [E] J* F");
    await tabKey(tabNumber(9));
    expect(panels()[0]).toBe("C E J* [F]");
    await tabKey(tabNumber(5)); // there's no fifth
    expect(panels()[0]).toBe("C E J* [F]");
  });

  it("Alt+W closes the tab showing", async () => {
    const event = await tabKey(closeTabKey);
    expect(event.defaultPrevented).toBe(true); // no ∑ typed
    expect(panels()).toEqual(["C E [J*]", "A [D*]", "[G*]"]);
    expect(urlDoc()).toBe(docUrl("J"));
  });

  it("a key a tool takes for itself stays the tool's", async () => {
    const target = docEl("J");
    const takeIt = (event: Event) => event.preventDefault();
    target.addEventListener("keydown", takeIt);
    await tabKey(prevTab, target);
    target.removeEventListener("keydown", takeIt);
    expect(panels()).toEqual(["C E [J*]", "A [D*]", "[G*]"]);
  });

  it("with focus in the folder, they act on the selected document's panel", async () => {
    await focus(folderEl());
    await tabKey(prevTab);
    expect(panels()).toEqual(["C [E] J*", "A [D*]", "[G*]"]);
  });

  it("pressed in a preview they don't keep it; typing in it does", async () => {
    await tabKey(nextTab, docEl("E"));
    expect(panels()).toEqual(["C E [J*]", "A [D*]", "[G*]"]);
    await tabKey({ code: "ShiftLeft", key: "Shift", shiftKey: true }, docEl("J"));
    expect(panels()).toEqual(["C E [J*]", "A [D*]", "[G*]"]);
    await tabKey({ code: "KeyX", key: "x" }, docEl("J"));
    expect(panels()).toEqual(["C E [J]", "A [D*]", "[G*]"]);
    await tabKey(prevTab);
  });

  it("a panel's last tab closes the panel", async () => {
    await focus(docEl("G"));
    await tabKey(closeTabKey);
    expect(panels()).toEqual(["C [E] J", "A [D*]"]);
  });

  it("none of them while Quick Open is up", async () => {
    await pressQuickOpen();
    await tabKey(closeTabKey, paletteInput());
    await tabKey(nextTab, paletteInput());
    expect(panels()).toEqual(["C [E] J", "A [D*]"]);
    await press("Escape");
  });

  // The shortcuts sheet and the keys named in tooltips.

  const sheet = () => element.querySelector<HTMLElement>(".tile-shortcuts");
  const questionMark = async (target: EventTarget) => {
    let event!: KeyboardEvent;
    await act(async () => {
      event = new KeyboardEvent("keydown", {
        key: "?",
        code: "Slash",
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
    });
    await settle();
    return event;
  };
  const leafEl = (name: string) => {
    const leaf = leaves(layout.doc()!.layout).find((l) => leafTabs(l).tabs.some((t) => t.url === docs.get(name)))!;
    return element.querySelector<HTMLElement>(`[data-leaf-id="${leaf.id}"]`)!;
  };

  it("? opens the shortcuts sheet; Escape closes it and gives focus back", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect((await questionMark(button)).defaultPrevented).toBe(true);
    expect(sheet()).not.toBeNull();
    expect(document.activeElement).toBe(sheet());
    const closeRow = sheet()!.querySelector('[data-shortcut="close-tab"] kbd')!.textContent;
    expect(closeRow).toBe(mac ? "⌥W" : "Alt+W");
    await act(async () => {
      sheet()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("? typed in a text field is only typed", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect((await questionMark(input)).defaultPrevented).toBe(false);
    expect(sheet()).toBeNull();
    input.remove();
  });

  it("the top bar's keyboard button opens it; a click elsewhere closes it", async () => {
    const button = element.querySelector<HTMLElement>('.tile-topbar [aria-label="Keyboard shortcuts"]')!;
    expect(button.title).toBe("Keyboard shortcuts (?)");
    await act(async () => button.click());
    await settle();
    expect(sheet()).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await settle();
    expect(sheet()).toBeNull();
  });

  it("the tooltips name the keys that do the same", async () => {
    expect(panels()).toEqual(["C [E] J", "A [D*]"]);
    const stack = leafEl("E");
    const tabs = [...stack.querySelectorAll<HTMLElement>(".tile-panel__tab")];
    const n = (i: number) => (mac ? `⌃${i}` : `Alt+${i}`);
    // (Titles here are ids: these documents have no datatype to name them.)
    expect(tabs.map((t) => / \((.+)\)$/.exec(t.title)?.[1])).toEqual([n(1), n(2), n(3)]);
    const closes = tabs.map((t) => t.querySelector<HTMLElement>(".tile-panel__tab-close")!.title);
    expect(closes).toEqual(["Close tab", `Close tab (${mac ? "⌥W" : "Alt+W"})`, "Close tab"]);
    // A stack's × closes the panel, which ⌥W doesn't; a lone document's does.
    expect(stack.querySelector<HTMLElement>(".tile-panel__icon-btn--close")!.title).toBe("Close panel");
    await open(folderEl(), "H", { altKey: true });
    expect(panels()).toEqual(["C [E] J", "[H*]", "A [D*]"]); // beside the focused panel
    expect(leafEl("H").querySelector<HTMLElement>(".tile-panel__icon-btn--close")!.title).toBe(
      `Close panel (${mac ? "⌥W" : "Alt+W"})`,
    );
    const folderPanel = folderEl().closest<HTMLElement>("[data-leaf-id]")!;
    expect(folderPanel.querySelector<HTMLElement>(".tile-panel__icon-btn--close")!.title).toBe("Close panel");
  });
});
