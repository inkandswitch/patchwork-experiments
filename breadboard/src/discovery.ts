import type { DiscoveredView, PatchworkViewElement } from "./types.js";

function countAncestors(el: Element, tagName: string): number {
  let count = 0;
  let node = el.parentElement;
  while (node) {
    if (node.tagName?.toLowerCase() === tagName) count++;
    node = node.parentElement;
  }
  return count;
}

export function discoverViews(): DiscoveredView[] {
  return Array.from(document.querySelectorAll("patchwork-view")).map((el) => ({
    element: el as PatchworkViewElement,
    toolId: el.getAttribute("tool-id"),
    docUrl: el.getAttribute("doc-url"),
    parent: el.parentElement,
    depth: countAncestors(el, "patchwork-view"),
  }));
}

export function observeViewChanges(callback: () => void): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === "doc-url" || m.attributeName === "tool-id")) {
      callback();
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["doc-url", "tool-id"] });
  return observer;
}
