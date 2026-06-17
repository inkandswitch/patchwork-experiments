import type { Repo } from "@automerge/automerge-repo";
import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { EmbarkCanvasDoc, EmbarkEmbed } from "./EmbarkCanvas";
import type { SearchDoc } from "../search/datatype";
import type { PoiProviderDoc } from "../poi/datatype";

export const EmbarkCanvasDatatype: DatatypeImplementation<EmbarkCanvasDoc> = {
  init(doc, repo) {
    doc["@patchwork"] = { type: "embark-canvas" };
    doc.title = "Canvas";
    doc.embeds = seedDefaultEmbeds(repo);
  },
  getTitle(doc: EmbarkCanvasDoc) {
    return doc.title || "Canvas";
  },
  setTitle(doc: EmbarkCanvasDoc, title: string) {
    doc.title = title;
  },
};

// A fresh canvas comes pre-wired with a search box and a POI provider so the
// search demo works out of the box: type a place into the search box and the
// POI provider answers from OpenStreetMap. `repo.create` doesn't run a
// datatype's `init`, so each child doc's initial value is set inline.
function seedDefaultEmbeds(repo: Repo): EmbarkCanvasDoc["embeds"] {
  const search = repo.create<SearchDoc>({
    "@patchwork": { type: "search" },
    query: "",
    results: [],
  });
  const poi = repo.create<PoiProviderDoc>({
    "@patchwork": { type: "poi-provider" },
  });

  const searchEmbed: EmbarkEmbed = {
    id: crypto.randomUUID(),
    docUrl: search.url,
    toolId: "search",
    x: 40,
    y: 40,
    width: 320,
    height: 360,
    z: 1,
  };
  const poiEmbed: EmbarkEmbed = {
    id: crypto.randomUUID(),
    docUrl: poi.url,
    toolId: "poi-provider",
    x: 400,
    y: 40,
    width: 300,
    height: 300,
    z: 2,
  };

  return {
    [searchEmbed.id]: searchEmbed,
    [poiEmbed.id]: poiEmbed,
  };
}
