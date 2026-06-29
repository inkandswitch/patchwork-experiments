import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import type { InspectDoc } from "./resolve-target";
import "./inspect.css";

// Tool entry point: a two-pane inspector. Its backing doc (minted at inspect
// time) names the package that paints the inspected embed and, when that embed
// shows a document, the document itself. Each pane is a plain `<patchwork-view>`:
// the package folder doc renders with whatever tool claims its datatype, and the
// document renders with its own default tool.
export const InspectTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Inspect handle={handle as DocHandle<InspectDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

function Inspect(props: { handle: DocHandle<InspectDoc> }) {
  const [doc] = useDocument<InspectDoc>(() => props.handle.url);

  return (
    <div class="embark-inspect">
      <Show
        when={doc()?.packageUrl}
        fallback={<div class="embark-inspect__empty">Nothing to inspect.</div>}
      >
        {(packageUrl) => (
          <div class="embark-inspect__pane">
            <div class="embark-inspect__label">Package</div>
            <patchwork-view class="embark-inspect__view" doc-url={packageUrl()} />
          </div>
        )}
      </Show>

      <Show when={doc()?.documentUrl}>
        {(documentUrl) => (
          <div class="embark-inspect__pane">
            <div class="embark-inspect__label">Document</div>
            <patchwork-view
              class="embark-inspect__view"
              doc-url={documentUrl()}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
