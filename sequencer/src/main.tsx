import { dataType } from "./datatype";

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "sequencer",
    name: "Sequencer",
    icon: "Music",
    async load() {
      return dataType;
    },
  },
  {
    type: "patchwork:tool",
    id: "sequencer",
    name: "Sequencer",
    supportedDatatypes: ["sequencer"],
    async load() {
      const { renderSequencer } = await import("./tool");
      return renderSequencer;
    },
  },
];
