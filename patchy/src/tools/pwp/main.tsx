import { render } from "solid-js/web";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { Pwp } from "./Pwp";

export const renderPwp = (handle: DocHandle<any>, element: ToolElement) =>
  render(() => <Pwp handle={handle} element={element} />, element);
