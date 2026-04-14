import type { Plugin, Tool, Datatype } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "grjte-spec-viewer",
    name: "grjte Spec Viewer",
    supportedDatatypes: ["spec"],
    async load() {
      const { SpecTool } = await import("./spec/tool");
      return SpecTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "grjte-plan-viewer",
    name: "grjte Plan Viewer",
    supportedDatatypes: ["task-list-plan"],
    async load() {
      const { PlanTool } = await import("./plan/tool");
      return PlanTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:datatype",
    id: "task-list-plan",
    name: "Task List Plan",
    icon: "ListChecks",
    async load() {
      const { TaskListPlanDatatype } = await import("./plan/types");
      return TaskListPlanDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "task",
    name: "Task",
    icon: "CheckSquare",
    async load() {
      const { TaskDatatype } = await import("./plan/types");
      return TaskDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "task-list-execution",
    name: "Task List Execution",
    icon: "Play",
    async load() {
      const { TaskListExecutionDatatype } = await import("./execution/types");
      return TaskListExecutionDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "grjte-validation-viewer",
    name: "grjte Validation Viewer",
    supportedDatatypes: ["validation"],
    async load() {
      const { ValidationTool } = await import("./validation/tool");
      return ValidationTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "grjte-artifact-projection",
    name: "grjte Artifact Projection",
    supportedDatatypes: ["workflow-artifact"],
    async load() {
      const { ArtifactProjectionTool } =
        await import("./artifact-projection/tool");
      return ArtifactProjectionTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:datatype",
    id: "artifact-projection",
    name: "Artifact Projection",
    icon: "TableProperties",
    async load() {
      const { ArtifactProjectionDatatype } =
        await import("./artifact-projection/datatype");
      return ArtifactProjectionDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "grjte-execution-viewer",
    name: "grjte Execution Viewer",
    supportedDatatypes: ["task-list-execution"],
    async load() {
      const { ExecutionTool } = await import("./execution/tool");
      return ExecutionTool;
    },
  } satisfies Tool,
];
