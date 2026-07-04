import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  RepoContext,
  useDocument,
  useDocHandle,
} from "@automerge/automerge-repo-react-hooks";
import { createRoot } from "react-dom/client";
import { completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { useMemo } from "react";
import { Codemirror } from "./codemirror.tsx";
import { theme } from "./theme.ts";
import type { MarkdownDoc } from "./datatype.ts";
import { parseMarkwhenEvents } from "./markwhen.ts";
import { TimelineView } from "./TimelineView.tsx";

const PATH = ["content"];

export function MarkdownTool({ docUrl }: { docUrl: AutomergeUrl }) {
  useDocHandle<MarkdownDoc>(docUrl, { suspense: true });
  const [doc] = useDocument<MarkdownDoc>(docUrl);

  const cmExtensions = useMemo(
    () => [
      ...theme(),
      history(),
      indentOnInput(),
      keymap.of([
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      markdown({ codeLanguages: languages }),
      indentUnit.of("    "),
    ],
    []
  );

  const content = doc?.content || "";
  const events = useMemo(() => parseMarkwhenEvents(content), [content]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: events.length > 0 ? "1 1 0" : "1 1 auto",
          minHeight: 0,
          overflow: "auto",
          padding: "16px",
        }}
      >
        <Codemirror docUrl={docUrl} path={PATH} extensions={cmExtensions} />
      </div>

      {events.length > 0 && (
        <div
          style={{
            flex: "0 0 350px",
            minHeight: "200px",
            overflow: "hidden",
          }}
        >
          <TimelineView events={events} />
        </div>
      )}
    </div>
  );
}

// Kept here (rather than main.tsx) so the entry point never statically
// imports react-dom/automerge-repo-react-hooks — the host may not have a
// document open for this tool at all, so React shouldn't load until it does.
export function renderMarkdownTool(handle: DocHandle<unknown>, element: ToolElement) {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <MarkdownTool docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
