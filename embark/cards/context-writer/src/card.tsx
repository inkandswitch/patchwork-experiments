import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  defineChannel,
  findContextStore,
  getBodyContextStore,
  type ContextStore,
  type ScopeHandle,
} from "@embark/context";

// The debug channel this card contributes to (read back by @embark/context-reader).
// Defined identically in both packages: the shared context correlates channels
// by name, so these two independent definitions address the same channel.
type DebugMark = { id: string; where: string; count: number; at: number };
const DebugChannel = defineChannel<{ marks: DebugMark[] }>({
  name: "debug:context",
  empty: { marks: [] },
});

// How often the heartbeat bumps its counter and re-writes the mark, so a reader
// elsewhere can watch the value propagate (or fail to).
const HEARTBEAT_MS = 2000;

// Context Writer card behavior, loaded by the shared card shell as this
// package's `card.js`. It writes a single "mark" into the debug channel of
// whichever store it is mounted in — the page-global body store when placed on
// the context sidebar, or a local canvas store otherwise — and bumps a counter
// on a heartbeat so the write keeps changing. Writes stop at the nearest store,
// so where this card sits determines who can see the mark. A compact live
// readout is rendered into the card's middle slot; the console is the record.
const card: ToolRender = (_handle, element) =>
  render(() => <ContextWriter element={element} />, element);

export default card;

function ContextWriter(props: { element: HTMLElement }) {
  const id = Math.random().toString(36).slice(2, 6);
  const log = (...args: unknown[]) =>
    console.log(`%c[ctx-writer ${id}]`, "color:#dc2626;font-weight:700", ...args);

  const [where, setWhere] = createSignal("(resolving…)");
  const [count, setCount] = createSignal(0);

  onMount(() => {
    const store = findContextStore(props.element);
    const isBody = store === getBodyContextStore();
    const depth = chainDepth(store);
    const scope = isBody ? "global" : "local";
    const location = `${isBody ? "PAGE-GLOBAL (body)" : "local"} · depth ${depth}`;
    setWhere(location);
    log("mounted →", location, { isBodyStore: isBody, store });

    const handle: ScopeHandle<{ marks: DebugMark[] }> = store.handle(DebugChannel);

    let n = 0;
    const beat = () => {
      n += 1;
      setCount(n);
      handle.change((slice) => {
        slice.marks = [{ id, where: scope, count: n, at: Date.now() }];
      });
      log("wrote mark", { count: n, where: scope });
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);

    onCleanup(() => {
      clearInterval(timer);
      handle.release();
      log("released mark");
    });
  });

  return (
    <div
      style={{
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-size": "11px",
        "line-height": "1.5",
        color: "#0f172a",
        flex: "1 1 auto",
        "min-height": "0",
        width: "100%",
      }}
    >
      <div style={{ "font-weight": "700", color: "#dc2626", "margin-bottom": "6px" }}>
        writer · {where()}
      </div>
      <div>
        writing <b>debug:context</b>
      </div>
      <div>heartbeat #{count()}</div>
      <div style={{ opacity: "0.6", "margin-top": "8px" }}>id {id}</div>
    </div>
  );
}

// How many stores sit above this one in the parent chain (0 for a root such as
// the page-global body store or an `isolated` context).
function chainDepth(store: ContextStore): number {
  let depth = 0;
  for (let p = store.parent; p; p = p.parent) depth += 1;
  return depth;
}
