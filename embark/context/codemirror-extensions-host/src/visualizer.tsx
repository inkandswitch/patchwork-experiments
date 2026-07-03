import { createMemo, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { type ContextView, type ContextVisualizer } from "@embark/context";
import { Chips } from "@embark/selection/tokens";
import { CodemirrorExtensions } from "./channel";

// Visualizer for `codemirror:extensions`: the keys under which cards publish
// their editor extensions, as chips. The values are live CodeMirror Extension
// objects (not JSON), so only the keys are shown — never the values. The
// `context` is already scoped by the viewer.
export const codemirrorExtensionsVisualizer: ContextVisualizer = (
  element,
  props,
) => {
  return render(
    () => (
      <div class="embark-tokens-panel">
        <ExtensionChips context={props.context} />
      </div>
    ),
    element,
  );
};

function ExtensionChips(props: { context: ContextView }) {
  const [tick, setTick] = createSignal(0);
  onCleanup(
    props.context.subscribe(CodemirrorExtensions, () => setTick((t) => t + 1)),
  );
  const labels = createMemo(() => {
    tick();
    return Object.keys(props.context.read(CodemirrorExtensions)).map((key) =>
      JSON.stringify(key),
    );
  });
  return <Chips labels={labels()} />;
}
