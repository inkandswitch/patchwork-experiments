import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { WeatherProvider } from "./WeatherProvider";

// `patchwork:component` entry: a handle-less view. The canvas imports this
// module by its (stable, head-less) url and runs the default export into the
// embed host — there is no backing document. It paints the Weather card and runs
// its `/weather` command contributor against the shared canvas context the host
// is mounted inside.
export default function component(element: ToolElement): () => void {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <WeatherProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
}
