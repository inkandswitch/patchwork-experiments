import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createContext, useContext } from "react";

const ToolSketchDocContext = createContext<AutomergeUrl | null>(null);

export const ToolSketchDocProvider = ToolSketchDocContext.Provider;

export function useToolSketchDocUrl(): AutomergeUrl | null {
  return useContext(ToolSketchDocContext);
}
