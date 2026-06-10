import type { ExerciseDoc } from "./types";

export const DEFAULT_EXERCISES: Omit<ExerciseDoc, "@patchwork">[] = [
  {
    name: "Barbell Bench Press",
    muscleGroups: ["chest", "shoulders", "triceps"],
    equipment: ["barbell"],
    category: "compound",
    instructions:
      "Lie on bench, grip slightly wider than shoulders. Lower bar to mid-chest, press up.",
  },
  {
    name: "Barbell Back Squat",
    muscleGroups: ["quads", "glutes", "hamstrings", "core"],
    equipment: ["barbell"],
    category: "compound",
    instructions:
      "Bar on upper back, feet shoulder-width. Break at hips and knees, drive up.",
  },
  {
    name: "Conventional Deadlift",
    muscleGroups: ["back", "hamstrings", "glutes", "core"],
    equipment: ["barbell"],
    category: "compound",
    instructions:
      "Hinge at hips, grip bar outside knees. Drive through floor, lock out hips.",
  },
  {
    name: "Overhead Press",
    muscleGroups: ["shoulders", "triceps", "core"],
    equipment: ["barbell"],
    category: "compound",
    instructions: "Press bar from front rack to lockout overhead.",
  },
  {
    name: "Barbell Row",
    muscleGroups: ["back", "biceps"],
    equipment: ["barbell"],
    category: "compound",
    instructions: "Hinge forward, pull bar to lower chest/upper abs.",
  },
  {
    name: "Pull-Up",
    aliases: ["Chin-Up"],
    muscleGroups: ["back", "biceps"],
    equipment: ["bodyweight"],
    category: "compound",
    instructions: "Hang from bar, pull until chin clears bar.",
  },
  {
    name: "Dumbbell Romanian Deadlift",
    muscleGroups: ["hamstrings", "glutes", "back"],
    equipment: ["dumbbell"],
    category: "compound",
    instructions: "Soft knees, hinge hips back, lower DBs along legs.",
  },
  {
    name: "Dumbbell Lateral Raise",
    muscleGroups: ["shoulders"],
    equipment: ["dumbbell"],
    category: "isolation",
    instructions: "Raise arms to sides until parallel with floor.",
  },
  {
    name: "Cable Tricep Pushdown",
    muscleGroups: ["triceps"],
    equipment: ["cable"],
    category: "isolation",
    instructions: "Elbows pinned, extend forearms down.",
  },
  {
    name: "Leg Press",
    muscleGroups: ["quads", "glutes"],
    equipment: ["machine"],
    category: "compound",
    instructions: "Feet mid-platform, lower sled with control, press up.",
  },
  {
    name: "Lat Pulldown",
    muscleGroups: ["back", "biceps"],
    equipment: ["cable"],
    category: "compound",
    instructions: "Pull bar to upper chest, squeeze lats.",
  },
  {
    name: "Plank",
    muscleGroups: ["core"],
    equipment: ["bodyweight"],
    category: "other",
    instructions: "Forearms and toes, maintain straight line.",
  },
];
