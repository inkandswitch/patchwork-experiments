import { useDocuments } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo } from "react";
import type { ExerciseDoc, WorkoutSessionDoc } from "./types";

export function useLoadedExercises(urls: AutomergeUrl[]) {
  const [docsMap] = useDocuments<ExerciseDoc>(urls, { suspense: false });
  return useMemo(
    () =>
      urls.flatMap((url) => {
        const doc = docsMap.get(url);
        return doc ? [{ url, doc }] : [];
      }),
    [urls, docsMap],
  );
}

export function useLoadedWorkoutSessions(urls: AutomergeUrl[]) {
  const [docsMap] = useDocuments<WorkoutSessionDoc>(urls, {
    suspense: false,
  });
  return useMemo(
    () =>
      urls.flatMap((url) => {
        const doc = docsMap.get(url);
        return doc ? [{ url, doc }] : [];
      }),
    [urls, docsMap],
  );
}