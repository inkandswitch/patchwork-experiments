// The frame hosted the way the site hosts it, hearing documents opened from
// outside it: a shared link it loads with, and a link that changes the
// address while it runs.
//
// The site's root is a `<patchwork-view id="root">`. In legacy mode the view
// hands its tool a content `<div>` inside itself, calls the tool's module
// with that div, and then dispatches `patchwork:mounted` on the view itself
// (`LegacyImpl` in `@inkandswitch/patchwork-elements`). The site's hash router
// (`createRouter` in `@inkandswitch/patchwork`, copied below) dispatches every
// open that comes from the address bar on the view, without bubbling, on that
// `patchwork:mounted` and on every `hashchange`; and it writes the hash itself
// from every open it hears there. So the frame must listen on the view, not on
// the div it was handed, and must write the hash the way the router does, or
// the router's own write of the same open is a second navigation.
//
// The cases, each checked on purpose:
//  - a link the frame loads with opens its document, although the router
//    sends it before the frame has rendered or has a layout to put it in;
//  - a link that changes the address opens its document;
//  - an open made inside the frame reaches the router, and leaves `doc=` as
//    the full automerge URL, heads included, in the router's own form, so
//    the router's write of it is no navigation;
//  - the router's replay of the address on a remount changes nothing.

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
import { act } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leafTabs } from "./layout";
import { renderPatchworkFrame } from "./PatchworkFrame";
import type { LayoutNode, LeafNode, TilingLayoutDoc } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const FRAME_TOOL = "tiling-frame";

/**
 * The site's router (`createRouter`) and the root's reveal (`installReveal`),
 * minus retitling, older link shapes and frame switching. It records the
 * opens it hears and how many of its own hash writes were navigations.
 */
const routeLikeTheSite = (rootElement: HTMLElement, frameDocUrl: AutomergeUrl) => {
  const heard: AutomergeUrl[] = [];
  let navigations = 0;
  const route = () => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const docUrl = docParamToUrl(params.get("doc"));
    const seeding = !rootElement.hasAttribute("tool-id");
    if (seeding) {
      rootElement.setAttribute("tool-id", FRAME_TOOL);
      rootElement.setAttribute("doc-url", frameDocUrl);
      return;
    }
    if (!docUrl) return;
    rootElement.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail: {
          url: docUrl,
          toolId: params.get("tool"),
          title: params.get("title"),
          type: params.get("type"),
        },
      }),
    );
  };
  const onOpen = (event: Event) => {
    const { url, toolId, type, title } = (event as CustomEvent).detail as {
      url: AutomergeUrl;
      toolId?: string;
      type?: string;
      title?: string;
    };
    heard.push(url);
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.delete("heads");
    const prevDoc = docParamToUrl(params.get("doc"));
    if (
      prevDoc &&
      parseAutomergeUrl(prevDoc).documentId !== parseAutomergeUrl(url).documentId
    ) {
      params.delete("draft");
    }
    params.set("doc", url);
    for (const [key, value] of [
      ["tool", toolId],
      ["title", title],
      ["type", type],
    ] as const) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const next = serializeHashParams(params);
    // Setting the hash a page already has is no navigation (the Location
    // `hash` setter), so it fires no `hashchange`.
    if (`#${next}` === window.location.hash) return;
    navigations++;
    window.location.hash = next;
  };
  const onMounted = (event: Event) => {
    if (event.target !== rootElement) return;
    route();
    // Routed again once every module has registered.
    void Promise.resolve().then(route);
  };
  rootElement.addEventListener("patchwork:open-document", onOpen);
  rootElement.addEventListener("patchwork:mounted", onMounted);
  window.addEventListener("hashchange", route);
  route();
  return {
    heard,
    get navigations() {
      return navigations;
    },
    stop() {
      rootElement.removeEventListener("patchwork:open-document", onOpen);
      rootElement.removeEventListener("patchwork:mounted", onMounted);
      window.removeEventListener("hashchange", route);
    },
  };
};

let repo: Repo;
let account: DocHandle<{ rootFolderUrl: AutomergeUrl }>;
let view: HTMLElement;
let content: HTMLElement;
let router: ReturnType<typeof routeLikeTheSite>;
let cleanup: () => void;
const docs = new Map<string, AutomergeUrl>();
const names = new Map<string, string>();

const layoutHandle = () => {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get("layout");
  return repo.find<TilingLayoutDoc>(`automerge:${raw}` as AutomergeUrl);
};

const leaves = (node: LayoutNode | null | undefined): LeafNode[] =>
  !node
    ? []
    : node.kind === "leaf"
      ? [node]
      : [...leaves(node.children[0]), ...leaves(node.children[1])];

