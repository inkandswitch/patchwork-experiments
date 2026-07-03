import { createMemo, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { type ContextView, type ContextVisualizer } from "@embark/context";
import { Chips } from "@embark/selection/tokens";
import { SchemaQueries } from "./channels";

// Visualizer for `schema:queries`: the human-readable name of each published
// schema query, as chips. `schema:matches` is left to the default JSON viewer
// (its values are raw match-url arrays with no obvious richer face).
export const schemaVisualizer: ContextVisualizer = (element, props) => {
  return render(
    () => (
      <div class="embark-tokens-panel">
        <SchemaQueryChips context={props.context} />
      </div>
    ),
    element,
  );
};

function SchemaQueryChips(props: { context: ContextView }) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.context.subscribe(SchemaQueries, () => setTick((t) => t + 1)));
  const labels = createMemo(() => {
    tick();
    return Object.values(props.context.read(SchemaQueries)).map((query) => {
      const name = (query as { name?: unknown })?.name;
      return typeof name === "string" && name.trim() ? name : "schema";
    });
  });
  return <Chips labels={labels()} />;
}
