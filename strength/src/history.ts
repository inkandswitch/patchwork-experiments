import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  bestSetFromSets,
  estimate1Rm,
  newId,
  setVolume,
} from "./calculations";
import type {
  ExerciseHistoryEntry,
  ExerciseProgressPoint,
  LoggedExercise,
  LoggedSet,
  WorkoutSessionDoc,
  WorkoutTemplateDoc,
} from "./types";

export type LoadedWorkoutSession = {
  url: AutomergeUrl;
  doc: WorkoutSessionDoc;
};

export function exerciseHistoryForUrl(
  exerciseUrl: AutomergeUrl,
  sessions: LoadedWorkoutSession[],
): ExerciseHistoryEntry[] {
  const entries: ExerciseHistoryEntry[] = [];

  for (const { url, doc } of sessions) {
    if (doc.status !== "completed" && !doc.completedAt) continue;

    for (const exercise of doc.exercises ?? []) {
      if (exercise.exerciseUrl !== exerciseUrl) continue;

      const completedSets = (exercise.sets ?? []).filter((s) => s.completed);
      if (!completedSets.length) continue;

      const best = bestSetFromSets(completedSets);
      const estimated1Rm = best
        ? estimate1Rm(best.weight ?? 0, best.reps ?? 0)
        : null;

      entries.push({
        date: doc.completedAt ?? doc.startedAt,
        workoutTitle: doc.title,
        workoutUrl: url,
        sets: completedSets,
        bestSet: best,
        estimated1Rm: estimated1Rm && estimated1Rm > 0 ? estimated1Rm : null,
        totalVolume: completedSets.reduce((sum, s) => sum + setVolume(s), 0),
      });
    }
  }

  return entries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

export function progressPointsForExercise(
  exerciseUrl: AutomergeUrl,
  sessions: LoadedWorkoutSession[],
): ExerciseProgressPoint[] {
  const history = exerciseHistoryForUrl(exerciseUrl, sessions);
  return history
    .filter((entry) => entry.estimated1Rm != null && entry.estimated1Rm > 0)
    .map((entry) => ({
      date: entry.date,
      estimated1Rm: entry.estimated1Rm!,
      bestWeight: entry.bestSet?.weight ?? 0,
      bestReps: entry.bestSet?.reps ?? 0,
      volume: entry.totalVolume,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/** Clone a template into a fresh in-progress session (new exercise/set IDs). */
export function createSessionFromTemplate(
  template: WorkoutTemplateDoc,
  templateUrl: AutomergeUrl,
): Omit<WorkoutSessionDoc, "@patchwork"> {
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const exercises: LoggedExercise[] = (template.exercises ?? []).map(
    (planned) => ({
      id: newId(),
      exerciseUrl: planned.exerciseUrl,
      exerciseName: planned.exerciseName,
      notes: planned.notes,
      supersetGroup: planned.supersetGroup,
      sets: planned.sets.map((set) => ({
        reps: set.targetReps ?? set.targetRepsMin,
        weight: set.targetWeight,
        rpe: set.targetRpe,
        completed: false,
        notes: set.notes,
      })),
    }),
  );

  return {
    title: `${template.title} — ${dateLabel}`,
    startedAt: now.toISOString(),
    templateUrl,
    exercises,
    status: "in_progress",
  };
}

export function summarizeSet(set: LoggedSet, unit = "kg"): string {
  const parts: string[] = [];
  if (set.weight != null && set.weight > 0) {
    parts.push(`${set.weight} ${unit}`);
  }
  if (set.reps != null && set.reps > 0) {
    parts.push(`× ${set.reps}`);
  }
  if (set.rpe != null) {
    parts.push(`@ RPE ${set.rpe}`);
  }
  if (set.durationSeconds != null && set.durationSeconds > 0) {
    const mins = Math.floor(set.durationSeconds / 60);
    const secs = set.durationSeconds % 60;
    parts.push(`${mins}:${secs.toString().padStart(2, "0")}`);
  }
  return parts.length ? parts.join(" ") : "—";
}
