import {
  RepoContext,
  useDocHandle,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { setAutomergeString } from "./automerge-fields";
import { GameDetail } from "./components";
import type { BoardGameDoc } from "./datatype";

function BoardGameView({ docUrl }: { docUrl: AutomergeUrl }) {
  const handle = useDocHandle<BoardGameDoc>(docUrl, { suspense: true });
  const game = handle.doc();

  if (!game) return null;

  return (
    <div className="boardgame-collection h-full overflow-y-auto bg-slate-50 p-4">
      <GameDetail
        game={game}
        onUpdateComment={(comment) => {
          handle.change((draft) => {
            setAutomergeString(draft, "comment", comment);
          });
        }}
      />
    </div>
  );
}

export const BoardgameTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <BoardGameView docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
