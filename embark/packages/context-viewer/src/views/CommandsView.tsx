import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup } from "solid-js";
import {
  type ContextStore,
  CommandQueries,
  CommandSuggestions,
  type Suggestion,
} from "@embark/core";
import { DocToken, useDocTitles, useHighlight } from "./tokens";

// The slash-command request/response pair as boxes: one box per active command
// query, with its suggestions below. A suggestion shows its own label and
// highlights the (prototype) card document it stands for on hover.
export function CommandsView(props: {
  store: ContextStore;
  element: ToolElement;
}) {
  const [queries, setQueries] = createSignal(props.store.read(CommandQueries));
  const [suggestions, setSuggestions] = createSignal(
    props.store.read(CommandSuggestions),
  );
  onCleanup(props.store.subscribe(CommandQueries, (q) => setQueries(() => q)));
  onCleanup(
    props.store.subscribe(CommandSuggestions, (s) => setSuggestions(() => s)),
  );

  const titles = useDocTitles(props.element);
  const highlight = useHighlight(props.store);
  const active = () => Object.keys(queries());

  return (
    <div class="embark-context__channel">
      <div class="embark-context__name">commands</div>
      <div class="embark-tokens-panel">
        <Show
          when={active().length > 0}
          fallback={<div class="embark-token-row__empty">no active commands</div>}
        >
          <For each={active()}>
            {(query) => {
              const items = (): Suggestion[] => suggestions()[query] ?? [];
              return (
                <div class="embark-querybox">
                  <div class="embark-querybox__query">{`/${query}`}</div>
                  <Show
                    when={items().length > 0}
                    fallback={
                      <div class="embark-token-row__empty">no suggestions</div>
                    }
                  >
                    <div class="embark-token-row">
                      <For each={items()}>
                        {(item) => (
                          <DocToken
                            url={item.url}
                            label={item.label}
                            titles={titles}
                            highlight={highlight}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