/** Every content panel's tabs: names, `*` a preview, `[…]` showing. */
const panels = async (): Promise<string[]> =>
  leaves((await layoutHandle()).doc()?.layout)
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

const hashParams = () => new URLSearchParams(window.location.hash.slice(1));

/** The address names `url` in the router's own form. */
const expectAddressNames = (url: AutomergeUrl) => {
  expect(docParamToUrl(hashParams().get("doc"))).toBe(url);
  expect(hashParams().has("heads")).toBe(false);
  expect(window.location.hash).toBe(`#${serializeHashParams(hashParams())}`);
};

const settle = () => act(() => sleep(50));

/** Mount the frame the way the site's root `<patchwork-view>` does. */
const mount = async () => {
  view = document.createElement("patchwork-view");
  view.id = "root";
  document.body.append(view);
  router = routeLikeTheSite(view, account.url);
  content = document.createElement("div");
  content.className = "patchwork-view-content";
  (content as HTMLElement & { repo?: Repo }).repo = repo;
  view.append(content);
  await act(async () => {
    cleanup = renderPatchworkFrame(account, content as never);
    view.dispatchEvent(
      new CustomEvent("patchwork:mounted", {
        bubbles: true,
        composed: true,
        detail: { url: account.url, toolId: FRAME_TOOL },
      }),
    );
  });
  // The base providers never mount here, so wait out the frame's grace period.
  for (let i = 0; i < 60 && !content.querySelector(".tile-panel"); i++) {
    await act(() => sleep(100));
  }
  await settle();
};

beforeAll(async () => {
  await initSubduction();
  repo = new Repo({ network: [] });
  for (const name of "ABC") {
    const handle = repo.create<{ title: string }>({ title: name });
    docs.set(name, handle.url);
    names.set(handle.url, name);
  }
  // C as of an earlier version: the same document, at its first heads.
  const c = await repo.find<{ title: string }>(docs.get("C")!);
  const cAtHeads = stringifyAutomergeUrl({
    documentId: c.documentId,
    heads: c.heads(),
  });
  c.change((d) => {
    d.title = "C, later";
  });
  docs.set("C@1", cAtHeads);
  names.set(cAtHeads, "C@1");
  const folder = repo.create({ "@patchwork": { type: "folder" }, title: "Home", docs: [] });
  account = repo.create({ rootFolderUrl: folder.url });
  // A shared link to A, as the router writes it, opened in a fresh tab: no
  // layout yet, so the frame makes one.
  window.history.replaceState(null, "", `/#doc=${docs.get("A")}`);
  await mount();
}, 20_000);

afterAll(() => {
  act(() => cleanup());
  router.stop();
  view.remove();
});

describe("the frame hosted by a <patchwork-view>, routed like the site", () => {
  it("is handed a div inside the view, as the site's view hands it", () => {
    expect(content.parentElement).toBe(view);
    expect(content.querySelectorAll(".tile-panel")).toHaveLength(2);
  });

  it("opens the link it loaded with, sent before it had a layout", async () => {
    expect(await panels()).toEqual(["[A*]"]);
    expectAddressNames(docs.get("A")!);
  });

  it("opens a document when a link changes the address", async () => {
    await act(async () => {
      window.location.hash = serializeHashParams(
        new URLSearchParams({ ...Object.fromEntries(hashParams()), doc: docs.get("B")! }),
      );
    });
    await settle();
    expect(await panels()).toEqual(["[B*]"]);
    expectAddressNames(docs.get("B")!);
  });

  it("tells the router of an open made inside it, in the router's own form", async () => {
    const before = router.navigations;
    const heard = router.heard.length;
    const leaf = leaves((await layoutHandle()).doc()?.layout).find(
      (l) => l.view.role !== "root-folder",
    )!;
    const panel = content.querySelector<HTMLElement>(
      `[data-leaf-id="${leaf.id}"] .tile-panel__tab-content:not([hidden])`,
    )!;
    await act(async () => {
      panel.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, button: 0 }));
      panel.dispatchEvent(
        new CustomEvent("patchwork:open-document", {
          bubbles: true,
          composed: true,
          detail: { url: docs.get("C@1") },
        }),
      );
    });
    await settle();
    expect(await panels()).toEqual(["[C@1*]"]);
    expectAddressNames(docs.get("C@1")!);
    expect(router.heard.slice(heard)).toContain(docs.get("C@1"));
    expect(router.navigations).toBe(before);
  });

  it("the router's replay of the address as it remounts changes nothing", async () => {
    const before = router.navigations;
    await act(async () => {
      view.dispatchEvent(
        new CustomEvent("patchwork:mounted", { bubbles: true, composed: true }),
      );
    });
    await settle();
    expect(await panels()).toEqual(["[C@1*]"]);
    expectAddressNames(docs.get("C@1")!);
    expect(router.navigations).toBe(before);
  });
});
