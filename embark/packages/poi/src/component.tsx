import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { PoiProvider } from "./PoiProvider";

// `patchwork:component` entry: a handle-less view. The canvas imports this
// module by its (stable, head-less) url and runs the default export into the
// embed host — there is no backing document. It paints the Place Finder card and
// runs its search contributor against the shared canvas context the host is
// mounted inside.
export default function component(element: ToolElement): () => void {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PoiProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
}
