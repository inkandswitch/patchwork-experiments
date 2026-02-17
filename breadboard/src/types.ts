import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";

export interface PatchworkViewElement extends HTMLElement {
  repo: Repo;
  docUrl?: AutomergeUrl;
  toolId?: string;
}

export interface DiscoveredView {
  element: PatchworkViewElement;
  toolId: string | null;
  docUrl: string | null;
  parent: HTMLElement | null;
  depth: number;
}

export interface SlotInfo {
  fieldName: string;
  kind: "single" | "array";
  currentValue: string | string[];
}

export type EnrichedConfigMap = Map<string, SlotInfo>;
export type StyleOriginals = Map<HTMLElement, Record<string, string>>;
export type OnSlotChange = (fieldName: string, newValue: string | string[]) => void;

export interface PlacedCard {
  card: HTMLElement;
  view: DiscoveredView;
  x: number;
  y: number;
  key: string;
}
