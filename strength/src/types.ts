import type { AutomergeUrl } from "@automerge/automerge-repo";

export interface DocLink {
  name: string;
  type: string;
  url: AutomergeUrl;
}

export type WeightUnit = "kg" | "lb";

/** Metadata stamped on gym subfolders at bootstrap time. */
export interface StrengthFolderMeta {
  strengthGymUrl?: AutomergeUrl;
  strengthRole?: "exercises" | "templates" | "sessions";
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

export interface StrengthGymDoc {
  "@patchwork"?: { type: "strength-gym" };
  title: string;
  /** Set automatically when the gym is bootstrapped. */
  exercisesFolderUrl?: AutomergeUrl;
  templatesFolderUrl?: AutomergeUrl;
  sessionsFolderUrl?: AutomergeUrl;
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
}

/** Reusable workout blueprint — cloned into sessions, never mutated by a workout. */
export interface WorkoutTemplateDoc {
  "@patchwork"?: { type: "strength-workout-template" };
  title: string;
  notes?: string;
  exercises: TemplateExercise[];
  gymUrl?: AutomergeUrl;
}

export interface LoggedSet {
  reps?: number;
  weight?: number;
  rpe?: number;
  durationSeconds?: number;
  completed: boolean;
  notes?: string;
}

export interface LoggedExercise {
  id: string;
  exerciseUrl: AutomergeUrl;
  exerciseName: string;
  sets: LoggedSet[];
  notes?: string;
  supersetGroup?: string;
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
  status: "in_progress" | "completed";
}

export interface ExerciseHistoryEntry {
  date: string;
  workoutTitle: string;
  workoutUrl: AutomergeUrl;
  sets: LoggedSet[];
  bestSet: LoggedSet | null;
  estimated1Rm: number | null;
  totalVolume: number;
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
