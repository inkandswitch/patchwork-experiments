import { Show } from "solid-js";

export function NavigationBar(props: {
  contextId: string | null;
  activeTag: string | null;
  onBack: () => void;
  onUp: () => void;
  onHome: () => void;
}) {
  return (
    <div class="bullets-nav-bar">
      <button class="bullets-nav-btn" onClick={props.onHome} title="Home">
        Home
      </button>
      <Show when={props.contextId}>
        <span class="bullets-nav-sep">/</span>
        <button class="bullets-nav-btn" onClick={props.onUp} title="Up one level">
          Up
        </button>
      </Show>
      <Show when={props.contextId || props.activeTag}>
        <span class="bullets-nav-sep">/</span>
        <button class="bullets-nav-btn" onClick={props.onBack} title="Go back">
          Back
        </button>
      </Show>
    </div>
  );
}
