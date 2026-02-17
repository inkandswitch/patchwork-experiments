import type { Repo } from "@automerge/automerge-repo";
import type { DiscoveredView } from "./types.js";

function center(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function spawnDot(svg: SVGSVGElement, fx: number, fy: number, tx: number, ty: number, color: string): void {
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("r", "3");
  c.setAttribute("fill", color);
  svg.appendChild(c);

  const start = performance.now();
  const ox = (Math.random() - 0.5) * 8;
  const oy = (Math.random() - 0.5) * 8;

  const tick = (now: number) => {
    const t = Math.min((now - start) / 600, 1);
    const e = 1 - (1 - t) ** 3;
    c.setAttribute("cx", String(fx + (tx - fx) * e + ox * (1 - e)));
    c.setAttribute("cy", String(fy + (ty - fy) * e + oy * (1 - e)));
    c.setAttribute("opacity", String(1 - t * 0.7));
    t < 1 ? requestAnimationFrame(tick) : c.remove();
  };
  requestAnimationFrame(tick);
}

export function startSyncMonitor(
  svg: SVGSVGElement,
  overlay: HTMLElement,
  views: DiscoveredView[],
  cardLookup: Map<string, HTMLElement>,
  repo: Repo
): () => void {
  const netNode = document.createElement("div");
  netNode.style.cssText = `
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: rgba(18,18,30,0.94); color: #aab; font: 10px/1.5 "SF Mono", monospace;
    padding: 4px 12px; border-radius: 12px; z-index: 10000; pointer-events: none;
    border: 1px solid rgba(120,140,255,0.2); transition: border-color 0.3s;
  `;
  netNode.textContent = "network";
  overlay.appendChild(netNode);

  const pulse = () => {
    netNode.style.borderColor = "rgba(120, 180, 255, 0.6)";
    setTimeout(() => { netNode.style.borderColor = "rgba(120, 140, 255, 0.2)"; }, 300);
  };

  // Map each unique doc URL to the set of cards that display it
  const urlToCards = new Map<string, Set<HTMLElement>>();
  for (const v of views) {
    if (!v.docUrl) continue;
    if (v.depth > 0) {
      const key = v.toolId ? `tool:${v.toolId}` : `doc:${v.docUrl}`;
      const card = cardLookup.get(key);
      if (card) {
        let s = urlToCards.get(v.docUrl);
        if (!s) { s = new Set(); urlToCards.set(v.docUrl, s); }
        s.add(card);
      }
    }
    // Ensure depth-0 doc URLs are still subscribed
    if (v.depth === 0 && !urlToCards.has(v.docUrl)) {
      urlToCards.set(v.docUrl, new Set());
    }
  }

  // Backfill: depth-0 URLs with no cards get cards from deeper views sharing the URL
  for (const [url, cards] of urlToCards) {
    if (cards.size > 0) continue;
    for (const v of views) {
      if (v.depth > 0 && v.docUrl === url) {
        const key = v.toolId ? `tool:${v.toolId}` : `doc:${v.docUrl}`;
        const card = cardLookup.get(key);
        if (card) cards.add(card);
      }
    }
  }

  const cleanups: (() => void)[] = [];

  for (const [url, cards] of urlToCards) {
    (async () => {
      try {
        const handle = await repo.find(url as any);
        const onChange = (payload: any) => {
          pulse();
          if (cards.size === 0) return;
          const net = center(netNode);
          const isLocal = payload?.patchInfo?.source === "change";
          for (const card of cards) {
            const p = center(card);
            if (isLocal) spawnDot(svg, p.x, p.y, net.x, net.y, "#8ba4ff");
            else spawnDot(svg, net.x, net.y, p.x, p.y, "#7a9a6a");
          }
        };
        handle.on("change", onChange);
        cleanups.push(() => handle.off("change", onChange));
      } catch {}
    })();
  }

  return () => { cleanups.forEach((fn) => fn()); netNode.remove(); };
}
