import type { AutomergeUrl } from "@automerge/automerge-repo";
import { For, Match, Switch } from "solid-js";
import {
  type Suggestion,
  CodemirrorExtensions,
  CommandQueries,
  CommandSuggestions,
  Highlight,
  SchemaQueries,
  SearchQueries,
  Stickers,
} from "@embark/core";
import { EmbedToken, type HighlightController } from "./tokens";

// Renders one channel's value in the most legible shape for that channel: query
// strings and schema names as chips, document-valued channels as embed tokens,
// and anything unrecognized as compact JSON. Shared by the "Contributed" view
// (fed the embed's own merged slice) and the "Used" view (fed the merged value
// the embed reads). `search:results` is rendered by SearchResultsTable instead,
// so it isn't handled here.
export function ChannelValue(props: {
  channel: string;
  value: Record<string, unknown>;
  highlight: HighlightController;
}) {
  return (
    <Switch
      fallback={
        <pre class="embark-context__value">
          {JSON.stringify(props.value, null, 2)}
        </pre>
      }
    >
      <Match
        when={
          props.channel === SearchQueries.name ||
          props.channel === CommandQueries.name ||
          props.channel === CodemirrorExtensions.name
        }
      >
        {/* Keys are plain strings (query text, extension keys); show them
            quoted so whitespace and empties read clearly. */}
        <Chips labels={Object.keys(props.value).map((key) => JSON.stringify(key))} />
      </Match>
      <Match when={props.channel === SchemaQueries.name}>
        <Chips labels={schemaNames(props.value)} />
      </Match>
      <Match
        when={props.channel === Highlight.name || props.channel === Stickers.name}
      >
        <Tokens
          items={(Object.keys(props.value) as AutomergeUrl[]).map((url) => ({
            url,
          }))}
          highlight={props.highlight}
        />
      </Match>
      <Match when={props.channel === CommandSuggestions.name}>
        <Tokens
          items={suggestionList(props.value).map((s) => ({
            url: s.url,
            label: s.label,
          }))}
          highlight={props.highlight}
        />
      </Match>
    </Switch>
  );
}

function Chips(props: { labels: string[] }) {
  return (
    <div class="embark-token-row">
      <For each={props.labels}>
        {(label) => <span class="embark-schema__token">{label}</span>}
      </For>
    </div>
  );
}

function Tokens(props: {
  items: Array<{ url: AutomergeUrl; label?: string }>;
  highlight: HighlightController;
}) {
  return (
    <div class="embark-token-row">
      <For each={props.items}>
        {(item) => (
          <EmbedToken
            url={item.url}
            label={item.label}
            highlight={props.highlight}
          />
        )}
      </For>
    </div>
  );
}

// Flatten a `Record<key, Suggestion[]>` value (commands:suggestions).
function suggestionList(value: Record<string, unknown>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object" && "url" in entry) {
        out.push(entry as Suggestion);
      }
    }
  }
  return out;
}

// The human names of the schema queries in a schema:queries value.
function schemaNames(value: Record<string, unknown>): string[] {
  return Object.values(value).map((query) => {
    const name = (query as { name?: unknown })?.name;
    return typeof name === "string" && name.trim() ? name : "schema";
  });
}
