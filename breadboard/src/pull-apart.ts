import type { DiscoveredView, StyleOriginals } from "./types.js";

export function storeAndSet(originals: StyleOriginals, el: HTMLElement, styles: Record<string, string>): void {
  const existing = originals.get(el) ?? {};
  for (const [prop, value] of Object.entries(styles)) {
    if (!(prop in existing)) existing[prop] = el.style.getPropertyValue(prop);
    el.style.setProperty(prop, value);
  }
  originals.set(el, existing);
}

export function restoreAll(originals: StyleOriginals): void {
  for (const [el, styles] of originals) {
    for (const [prop, value] of Object.entries(styles)) {
      value ? el.style.setProperty(prop, value) : el.style.removeProperty(prop);
    }
  }
  originals.clear();
}

function findFrameContainer(views: DiscoveredView[]): HTMLElement | null {
  const root = views.find((v) => v.depth === 0)?.element;
  return (root?.firstElementChild as HTMLElement) ?? null;
}

function spreadFlexContainers(root: HTMLElement, originals: StyleOriginals): void {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i] as HTMLElement;
    if (!child.style) continue;
    const display = getComputedStyle(child).display;
    if (display.includes("flex") || display.includes("grid")) {
      storeAndSet(originals, child, { gap: "20px", transition: "gap 0.3s ease" });
    }
    spreadFlexContainers(child, originals);
  }
}

export function applyPullApart(views: DiscoveredView[], originals: StyleOriginals): () => void {
  const frame = findFrameContainer(views);
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (frame) {
    storeAndSet(originals, frame, {
      transition: "transform 0.4s ease, gap 0.3s ease 0.2s, padding 0.3s ease 0.2s",
      transform: "scale(0.65)",
      "transform-origin": "center center",
    });

    timer = setTimeout(() => {
      storeAndSet(originals, frame, { gap: "40px", padding: "48px" });
      spreadFlexContainers(frame, originals);
    }, 50);
  }

  for (const v of views) {
    if (v.depth > 0) {
      storeAndSet(originals, v.element, {
        outline: "2px dashed rgba(120, 140, 255, 0.35)",
        "outline-offset": "6px",
        "border-radius": "6px",
        transition: "outline 0.3s ease",
      });
    }
  }

  return () => { if (timer !== null) clearTimeout(timer); };
}
