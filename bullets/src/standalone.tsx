import { render } from "solid-js/web";
import {
  mountStandaloneApp,
  type ToolRegistration,
  type ToolElement,
} from "@jtfmumm/patchwork-standalone-frame";
import type { DocHandle } from "@automerge/automerge-repo";
import { datatype, type BulletsDoc } from "./datatype.ts";
import { BulletsTool } from "./tool.tsx";

const bulletsRegistration: ToolRegistration<BulletsDoc> = {
  id: "bullets",
  name: "Bullets",
  defaultTitle: "Untitled Bullets",
  syncUrl: "wss://keyhive.sync.automerge.org",
  init: datatype.init,
  getTitle: datatype.getTitle,
  setTitle: datatype.setTitle,
  isDocReady: (doc) => !!(doc?.nodes && doc?.rootId && doc.nodes[doc.rootId]),
  render: (handle: DocHandle<BulletsDoc>, element: ToolElement) => {
    return render(() => <BulletsTool handle={handle} element={element} />, element);
  },
};

const root = document.getElementById("root");
if (root) mountStandaloneApp(root, bulletsRegistration);
