// PRESENCE as a bare window — the bar/controls half (the cursor/view layer
// stays canvas-level in brush/ui/presence.jsx). Face chips per peer, a USER
// (person) button — not an eyeball — opening a flyout with the views toggle +
// per-peer follow, all over plain context Sources (raw connects, apply writes).
import { describe, it, expect } from "vitest";
import { mountPresence, plugin, USER_ICON_PATH } from "../src/presence-node.js";

function stubSource(initial) {
  let val = initial;
  const cbs = new Set();
  const s = {
    get value() { return val; },
    connect(cb) { cbs.add(cb); cb({ type: "snapshot", value: val }); return () => cbs.delete(cb); },
    set(v) { val = v; for (const cb of [...cbs]) cb({ type: "snapshot", value: v }); },
    apply(op) { if (op && op.type === "snapshot") s.set(op.value); },
  };
  return s;
}

const PEERS = [
  { contactUrl: "automerge:alice", name: "Alice", color: "#f0f" },
  { contactUrl: "automerge:bob", name: "Bob", color: "#0ff", avatarUrl: "automerge:avatar" },
];

function mount({ peers = [], inlets } = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const context = {
    peers: stubSource(peers),
    showViews: stubSource(false),
    following: stubSource(null),
    serviceUrl: (u) => `sw:${u}`,
  };
  const cleanup = mountPresence({ element, inlets: inlets || {}, context });
  return { element, context, cleanup, done: () => { cleanup(); element.remove(); } };
}

describe("plugin descriptor", () => {
  it("is a BARE (frameless) sketchy:window with an auto-wirable peers inlet", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("presence");
    expect(plugin.bare).toBe(true);
    expect(plugin.inlets).toEqual([{ name: "peers", type: "json" }]);
    expect(plugin.outlets).toEqual([]);
  });
  it("loads to mountPresence", async () => {
    expect(await plugin.load()).toBe(mountPresence);
  });
});

describe("mountPresence", () => {
  it("shows a USER (person) icon — not the old eyeball — with a tooltip", () => {
    const m = mount({ peers: PEERS });
    const btn = m.element.querySelector(".ns-presence-btn");
    expect(btn).toBeTruthy();
    expect(btn.title).toContain("People");
    expect(btn.querySelector("svg path").getAttribute("d")).toBe(USER_ICON_PATH);
    m.done();
  });

  it("renders a face chip per peer (initial + colour; avatar via serviceUrl) with follow tooltips", () => {
    const m = mount({ peers: PEERS });
    const chips = [...m.element.querySelectorAll(".ns-pface-btn")];
    expect(chips.length).toBe(2);
    expect(chips[0].title).toContain("Alice");
    expect(chips[0].querySelector(".ns-pface").textContent).toBe("A");
    expect(chips[1].querySelector(".ns-pface").style.backgroundImage).toContain("sw:automerge:avatar");
    m.done();
  });

  it("the flyout: views toggle writes context.showViews; follow writes context.following (toggle)", () => {
    const m = mount({ peers: PEERS });
    m.element.querySelector(".ns-presence-btn").click();
    // the flyout is PORTAL'd out of the (clipped) bare window to the canvas root
    // (document.body in this bare mount) — never a child of the bar
    expect(m.element.querySelector(".ns-presence-menu")).toBeFalsy();
    const menu = document.querySelector(".ns-presence-menu");
    expect(menu).toBeTruthy();
    expect(document.querySelector(".ns-menu-backdrop")).toBeTruthy(); // click-away closes
    const items = [...menu.querySelectorAll(".ns-presence-item")];
    expect(items[0].title).toBeTruthy(); // tooltips on the flyout controls
    expect(items.every((i) => i.title.length > 0)).toBe(true);
    items[0].click(); // "show everyone's views"
    expect(m.context.showViews.value).toBe(true);
    const alice = [...document.querySelectorAll(".ns-presence-item")].find((i) => i.textContent.includes("Alice"));
    alice.click();
    expect(m.context.following.value).toBe("automerge:alice");
    // clicking again unfollows
    [...document.querySelectorAll(".ns-presence-item")].find((i) => i.textContent.includes("Alice")).click();
    expect(m.context.following.value).toBe(null);
    m.done();
    expect(document.querySelector(".ns-presence-menu")).toBeFalsy(); // cleanup removes the portal
  });

  it("clicking a face chip follows that peer directly", () => {
    const m = mount({ peers: PEERS });
    [...m.element.querySelectorAll(".ns-pface-btn")][1].click();
    expect(m.context.following.value).toBe("automerge:bob");
    expect(m.element.querySelectorAll(".ns-pface-btn")[1].classList.contains("following")).toBe(true);
    m.done();
  });

  it("a WIRED peers inlet wins over the context; live updates re-render", () => {
    const wired = stubSource([PEERS[0]]);
    wired.wired = true;
    const m = mount({ peers: PEERS, inlets: { peers: wired } });
    expect(m.element.querySelectorAll(".ns-pface-btn").length).toBe(1);
    wired.set(PEERS);
    expect(m.element.querySelectorAll(".ns-pface-btn").length).toBe(2);
    m.done();
  });

  it("empty room: no chips, and the flyout says so", () => {
    const m = mount({ peers: [] });
    expect(m.element.querySelectorAll(".ns-pface-btn").length).toBe(0);
    m.element.querySelector(".ns-presence-btn").click();
    expect(document.querySelector(".ns-presence-menu").textContent).toContain("just you here"); // (portal'd)
    m.done();
  });

  it("peer emissions RECONCILE in place: chips keep DOM identity, the open flyout never remounts", () => {
    const m = mount({ peers: PEERS });
    const chip0 = m.element.querySelectorAll(".ns-pface-btn")[0];
    // a peers emission (these arrive up to ~60/s while someone moves) must UPDATE
    // the existing chip, not replace it — a replaced button between pointerdown
    // and click never receives the click
    m.context.peers.set([{ ...PEERS[0], name: "Alicia" }, PEERS[1]]);
    expect(m.element.querySelectorAll(".ns-pface-btn")[0]).toBe(chip0); // same node
    expect(chip0.title).toContain("Alicia");
    // the open flyout survives emissions in place (no dismiss/reopen flicker)
    m.element.querySelector(".ns-presence-btn").click();
    const menu = document.querySelector(".ns-presence-menu");
    const row0 = [...menu.querySelectorAll(".ns-presence-item")].find((i) => i.textContent.includes("Alicia"));
    m.context.peers.set([{ ...PEERS[0], name: "Alice" }, PEERS[1]]);
    expect(document.querySelector(".ns-presence-menu")).toBe(menu); // same popover
    expect(menu.contains(row0)).toBe(true); // same row, updated in place
    expect(row0.textContent).toContain("Alice");
    // a departed peer's chip + row drop out
    m.context.peers.set([PEERS[1]]);
    expect(m.element.querySelectorAll(".ns-pface-btn").length).toBe(1);
    expect([...menu.querySelectorAll(".ns-presence-item")].some((i) => i.textContent.includes("Alice"))).toBe(false);
    m.done();
  });

  it("stops propagation on pointerdown only (the house rule); cleanup removes + disconnects", () => {
    const m = mount({ peers: PEERS });
    let sawDown = 0;
    m.element.addEventListener("pointerdown", () => sawDown++);
    m.element.querySelector(".ns-presence-bar").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(sawDown).toBe(0);
    m.cleanup();
    expect(m.element.querySelector(".ns-presence-bar")).toBeFalsy();
    m.context.peers.set([]); // no listeners left to throw
    m.element.remove();
  });
});
