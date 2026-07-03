// POPOVER — the pure placement math (portal'd bare-window menus: palette
// overflow, presence flyout). The invariant: the menu opens AWAY from the
// viewport edge its anchor is docked to, and never leaves the viewport.
import { describe, it, expect } from "vitest";
import { placePopover, openPopover } from "./popover.js";

const VP = { w: 1000, h: 600 };

describe("placePopover (pure)", () => {
  it("prefers opening ABOVE the anchor (the palette's traditional direction)", () => {
    const p = placePopover({ x: 480, y: 560, w: 40, h: 30 }, { w: 120, h: 100 }, VP);
    expect(p.up).toBe(true);
    expect(p.y).toBe(560 - 6 - 100);
    expect(p.x).toBe(480 + 20 - 60); // centred on the anchor
  });

  it("flips BELOW when the anchor hugs the top edge (a top-docked window)", () => {
    const p = placePopover({ x: 480, y: 12, w: 40, h: 30 }, { w: 120, h: 100 }, VP);
    expect(p.up).toBe(false);
    expect(p.y).toBe(12 + 30 + 6);
  });

  it("clamps horizontally at the left and right edges", () => {
    const left = placePopover({ x: 2, y: 560, w: 40, h: 30 }, { w: 200, h: 100 }, VP);
    expect(left.x).toBe(6); // margin, not negative
    const right = placePopover({ x: 970, y: 560, w: 40, h: 30 }, { w: 200, h: 100 }, VP);
    expect(right.x).toBe(1000 - 200 - 6);
  });

  it("a menu taller than the space below still stays on screen (clamped)", () => {
    const p = placePopover({ x: 480, y: 8, w: 40, h: 30 }, { w: 120, h: 590 }, VP);
    expect(p.up).toBe(false);
    expect(p.y).toBeGreaterThanOrEqual(0);
  });
});

describe("openPopover (DOM portal)", () => {
  it("portals to the nearest .ns-root (else body), closes via backdrop with onClose, and programmatic close skips onClose", () => {
    const root = document.createElement("div");
    root.className = "ns-root";
    const anchor = document.createElement("button");
    root.append(anchor);
    document.body.append(root);
    const menu = document.createElement("div");
    menu.className = "ns-menu";
    let closed = 0;
    const close = openPopover({ anchor, menu, onClose: () => closed++ });
    expect(menu.parentElement).toBe(root); // escaped the widget, inherits theme vars
    expect(root.querySelector(".ns-menu-backdrop")).toBeTruthy();
    expect(menu.style.position).toBe("absolute");
    // backdrop click closes AND notifies
    root.querySelector(".ns-menu-backdrop").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(closed).toBe(1);
    expect(root.querySelector(".ns-menu")).toBeFalsy();
    // a fresh popover closed programmatically does NOT notify (the caller re-renders)
    const menu2 = document.createElement("div");
    const close2 = openPopover({ anchor, menu: menu2, onClose: () => closed++ });
    close2();
    expect(closed).toBe(1);
    expect(root.querySelector(".ns-menu-backdrop")).toBeFalsy();
    close(); // idempotent-ish: already removed, must not throw
    root.remove();
  });

  it("menu pointerdowns are stopped (no marquee/draw through an open menu)", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const menu = document.createElement("div");
    const close = openPopover({ anchor, menu });
    let saw = 0;
    document.body.addEventListener("pointerdown", () => saw++);
    menu.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(saw).toBe(0);
    close();
    anchor.remove();
  });
});
