// POPOVER — the pure placement math (portal'd bare-window menus: palette
// overflow, presence flyout). The invariant: the menu opens AWAY from the
// viewport edge its anchor is docked to, and never leaves the viewport.
import { describe, it, expect } from "vitest";
import { placePopover, popoverDirection, openPopover } from "../src/popover.js";

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

  it("reports the direction taken as `side` (the trigger chevron matches it)", () => {
    expect(placePopover({ x: 480, y: 560, w: 40, h: 30 }, { w: 120, h: 100 }, VP).side).toBe("up");
    expect(placePopover({ x: 480, y: 12, w: 40, h: 30 }, { w: 120, h: 100 }, VP).side).toBe("down");
  });

  it("prefer 'right'/'left' opens SIDEWAYS, vertically centred on the anchor (a docked vertical palette)", () => {
    const r = placePopover({ x: 20, y: 280, w: 32, h: 30 }, { w: 140, h: 100 }, VP, 6, "right");
    expect(r.side).toBe("right");
    expect(r.x).toBe(20 + 32 + 6); // just off the anchor's right edge
    expect(r.y).toBe(280 + 15 - 50); // centred on the anchor
    const l = placePopover({ x: 940, y: 280, w: 32, h: 30 }, { w: 140, h: 100 }, VP, 6, "left");
    expect(l.side).toBe("left");
    expect(l.x).toBe(940 - 6 - 140);
  });

  it("a sideways popover FLIPS when the preferred side lacks room, and clamps vertically", () => {
    // anchor hugs the right edge: prefer right has no room → flips left
    const p = placePopover({ x: 960, y: 10, w: 32, h: 30 }, { w: 140, h: 100 }, VP, 6, "right");
    expect(p.side).toBe("left");
    expect(p.x).toBe(960 - 6 - 140);
    expect(p.y).toBe(6); // clamped off the top edge
  });
});

describe("popoverDirection (the closed trigger's glyph)", () => {
  it("an explicit side short-circuits (a docked palette knows its edge)", () => {
    expect(popoverDirection(null, { side: "right" })).toBe("right");
    expect(popoverDirection(null, { side: "left" })).toBe("left");
  });
  it("otherwise the vertical rule: room above the anchor ⇒ up, else down", () => {
    const anchor = {
      closest: () => ({ getBoundingClientRect: () => ({ top: 100 }) }),
      getBoundingClientRect: () => ({ top: 500 }),
    };
    expect(popoverDirection(anchor)).toBe("up"); // 400px above ≥ the estimate
    anchor.getBoundingClientRect = () => ({ top: 130 });
    expect(popoverDirection(anchor)).toBe("down"); // 30px above < the estimate
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

  it("places ROOT-LOCALLY when .ns-root sits at a non-zero page offset (the real host has chrome above/left)", () => {
    // happy-dom rects are all zero — stub the geometry the placement math reads
    const root = document.createElement("div");
    root.className = "ns-root";
    root.getBoundingClientRect = () => ({ left: 300, top: 120, width: 1000, height: 600 });
    const anchor = document.createElement("button");
    // the anchor at page (780, 660) = root-local (480, 540)
    anchor.getBoundingClientRect = () => ({ left: 780, top: 660, width: 40, height: 30 });
    root.append(anchor);
    document.body.append(root);
    const menu = document.createElement("div");
    Object.defineProperty(menu, "offsetWidth", { value: 120 });
    Object.defineProperty(menu, "offsetHeight", { value: 100 });
    let placed = null;
    const close = openPopover({ anchor, menu, onPlace: (p) => { placed = p; } });
    expect(menu.parentElement).toBe(root);
    // root-local: y = 540 - 6 - 100 (opens up), x centred on the anchor — NOT the
    // page-absolute coords (which would land it at the viewport's top-left corner)
    expect(menu.style.top).toBe(`${540 - 6 - 100}px`);
    expect(menu.style.left).toBe(`${480 + 20 - 60}px`);
    expect(placed.side).toBe("up");
    close();
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
