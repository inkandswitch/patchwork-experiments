import type { LoggedExercise, LoggedSet } from "./types";

export type SetPointer = {
  exerciseId: string;
  setIndex: number;
};

export function setRowId(pointer: SetPointer): string {
  return `strength-set-${pointer.exerciseId}-${pointer.setIndex}`;
}

export function listIncompleteSets(exercises: LoggedExercise[]): SetPointer[] {
  const pointers: SetPointer[] = [];
  for (const exercise of exercises) {
    for (let setIndex = 0; setIndex < exercise.sets.length; setIndex++) {
      if (!exercise.sets[setIndex].completed) {
        pointers.push({ exerciseId: exercise.id, setIndex });
      }
    }
  }
  return pointers;
}

export function findNextIncompleteSet(
  exercises: LoggedExercise[],
  after?: SetPointer | null,
): SetPointer | null {
  const incomplete = listIncompleteSets(exercises);
  if (!incomplete.length) return null;
  if (!after) return incomplete[0];

  const currentIndex = incomplete.findIndex(
    (pointer) =>
      pointer.exerciseId === after.exerciseId &&
      pointer.setIndex === after.setIndex,
  );
  if (currentIndex < 0) return incomplete[0];
  return incomplete[currentIndex + 1] ?? null;
}

export function restSecondsForSet(
  set: LoggedSet,
  sessionDefault = 90,
): number {
  const value = set.restSeconds ?? sessionDefault;
  return value > 0 ? value : 90;
}
