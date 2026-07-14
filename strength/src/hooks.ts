import { useDocuments } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useMemo } from "react";
import type { WorkoutSessionDoc, WorkoutTemplateDoc } from "./types";

/**
 * Load a list of documents, returning only the ones that have arrived as
 * `{ url, doc }` pairs in input order.
 */
export function useLoadedDocs<T>(urls: AutomergeUrl[]) {
  const [docsMap] = useDocuments<T>(urls, { suspense: false });
  return useMemo(
    () =>
      urls.flatMap((url) => {
        const doc = docsMap.get(url);
        return doc ? [{ url, doc }] : [];
      }),
    [urls, docsMap],
  );
}

export const useLoadedWorkoutTemplates = (urls: AutomergeUrl[]) =>
  useLoadedDocs<WorkoutTemplateDoc>(urls);

export const useLoadedWorkoutSessions = (urls: AutomergeUrl[]) =>
  useLoadedDocs<WorkoutSessionDoc>(urls);
