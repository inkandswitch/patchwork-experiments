import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import {
  contributedSlice,
  type ContextStore,
  type ContextVisualizer,
} from "@embark/context";
import { Chips, EmbedToken, useHighlight } from "@embark/selection/tokens";
import { CommandQueries, CommandSuggestions } from "./channels";
import type { Suggestion } from "./suggestion";

// Visualizer for the command channels: `commands:queries` as quoted chips, and
// `commands:suggestions` as labeled tokens (the suggestion label over its
// prototype card document).
export const commandsVisualizer: ContextVisualizer = (element, props) => {
  return render(() => {
    const isSuggestions = props.channel === CommandSuggestions.name;
    return (
      <div class="embark-tokens-panel">
        <Show
          when={isSuggestions}
          fallback={
            <QueryChips
              store={props.store}
              mode={props.mode}
              focusDocUrl={props.focusDocUrl as AutomergeUrl}
            />
          }
        >
          <SuggestionTokens
            store={props.store}
            mode={props.mode}
            focusDocUrl={props.focusDocUrl as AutomergeUrl}
          />
        </Show>
      </div>
    );
  }, element);
};

function QueryChips(props: {
  store: ContextStore;
  mode: "contributes" | "uses";
  focusDocUrl: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.store.subscribe(CommandQueries, () => setTick((t) => t + 1)));
  const labels = createMemo(() => {
    tick();
    const value =
      props.mode === "contributes"
        ? contributedSlice(props.store, CommandQueries, props.focusDocUrl)
        : props.store.read(CommandQueries);
    return Object.keys(value).map((key) => JSON.stringify(key));
  });
  return <Chips labels={labels()} />;
}

function SuggestionTokens(props: {
  store: ContextStore;
  mode: "contributes" | "uses";
  focusDocUrl: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(
    props.store.subscribe(CommandSuggestions, () => setTick((t) => t + 1)),
  );
  const highlight = useHighlight(props.store);
  const suggestions = createMemo<Suggestion[]>(() => {
    tick();
    const value =
      props.mode === "contributes"
        ? contributedSlice(props.store, CommandSuggestions, props.focusDocUrl)
        : props.store.read(CommandSuggestions);
    return flatten(value);
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
