import type { AutomergeUrl } from "@automerge/automerge-repo";

// One entry offered while the user is typing a `/` command. `label` is what the
// menu shows; `url` is the (prototype) card document the command stands for; and
// `viewUrl`, when set, is the import url of a render module that draws that card
// inline. When the user picks a suggestion the menu clones `url` (so each
// insertion is independent) and inserts a mention-style token referencing the
// clone plus the renderer — `[label]{cloneUrl?view=viewUrl}`. With no `viewUrl`
// the token is a plain mention pill rendered by the default tool.
//
// Suggestions ride the `CommandSuggestions` context channel inline (plain JSON);
// there is no longer a per-menu document.
export type Suggestion = {
  label: string;
  url: AutomergeUrl;
  viewUrl?: string;
};
