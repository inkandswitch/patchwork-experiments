import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import {
  contributedSlice,
  type ContextStore,
  type ContextVisualizer,
} from "@embark/context";
import { Chips } from "@embark/selection/tokens";
import { CodemirrorExtensions } from "./channel";

// Visualizer for `codemirror:extensions`: the keys under which cards publish
// their editor extensions, as chips. The values are live CodeMirror Extension
// objects (not JSON), so only the keys are shown — never the values.
export const codemirrorExtensionsVisualizer: ContextVisualizer = (
  element,
  props,
) => {
  return render(
    () => (
      <div class="embark-tokens-panel">
        <ExtensionChips
          store={props.store}
          mode={props.mode}
          focusDocUrl={props.focusDocUrl as AutomergeUrl}
        />
      </div>
    ),
    element,
  );
};

function ExtensionChips(props: {
  store: ContextStore;
  mode: "contributes" | "uses";
  focusDocUrl: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(
    props.store.subscribe(CodemirrorExtensions, () => setTick((t) => t + 1)),
  );
  const labels = createMemo(() => {
    tick();
    const value =
      props.mode === "contributes"
        ? contributedSlice(props.store, CodemirrorExtensions, props.focusDocUrl)
        : props.store.read(CodemirrorExtensions);
    return Object.keys(value).map((key) => JSON.stringify(key));
  });
  return <Chips labels={labels()} />;
}
