// The tool's side of comments in jsdom: the Comment button, the focus
// selection it writes, the outline and ring it draws, and revealing a page.
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cellRefUrl, type CommentEntry, type FocusDoc, threadRefUrl } from "../src/comments";
import { parseDrawio } from "../src/drawio";
import type { GraphDoc } from "../src/model";
import Tool from "../src/tool";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  const proto = HTMLElement.prototype as any;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.hasPointerCapture = () => false;
});

const URL = "automerge:2ErhaZ1xysyiKADAfYy129tCWPqc";
const ROOT = "automerge:3Wq8xLpRZrtnhUyfFz3Y7vM1aBcd";

type FakeThread = { url: string; refs: string[]; contactUrl: string };

function fakeHandle<T>(url: string, initial: T) {
  let doc = initial;
  const listeners = new Set<() => void>();
  return {
    url,
    doc: () => doc,
    change(fn: (d: T) => void) {
      const draft = structuredClone(doc);
      fn(draft);
      doc = JSON.parse(JSON.stringify(draft)); // no undefined, as automerge
      listeners.forEach((l) => l());
    },
    on: (_: "change", l: () => void) => void listeners.add(l),
    off: (_: "change", l: () => void) => void listeners.delete(l),
  };
}

const click = (el: Element) => {
  for (const type of ["pointerdown", "pointerup"])
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
};

async function mount(opts: { contact?: string; refuse?: boolean } = {}) {
  const xml = readFileSync(resolve(__dirname, "../examples/p1-graph.drawio"), "utf8");
  const all = await parseDrawio(xml);
  const pages = [all.find((d) => d.id === "top")!, all.find((d) => d.id === "z9")!];
  const handle = fakeHandle<GraphDoc>(URL, { title: "t", diagrams: pages });
  const focus = fakeHandle<FocusDoc>("automerge:focus", { selection: {}, highlight: {} });
  (window as any).repo = { find: async () => focus };

  // the frame: answers the tool's subscriptions, keeps the threads (in the
  // root doc, as far as the tool can tell), and hears it ask for the sidebar
  const frame = document.createElement("div");
  const shown: string[] = [];
  const threads: FakeThread[] = [];
  const listings = new Set<(entries: CommentEntry[]) => void>();
  const entries = () =>
    threads.flatMap((t) => t.refs.map((targetUrl) => ({ targetUrl, threadUrl: t.url })));
  const publish = () => listings.forEach((respond) => respond(entries()));
  frame.addEventListener("patchwork:subscribe", (e) => {
    const ev = e as SubscribeEvent;
    const selector = ev.detail.selector;
    const type = selector.type;
    if (type === "patchwork:contact" && opts.contact) accept(ev, (respond) => respond(opts.contact!));
    if (type === "patchwork:focus") accept(ev, (respond) => respond(focus.url));
    if (type === "patchwork:comments" && selector.url === URL)
      accept<CommentEntry[]>(ev, (respond) => {
        listings.add(respond);
        respond(entries());
        return () => listings.delete(respond);
      });
    if (type === "comments:create")
      accept<string | null>(ev, (respond) => {
        if (opts.refuse || !opts.contact) return respond(null);
        const url = threadRefUrl(ROOT, `t${threads.length + 1}`);
        threads.push({ url, refs: selector.refs as string[], contactUrl: opts.contact });
        publish();
        respond(url);
      });
  });
  frame.addEventListener("patchwork:show-comments", (e) =>
    shown.push((e as CustomEvent).detail.threadUrl),
  );
  const el = document.createElement("div");
  frame.append(el);
  document.body.append(frame);
  const dispose = Tool(handle, el);
  const node = (id: string) => el.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  const commentButton = () =>
    [...el.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent!.trim() === "Comment",
    )!;
  return { handle, focus, el, node, commentButton, threads, shown, dispose };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("comments", () => {
  it("can't comment without a contact or a selection", async () => {
    const t = await mount();
    await flush();
    expect(t.commentButton().disabled).toBe(true);
    click(t.node("top_in1")!);
    expect(t.commentButton().disabled).toBe(true);
    expect(t.commentButton().title).toMatch(/contact/);
    t.dispose();
  });

  it("writes the selection to the focus, and comments on it", async () => {
    const t = await mount({ contact: "automerge:me" });
    await vi.waitFor(() => expect(t.commentButton().title).toMatch(/Select/));
    expect(t.commentButton().disabled).toBe(true);

    const a = cellRefUrl(URL, "top", "top_in1");
    const b = cellRefUrl(URL, "top", "top_in2");
    click(t.node("top_in1")!);
    t.node("top_in2")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true }));
    t.node("top_in2")!.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, shiftKey: true }));
    expect(Object.keys(t.focus.doc().selection!).sort()).toEqual([a, b].sort());
    expect(t.commentButton().disabled).toBe(false);

    const before = structuredClone(t.handle.doc());
    t.commentButton().click();
    await vi.waitFor(() => expect(t.threads).toHaveLength(1));
    const [thread] = t.threads;
    expect(thread.refs.sort()).toEqual([a, b].sort());
    expect(thread.contactUrl).toBe("automerge:me");
    // the graph doc isn't written to, and the frame opens the sidebar itself
    expect(t.handle.doc()).toEqual(before);
    expect(t.shown).toHaveLength(0);
    expect(Object.keys(t.focus.doc().selection!).sort()).toEqual([a, b].sort());

    // both nodes are now outlined as commented, from the provider
    await vi.waitFor(() => expect(t.el.querySelectorAll("[data-commented]")).toHaveLength(2));
    const outlined = [...t.el.querySelectorAll<HTMLElement>(".ag-node[data-commented]")];
    expect(outlined.map((x) => x.dataset.nodeId).sort()).toEqual(["top_in1", "top_in2"]);

    // clearing the selection clears the focus selection
    click(t.el.querySelector(".ag-canvas")!);
    expect(t.focus.doc().selection).toEqual({});
    t.dispose();
  });

  it("says so when the frame can't start a thread", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = await mount({ contact: "automerge:me", refuse: true });
    await vi.waitFor(() => expect(t.commentButton().title).toMatch(/Select/));
    click(t.node("top_in1")!);
    t.commentButton().click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(t.threads).toHaveLength(0);
    expect(t.el.querySelectorAll("[data-commented]")).toHaveLength(0);
    expect(t.shown).toHaveLength(0);
    warn.mockRestore();
    t.dispose();
  });

  it("rings what the sidebar focuses, and goes to its page", async () => {
    const t = await mount({ contact: "automerge:me" });
    await vi.waitFor(() => expect(t.commentButton().title).toMatch(/Select/));
    // a cell on this page highlighted
    t.focus.change((d) => {
      d.highlight = { [cellRefUrl(URL, "top", "top_in1")]: true };
    });
    expect(t.node("top_in1")!.hasAttribute("data-comment-focus")).toBe(true);
    expect(t.node("top_in2")!.hasAttribute("data-comment-focus")).toBe(false);

    // a cell on the other page selected: the tool switches to it, and leaves the focus alone
    const z9 = t.handle.doc().diagrams[1];
    const target = z9.cells.find((c) => c.vertex)!;
    const ref = cellRefUrl(URL, "z9", target.id);
    t.focus.change((d) => {
      d.selection = { [ref]: true };
    });
    await vi.waitFor(() => expect(t.node(target.id)).not.toBeNull());
    expect(t.node(target.id)!.hasAttribute("data-comment-focus")).toBe(true);
    expect(Object.keys(t.focus.doc().selection!)).toEqual([ref]);
    t.dispose();
  });
});
