import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One entry offered while the user is typing a `/` command. `label` is what the
// menu shows; `insert` is the text dropped into the document when it's chosen
// (e.g. "{Route(from: Aachen to: Berlin)}"). The inserted text is plain,
// editable document text — a card effect later finds and acts on it.
export type Suggestion = { label: string; insert: string };

// A throwaway document a command menu mints to receive suggestions. It mirrors
// the SearchDoc: the menu only ever writes `query`, and the commands broker
// owns `suggestions` (the union of what every contributor offers for the query).
export type CommandsDoc = {
  "@patchwork": { type: "commands" };
  query: string;
  suggestions: Suggestion[];
};

export const CommandsDatatype: DatatypeImplementation<CommandsDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "commands" };
    doc.query = "";
    doc.suggestions = [];
  },
  getTitle(doc) {
    return doc.query ? `/${doc.query}` : "Commands";
  },
  setTitle(doc, title) {
    doc.query = title;
  },
};
