import { render } from "solid-js/web";
import type { Repo } from "@automerge/automerge-repo/slim";
import { PatchesPanel } from "./Panel";

export const renderPatchesPanel = (element: HTMLElement & { repo: Repo }) =>
  render(() => <PatchesPanel element={element} />, element);
