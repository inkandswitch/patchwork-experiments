// A package as a scene would list one (probes/packages-probe.html serves it
// through the filesystem stub): an extension for the trait "probe.sea", a
// scene:source "probe-box" and a part. Nothing here runs until the viewer
// says Load.
import { encodeGLB } from "../src/glb.js";

const box = (w, h, d, color) => {
  const a = w / 2, c = d / 2;
  const v = [[-a,0,-c],[a,0,-c],[a,0,c],[-a,0,c],[-a,h,-c],[a,h,-c],[a,h,c],[-a,h,c]];
  const f = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
  return { positions: f.flat().flatMap((i) => v[i]), color };
};

export const plugins = [
  {
    type: "scene:extension",
    id: "probe.sea",
    name: "Sea",
    traits: ["probe.sea"],
    async load() {
      return {
        create(api) {
          window.__seaStarted = (window.__seaStarted ?? 0) + 1;
          const el = document.createElement("div");
          el.className = "probe-sea";
          el.textContent = "probe.sea is running";
          el.style.cssText = "position:absolute;left:8px;bottom:8px;padding:2px 8px;background:#135;color:#fff;border-radius:9px;font-size:12px;pointer-events:none";
          api.overlay().append(el);
          return {};
        },
      };
    },
  },
  {
    type: "scene:source",
    id: "probe-box",
    name: "Probe box",
    supportedDatatypes: ["probe-box"],
    params: [],
    async load() {
      return {
        async build({ doc }) {
          window.__boxBuilt = (window.__boxBuilt ?? 0) + 1;
          const s = Number(doc?.size) || 1;
          return { kind: "glb", glb: encodeGLB({ meshes: [box(s, s, s, "#d2691e")] }), meta: { bounds: { min: [-s / 2, 0, -s / 2], max: [s / 2, s, s / 2] } } };
        },
      };
    },
  },
  { type: "scene:part", id: "probe.buoy", name: "Buoy", category: "Probe", load: async () => ({ create: async () => null }) },
];
