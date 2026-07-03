import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import {
  contributedSlice,
  type ContextStore,
  type ContextVisualizer,
} from "@embark/context";
import { Chips } from "@embark/selection/tokens";
import { SchemaQueries } from "./channels";

// Visualizer for `schema:queries`: the human-readable name of each published
// schema query, as chips. `schema:matches` is left to the default JSON viewer
// (its values are raw match-url arrays with no obvious richer face).
export const schemaVisualizer: ContextVisualizer = (element, props) => {
  return render(
    () => (
      <div class="embark-tokens-panel">
        <SchemaQueryChips
          store={props.store}
          mode={props.mode}
          focusDocUrl={props.focusDocUrl as AutomergeUrl}
        />
      </div>
    ),
    element,
  );
};

function SchemaQueryChips(props: {
  store: ContextStore;
  mode: "contributes" | "uses";
  focusDocUrl: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.store.subscribe(SchemaQueries, () => setTick((t) => t + 1)));
  const labels = createMemo(() => {
    tick();
    const value =
      props.mode === "contributes"
        ? contributedSlice(props.store, SchemaQueries, props.focusDocUrl)
        : props.store.read(SchemaQueries);
    return Object.values(value).map((query) => {
      const name = (query as { name?: unknown })?.name;
      return typeof name === "string" && name.trim() ? name : "schema";
    });
  });
  return <Chips labels={labels()} />;
}
