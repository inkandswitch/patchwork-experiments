import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import { type ContextView, type ContextVisualizer } from "@embark/context";
import { Chips, EmbedToken, useHighlight } from "@embark/selection/tokens";
import { CommandQueries, CommandSuggestions } from "./channels";
import type { Suggestion } from "./suggestion";

// Visualizer for the command channels: `commands:queries` as quoted chips, and
// `commands:suggestions` as labeled tokens (the suggestion label over its
// prototype card document). The `context` is already scoped by the viewer.
export const commandsVisualizer: ContextVisualizer = (element, props) => {
  return render(() => {
    const isSuggestions = props.channel === CommandSuggestions.name;
    return (
      <div class="embark-tokens-panel">
        <Show
          when={isSuggestions}
          fallback={<QueryChips context={props.context} />}
        >
          <SuggestionTokens context={props.context} />
        </Show>
      </div>
    );
  }, element);
};

function QueryChips(props: { context: ContextView }) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.context.subscribe(CommandQueries, () => setTick((t) => t + 1)));
  const labels = createMemo(() => {
    tick();
    return Object.keys(props.context.read(CommandQueries)).map((key) =>
      JSON.stringify(key),
    );
  });
  return <Chips labels={labels()} />;
}

function SuggestionTokens(props: { context: ContextView }) {
  const [tick, setTick] = createSignal(0);
  onCleanup(
    props.context.subscribe(CommandSuggestions, () => setTick((t) => t + 1)),
  );
  const highlight = useHighlight(props.context);
  const suggestions = createMemo<Suggestion[]>(() => {
    tick();
    return flatten(props.context.read(CommandSuggestions));
  });
  return (
    <Show
      when={suggestions().length > 0}
      fallback={<div class="embark-token-row__empty">no suggestions</div>}
    >
      <div class="embark-token-row">
        <For each={suggestions()}>
          {(s) => <EmbedToken url={s.url} label={s.label} highlight={highlight} />}
        </For>
      </div>
    </Show>
  );
}

// Flatten a `Record<query, Suggestion[]>` value into a single suggestion list.
function flatten(value: Record<string, unknown>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object" && "url" in entry) {
        out.push(entry as Suggestion);
      }
    }
  }
  return out;
}
