// The shared layout switcher: lists registered `sketchy:layout`s and re-opens the
// same folder through another lens (patchwork:open-document + toolId). The plugin
// registry is process-global, so tests use unique datatype keys per case.
import { describe, it, expect } from "vitest";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { layoutSwitcher, switchToLayout } from "./layout-switch.js";

const ns = (() => { let n = 0; return (s) => `ls-test-${s}-${n++}`; })();

function register(type, descriptors) {
  registerPlugins(descriptors.map((d) => ({ type: "sketchy:layout", supportedDatatypes: [type], ...d })));
}

describe("switchToLayout", () => {
  it("dispatches a bubbling, composed patchwork:open-document with url + toolId", () => {
    const parent = document.createElement("div");
    const child = document.createElement("div");
    parent.append(child);
    let seen = null;
    parent.addEventListener("patchwork:open-document", (e) => { seen = e; });
    switchToLayout(child, "automerge:folder", "sketchy:dock");
    expect(seen).toBeTruthy();
    expect(seen.detail).toEqual({ url: "automerge:folder", toolId: "sketchy:dock" });
    expect(seen.bubbles).toBe(true);
    expect(seen.composed).toBe(true);
  });
});

describe("layoutSwitcher", () => {
  it("returns null when fewer than two layouts exist for the type", () => {
    const t0 = ns("none");
    expect(layoutSwitcher(document.createElement("div"), "automerge:f", "x", t0)).toBe(null);
    const t1 = ns("one");
    register(t1, [{ id: ns("solo"), name: "Solo", toolId: "tool:solo" }]);
    expect(layoutSwitcher(document.createElement("div"), "automerge:f", "tool:solo", t1)).toBe(null);
  });

  it("renders one button per layout, with the active one marked", () => {
    const type = ns("two");
    register(type, [
      { id: ns("a"), name: "Alpha", toolId: "tool:a" },
      { id: ns("b"), name: "Beta", toolId: "tool:b" },
    ]);
    const sw = layoutSwitcher(document.createElement("div"), "automerge:f", "tool:a", type);
    expect(sw).toBeTruthy();
    const btns = [...sw.querySelectorAll("button")];
    expect(btns.map((b) => b.textContent)).toEqual(["Alpha", "Beta"]);
    // the active button is styled differently (filled) from the inactive one
    expect(btns[0].getAttribute("style")).not.toBe(btns[1].getAttribute("style"));
  });

  it("clicking another layout dispatches the switch; clicking the active one does not", () => {
    const type = ns("click");
    register(type, [
      { id: ns("a"), name: "A", toolId: "tool:a" },
      { id: ns("b"), name: "B", toolId: "tool:b" },
    ]);
    const host = document.createElement("div");
    const element = document.createElement("div");
    host.append(element);
    const events = [];
    host.addEventListener("patchwork:open-document", (e) => events.push(e.detail));
    const sw = layoutSwitcher(element, "automerge:folder", "tool:a", type);
    const [active, other] = sw.querySelectorAll("button");
    active.click();
    expect(events.length).toBe(0); // already here — no re-open
    other.click();
    expect(events).toEqual([{ url: "automerge:folder", toolId: "tool:b" }]);
  });
});
