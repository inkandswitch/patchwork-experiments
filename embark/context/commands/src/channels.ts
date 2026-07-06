import { defineChannel, defineSetChannel } from "@embark/context";
import type { Suggestion } from "./suggestion";

// Request/response pair for slash-commands: boxes publish active query strings
// into `CommandQueries`, contributors answer each with suggestions to insert in
// `CommandSuggestions`. Identical in shape to the search channels, with a
// different payload (suggestions instead of result urls).
export const CommandQueries = defineSetChannel<string>({
  name: "commands:queries",
});

export const CommandSuggestions = defineChannel<Record<string, Suggestion[]>>({
  name: "commands:suggestions",
  empty: {},
  value: "suggestion",
});
