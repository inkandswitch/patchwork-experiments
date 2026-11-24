// Smoke test of the UI in jsdom (no layout): mounts the tool on the example
// graph and drives it with synthetic pointer events.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseDrawio } from "../src/drawio";
import type { GraphDoc } from "../src/model";
import Tool from "../src/tool";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) =>
    setTimeout(fn, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  const proto = HTMLElement.prototype as any;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.hasPointerCapture = () => false;
});

function fakeHandle(initial: GraphDoc) {
  let doc = initial;
  const listeners = new Set<() => void>();
  return {
    url: "automerge:test" + Math.random(),
    doc: () => doc,
    change(fn: (d: GraphDoc) => void) {
      const draft = structuredClone(doc);
      fn(draft);
      expect(JSON.stringify(draft)).toBe(
        JSON.stringify(JSON.parse(JSON.stringify(draft))),
      ); // no undefined
      doc = draft;
      listeners.forEach((l) => l());
    },
    on: (_: "change", l: () => void) => void listeners.add(l),
    off: (_: "change", l: () => void) => void listeners.delete(l),
  };
}

const pointer = (el: Element, type: string, x = 0, y = 0, extra: object = {}) =>
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      ...extra,
    }),
  );
const click = (el: Element, x = 0, y = 0) => {
  pointer(el, "pointerdown", x, y);
  pointer(el, "pointerup", x, y);
};

async function mount(pageId: string) {
  const xml = readFileSync(
    resolve(__dirname, "../examples/p1-graph.drawio"),
    "utf8",
  );
  const all = await parseDrawio(xml);
  const handle = fakeHandle({
    title: "t",
    diagrams: [
      all.find((d) => d.id === pageId)!,
      all.find((d) => d.id === "z9")!,
    ],
  });
  const el = document.createElement("div");
  document.body.append(el);
  const dispose = Tool(handle, el);
  const node = (id: string) =>
    el.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  const button = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent!.trim() === label,
    )!;
  const cell = (id: string) =>
    handle.doc().diagrams[0].cells.find((c) => c.id === id);
  return { handle, el, dispose, node, button, cell };
}

