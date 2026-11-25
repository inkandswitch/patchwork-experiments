// The frame hosted the way the site hosts it (see `frame-host.test.tsx`),
// hearing documents opened from outside it while its own layout is not yet
// there to put them in, and an older link that names a document by its bare
// id.
//
// A fresh tab resumes the account's last session: it mints its own layout
// document and clones the last one into it, and until that has loaded there
// is no layout. The router routes again as the site's tools finish loading,
// and on every `hashchange`, so an open can arrive on the frame's listener in
// that window. Here the last session's document is held back until the test
// lets it load, which makes the window certain rather than a race.
//
// The cases, each checked on purpose:
//  - an open the router sends while the layout is loading is opened once it
//    has loaded, and it is that open, not the link the tab was loaded with,
//    that ends up showing and named in the address;
//  - a link the frame loads with that names a document by its bare id, as
//    older links do, opens that document, and the address then names it as
//    the full automerge URL, as the router writes it.

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
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { leafTabs, makeInitialLayout } from "./layout";
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

/**
 * The site's router as far as inbound opens go: on `patchwork:mounted` of the
 * root and on every `hashchange`, the address's `doc` is dispatched on the
 * root view without bubbling.
 */
const routeLikeTheSite = (rootElement: HTMLElement) => {
  const route = () => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const url = docParamToUrl(params.get("doc"));
    if (!url) return;
    rootElement.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail: { url, toolId: params.get("tool") },
      }),
    );
  };
  const onMounted = (event: Event) => {
    if (event.target === rootElement) route();
  };
  rootElement.addEventListener("patchwork:mounted", onMounted);
  window.addEventListener("hashchange", route);
  return () => {
    rootElement.removeEventListener("patchwork:mounted", onMounted);
    window.removeEventListener("hashchange", route);
  };
};

let repo: Repo;
let account: DocHandle<{ rootFolderUrl: AutomergeUrl; currentLayoutUrl?: AutomergeUrl }>;
const docs = new Map<string, AutomergeUrl>();
const names = new Map<string, string>();
let unmount: (() => void) | null = null;

// The last session's layout document, held back from the frame until `release`.
let heldUrl: AutomergeUrl | null = null;
let released: Promise<void> = Promise.resolve();
let release: () => void = () => {};

const hashParams = () => new URLSearchParams(window.location.hash.slice(1));

const layoutHandle = () =>
  repo.find<TilingLayoutDoc>(`automerge:${hashParams().get("layout")}` as AutomergeUrl);

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
          const label = tab.url ? `${names.get(tab.url) ?? "?"}${tab.preview ? "*" : ""}` : "∅";
          return i === active ? `[${label}]` : label;
        })
        .join(" ");
    });

/** A new tab on `hash`, resuming the session `lastSession`. */
const mount = async (hash: string, lastSession: AutomergeUrl) => {
  account.change((d) => {
    d.currentLayoutUrl = lastSession;
  });
  window.history.replaceState(null, "", `/#${hash}`);
  const view = document.createElement("patchwork-view");
  view.id = "root";
  document.body.append(view);
  const stopRouting = routeLikeTheSite(view);
  const content = document.createElement("div");
  content.className = "patchwork-view-content";
  (content as HTMLElement & { repo?: Repo }).repo = repo;
  view.append(content);
  let stopFrame: () => void = () => {};
  await act(async () => {
    stopFrame = renderPatchworkFrame(account, content as never);
    view.dispatchEvent(
      new CustomEvent("patchwork:mounted", { bubbles: true, composed: true }),
    );
  });
  // The frame writes `layout=` from the same commit that attaches its
  // open-document listener, so once it is there the frame is listening.
  for (let i = 0; i < 50 && !hashParams().get("layout"); i++) {
    await act(() => sleep(20));
  }
  expect(hashParams().get("layout")).toBeTruthy();
  unmount = () => {
    act(() => stopFrame());
    stopRouting();
    view.remove();
  };
  return content;
};

/** A layout document such as a last session leaves behind. */
const lastSession = (): AutomergeUrl =>
  repo.create<TilingLayoutDoc>({
    "@patchwork": { type: "patchwork-frame-tiling:layout" },
    layout: makeInitialLayout(),
  } as TilingLayoutDoc).url;

beforeAll(async () => {
  await initSubduction();
  repo = new Repo({ network: [] });
  for (const name of "ABC") {
    const handle = repo.create<{ title: string }>({ title: name });
    docs.set(name, handle.url);
    names.set(handle.url, name);
  }
  const folder = repo.create({ "@patchwork": { type: "folder" }, title: "Home", docs: [] });
  account = repo.create({ rootFolderUrl: folder.url });

  // Hold one document back: the hooks the frame loads documents with ask
  // `findWithProgress(...).peek()` first and then wait on `find`, so both
  // answer "not yet" for it until it is released.
  const find = repo.find.bind(repo);
  const findWithProgress = repo.findWithProgress.bind(repo);
  repo.find = (async (id: AutomergeUrl, ...rest: unknown[]) => {
    if (id === heldUrl) await released;
    return (find as (...a: unknown[]) => unknown)(id, ...rest);
  }) as typeof repo.find;
  repo.findWithProgress = ((id: AutomergeUrl, ...rest: unknown[]) => {
    const progress = (findWithProgress as (...a: unknown[]) => { peek: () => unknown })(
      id,
      ...rest,
    );
    if (id !== heldUrl) return progress;
    return Object.assign(Object.create(progress), {
      peek: () => ({ state: "loading", progress: 0 }),
    });
  }) as typeof repo.findWithProgress;
}, 20_000);

/** Hold `url` back from the frame until `release()`. */
const hold = (url: AutomergeUrl) => {
  heldUrl = url;
  released = new Promise((resolve) => {
    release = () => {
      heldUrl = null;
      resolve();
    };
  });
};

afterEach(() => {
  unmount?.();
  unmount = null;
});

describe("the frame hosted by a <patchwork-view>, before its layout is there", () => {
  it("opens what the router sends while the layout loads, not the link it loaded with", async () => {
    const last = lastSession();
    hold(last);
    const content = await mount(`doc=${docs.get("A")}`, last);
    // Still no layout: the last session is held back.
    expect((await layoutHandle()).doc()?.layout ?? null).toBeNull();
    expect(content.querySelector(".tile-panel")).toBeNull();

    // A link changes the address while the layout is loading.
    await act(async () => {
      window.location.hash = serializeHashParams(
        new URLSearchParams({ ...Object.fromEntries(hashParams()), doc: docs.get("B")! }),
      );
    });
    await act(() => sleep(50));
    expect((await layoutHandle()).doc()?.layout ?? null).toBeNull();

    await act(async () => release());
    for (let i = 0; i < 60 && !content.querySelector(".tile-panel"); i++) {
      await act(() => sleep(100));
    }
    await act(() => sleep(50));
    expect(await panels()).toEqual(["[B*]"]);
    expect(hashParams().get("doc")).toBe(docs.get("B"));
  }, 15_000);

  it("opens a link that names a document by its bare id, and names it in full", async () => {
    const c = docs.get("C")!;
    const content = await mount(`doc=${parseAutomergeUrl(c).documentId}`, lastSession());
    for (let i = 0; i < 60 && !content.querySelector(".tile-panel"); i++) {
      await act(() => sleep(100));
    }
    await act(() => sleep(50));
    expect(await panels()).toEqual(["[C*]"]);
    expect(hashParams().get("doc")).toBe(c);
    expect(window.location.hash).toBe(`#${serializeHashParams(hashParams())}`);
  }, 15_000);
});
