// PERF.md Phase 5 pins: per-item shape render memoization + the resolveColor
// cache. Unit level: cachedColorResolver resolves each input string ONCE until
// clear(). Mount level (real Canvas in happy-dom, window.__perf counters):
// mounting N shapes sharing a colour does one underlying resolution; rebuilding
// paths happens per shape CHANGE (not per reactive flush); a theme bump clears
// the colour cache and re-resolves.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas, cachedColorResolver } from "./brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps the pointer-up drop path needs
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const mounted = [];
async function mountCanvas(opts = {}, items = []) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts }), element);
  const m = { repo, layout, folder, element, dispose };
  mounted.push(m);
  await flush();
  return m;
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
  document.documentElement.removeAttribute("data-theme");
});

const counter = (name) => window.__perf?.[name] || 0;

describe("cachedColorResolver (unit)", () => {
  it("two calls with the same input do ONE underlying resolution", () => {
    let calls = 0;
    const resolve = cachedColorResolver((c) => { calls++; return `resolved(${c})`; });
    expect(resolve("var(--a)")).toBe("resolved(var(--a))");
    expect(resolve("var(--a)")).toBe("resolved(var(--a))");
    expect(calls).toBe(1);
  });

  it("distinct inputs each resolve once", () => {
    let calls = 0;
    const resolve = cachedColorResolver((c) => { calls++; return c.toUpperCase(); });
    resolve("a"); resolve("b"); resolve("a"); resolve("b");
    expect(calls).toBe(2);
  });

  it("clear() (the themeTick bump) re-resolves", () => {
    let theme = "light";
    let calls = 0;
    const resolve = cachedColorResolver((c) => { calls++; return `${theme}:${c}`; });
    expect(resolve("ink")).toBe("light:ink");
    theme = "dark";
    expect(resolve("ink")).toBe("light:ink"); // cached until the bump
    resolve.clear();
    expect(resolve("ink")).toBe("dark:ink");
    expect(calls).toBe(2);
  });
});

const rect = (id, color, x = 0) => ({ id, kind: "shape", type: "rectangle", x, y: 10, w: 60, h: 40, color, fill: "none", strokeWidth: 2, seed: 7, rotation: 0 });

describe("shape render memoization + colour cache (mounted)", () => {
  // retry(1): the window.__perf counters are global — a previous file's canvas can
  // leak one async tick into our deltas when file order lines up (seen 2026-07-02).
  // A real regression fails BOTH attempts; only cross-file noise gets absorbed.
  it("N shapes sharing a colour → one resolution; rebuilds track shape/theme change, not flushes", { retry: 1 }, async () => {
    const resolved0 = counter("colorResolve");
    const built0 = counter("shapePaths");
    const { element, layout } = await mountCanvas({}, [rect("s1", "red", 0), rect("s2", "red", 100)]);
    expect(element.querySelectorAll(".ns-mark").length).toBe(2);
    // one underlying resolution for the shared stroke colour ("none" fills skip the cache)
    expect(counter("colorResolve") - resolved0).toBe(1);
    // one path build per shape
    expect(counter("shapePaths") - built0).toBe(2);

    // an unrelated reactive flush (tool change) rebuilds NOTHING
    const resolved1 = counter("colorResolve");
    const built1 = counter("shapePaths");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true })); // arm the pen (canvas-level shortcut — no toolbar DOM)
    await flush(5);
    expect(counter("colorResolve") - resolved1).toBe(0);
    expect(counter("shapePaths") - built1).toBe(0);

    // changing ONE shape rebuilds only that shape; its new colour resolves once
    layout.change((d) => { d.items[0].color = "blue"; });
    await flush(5);
    expect(counter("shapePaths") - built1).toBe(1);
    expect(counter("colorResolve") - resolved1).toBe(1);

    // a theme bump clears the colour cache: every shape rebuilds, every unique colour re-resolves
    const resolved2 = counter("colorResolve");
    const built2 = counter("shapePaths");
    document.documentElement.setAttribute("data-theme", "dark");
    await flush(5);
    expect(counter("shapePaths") - built2).toBe(2);
    expect(counter("colorResolve") - resolved2).toBe(2); // blue + red
  });
});
