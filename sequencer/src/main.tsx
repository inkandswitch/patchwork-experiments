import ReactDOM from "react-dom/client";
import "./style.css";
import { Repo } from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/react/slim";
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
      const { Sequencer } = await import("./tool");
      return (handle: any, element: HTMLElement & { repo: Repo }) => {
        console.log("[Sequencer] Startup with handle.url:", handle.url);
        const root = ReactDOM.createRoot(element);

        root.render(
          <RepoContext.Provider value={element.repo}>
            <Sequencer docUrl={handle.url} />
          </RepoContext.Provider>
        );
        return () => root.unmount();
      };
    },
  },
];
