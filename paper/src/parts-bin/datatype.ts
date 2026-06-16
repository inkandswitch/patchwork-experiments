import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { PaperMapDoc } from "../map/types";
import type { PartsBinDoc, PartsBinItem } from "./types";

export const PartsBinDatatype = {
  init(doc: PartsBinDoc, repo: Repo) {
    doc.title = "Parts bin";
    doc.items = seedExampleItems(repo);
  },
  getTitle(doc: PartsBinDoc) {
    return doc.title || "Parts bin";
  },
  setTitle(doc: PartsBinDoc, title: string) {
    doc.title = title;
  },
};

// Create a ready-to-embed parts bin seeded with the example documents. Used by
// the paper datatype, which embeds one in every fresh paper. Raw `repo.create`
// doesn't run a datatype's `init`, so the seeding lives here (shared with
// `init`) rather than relying on the host to seed nested docs.
export function createPartsBin(repo: Repo): DocHandle<PartsBinDoc> {
  return repo.create<PartsBinDoc>({
    "@patchwork": { type: "parts-bin" },
    title: "Parts bin",
    items: seedExampleItems(repo),
  });
}

// The starter set: an editable markdown note and a map. Each is a real
// document; the bin previews them live and hands out clones on drag.
function seedExampleItems(repo: Repo): PartsBinItem[] {
  const markdown = repo.create({
    "@patchwork": { type: "markdown" },
    content: "# Example note\n\nDrag me onto the canvas to make a copy.",
  });

  const map = repo.create<PaperMapDoc>({
    "@patchwork": { type: "paper-map" },
    title: "Map",
    layers: {},
  });

  return [
    { url: markdown.url, toolId: "codemirror-base" },
    { url: map.url, toolId: "paper-map" },
  ];
}
