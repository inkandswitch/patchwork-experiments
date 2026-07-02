// PERF.md Phase 10 (plan-2 §6) — async brush-module loading is REACTIVE.
// Brush modules resolve asynchronously into the canvas's brushMods Map; a
// version signal bumps when one lands, so isBrushTool / paramDefs / the
// properties panel refresh the moment the module arrives. Pinned here: select
// a brush whose module resolves LATER (a controlled promise) → the params
// panel appears when it lands, with no unrelated update in between.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "./brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

// a brush whose module load we resolve BY HAND, mid-test
let resolveSlow;
registerPlugins([{
  type: "sketchy:brush", id: "slowbrush", name: "Slowbrush", icon: "PenLine",
  load: () => new Promise((r) => { resolveSlow = r; }),
}]);

const mounted = [];
async function mountCanvas() {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [] });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  let host = null;
  const opts = { slots: { toolbar: (h) => { host = h; return document.createElement("div"); } } };
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts }), element);
  const m = { repo, layout, folder, element, dispose };
  mounted.push(m);
  await flush();
  return { ...m, host };
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

describe("brush modules land reactively", () => {
  it("a brush selected BEFORE its module resolves shows its params WHEN the module lands", async () => {
    const { element, host } = await mountCanvas();
    expect(host).toBeTruthy();
    expect(typeof resolveSlow).toBe("function"); // the canvas called load() at mount
    host.setTool("slowbrush");
    await flush(10);
    // module still pending: not yet a known brush — no properties panel
    expect(host.context.tool.value).toBe("slowbrush");
    expect(element.querySelector(".ns-props")).toBeFalsy();
    // the module lands — the panel must appear WITHOUT any other update
    resolveSlow({
      id: "slowbrush", name: "Slowbrush", iconPath: "M0 0",
      stroke: { size: 6, opacity: 0.8 },
      params: [
        { key: "size", label: "Size", type: "size" },
        { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05 },
      ],
    });
    await flush(10);
    const panel = element.querySelector(".ns-props");
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("Slowbrush"); // the module's name titles the panel
    expect(panel.textContent).toContain("Size");
    expect(panel.textContent).toContain("Opacity");
    // param resolution reads the freshly-landed module's stroke defaults
    const slider = panel.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    expect(Number(slider.value)).toBeCloseTo(0.8);
  });
});
