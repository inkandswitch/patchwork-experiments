import type { AutomergeUrl } from "@automerge/automerge-repo";
import { omitUndefined } from "./automerge-fields";
import {
  bestSetFromSets,
  convertWeight,
  estimate1Rm,
  newId,
  setVolume,
} from "./calculations";
import { setsForExercise } from "./session-model";
import type {
  ExerciseHistoryEntry,
  ExerciseProgressPoint,
  LoggedExercise,
  LoggedSet,
  TemplateExercise,
  TemplateSet,
  WeightUnit,
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

      const completedSets = setsForExercise(doc, exercise.id).filter(
        (s) => s.completed,
      );
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
        unit: exercise.unit ?? doc.weightUnit,
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
  targetUnit: WeightUnit = "kg",
): ExerciseProgressPoint[] {
  const history = exerciseHistoryForUrl(exerciseUrl, sessions);
  return history
    .filter((entry) => entry.estimated1Rm != null && entry.estimated1Rm > 0)
    .map((entry) => {
      const from = entry.unit ?? targetUnit;
      return {
        date: entry.date,
        estimated1Rm: convertWeight(entry.estimated1Rm!, from, targetUnit),
        bestWeight: convertWeight(entry.bestSet?.weight ?? 0, from, targetUnit),
        bestReps: entry.bestSet?.reps ?? 0,
        volume: convertWeight(entry.totalVolume, from, targetUnit),
      };
    })
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

  const exercises: LoggedExercise[] = [];
  const sets: LoggedSet[] = [];

  for (const planned of template.exercises ?? []) {
    const exerciseId = newId();
    exercises.push(
      omitUndefined({
        id: exerciseId,
        exerciseUrl: planned.exerciseUrl,
        exerciseName: planned.exerciseName,
        notes: planned.notes,
        supersetGroup: planned.supersetGroup,
        unit: planned.unit,
      }) as LoggedExercise,
    );
    for (const set of planned.sets) {
      sets.push(
        omitUndefined({
          id: newId(),
          exerciseId,
          kind: set.kind,
          reps: set.targetReps ?? set.targetRepsMin,
          weight: set.targetWeight,
          rpe: set.targetRpe,
          restSeconds: set.restSeconds,
          completed: false,
          notes: set.notes,
        }) as LoggedSet,
      );
    }
  }

  return {
    title: `${template.title} — ${dateLabel}`,
    startedAt: now.toISOString(),
    templateUrl,
    exercises,
    sets,
    status: "in_progress",
    defaultRestSeconds: 90,
  };
}

/** Strip date suffix from session titles like "Push Day — Jun 10, 2026". */
export function templateTitleFromSession(sessionTitle: string): string {
  const stripped = sessionTitle
    .replace(
      /\s+[—–-]\s+(?:\w{3,9}\s+\d{1,2},?\s*(?:\d{4})?|\d{1,2}\s+\w{3,9}\s+\d{4})$/i,
      "",
    )
    .trim();
  return stripped || sessionTitle;
}

function loggedSetToTemplateSet(set: LoggedSet): TemplateSet {
  return omitUndefined({
    kind: set.kind,
    targetReps: set.reps,
    targetWeight: set.weight,
    targetRpe: set.rpe,
    restSeconds: set.restSeconds,
    notes: set.notes,
  }) as TemplateSet;
}

/** Build template content from a completed (or in-progress) session. */
export function createTemplateFromSession(
  session: WorkoutSessionDoc,
  title?: string,
): Omit<WorkoutTemplateDoc, "@patchwork"> {
  const exercises: TemplateExercise[] = (session.exercises ?? [])
    .map((exercise) => {
      const sets = setsForExercise(session, exercise.id)
        .filter(
          (set) =>
            set.completed ||
            set.reps != null ||
            set.weight != null ||
            set.durationSeconds != null,
        )
        .map(loggedSetToTemplateSet);
      if (!sets.length) return null;
      return omitUndefined({
        id: newId(),
        exerciseUrl: exercise.exerciseUrl,
        exerciseName: exercise.exerciseName,
        notes: exercise.notes,
        supersetGroup: exercise.supersetGroup,
        unit: exercise.unit,
        sets,
      }) as TemplateExercise;
    })
    .filter((exercise): exercise is TemplateExercise => exercise != null);

  return omitUndefined({
    title: title ?? templateTitleFromSession(session.title),
    notes: session.notes,
    exercises,
    gymUrl: session.gymUrl,
    exercisesFolderUrl: session.exercisesFolderUrl,
  }) as Omit<WorkoutTemplateDoc, "@patchwork">;
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
  if (set.kind === "warmup") parts.push("(warmup)");
  if (set.kind === "failure") parts.push("(to failure)");
  return parts.length ? parts.join(" ") : "—";
}
