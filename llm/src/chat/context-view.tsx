import { render } from "solid-js/web";
import { createResource } from "solid-js";
import { RepoContext, useDocument } from "@automerge/automerge-repo-solid-primitives";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";

import type { LLMProcessDoc } from "../types";
import INSTRUCTIONS from "../INSTRUCTIONS.md?raw";
import { ChatShell } from "./chat-shell";
import "./view.css";

const CHAT_PREAMBLE = `You are a helpful assistant embedded in the Patchwork context sidebar. Be concise and friendly. The user is working in Patchwork; when they have a document focused you can read and edit it.`;
const BASE_SYSTEM_PROMPT = `${CHAT_PREAMBLE}\n\n${INSTRUCTIONS}`;

/** Account doc shape: we persist a single chat link on it. */
type AccountChatDoc = { llmChatUrl?: AutomergeUrl };

/** Focused document shape we read for context. */
type FocusedDoc = { title?: string; "@patchwork"?: { type?: string } };

/**
 * Context-sidebar variant of the LLM chat. Registered as a `context-tool`, so
 * it receives the account doc as its handle.
 *
 * There is a single persistent chat for the account (its url is stored on
 * `account.llmChatUrl`), so the conversation survives reloads and is the same
 * everywhere. The chat's *context follows focus*: whatever document the user
 * currently has selected (via `patchwork:selected-doc`) is injected into the
 * process's system prompt at send time, so the assistant can read or edit it.
 *
 * All shared chat UI lives in `ChatShell`; this component only resolves the
 * account-scoped process and supplies the focus-aware system prompt + banner.
 */
export const LLMContextChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ContextChatView
          repo={element.repo}
          element={element}
          accountHandle={handle as DocHandle<AccountChatDoc>}
        />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function ContextChatView(props: {
  repo: Repo;
  element: HTMLElement;
  accountHandle: DocHandle<AccountChatDoc>;
}) {
  const selectedDocUrls = subscribe<AutomergeUrl[]>(
    props.element,
    { type: "patchwork:selected-doc" },
    [],
  );
  const focusedUrl = () => selectedDocUrls()[0] as AutomergeUrl | undefined;

  const [focusedDoc] = useDocument<FocusedDoc>(() => focusedUrl());
  const focusedLabel = () => {
    const d = focusedDoc();
    if (!d) return "no document focused";
    const type = d["@patchwork"]?.type ?? "unknown";
    const title = typeof d.title === "string" ? d.title : undefined;
    return title ? `${title} (${type})` : type;
  };

  // The single, account-scoped chat. Created (and linked on the account) once,
  // then reused on every mount.
  const ensureAccountChat = async (): Promise<AutomergeUrl> => {
    const existing = props.accountHandle.doc()?.llmChatUrl;
    if (existing) return existing;

    const folderHandle = props.repo.create<any>();
    folderHandle.change((d: any) => {
      d["@patchwork"] = { type: "folder" };
      d.title = "Documents";
      d.docs = [];
    });

    const processHandle = props.repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d["@patchwork"] = { type: "llm-process" };
      d.title = "Assistant";
      d.systemPrompt = BASE_SYSTEM_PROMPT;
      d.docFolderUrl = folderHandle.url;
      d.messages = [];
    });

    props.accountHandle.change((d) => {
      d.llmChatUrl = processHandle.url;
    });

    return processHandle.url;
  };

  const [processUrl] = createResource(
    () => props.accountHandle.url,
    () => ensureAccountChat(),
  );
  const [processDoc] = useDocument<LLMProcessDoc>(() => processUrl());
  const folderUrl = () => processDoc()?.docFolderUrl;

  const buildFocusContext = (): string => {
    const url = focusedUrl();
    if (!url) return "";
    const d = focusedDoc();
    const type = d?.["@patchwork"]?.type ?? "unknown";
    const title = typeof d?.title === "string" ? d.title : undefined;
    return (
      `[Context] The user is currently viewing a Patchwork document:\n` +
      `- URL: ${url}\n` +
      `- Type: ${type}\n` +
      (title ? `- Title: ${title}\n` : "") +
      `To read or modify it, use:\n` +
      `const handle = await workspace.find("${url}");\n` +
      `const doc = handle.doc();\n` +
      `handle.change((d) => { /* mutate */ });`
    );
  };

  // Rebuilt on every send so the assistant always sees the currently-focused
  // document.
  const buildSystemPrompt = (): string => {
    const focusContext = buildFocusContext();
    return focusContext
      ? `${BASE_SYSTEM_PROMPT}\n\n${focusContext}`
      : BASE_SYSTEM_PROMPT;
  };

  return (
    <ChatShell
      repo={props.repo}
      processUrl={() => processUrl()}
      docFolderUrl={() => folderUrl()}
      buildSystemPrompt={buildSystemPrompt}
    >
      <div class="chat-context-bar">
        Context: <strong>{focusedLabel()}</strong>
      </div>
    </ChatShell>
  );
}
