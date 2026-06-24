import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { PartsBinDoc, PartsBinItem } from "./types";
import type { SearchDoc } from "../../search/datatype";
import type { PoiProviderDoc } from "../../poi/datatype";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  type MapDoc,
} from "../../map/datatype";
import type { ColorStylerDoc } from "../../stickers/sources/color-styler/datatype";
import type { UnitConverterDoc } from "../../stickers/sources/unit-converter/datatype";
import type { TimerSourceDoc } from "../../stickers/sources/timer-source/datatype";

// A markdown document, shaped for both the schema-match provider (it has
// `@patchwork.type` + `content`) and the CodeMirror editor (reads `content`).
type MarkdownDoc = {
  "@patchwork": { type: "markdown" };
  content: string;
};

// A sample note exercising all three sticker sources at once: a named color and
// a hex color (styler), imperial quantities (converter), and a timer token.
const DEMO_MARKDOWN = `# Trip notes

The route is about 5 miles along a red trail.
Take a break partway: @timer 5m

Bring 10 lb of gear. The summit hut is painted #2f80ed.
`;

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

// The starter set: a search box, a POI provider, a map, the three sticker
// sources, and a demo markdown note for them to annotate. Each is a real
// document; the bin previews them live and hands out clones on drag.
// `repo.create` doesn't run a datatype's `init`, so each child doc's initial
// value is set inline here.
function seedExampleItems(repo: Repo): PartsBinItem[] {
  const search = repo.create<SearchDoc>({
    "@patchwork": { type: "search" },
    query: "",
  });
  const poi = repo.create<PoiProviderDoc>({
    "@patchwork": { type: "poi-provider" },
  });
  const map = repo.create<MapDoc>({
    "@patchwork": { type: "map" },
    center: [...DEFAULT_CENTER],
    zoom: DEFAULT_ZOOM,
  });
  const colorStyler = repo.create<ColorStylerDoc>({
    "@patchwork": { type: "color-styler" },
  });
  const unitConverter = repo.create<UnitConverterDoc>({
    "@patchwork": { type: "unit-converter" },
  });
  const timerSource = repo.create<TimerSourceDoc>({
    "@patchwork": { type: "timer-source" },
  });
  const note = repo.create<MarkdownDoc>({
    "@patchwork": { type: "markdown" },
    content: DEMO_MARKDOWN,
  });

  return [
    { url: search.url, toolId: "search" },
    { url: poi.url, toolId: "poi-provider" },
    { url: map.url, toolId: "map" },
    { url: colorStyler.url, toolId: "color-styler" },
    { url: unitConverter.url, toolId: "unit-converter" },
    { url: timerSource.url, toolId: "timer-source" },
    { url: note.url, toolId: "codemirror-base" },
  ];
}
