import {
  Repo,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import {
  accept,
  registerRepoProviderElement,
  subscribe,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPatch,
  providePatchLayers,
  type Descriptor,
  type PatchDoc,
} from "../src/layers/index.js";

type Clock = { theme: { accent: string; font: string }; title: string };
type Folder = {
  title: string;
  docs: { name: string; type: string; url: AutomergeUrl; off?: boolean }[];
};

let repo: Repo;
let scratch: Repo;
let clock: DocHandle<Clock>;
const teardowns: (() => void)[] = [];

beforeEach(() => {
  repo = new Repo();
  scratch = new Repo();
  registerRepoProviderElement(repo);
  clock = repo.create<Clock>({
    theme: { accent: "lemon", font: "chicago" },
    title: "clock",
  });
});

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  document.body.replaceChildren();
});

function folderOf(...patches: DocHandle<PatchDoc>[]) {
  return repo.create<Folder>({
    title: "skins",
    docs: patches.map((p, i) => ({
      name: `skin ${i}`,
      type: "patch",
      url: p.url,
    })),
  });
}

function lay(el: HTMLElement, folder: AutomergeUrl | Promise<AutomergeUrl>) {
  teardowns.push(
    providePatchLayers(el, { repo, folder, scratchRepo: scratch, keepFor: 10 })
  );
}

// What a view does with the answers, as an OverlayRepo with scratch backings
// would, short of wrapping the handle: shows `scratchUrl` from the scratch
// repo, leased, while it's live, and `cloneUrl ?? url` otherwise.
function look<T>(consumer: HTMLElement, url: AutomergeUrl) {
  let shown: DocHandle<T> | undefined;
  let lease: (() => void) | undefined;
  let last: Descriptor | undefined;
  let answers = 0;
  const stop = subscribe<Descriptor>(
    consumer,
    { type: "repo:handle-descriptor", url },
    async (descriptor) => {
      const mine = ++answers;
      last = descriptor;
      const next = descriptor.scratchUrl
        ? subscribe(
            consumer,
            { type: "repo:scratch-lease", url: descriptor.scratchUrl },
            () => {}
          )
        : undefined;
      const handle = descriptor.scratchUrl
        ? await scratch.find<T>(descriptor.scratchUrl)
        : await repo.find<T>(descriptor.cloneUrl ?? descriptor.url);
      if (mine !== answers) return next?.();
      const previous = lease;
      shown = handle;
      lease = next;
      previous?.();
    }
  );
  teardowns.push(() => {
    stop();
    lease?.();
  });
  const view = {
    get handle(): DocHandle<T> {
      if (!shown) throw new Error("not answered yet");
      return shown;
    },
    get descriptor(): Descriptor {
      if (!last) throw new Error("not answered yet");
      return last;
    },
    doc: () => view.handle.doc(),
    ready: () => vi.waitFor(() => view.handle),
    letGo() {
      stop();
      lease?.();
      lease = undefined;
    },
  };
  return view;
}

// <repo-provider> > ...providers > consumer, each provider a plain element
// laying one folder.
function mount(...folders: DocHandle<Folder>[]) {
  let parent: HTMLElement = document.createElement("repo-provider");
  document.body.append(parent);
  for (const folder of folders) {
    const el = document.createElement("div");
    parent.append(el);
    lay(el, folder.url);
    parent = el;
  }
  const consumer = document.createElement("div");
  parent.append(consumer);
  return consumer;
}

// A remapper answering `url` with `cloneUrl`, the way a draft does.
function remapper(map: Map<AutomergeUrl, AutomergeUrl>) {
  const el = document.createElement("div");
  el.addEventListener("patchwork:subscribe", (event: SubscribeEvent) => {
    if (event.detail.selector.type !== "repo:handle-descriptor") return;
    const url = event.detail.selector.url as AutomergeUrl;
    const cloneUrl = map.get(url);
    accept<Descriptor>(event, (respond) =>
      respond(cloneUrl ? { url, cloneUrl } : { url })
    );
  });
  return el;
}

