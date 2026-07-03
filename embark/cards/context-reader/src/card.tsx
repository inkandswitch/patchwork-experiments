import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  defineChannel,
  findContextStore,
  getBodyContextStore,
  type Channel,
  type ContextStore,
} from "@embark/context";

// The debug channel the writer card contributes to (see @embark/context-writer).
// Defined identically in both packages: the shared context correlates channels
// by name, so these two independent definitions address the same channel — the
// point of the pair is to watch whether a write on one store is visible to a
// read on another.
const DebugChannel = defineChannel<{ marks: Record<string, unknown>[] }>({
  name: "debug:context",
  empty: { marks: [] },
});

// Context Reader card behavior, loaded by the shared card shell as this
// package's `card.js`. It resolves the context store it is mounted in and logs
// everything it can see there: which store it landed on (the page-global body
// store when placed on the context sidebar, or a local canvas store otherwise),
// the parent-chain depth, and every channel's merged value — seeded on mount and
// re-logged on every change. A compact live readout is rendered into the card's
// middle slot; the console is the primary record.
const card: ToolRender = (_handle, element) =>
  render(() => <ContextReader element={element} />, element);

export default card;

type ChannelRow = { name: string; value: string };

function ContextReader(props: { element: HTMLElement }) {
  const id = Math.random().toString(36).slice(2, 6);
  const log = (...args: unknown[]) =>
    console.log(`%c[ctx-reader ${id}]`, "color:#2563eb;font-weight:700", ...args);

  const [where, setWhere] = createSignal("(resolving…)");
  const [rows, setRows] = createSignal<ChannelRow[]>([]);

  onMount(() => {
    const store = findContextStore(props.element);
    const isBody = store === getBodyContextStore();
    const depth = chainDepth(store);
    const location = `${isBody ? "PAGE-GLOBAL (body)" : "local"} · depth ${depth}`;
    setWhere(location);
    log("mounted →", location, { isBodyStore: isBody, store });

    // Latest merged value per channel, and the unsubscribe for each.
    const values = new Map<string, Record<string, unknown>>();
    const unsubs = new Map<string, () => void>();

    const refresh = () =>
      setRows(
        [...values.entries()]
          .map(([name, value]) => ({ name, value: preview(value) }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      );

    // Seed a channel's current value and subscribe to its changes. `subscribe`
    // never fires an initial value, so read once up front.
    const watch = (channel: Channel<Record<string, unknown>>) => {
      if (unsubs.has(channel.name)) return;
      const seed = store.read(channel);
      values.set(channel.name, seed);
      log("channel seen:", channel.name, seed);
      unsubs.set(
        channel.name,
        store.subscribe(channel, (value) => {
          values.set(channel.name, value);
          log("channel changed:", channel.name, value);
          refresh();
        }),
      );
    };

    // Watch every channel already known to this store (and its parents), plus
    // the debug channel even if nothing has touched it yet.
    for (const channel of store.channels()) watch(channel);
    watch(DebugChannel);
    refresh();

    // Pick up channels that appear later (a scope or reader touching one for the
    // first time), and note reader-registry changes.
    const unsubChannels = store.subscribeChannels(() => {
      for (const channel of store.channels()) watch(channel);
      refresh();
    });
    const unsubReaders = store.subscribeReaders(() => log("readers changed"));

    onCleanup(() => {
      unsubChannels();
      unsubReaders();
      for (const unsub of unsubs.values()) unsub();
      log("unmounted");
    });
  });

  return (
    <div
      style={{
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-size": "9px",
        "line-height": "1.35",
        color: "#0f172a",
        overflow: "auto",
        flex: "1 1 auto",
        "min-height": "0",
        width: "100%",
      }}
    >
      <div style={{ "font-weight": "700", "margin-bottom": "4px", color: "#2563eb" }}>
        reader · {where()}
      </div>
      <For
        each={rows()}
        fallback={<div style={{ opacity: "0.6" }}>no channels visible yet</div>}
      >
        {(row) => (
          <div style={{ "margin-bottom": "3px", "word-break": "break-all" }}>
            <span style={{ "font-weight": "700" }}>{row.name}</span>
            <span style={{ opacity: "0.85" }}> {row.value}</span>
          </div>
        )}
      </For>
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

// A short, safe, one-line preview of a channel value. Guards against the
// non-JSON shapes a channel can legitimately hold (a CodeMirror `Extension` is a
// deeply-nested object graph with functions and cycles), and truncates.
function preview(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === "function") return "«fn»";
      if (typeof val === "bigint") return `${val}n`;
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "«circular»";
        seen.add(val);
      }
      return val;
    });
    if (json === undefined) return String(value);
    return json.length > 300 ? `${json.slice(0, 300)}…` : json;
  } catch {
    return "«unserializable»";
  }
}
