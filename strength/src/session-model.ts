import { useEffect } from "react";
import type { DocHandle } from "@automerge/automerge-repo";
import { omitUndefined } from "./automerge-fields";
import { newId } from "./calculations";
import type {
  LoggedExercise,
  LoggedSet,
  WeightUnit,
  WorkoutSessionDoc,
} from "./types";

/**
 * Sessions store sets *flat* (`doc.sets`, in execution order) so that
 * supersets can interleave sets across exercises and so a single pattern
 * segment (`sets/{"completed":false}`) can address the current set.
 *
 * Older docs nested sets under each exercise; the readers here normalize
 * both shapes, and `flattenSessionDoc` migrates legacy docs in place.
 */

/** All sets in execution order, normalizing legacy nested docs. */
export function sessionSets(session: WorkoutSessionDoc): LoggedSet[] {
  if (session.sets) return session.sets;
  return (session.exercises ?? []).flatMap((exercise) =>
    (exercise.sets ?? []).map((set, index) => ({
      ...set,
      // Synthesized, stable-enough ids for read-only legacy views.
      id: `${exercise.id}:${index}`,
      exerciseId: exercise.id,
    })),
  );
}

export function setsForExercise(
  session: WorkoutSessionDoc,
  exerciseId: string,
): LoggedSet[] {
  return sessionSets(session).filter((set) => set.exerciseId === exerciseId);
}

export function exerciseById(
  session: WorkoutSessionDoc,
  exerciseId: string,
): LoggedExercise | undefined {
  return (session.exercises ?? []).find((ex) => ex.id === exerciseId);
}

export function unitForExercise(
  session: WorkoutSessionDoc,
  exerciseId: string,
  fallback: WeightUnit = "kg",
): WeightUnit {
  return exerciseById(session, exerciseId)?.unit ?? session.weightUnit ?? fallback;
}

export function isLegacySessionShape(session: WorkoutSessionDoc): boolean {
  return (
    !session.sets &&
    (session.exercises ?? []).some((ex) => (ex.sets?.length ?? 0) > 0)
  );
}

export function newLoggedSet(
  exerciseId: string,
  data?: Partial<LoggedSet>,
): LoggedSet {
  return omitUndefined({
    completed: false,
    ...data,
    id: newId(),
    exerciseId,
  }) as LoggedSet;
}

/** Append a set at the end of an exercise's block in execution order. */
export function pushSetForExercise(
  draft: WorkoutSessionDoc,
  exerciseId: string,
  set: LoggedSet,
): void {
  if (!draft.sets) draft.sets = [];
  let insertAt = draft.sets.length;
  for (let i = draft.sets.length - 1; i >= 0; i--) {
    if (draft.sets[i].exerciseId === exerciseId) {
      insertAt = i + 1;
      break;
    }
  }
  draft.sets.splice(insertAt, 0, set);
}

/** In-place migration from the legacy nested shape. Call inside change(). */
export function flattenSessionDoc(draft: WorkoutSessionDoc): void {
  if (draft.sets) return;
  const flat: LoggedSet[] = [];
  for (const exercise of draft.exercises ?? []) {
    for (const set of exercise.sets ?? []) {
      flat.push(
        omitUndefined({
          id: newId(),
          exerciseId: exercise.id,
          kind: set.kind,
          reps: set.reps,
          weight: set.weight,
          rpe: set.rpe,
          durationSeconds: set.durationSeconds,
          restSeconds: set.restSeconds,
          completed: set.completed,
          notes: set.notes,
        }) as LoggedSet,
      );
    }
  }
  draft.sets = flat;
  for (const exercise of draft.exercises ?? []) {
    delete exercise.sets;
  }
}

/** Lazily migrate a legacy session doc the first time it's opened to edit. */
export function useFlatSessionMigration(
  sessionHandle: DocHandle<WorkoutSessionDoc>,
  session: WorkoutSessionDoc | undefined,
): void {
  const needsMigration = session ? isLegacySessionShape(session) : false;
  useEffect(() => {
    if (!needsMigration) return;
    sessionHandle.change((draft) => flattenSessionDoc(draft));
  }, [needsMigration, sessionHandle]);
}
