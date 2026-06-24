import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One entry offered while the user is typing a `/` command. `label` is what the
// menu shows; `url` is the (prototype) card document the command stands for; and
// `viewUrl`, when set, is the import url of a render module that draws that card
// inline. When the user picks a suggestion the menu clones `url` (so each
// insertion is independent) and inserts a mention-style token referencing the
// clone plus the renderer — `[label]{cloneUrl?view=viewUrl}`. With no `viewUrl`
// the token is a plain mention pill rendered by the default tool.
export type Suggestion = {
  label: string;
  url: AutomergeUrl;
  viewUrl?: string;
};

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
