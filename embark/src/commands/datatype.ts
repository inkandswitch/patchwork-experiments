import type { AutomergeUrl } from "@automerge/automerge-repo";

// One entry offered while the user is typing a `/` command. `label` is what the
// menu shows and `url` is the (prototype) card document the command stands for.
// When the user picks a suggestion the menu clones `url` (so each insertion is
// independent) and inserts a token referencing the clone — `{cloneUrl}`. How the
// token renders (a plain title pill, or a custom inline face) is decided by the
// resolved document itself: a card may carry a `viewUrl` render module on its
// doc, which the unified token renderer imports and runs.
//
// Suggestions ride the `CommandSuggestions` context channel inline (plain JSON);
// there is no longer a per-menu document.
export type Suggestion = {
  label: string;
  url: AutomergeUrl;
};
