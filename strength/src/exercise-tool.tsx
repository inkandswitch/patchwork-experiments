import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "./automerge-fields";
import { ExerciseDetail } from "./components/ExerciseDetail";
import { makeTool } from "./make-tool";
import type { ExerciseDoc } from "./types";

function ExerciseView({ docUrl }: { docUrl: AutomergeUrl }) {
  const [exercise, changeExercise] = useDocument<ExerciseDoc>(docUrl, {
    suspense: true,
  });
  if (!exercise) return null;

  return (
    <div className="strength h-full overflow-y-auto bg-slate-50 p-4">
      <ExerciseDetail
        exercise={exercise}
        onUpdate={(patch) => {
          changeExercise((draft) => {
            assignAutomergeFields(draft, patch);
          });
        }}
      />
    </div>
  );
}

export const ExerciseTool = makeTool(ExerciseView);
