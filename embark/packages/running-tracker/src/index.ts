import type { Plugin } from "@inkandswitch/patchwork-plugins";

// A mobile running tracker. The `run-log` datatype is the app users open (the
// single document that indexes every run); each recorded run is its own `run`
// document. One tool renders both: the full app on a log, a summary on a run.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "running-tracker",
    name: "Run Tracker",
    icon: "Footprints",
    supportedDatatypes: ["run-log", "run"],
    async load() {
      const { RunningTrackerTool } = await import("./RunningTrackerTool");
      return RunningTrackerTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "run-log",
    name: "Run Tracker",
    icon: "Footprints",
    async load() {
      const { RunLogDatatype } = await import("./datatype");
      return RunLogDatatype;
    },
  },
  {
    type: "patchwork:datatype",
    id: "run",
    name: "Run",
    icon: "Footprints",
    async load() {
      const { RunDatatype } = await import("./datatype");
      return RunDatatype;
    },
  },
];
