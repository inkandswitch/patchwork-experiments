import type { Equipment, ExerciseCategory, MuscleGroup } from "./types";

export const MUSCLE_GROUPS: MuscleGroup[] = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "full body",
  "cardio",
];

export const EQUIPMENT_OPTIONS: Equipment[] = [
  "barbell",
  "dumbbell",
  "cable",
  "machine",
  "kettlebell",
  "bodyweight",
  "bands",
  "other",
];

export const CATEGORIES: ExerciseCategory[] = [
  "compound",
  "isolation",
  "cardio",
  "other",
];

export const muscleGroupLabel = (group: MuscleGroup): string =>
  group.charAt(0).toUpperCase() + group.slice(1);

export const equipmentLabel = (eq: Equipment): string =>
  eq.charAt(0).toUpperCase() + eq.slice(1);