describe("providePatchLayers", () => {
  it("lays a folder's patches over documents resolved beneath it", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const view = look<Clock>(mount(folderOf(skin)), clock.url);
    await view.ready();
    expect(view.descriptor.url).toBe(clock.url);
    expect(view.doc().theme.accent).toBe("cherry");
    expect(repo.handles[view.handle.documentId]).toBeUndefined();

    view.handle.change((d) => {
      d.title = "cat clock";
    });
    expect(clock.doc().title).toBe("cat clock");
    expect(clock.doc().theme.accent).toBe("lemon");
  });

  it("passes documents no patch is on straight through", async () => {
    const other = repo.create({ n: 1 });
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const view = look<{ n: number }>(mount(folderOf(skin)), other.url);
    await view.ready();
    expect(view.descriptor).toEqual({ url: other.url });
  });

  it("re-lays live when a patch is added to or taken out of the folder", async () => {
    const folder = folderOf();
    const view = look<Clock>(mount(folder), clock.url);
    await view.ready();
    expect(view.doc().theme.accent).toBe("lemon");

    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    folder.change((d) => {
      d.docs.push({ name: "skin", type: "patch", url: skin.url });
    });
    await vi.waitFor(() => expect(view.doc().theme.accent).toBe("cherry"));

    folder.change((d) => {
      d.docs.splice(0, 1);
    });
    await vi.waitFor(() => expect(view.doc().theme.accent).toBe("lemon"));
  });

  it("skips links switched off, and lays them again when switched on", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const folder = folderOf(skin);
    const view = look<Clock>(mount(folder), clock.url);
    await view.ready();
    expect(view.doc().theme.accent).toBe("cherry");

    folder.change((d) => {
      d.docs[0].off = true;
    });
    await vi.waitFor(() => expect(view.doc().theme.accent).toBe("lemon"));

    folder.change((d) => {
      delete d.docs[0].off;
    });
    await vi.waitFor(() => expect(view.doc().theme.accent).toBe("cherry"));
  });

  it("stacks: the nearer provider's patches go in front", async () => {
    const far = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
      { path: ["theme", "font"], value: "monaco" },
    ]);
    const near = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "plum" },
    ]);
    const view = look<Clock>(
      mount(folderOf(far), folderOf(near)),
      clock.url
    );
    await view.ready();
    expect(view.doc().theme).toEqual({ accent: "plum", font: "monaco" });

    view.handle.change((d) => {
      d.theme.font = "geneva";
    });
    expect(far.doc().patches[1].value).toBe("geneva");
    expect(clock.doc().theme.font).toBe("chicago");
  });

  it("shares one layered doc between views laying the same patches", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const consumer = mount(folderOf(skin));
    const sibling = document.createElement("div");
    consumer.after(sibling);
    const a = look<Clock>(consumer, clock.url);
    const b = look<Clock>(sibling, clock.url);
    await a.ready();
    await b.ready();
    a.handle.change((d) => {
      d.theme.accent = "plum";
    });
    expect(b.doc().theme.accent).toBe("plum");
    expect(Object.keys(scratch.handles)).toHaveLength(1);
  });

  it("waits for a folder given as a promise", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    let give!: (url: AutomergeUrl) => void;
    const folder = new Promise<AutomergeUrl>((resolve) => (give = resolve));
    const root = document.createElement("repo-provider");
    const el = document.createElement("div");
    const consumer = document.createElement("div");
    document.body.append(root);
    root.append(el);
    el.append(consumer);
    lay(el, folder);

    const view = look<Clock>(consumer, clock.url);
    give(folderOf(skin).url);
    await view.ready();
    expect(view.doc().theme.accent).toBe("cherry");
  });

  it("finds patch docs unremapped, past any remapper above", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const decoy = repo.clone(skin);
    decoy.change((d) => {
      d.patches[0].value = "decoy";
    });
    const root = document.createElement("repo-provider");
    const above = remapper(new Map([[skin.url, decoy.url]]));
    const el = document.createElement("div");
    const consumer = document.createElement("div");
    document.body.append(root);
    root.append(above);
    above.append(el);
    el.append(consumer);
    lay(el, folderOf(skin).url);

    const view = look<Clock>(consumer, clock.url);
    await view.ready();
    expect(view.doc().theme.accent).toBe("cherry");
  });

  it("lays patches over a draft's clone, and keeps its cloneUrl", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const fork = repo.clone(clock);
    fork.change((d) => {
      d.title = "forked";
    });
    const root = document.createElement("repo-provider");
    const draft = remapper(new Map([[clock.url, fork.url]]));
    const el = document.createElement("div");
    const consumer = document.createElement("div");
    document.body.append(root);
    root.append(draft);
    draft.append(el);
    el.append(consumer);
    lay(el, folderOf(skin).url);

    const view = look<Clock>(consumer, clock.url);
    await view.ready();
    expect(view.descriptor.cloneUrl).toBe(fork.url);
    expect(view.doc()).toMatchObject({
      title: "forked",
      theme: { accent: "cherry" },
    });

    view.handle.change((d) => {
      d.title = "forked again";
    });
    expect(fork.doc().title).toBe("forked again");
    expect(clock.doc().title).toBe("clock");
  });

  it("passes an answer pinned to heads through unpatched", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const checkpoint = stringifyAutomergeUrl({
      documentId: clock.documentId,
      heads: clock.heads(),
    });
    const root = document.createElement("repo-provider");
    const draft = remapper(new Map([[clock.url, checkpoint]]));
    const el = document.createElement("div");
    const consumer = document.createElement("div");
    document.body.append(root);
    root.append(draft);
    draft.append(el);
    el.append(consumer);
    lay(el, folderOf(skin).url);

    const view = look<Clock>(consumer, clock.url);
    await view.ready();
    expect(view.descriptor).toEqual({ url: clock.url, cloneUrl: checkpoint });
    expect(Object.keys(scratch.handles)).toHaveLength(0);
  });
});

