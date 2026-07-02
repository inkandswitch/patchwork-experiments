import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { RouteProvider } from "./RouteProvider";

// `patchwork:component` entry: a handle-less view. The canvas imports this
// module by its (stable, head-less) url and runs the default export into the
// embed host — there is no backing document. It paints the Routes card and runs
// its `/Drive` `/Walk` `/Transit` command contributors against the shared canvas
// context the host is mounted inside.
export default function component(element: ToolElement): () => void {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <RouteProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
}
