import {
  RepoContext,
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { assignAutomergeFields } from "./automerge-fields";
import { ExerciseDetail } from "./components/ExerciseDetail";
import type { ExerciseDoc } from "./types";

function ExerciseView({ docUrl }: { docUrl: AutomergeUrl }) {
  const handle = useDocHandle<ExerciseDoc>(docUrl, { suspense: true });
  const [exercise] = useDocument<ExerciseDoc>(docUrl, { suspense: true });
  if (!exercise) return null;

  return (
    <div className="strength h-full overflow-y-auto bg-slate-50 p-4">
      <ExerciseDetail
        exercise={exercise}
        onUpdate={(patch) => {
          handle.change((draft) => {
            assignAutomergeFields(draft, patch);
          });
        }}
      />
    </div>
  );
}

export const ExerciseTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <ExerciseView docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