describe("tool UI", () => {
  it("renders, collapses and expands with the toggle, zooms and zooms out", async () => {
    vi.useFakeTimers();
    const t = await mount("cmb");
    expect(t.el.querySelectorAll(".ag-node").length).toBe(83);
    expect(t.el.querySelectorAll(".ag-edge").length).toBe(
      t.handle.doc().diagrams[0].cells.filter((c) => c.edge).length,
    );
    expect(t.node("cmb_Wrf")!.dataset.kind).toBe("untrusted");
    expect(t.node("cmb_Wrf")!.innerHTML).toContain("<b>Attestation</b>");
    expect(t.el.querySelector(".ag-edge-line")!.getAttribute("d")).toMatch(
      /^M135 190 L135 270 L303 270$/,
    );

    // the toggle on a gate collapses it into a single node
    const fold = (id: string) => click(t.node(id)!.querySelector(".ag-fold")!);
    expect(t.node("cmb_Wrf")!.querySelector(".ag-fold")).toBeNull();
    for (const id of ["cmb_gW", "cmb_gA", "cmb_Zo"]) fold(id);
    expect(t.node("cmb_gW")!.hasAttribute("data-collapsed")).toBe(true);
    expect(t.node("cmb_gW")!.querySelector(".ag-heading")!.textContent).toBe(
      "AND: 2 inputs",
    );
    expect(t.node("cmb_Zo")!.querySelector(".ag-heading")!.textContent).toBe(
      "OR: 3 paths",
    );
    expect(t.node("cmb_Zo")!.querySelector(".ag-title")!.textContent).toContain(
      "zkTLS path",
    );
    expect(t.node("cmb_gA")!.hasAttribute("data-holds")).toBe(true);
    expect(t.node("cmb_Wrf")).toBeNull();
    expect(t.el.querySelectorAll(".ag-node").length).toBeLessThan(40);
    expect(t.node("cmb_gW")!.querySelector(".ag-caption")!.textContent).toBe(
      "[in1–in9]",
    );

    // a plain click on a collapsed node chooses it as the path; it stays collapsed
    click(t.node("cmb_gW")!);
    expect(t.node("cmb_gW")!.hasAttribute("data-collapsed")).toBe(true);
    expect(t.node("cmb_gW")!.hasAttribute("data-path")).toBe(true);
    vi.advanceTimersByTime(600);
    fold("cmb_gW");
    expect(t.node("cmb_gW")!.hasAttribute("data-collapsed")).toBe(false);
    expect(t.node("cmb_Wrf")).not.toBeNull();
    expect(t.node("cmb_Zrf")).toBeNull();

    // double-click a folded node: zoom into it
    click(t.node("cmb_Zo")!);
    vi.advanceTimersByTime(50);
    click(t.node("cmb_Zo")!);
    vi.advanceTimersByTime(300);
    expect(t.node("cmb_Zrf")).not.toBeNull();
    expect(t.node("cmb_Wrf")).toBeNull();
    expect(t.node("cmb_Zo")!.querySelector(".ag-fold")).toBeNull(); // the zoomed node stays open
    expect(t.node("cmb_E")).toBeNull();
    expect(t.node("__zoom_output__")!.textContent).toContain("zkTLS path");
    expect(t.button("← Out one level")).toBeTruthy();

    // zoom deeper via the toolbar, then out one level, then all the way
    click(t.node("cmb_ZF")!);
    t.button("Zoom in").click();
    expect(t.node("cmb_Zrl")).toBeNull();
    expect(t.node("cmb_Zrf")).not.toBeNull();
    t.button("← Out one level").click();
    expect(t.node("cmb_Zrl")).not.toBeNull();
    t.button("⇤ All the way out").click();
    expect(t.node("cmb_E")).not.toBeNull();
    expect(t.node("cmb_Zo")!.hasAttribute("data-collapsed")).toBe(true); // still folded outside
    expect(t.node("cmb_gW")!.hasAttribute("data-path")).toBe(true); // the double-click did not change the choice
    fold("cmb_gA");
    fold("cmb_Zo");
    expect(t.el.querySelectorAll(".ag-node").length).toBe(83);
    t.dispose();
    vi.useRealTimers();
  });

  it("highlights the decided path and the chosen OR inputs", async () => {
    vi.useFakeTimers();
    const t = await mount("cmb");
    const onPath = () =>
      [...t.el.querySelectorAll<HTMLElement>(".ag-node[data-path]")]
        .map((n) => n.dataset.nodeId)
        .sort();
    expect(onPath()).toEqual([
      "cmb_Bm",
      "cmb_Dl",
      "cmb_E",
      "cmb_gF",
      "cmb_top",
    ]);
    expect(t.el.querySelectorAll(".ag-edge[data-path]").length).toBe(4);

    click(t.node("cmb_gW")!);
    vi.advanceTimersByTime(300);
    click(t.node("cmb_WcA")!);
    vi.advanceTimersByTime(300);
    expect(onPath()).toContain("cmb_Wrf");
    expect(onPath()).toContain("cmb_Wm");
    expect(onPath()).not.toContain("cmb_WcB");
    expect(onPath().length).toBe(17);
    expect(t.el.querySelectorAll(".ag-edge[data-path]").length).toBe(16);

    // a neighbour at the same OR takes over
    click(t.node("cmb_gA")!);
    vi.advanceTimersByTime(300);
    expect(onPath()).toEqual([
      "cmb_A4",
      "cmb_A5",
      "cmb_Bm",
      "cmb_Dl",
      "cmb_E",
      "cmb_gA",
      "cmb_gF",
      "cmb_top",
    ]);
    expect(t.button("Clear choice")).toBeTruthy();
    t.button("Clear choice").click();
    expect(onPath().length).toBe(5);
    t.dispose();
    vi.useRealTimers();
  });

  it("lists evidence bundles; hovering previews a path and clicking chooses it", async () => {
    const t = await mount("cmb");
    const onPath = () => t.el.querySelectorAll(".ag-node[data-path]").length;
    expect(t.el.querySelector(".ag-drawer")).toBeNull();
    t.button("Evidence bundles (7)").click();
    const rows = [
      ...t.el.querySelectorAll<HTMLElement>(".ag-bundles tbody tr"),
    ];
    expect(rows.length).toBe(7);
    expect(t.el.querySelectorAll(".ag-bundles th[data-bit]").length).toBe(13);
    const digits = (r: HTMLElement) =>
      [...r.querySelectorAll("td[data-bit]")]
        .map((c) => c.textContent)
        .join("");
    const matched = rows.find((r) => digits(r) === "1111101010011")!;
    const none = rows.find((r) => digits(r) === "0000010100011")!;

    expect(onPath()).toBe(5);
    pointer(matched, "pointerenter");
    expect(onPath()).toBe(17);
    expect(t.node("cmb_Wm")!.hasAttribute("data-path")).toBe(true);
    pointer(none, "pointerenter");
    expect(onPath()).toBe(8);
    pointer(matched.parentElement!, "pointerleave");
    expect(onPath()).toBe(5); // nothing chosen yet: back to the decided part

    matched.click();
    pointer(matched.parentElement!, "pointerleave");
    expect(onPath()).toBe(17);
    expect(matched.hasAttribute("data-active")).toBe(true);
    pointer(none, "pointerenter");
    expect(onPath()).toBe(8);
    expect(none.hasAttribute("data-active")).toBe(false);
    pointer(none.parentElement!, "pointerleave");
    expect(onPath()).toBe(17); // the chosen path is shown again

    t.el
      .querySelector<HTMLButtonElement>(".ag-bundles th[data-close] button")!
      .click();
    expect(t.el.querySelector(".ag-drawer")).toBeNull();
    expect(onPath()).toBe(17);
    t.dispose();
  });

  it("renames a collapsed node through the label beside it", async () => {
    const t = await mount("cmb");
    const fold = (id: string) => click(t.node(id)!.querySelector(".ag-fold")!);
    const rename = (id: string, text: string) => {
      const title = t.node(id)!.querySelector(".ag-title")!;
      click(title);
      click(title); // double-click on the title
      const editor = t
        .node(id)!
        .querySelector<HTMLElement>("[contenteditable]")!;
      editor.textContent = text;
      editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      editor.dispatchEvent(new FocusEvent("blur"));
    };

    // a gate with an "establishes:" label: the label is rewritten, prefix kept
    fold("cmb_Wo");
    expect(t.node("cmb_Wo")!.querySelector(".ag-heading")!.textContent).toBe(
      "OR: 3 paths",
    );
    rename("cmb_Wo", "print witness");
    expect(t.cell("cmb_WlO")!.value).toBe("establishes: print witness");
    expect(t.node("cmb_Wo")!.querySelector(".ag-title")!.textContent).toBe(
      "print witness",
    );
    expect(t.cell("cmb_Wo")!.value).toBe("OR");

    // a gate with no label is "Untitled"; naming it creates the label
    fold("cmb_Wo"); // open it again to reach the gates inside
    fold("cmb_WcA");
    const title = t.node("cmb_WcA")!.querySelector(".ag-title")!;
    expect(title.textContent).toBe("Untitled");
    rename("cmb_WcA", "both attested");
    expect(t.cell("cmb_WcA_note")!.value).toBe("both attested");
    expect(t.node("cmb_WcA")!.querySelector(".ag-title")!.textContent).toBe(
      "both attested",
    );
    fold("cmb_WcA");
    expect(t.node("cmb_WcA_note")!.textContent).toBe("both attested");
    t.dispose();
  });

  it("adds labels, and copies and pastes nodes and labels", async () => {
    const t = await mount("cmb");
    const cells = () => t.handle.doc().diagrams[0].cells;
    const added = (before: Set<string>) =>
      cells().filter((c) => !before.has(c.id));
    const ids = () => new Set(cells().map((c) => c.id));
    const root = t.el.querySelector(".attestation-graph")!;
    const clip = (type: string) =>
      root.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    const typeInto = (text: string) => {
      const editor = t.el.querySelector<HTMLElement>("[contenteditable]")!;
      editor.textContent = text;
      editor.dispatchEvent(new FocusEvent("blur"));
    };

    // a free label: created, edited straight away
    let before = ids();
    t.button("TLabel").click();
    typeInto("a note");
    let [label] = added(before);
    expect(label.value).toBe("a note");
    expect(label.style.startsWith("text")).toBe(true);
    expect(t.node(label.id)!.dataset.kind).toBe("text");

    // with a gate selected the label is attached to it, and names it
    click(t.node("cmb_WcA")!);
    t.button("TLabel").click();
    typeInto("both attested");
    expect(t.cell("cmb_WcA_note")!.value).toBe("both attested");
    click(t.node("cmb_WcA")!.querySelector(".ag-fold")!);
    expect(t.node("cmb_WcA")!.querySelector(".ag-title")!.textContent).toBe(
      "both attested",
    );
    click(t.node("cmb_WcA")!.querySelector(".ag-fold")!);

    // emptying a label removes it
    click(t.node(label.id)!);
    click(t.node(label.id)!);
    typeInto("");
    expect(t.cell(label.id)).toBeUndefined();

    // copy a block: its "in" name comes along; pasting twice does not stack
    click(t.node("cmb_Wh")!);
    clip("copy");
    before = ids();
    clip("paste");
    let pasted = added(before);
    expect(pasted.map((c) => c.id.replace(/^c[a-z0-9]+_/, "")).sort()).toEqual([
      "cmb_Wh",
      "cmb_Wh_l",
    ]);
    const copy = pasted.find((c) => c.id.endsWith("cmb_Wh"))!;
    expect(copy.x).toBe(t.cell("cmb_Wh")!.x! + 20);
    expect(copy.value).toBe(t.cell("cmb_Wh")!.value);
    expect(t.node(copy.id)!.hasAttribute("data-selected")).toBe(true);
    before = ids();
    clip("paste");
    expect(added(before).find((c) => c.id.endsWith("cmb_Wh"))!.x).toBe(
      t.cell("cmb_Wh")!.x! + 40,
    );

    // copy two connected nodes: the edge between them is copied, others are not
    click(t.node("cmb_WF")!);
    pointer(t.node("cmb_Wrf")!, "pointerdown", 0, 0, { shiftKey: true });
    pointer(t.node("cmb_Wrf")!, "pointerup", 0, 0, { shiftKey: true });
    clip("copy");
    before = ids();
    clip("paste");
    pasted = added(before);
    expect(pasted.filter((c) => c.edge).length).toBe(1);
    const edge = pasted.find((c) => c.edge)!;
    expect(
      pasted.some((c) => c.id === edge.source) &&
        pasted.some((c) => c.id === edge.target),
    ).toBe(true);

    // a label on its own can be copied too
    click(t.node("cmb_lT")!);
    clip("copy");
    before = ids();
    clip("paste");
    expect(added(before).map((c) => c.value)).toEqual([
      t.cell("cmb_lT")!.value,
    ]);

    // cut removes the original
    click(t.node(copy.id)!);
    clip("cut");
    expect(t.cell(copy.id)).toBeUndefined();
    t.dispose();
  });

  it("moves, toggles trust, edits, adds, connects and deletes", async () => {
    vi.useFakeTimers();
    const t = await mount("cmb");
    // drag a block: its label travels, the document updates on release
    const n = t.node("cmb_Wrf")!;
    pointer(n, "pointerdown", 100, 100);
    pointer(n, "pointermove", 130, 142);
    expect(n.style.left).toBe("70px");
    pointer(n, "pointerup", 130, 142);
    expect([t.cell("cmb_Wrf")!.x, t.cell("cmb_Wrf")!.y]).toEqual([70, 130]);
    expect([t.cell("cmb_Wrf_l")!.x, t.cell("cmb_Wrf_l")!.y]).toEqual([
      140, 106,
    ]);
    expect(t.cell("cmb_We1")!.points).toBeUndefined();

    t.button("Trusted ⇄ Untrusted").click();
    expect(t.node("cmb_Wrf")!.dataset.kind).toBe("trusted");
    expect(t.cell("cmb_Wrf")!.style).toContain("fillColor=#d5e8d4");

    // double-click to edit
    click(t.node("cmb_Wrf")!);
    click(t.node("cmb_Wrf")!);
    vi.advanceTimersByTime(10);
    const editor = t
      .node("cmb_Wrf")!
      .querySelector<HTMLElement>("[contenteditable]")!;
    expect(editor).not.toBeNull();
    editor.innerHTML =
      '<b>New</b> text<img src=x onerror="alert(1)"><script>bad()</script>';
    editor.dispatchEvent(new FocusEvent("blur"));
    expect(t.cell("cmb_Wrf")!.value).toBe("<b>New</b> text");

    // add a block as an input of the selected gate
    click(t.node("cmb_gA")!);
    t.button("Untrusted").click();
    const edges = t.handle
      .doc()
      .diagrams[0].cells.filter((c) => c.edge && c.target === "cmb_gA");
    expect(edges.length).toBe(3);
    const added = edges[2].source!;
    expect(t.node(added)!.dataset.kind).toBe("untrusted");
    expect(t.node(added)!.hasAttribute("data-selected")).toBe(true);
    expect(t.node(added + "_l")!.textContent).toBe("in14");

    // wire it into another gate by dragging from its port
    (document as any).elementsFromPoint = () => [t.node("cmb_gF")!];
    pointer(t.node(added)!.querySelector("[data-port]")!, "pointerdown", 5, 5);
    pointer(t.el.querySelector(".ag-canvas")!, "pointermove", 50, 50);
    expect(t.node("cmb_gF")!.hasAttribute("data-drop-target")).toBe(true);
    pointer(t.el.querySelector(".ag-canvas")!, "pointerup", 50, 50);
    expect(
      t.handle
        .doc()
        .diagrams[0].cells.some(
          (c) => c.edge && c.source === added && c.target === "cmb_gF",
        ),
    ).toBe(true);

    // delete it again (edges and label go too)
    click(t.node(added)!);
    t.el
      .querySelector(".attestation-graph")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    expect(t.cell(added)).toBeUndefined();
    expect(t.cell(added + "_l")).toBeUndefined();
    expect(
      t.handle.doc().diagrams[0].cells.some((c) => c.source === added),
    ).toBe(false);
    t.dispose();
    vi.useRealTimers();
  });

  it("inserts an existing graph by automerge URL", async () => {
    const t = await mount("top");
    const z9 = t.handle.doc().diagrams.find((d) => d.id === "z9")!;
    (window as any).repo = {
      find: async () => ({ doc: () => ({ title: "Other", diagrams: [z9] }) }),
    };
    click(t.node("top_in1")!);
    t.button("Existing graph…").click();
    const input = t.el.querySelector<HTMLInputElement>("input[data-wide]")!;
    input.value = "https://patchwork.example/#automerge:4Abc123";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await vi.waitFor(() => expect(t.button("Insert").disabled).toBe(false));
    t.button("Insert").click();
    expect(t.cell("top_in1")).toBeUndefined();
    const feeder = t.handle
      .doc()
      .diagrams[0].cells.find(
        (c) => c.edge && c.target === "top_gW" && c.source !== "top_in2",
      )!;
    expect(feeder.source!.endsWith("_z9_g")).toBe(true);
    expect(t.node(feeder.source!)!.hasAttribute("data-selected")).toBe(true);
    t.dispose();
  });
});
