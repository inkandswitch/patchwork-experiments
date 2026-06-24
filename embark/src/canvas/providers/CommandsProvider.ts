import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { CommandsDoc, Suggestion } from "../../commands/datatype";

// The slash-command broker. Like the search broker, it sits on the canvas
// element and bridges two roles that can't talk directly (the provider protocol
// only flows up the DOM tree, and command menus / contributors are sibling
// embeds):
//
//   - command menu  subscribe({ type: QUERY_SELECTOR, query, doc })  (registers)
//   - contributor   subscribe({ type: RESPONSES_SELECTOR })          -> response doc url
//
// A contributor reads the active query strings (the keys the broker seeds into
// its response doc) and writes the suggestions it offers back under each. The
// broker unions every contributor's suggestions per query and writes the plain
// array straight into the matching menu's own `CommandsDoc.suggestions` (the
// menu only ever writes its `query`; the broker owns `suggestions`).
//
// It mirrors SearchProvider almost exactly; the only difference is the payload —
// suggestions (text to insert) instead of result document urls.
export const COMMANDS_QUERY_SELECTOR = "commands:query";
export const COMMANDS_RESPONSES_SELECTOR = "commands:responses";

// A contributor's response doc: each active query maps to the suggestions that
// contributor offers for it. The broker owns the keys (active queries); the
// contributor owns the values. An empty-string key means "the user typed `/`
// with nothing after it" — answer it to offer your full command list.
export type CommandsResponseDoc = Record<string, Suggestion[]>;

// A registered command menu: its current query plus its own CommandsDoc handle,
// which the broker writes aggregated suggestions into. The handle resolves
// async, so it may be undefined for a tick after the menu subscribes.
type MenuEntry = { query: string; handle?: DocHandle<CommandsDoc> };

export function CommandsProvider(element: ToolElement): () => void {
  const repo = element.repo;
  // every live command menu waiting on suggestions.
  const menus = new Set<MenuEntry>();
  // every live contributor's response doc handle.
  const contributors = new Set<DocHandle<CommandsResponseDoc>>();

  // Unlike the search broker, the empty query is meaningful here (typing `/`
  // alone should still surface every command), so it is not filtered out.
  const activeQueries = () => {
    const set = new Set<string>();
    for (const menu of menus) set.add(menu.query);
    return Array.from(set);
  };

  const onSubscribe = (event: SubscribeEvent) => {
    const { type } = event.detail.selector;
    if (type === COMMANDS_QUERY_SELECTOR) acceptMenu(event);
    else if (type === COMMANDS_RESPONSES_SELECTOR) acceptContributor(event);
  };

  // A command menu registers itself with its current query and its own doc url.
  // The broker tracks it, makes sure contributors know about the query, and
  // writes the current suggestions into the menu's doc once its handle resolves.
  const acceptMenu = (event: SubscribeEvent) => {
    const { selector } = event.detail;
    const query = String(selector.query ?? "").trim();
    const docUrl = selector.doc as AutomergeUrl | undefined;
    accept<null>(event, () => {
      const entry: MenuEntry = { query };
      menus.add(entry);
      syncQueryKeys();
      if (docUrl) {
        void Promise.resolve(repo.find<CommandsDoc>(docUrl)).then((handle) => {
          if (!menus.has(entry)) return; // unsubscribed before it resolved
          entry.handle = handle;
          writeMenu(entry);
        });
      }

      return () => {
        menus.delete(entry);
        syncQueryKeys();
      };
    });
  };

  // A contributor joins. Hand it a fresh response doc seeded with the active
  // queries, relay whenever it writes suggestions, and clean the doc up when it
  // unsubscribes.
  const acceptContributor = (event: SubscribeEvent) => {
    accept<AutomergeUrl>(event, (respond) => {
      const handle = repo.create<CommandsResponseDoc>({});
      contributors.add(handle);
      handle.change((doc) => {
        for (const query of activeQueries()) doc[query] = [];
      });
      const onChange = () => emitAll();
      handle.on("change", onChange);
      respond(handle.url);

      return () => {
        contributors.delete(handle);
        handle.off("change", onChange);
        handle.delete();
        emitAll();
      };
    });
  };

  // Mirror the active query set into every contributor doc. Contributors learn
  // what to answer from their doc's keys, so seed new queries (value `[]`) and
  // prune ones no menu is asking for anymore.
  const syncQueryKeys = () => {
    const active = new Set(activeQueries());
    for (const handle of contributors) {
      handle.change((doc) => {
        for (const query of active) {
          if (!(query in doc)) doc[query] = [];
        }
        for (const query of Object.keys(doc)) {
          if (!active.has(query)) delete doc[query];
        }
      });
    }
  };

  // Union (dedup by card url, order-stable) the suggestions every contributor
  // wrote for `query`.
  const suggestionsForQuery = (query: string): Suggestion[] => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const handle of contributors) {
      const suggestions = handle.doc()?.[query];
      if (!suggestions) continue;
      for (const suggestion of suggestions) {
        if (!suggestion || typeof suggestion.url !== "string") continue;
        if (seen.has(suggestion.url)) continue;
        seen.add(suggestion.url);
        out.push({
          label: String(suggestion.label ?? suggestion.url),
          url: suggestion.url,
          ...(typeof suggestion.viewUrl === "string"
            ? { viewUrl: suggestion.viewUrl }
            : {}),
        });
      }
    }
    return out;
  };

  // Write a menu's current suggestions into its own doc, but only when they
  // differ so we never churn the document with identical arrays.
  const writeMenu = (entry: MenuEntry) => {
    const handle = entry.handle;
    if (!handle) return;
    const next = suggestionsForQuery(entry.query);
    handle.change((doc) => {
      if (!sameSuggestions(doc.suggestions, next)) doc.suggestions = next;
    });
  };

  const emitAll = () => {
    for (const menu of menus) writeMenu(menu);
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    menus.clear();
    for (const handle of contributors) handle.delete();
    contributors.clear();
  };
}

function sameSuggestions(a: Suggestion[] | undefined, b: Suggestion[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every(
    (suggestion, i) =>
      suggestion.url === b[i].url &&
      suggestion.label === b[i].label &&
      suggestion.viewUrl === b[i].viewUrl,
  );
}
