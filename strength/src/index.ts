import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";
import "./index.css";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "strength-exercise",
    name: "Exercise",
    icon: "Dumbbell",
    async load() {
      const { ExerciseDatatype } = await import("./datatype");
      return ExerciseDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "strength-exercise-library",
    name: "Exercise Library",
    icon: "Library",
    async load() {
      const { ExerciseLibraryDatatype } = await import("./datatype");
      return ExerciseLibraryDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "strength-workout-template",
    name: "Workout Template",
    icon: "ClipboardList",
    async load() {
      const { WorkoutTemplateDatatype } = await import("./datatype");
      return WorkoutTemplateDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "strength-workout-session",
    name: "Workout Session",
    icon: "Activity",
    async load() {
      const { WorkoutSessionDatatype } = await import("./datatype");
      return WorkoutSessionDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "strength-gym",
    name: "Gym",
    icon: "Home",
    supportedDatatypes: ["folder"],
    async load() {
      const { GymTool } = await import("./gym-tool");
      return GymTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-exercise",
    name: "Exercise",
    icon: "Dumbbell",
    supportedDatatypes: ["strength-exercise"],
    async load() {
      const { ExerciseTool } = await import("./exercise-tool");
      return ExerciseTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-library",
    name: "Exercise Library",
    icon: "Library",
    supportedDatatypes: ["strength-exercise-library"],
    async load() {
      const { ExerciseLibraryDocTool } = await import("./library-tool");
      return ExerciseLibraryDocTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-workout-template",
    name: "Workout Template",
    icon: "ClipboardList",
    supportedDatatypes: ["strength-workout-template"],
    async load() {
      const { WorkoutTemplateTool } = await import("./template-tool");
      return WorkoutTemplateTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-templates",
    name: "Templates",
    icon: "ClipboardList",
    supportedDatatypes: ["folder"],
    async load() {
      const { TemplatesTool } = await import("./templates-tool");
      return TemplatesTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-workout-session",
    name: "Workout Session",
    icon: "Play",
    supportedDatatypes: ["strength-workout-session"],
    async load() {
      const { WorkoutSessionTool } = await import("./session-tool");
      return WorkoutSessionTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-exercise-logger",
    name: "Exercise Logger",
    icon: "Target",
    supportedDatatypes: ["strength-workout-session"],
    async load() {
      const { ExerciseLoggerTool } = await import("./exercise-logger-tool");
      return ExerciseLoggerTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-current-set",
    name: "Current Set",
    icon: "Crosshair",
    supportedDatatypes: ["strength-workout-session"],
    async load() {
      const { CurrentSetTool } = await import("./current-set-tool");
      return CurrentSetTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-set",
    name: "Set",
    icon: "CircleDot",
    supportedDatatypes: ["strength-workout-session"],
    async load() {
      const { SetTool } = await import("./set-tool");
      return SetTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "strength-sessions",
    name: "Sessions",
    icon: "TrendingUp",
    supportedDatatypes: ["folder"],
    async load() {
      const { SessionsTool } = await import("./sessions-tool");
      return SessionsTool;
    },
  } satisfies Tool,
];
