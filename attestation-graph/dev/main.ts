// Dev harness: runs the tool outside Patchwork against an in-memory stand-in
// for a DocHandle. `?doc=zktls` / `?doc=empty` pick the starting document;
// `?dark` flips the theme variables to check the colours invert.
import p1 from "../../examples/p1-graph.drawio?raw";
import zktls from "../../examples/zktls-graph.drawio?raw";
import { AttestationGraphDatatype } from "../src/datatype";
import { parseDrawio } from "../src/drawio";
import type { GraphDoc } from "../src/model";
import Tool from "../src/tool";

function assertNoUndefined(value: unknown, path = "doc") {
  if (value === undefined) throw new Error(`automerge would reject undefined at ${path}`);
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

function fakeHandle(url: string, initial: GraphDoc) {
  let doc = initial;
  const listeners = new Set<() => void>();
  return {
    url,
    doc: () => doc,
    change(fn: (d: GraphDoc) => void) {
      const draft = structuredClone(doc);
      fn(draft);
      assertNoUndefined(draft);
      doc = draft;
      listeners.forEach((l) => l());
    },
    on: (_: "change", l: () => void) => void listeners.add(l),
    off: (_: "change", l: () => void) => void listeners.delete(l),
  };
}

const params = new URLSearchParams(location.search);
if (params.has("dark")) {
  const s = document.documentElement.style;
  s.setProperty("--editor-fill", "#1c1d21");
  s.setProperty("--editor-line", "#e8e6e1");
}

const which = params.get("doc") ?? "p1";
const doc = {} as GraphDoc;
AttestationGraphDatatype.init(doc);
if (which !== "empty") {
  doc.diagrams = await parseDrawio(which === "zktls" ? zktls : p1);
  doc.title = which === "zktls" ? "zktls-graph" : "p1-graph";
}

// "Existing graph…" lookups: any automerge URL resolves to the zkTLS example,
// except one ending in "file", which resolves to a raw .drawio file document.
(window as any).repo = {
  async find(url: string) {
    if (url.endsWith("file")) return { doc: () => ({ name: "p1-graph.drawio", content: p1 }) };
    return { doc: () => ({ title: "zktls-graph", diagrams: structuredClone(zktlsDiagrams) }) };
  },
};
const zktlsDiagrams = await parseDrawio(zktls);

const handle = fakeHandle("automerge:dev-" + which, doc);
(window as any).handle = handle;
Tool(handle, document.getElementById("app")!);
