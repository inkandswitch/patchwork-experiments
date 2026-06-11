import type { AutomergeUrl } from "@automerge/automerge-repo";

export interface DocLink {
  name: string;
  type: string;
  url: AutomergeUrl;
}

export type WeightUnit = "kg" | "lb";

/** Special set markers; absent = normal working set. */
export type SetKind = "warmup" | "failure";

/** Metadata for strength training folders (gym root and subfolders). */
export interface StrengthFolderMeta {
  strengthGymUrl?: AutomergeUrl;
  strengthRole?: "gym" | "exercises" | "templates" | "sessions";
  exercisesFolderUrl?: AutomergeUrl;
  templatesFolderUrl?: AutomergeUrl;
  sessionsFolderUrl?: AutomergeUrl;
}

export interface FolderDoc extends StrengthFolderMeta {
  "@patchwork"?: { type: string };
  title: string;
  docs: DocLink[];
  preferredUnit?: WeightUnit;
}

export type ExerciseCategory = "compound" | "isolation" | "cardio" | "other";

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "full body"
  | "cardio";

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "cable"
  | "machine"
  | "kettlebell"
  | "bodyweight"
  | "bands"
  | "other";

export interface ExerciseDoc {
  "@patchwork"?: { type: "strength-exercise" };
  name: string;
  aliases?: string[];
  muscleGroups: MuscleGroup[];
  equipment: Equipment[];
  category: ExerciseCategory;
  instructions?: string;
  defaultUnit?: WeightUnit;
  notes?: string;
}

export interface TemplateSet {
  kind?: SetKind;
  targetReps?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetWeight?: number;
  targetRpe?: number;
  restSeconds?: number;
  notes?: string;
}

export interface TemplateExercise {
  id: string;
  exerciseUrl: AutomergeUrl;
  exerciseName: string;
  sets: TemplateSet[];
  notes?: string;
  supersetGroup?: string;
  /** Weight unit for this exercise; falls back to the session/gym default. */
  unit?: WeightUnit;
}

/** Reusable workout blueprint — cloned into sessions, never mutated by a workout. */
export interface WorkoutTemplateDoc {
  "@patchwork"?: { type: "strength-workout-template" };
  title: string;
  notes?: string;
  exercises: TemplateExercise[];
  gymUrl?: AutomergeUrl;
  /** Denormalized from gym/folder for standalone template editing. */
  exercisesFolderUrl?: AutomergeUrl;
  sessionsFolderUrl?: AutomergeUrl;
}

/** Field data shared by current (flat) and legacy (nested) logged sets. */
export interface LoggedSetData {
  kind?: SetKind;
  reps?: number;
  weight?: number;
  rpe?: number;
  durationSeconds?: number;
  /** Rest after this set (seconds); copied from template when present. */
  restSeconds?: number;
  completed: boolean;
  notes?: string;
}

export interface LoggedSet extends LoggedSetData {
  id: string;
  /** Which LoggedExercise this set belongs to. */
  exerciseId: string;
}

/** Exercise metadata within a session. Sets live flat on the session doc. */
export interface LoggedExercise {
  id: string;
  exerciseUrl: AutomergeUrl;
  exerciseName: string;
  notes?: string;
  supersetGroup?: string;
  /** Weight unit for this exercise; falls back to the session/gym default. */
  unit?: WeightUnit;
  /** @deprecated Legacy nested shape — flattened into WorkoutSessionDoc.sets. */
  sets?: LoggedSetData[];
}

/** A single workout instance, cloned from a template. */
export interface WorkoutSessionDoc {
  "@patchwork"?: { type: "strength-workout-session" };
  title: string;
  startedAt: string;
  completedAt?: string;
  durationSeconds?: number;
  templateUrl?: AutomergeUrl;
  notes?: string;
  exercises: LoggedExercise[];
  /**
   * All sets, flat, in execution order (this is what makes supersets
   * expressible). Absent on legacy docs, where sets are nested per
   * exercise — use sessionSets() to read either shape.
   */
  sets?: LoggedSet[];
  status: "in_progress" | "completed";
  /** Default rest between sets when a set has no restSeconds. */
  defaultRestSeconds?: number;
  /** Weight unit for logged sets (e.g. lb for Hevy imports). */
  weightUnit?: WeightUnit;
  /** Denormalized from sessions folder for save-as-template. */
  gymUrl?: AutomergeUrl;
  exercisesFolderUrl?: AutomergeUrl;
  templatesFolderUrl?: AutomergeUrl;
  sessionsFolderUrl?: AutomergeUrl;
}

export interface ExerciseHistoryEntry {
  date: string;
  workoutTitle: string;
  workoutUrl: AutomergeUrl;
  sets: LoggedSet[];
  bestSet: LoggedSet | null;
  estimated1Rm: number | null;
  totalVolume: number;
  /** Unit the sets were logged in (exercise unit, else session unit). */
  unit?: WeightUnit;
}

export interface ExerciseProgressPoint {
  date: string;
  estimated1Rm: number;
  bestWeight: number;
  bestReps: number;
  volume: number;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "doc-url"?: AutomergeUrl | string | null;
          "tool-id"?: string;
          class?: string;
        },
        HTMLElement
      >;
    }
  }
}
