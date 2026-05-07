import ReactDOM from "react-dom/client";
import {
  mountStandaloneApp,
  type ToolRegistration,
  type ToolElement,
} from "@jtfmumm/patchwork-standalone-frame";
import { RepoContext } from "@automerge/react/slim";
import type { DocHandle } from "@automerge/automerge-repo";
import { dataType, init, type SequencerDoc } from "./datatype";
import { Sequencer } from "./tool";
import "./style.css";

const sequencerRegistration: ToolRegistration<SequencerDoc> = {
  id: "sequencer",
  name: "Sequencer",
  defaultTitle: "Untitled Song",
  syncUrl: "wss://keyhive.sync.automerge.org",
  init,
  getTitle: dataType.getTitle,
  setTitle: dataType.setTitle,
  isDocReady: (doc) => !!(doc?.toggleRows && doc?.config),
  render: (handle: DocHandle<SequencerDoc>, element: ToolElement) => {
    const root = ReactDOM.createRoot(element);
    root.render(
      <RepoContext.Provider value={element.repo}>
        <Sequencer docUrl={handle.url} />
      </RepoContext.Provider>
    );
    return () => root.unmount();
  },
};

const rootEl = document.getElementById("root");
if (rootEl) mountStandaloneApp(rootEl, sequencerRegistration);
