import { defineChannel } from "@embark/context";
import type { Suggestion } from "./suggestion";

// Request/response pair for slash-commands: boxes publish active query strings
// into `CommandQueries`, contributors answer each with suggestions to insert in
// `CommandSuggestions`. Identical in shape to the search channels, with a
// different payload (suggestions instead of result urls).
export const CommandQueries = defineChannel<Record<string, true>>({
  name: "commands:queries",
  empty: {},
});

export const CommandSuggestions = defineChannel<Record<string, Suggestion[]>>({
  name: "commands:suggestions",
  empty: {},
});
