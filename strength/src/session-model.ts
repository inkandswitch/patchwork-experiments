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
 */

/** All sets in execution order. */
export function sessionSets(session: WorkoutSessionDoc): LoggedSet[] {
  return session.sets ?? [];
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
