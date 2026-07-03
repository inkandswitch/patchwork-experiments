import type { Repo } from "@automerge/automerge-repo";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  contextVisualizers,
  type Channel,
  type ContextView,
  type ContextVisualizer,
} from "@embark/context";

// Hosts the visualization for one channel. Looks up a registered
// `embark:context-visualizer` whose `channels` include this channel's name,
// loads it, and mounts it into a plain container. If none is registered it
// paints the default JSON viewer and upgrades in place when a matching
// visualizer registers later (module bundles load asynchronously) — the same
// register-then-upgrade pattern the `token-view` tool uses.
//
// The `context` is already scoped by the caller: the whole store for the
// whole-context view, or a `filterChannel` lens for a focused embed. The
// visualizer just draws whatever this context reports for its channel.
export function VisualizerHost(props: {
  context: ContextView;
  channel: Channel<Record<string, unknown>>;
  repo: Repo;
}) {
  let container!: HTMLDivElement;

  onMount(() => {
    let disposed = false;
    let cleanup: (() => void) | void;

    const mountVisualizer = (visualize: ContextVisualizer) => {
      cleanup?.();
      cleanup = visualize(container, {
        context: props.context,
        channel: props.channel.name,
        repo: props.repo,
      });
    };

    const pluginForChannel = () =>
      contextVisualizers()
        .all()
        .find((plugin) => plugin.channels?.includes(props.channel.name));

    const tryMount = async (): Promise<boolean> => {
      const plugin = pluginForChannel();
      if (!plugin) return false;
      const loaded = await contextVisualizers().load(plugin.id);
      if (disposed || !loaded) return false;
      mountVisualizer(loaded.module as ContextVisualizer);
      return true;
    };

    void (async () => {
      if (await tryMount()) return;
      if (disposed) return;
      cleanup = mountDefault(container, props);
      const off = contextVisualizers().on("registered", () => {
        void (async () => {
          if (disposed || !pluginForChannel()) return;
          if (await tryMount()) off();
        })();
      });
      onCleanup(off);
    })();

    onCleanup(() => {
      disposed = true;
      cleanup?.();
    });
  });

  return <div ref={container} />;
}

// The default face for a channel with no registered visualizer: its value as
// pretty JSON, updated as the channel changes. Mounted imperatively so it uses
// the same teardown contract as a real visualizer.
function mountDefault(
  container: HTMLElement,
  props: {
    context: ContextView;
    channel: Channel<Record<string, unknown>>;
  },
): () => void {
  return render(() => {
    const [tick, setTick] = createSignal(0);
    onCleanup(props.context.subscribe(props.channel, () => setTick((t) => t + 1)));
    const text = createMemo(() => {
      tick();
      return safeJson(props.context.read(props.channel));
    });
    return <pre class="embark-context__value">{text()}</pre>;
  }, container);
}

// JSON.stringify hardened for arbitrary channel payloads: some channels carry
// non-JSON values (e.g. live CodeMirror `Extension` objects on
// `codemirror:extensions`) that are circular or hold functions. Guard against
// those and cap the output so the fallback never throws or floods the panel.
function safeJson(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const out = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "function") return "[function]";
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[circular]";
          seen.add(val);
        }
        return val;
      },
      2,
    );
    if (out === undefined) return String(value);
    return out.length > 4000 ? `${out.slice(0, 4000)}\n… (truncated)` : out;
  } catch {
    return "[unserializable value]";
  }
}
