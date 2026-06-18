import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import type { TimerDoc } from "./datatype";
import "./timer.css";

// A compact countdown widget. Clicking it starts the timer (stamping
// `startedAt`); clicking again resets it. Time remaining is derived from the
// document, so it's the same for everyone viewing it.
export const TimerTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Timer handle={handle as DocHandle<TimerDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function Timer(props: { handle: DocHandle<TimerDoc> }) {
  const [doc] = useDocument<TimerDoc>(() => props.handle.url);
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    onCleanup(() => clearInterval(id));
  });

  const remaining = () => {
    const d = doc();
    if (!d) return 0;
    if (d.startedAt == null) return d.durationMs;
    return Math.max(0, d.durationMs - (now() - d.startedAt));
  };

  const started = () => doc()?.startedAt != null;
  const running = () => started() && remaining() > 0;
  const done = () => started() && remaining() === 0;

  const toggle = () => {
    props.handle.change((d) => {
      if (d.startedAt == null) d.startedAt = Date.now();
      else delete d.startedAt;
    });
  };

  return (
    <button
      type="button"
      class="embark-timer"
      classList={{
        "embark-timer--running": running(),
        "embark-timer--done": done(),
      }}
      title="Click to start / reset"
      on:click={toggle}
    >
      {formatRemaining(remaining())}
    </button>
  );
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
