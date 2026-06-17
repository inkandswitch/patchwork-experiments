import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { PartsBinDoc, PartsBinItem } from "./types";
import type { SearchDoc } from "../../search/datatype";
import type { PoiProviderDoc } from "../../poi/datatype";

export const PartsBinDatatype: DatatypeImplementation<PartsBinDoc> = {
  init(doc, repo) {
    doc["@patchwork"] = { type: "parts-bin" };
    doc.title = "Parts bin";
    doc.items = seedExampleItems(repo);
  },
  getTitle(doc) {
    return doc.title || "Parts bin";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

// Create a ready-to-embed parts bin seeded with the example documents. Used by
// the canvas datatype, which embeds one in every fresh canvas. Raw
// `repo.create` doesn't run a datatype's `init`, so the seeding lives here
// (shared with `init`) rather than relying on the host to seed nested docs.
export function createPartsBin(repo: Repo): DocHandle<PartsBinDoc> {
  return repo.create<PartsBinDoc>({
    "@patchwork": { type: "parts-bin" },
    title: "Parts bin",
    items: seedExampleItems(repo),
  });
}

// The starter set: a search box and a POI provider. Each is a real document;
// the bin previews them live and hands out clones on drag. `repo.create`
// doesn't run a datatype's `init`, so each child doc's initial value is set
// inline here.
function seedExampleItems(repo: Repo): PartsBinItem[] {
  const search = repo.create<SearchDoc>({
    "@patchwork": { type: "search" },
    query: "",
    results: [],
  });
  const poi = repo.create<PoiProviderDoc>({
    "@patchwork": { type: "poi-provider" },
  });

  return [
    { url: search.url, toolId: "search" },
    { url: poi.url, toolId: "poi-provider" },
  ];
}