describe("layered doc lifetimes", () => {
  it("keeps a re-laid view's old layered doc until it lets go, then deletes it", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const skin2 = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "plum" },
    ]);
    const folder = folderOf(skin);
    const view = look<Clock>(mount(folder), clock.url);
    await view.ready();
    const first = view.handle.documentId;

    folder.change((d) => {
      d.docs.push({ name: "skin 2", type: "patch", url: skin2.url });
    });
    await vi.waitFor(() => expect(view.doc().theme.accent).toBe("plum"));
    await vi.waitFor(() => expect(scratch.handles[first]).toBeUndefined());
    expect(Object.keys(scratch.handles)).toEqual([view.handle.documentId]);
  });

  it("deletes every layered doc once no view holds one", async () => {
    const far = createPatch(repo, clock, [
      { path: ["theme", "font"], value: "monaco" },
    ]);
    const near = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "plum" },
    ]);
    const view = look<Clock>(
      mount(folderOf(far), folderOf(near)),
      clock.url
    );
    await view.ready();
    // The near provider's, laid over the far one's.
    expect(Object.keys(scratch.handles)).toHaveLength(2);

    view.letGo();
    await vi.waitFor(() =>
      expect(Object.keys(scratch.handles)).toHaveLength(0)
    );
  });

  it("keeps a layered doc a view still leases after its provider goes, until it lets go", async () => {
    const skin = createPatch(repo, clock, [
      { path: ["theme", "accent"], value: "cherry" },
    ]);
    const root = document.createElement("repo-provider");
    const el = document.createElement("div");
    const consumer = document.createElement("div");
    document.body.append(root);
    root.append(el);
    el.append(consumer);
    const stop = providePatchLayers(el, {
      repo,
      folder: folderOf(skin).url,
      scratchRepo: scratch,
      keepFor: 10,
    });
    const view = look<Clock>(consumer, clock.url);
    await view.ready();

    stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scratch.handles[view.handle.documentId]).toBeDefined();
    view.letGo();
    await vi.waitFor(() =>
      expect(Object.keys(scratch.handles)).toHaveLength(0)
    );
  });
});
