import { render } from "solid-js/web";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, Repo } from "@automerge/automerge-repo";

import type { LLMChatDoc } from "../types";
import { ChatShell } from "./chat-shell";
import "./view.css";

export const LLMChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMChatView
          handle={handle as DocHandle<LLMChatDoc>}
          repo={element.repo}
        />
      </RepoContext.Provider>
    ),
    element
  );
  return dispose;
};

function LLMChatView(props: { handle: DocHandle<LLMChatDoc>; repo: Repo }) {
  const [doc] = useDocument<LLMChatDoc>(() => props.handle.url);

  // The process is created elsewhere (by the datatype); we just point the
  // shared shell at the chat doc's links. The shell owns the system prompt in
  // this variant, so no `buildSystemPrompt` is supplied.
  return (
    <ChatShell
      repo={props.repo}
      processUrl={() => doc()?.processUrl}
      docFolderUrl={() => doc()?.docFolderUrl}
    />
  );
}
