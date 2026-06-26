import { render } from "solid-js/web";
import { RepoContext } from "@automerge/automerge-repo-solid-primitives";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { App } from "./App";
import type { AccountDoc } from "./account";
import "./styles.css";

type ToolElement = HTMLElement & { repo: Repo };

/**
 * Frame-tool render contract: (accountHandle, element) => cleanup. `handle` is
 * the ACCOUNT doc (this is a frame tool: tags:["frame-tool"],
 * supportedDatatypes:["account"]); the frame's own config lives in a subdoc
 * referenced from the account. Mounts the Solid App and returns the disposer.
 */
export const HostTool = (
  accountHandle: DocHandle<AccountDoc>,
  element: ToolElement,
) => {
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  if (!element.style.height) element.style.height = "100%";

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <App accountHandle={accountHandle} repo={element.repo} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};
