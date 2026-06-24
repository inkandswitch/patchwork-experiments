import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { MountedEvent, UnmountedEvent } from "@inkandswitch/patchwork-elements";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { readContext, useContextHandle } from "../lib/context-solid";
import { SearchQueries, SearchResults } from "../canvas/channels";
import type { CardDoc } from "../card/datatype";
import type { Place } from "./datatype";
import "./poi.css";

const DEBOUNCE_MS = 350;
// Nominatim's usage policy asks for at most one request per second, so calls
// are serialized into 1s slots shared across every provider instance.
const NOMINATIM_MIN_GAP_MS = 1000;
let nextNominatimSlot = 0;

type NominatimItem = {
  // jsonv2 adds `name` (the place's own name tag, e.g. "Aachen") and
  // `addresstype` (a human-ish kind like "city"/"county"). `display_name` is
  // the long comma-joined string kept only as a fallback.
  name?: string;
  addresstype?: string;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
};

type QueryStatus = "queued" | "searching" | "error" | number;

// Tool entry point: a contributor that answers the canvas search broker with
// OpenStreetMap places. It reads the active queries from its response doc and
// writes a result document url back under each.
export const PoiProviderTool: ToolRender = (_handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PoiProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function PoiProvider(props: { element: ToolElement }) {
  const repo = props.element.repo;
  // Read the active queries from the context and write results back as our own
  // scoped slice. The two are separate channels, so writing results never
  // retriggers the query effect (no custom-equals memo needed anymore).
  const searchQueries = readContext(props.element, SearchQueries);
  const results = useContextHandle(props.element, SearchResults);

  // Per-query debounce timers, the queries we've already answered, the card
  // urls minted per query (so they can be unmounted when the query goes away),
  // and a status map purely for the UI.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const cardsByQuery = new Map<string, AutomergeUrl[]>();
  const [status, setStatus] = createSignal<Record<string, QueryStatus>>({});

  // The active query set, sorted for a stable UI list.
  const queries = (): string[] => Object.keys(searchQueries()).sort();

  createEffect(() => {
    const active = new Set(queries());

    for (const query of active) {
      if (handled.has(query) || timers.has(query)) continue;
      setStatus((s) => ({ ...s, [query]: "queued" }));
      const timer = setTimeout(() => {
        timers.delete(query);
        void runSearch(query);
      }, DEBOUNCE_MS);
      timers.set(query, timer);
    }

    // Forget queries the broker dropped: cancel pending fetches, clear status,
    // and unmount the cards we created for them.
    for (const query of [...handled]) {
      if (!active.has(query)) handled.delete(query);
    }
    for (const [query, timer] of [...timers]) {
      if (active.has(query)) continue;
      clearTimeout(timer);
      timers.delete(query);
    }
    for (const query of [...cardsByQuery.keys()]) {
      if (!active.has(query)) unmountCards(query);
    }
    // Drop our result slice entries for queries that are gone.
    results.change((slice) => {
      for (const query of Object.keys(slice)) {
        if (!active.has(query)) delete slice[query];
      }
    });
    setStatus((s) => {
      const next: Record<string, QueryStatus> = {};
      for (const query of active) if (query in s) next[query] = s[query];
      return next;
    });
  });

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const query of [...cardsByQuery.keys()]) unmountCards(query);
  });

  const runSearch = async (query: string) => {
    setStatus((s) => ({ ...s, [query]: "searching" }));
    try {
      const places = await fetchPois(query);
      // The query may have been dropped while we were fetching; don't resurrect
      // a stale key.
      if (!(query in searchQueries())) return;
      // One card document per place so each can be linked and matched
      // separately. Coordinates live in `props` for the schema matcher.
      const urls = places.map(
        (place) =>
          repo.create<CardDoc>({
            "@patchwork": { type: "card" },
            props: {
              name: place.name,
              lat: place.lat,
              lon: place.lon,
              type: place.type,
            },
            content: place.name,
          }).url,
      );
      results.change((slice) => {
        slice[query] = urls;
      });
      handled.add(query);
      mountCards(query, urls);
      setStatus((s) => ({ ...s, [query]: places.length }));
    } catch {
      setStatus((s) => ({ ...s, [query]: "error" }));
    }
  };

  // Announce the cards minted for a query as mounted documents so the canvas
  // schema-match provider can discover and traverse them — they're never put in
  // a `<patchwork-view>`, so these synthetic events are their only signal.
  const mountCards = (query: string, urls: AutomergeUrl[]) => {
    unmountCards(query); // replace any previous generation for this query
    cardsByQuery.set(query, urls);
    for (const url of urls) {
      props.element.dispatchEvent(new MountedEvent({ url, toolId: "card" }));
    }
  };

  const unmountCards = (query: string) => {
    const urls = cardsByQuery.get(query);
    if (!urls) return;
    cardsByQuery.delete(query);
    for (const url of urls) {
      props.element.dispatchEvent(new UnmountedEvent({ url, toolId: "card" }));
    }
  };

  return (
    <div class="embark-poi">
      <div class="embark-poi__header">
        <span class="embark-poi__dot" />
        POI Provider
      </div>
      <div class="embark-poi__sub">Nominatim / OpenStreetMap</div>
      <Show
        when={queries().length > 0}
        fallback={<div class="embark-poi__empty">Waiting for searches…</div>}
      >
        <ul class="embark-poi__list">
          <For each={queries()}>
            {(query) => (
              <li class="embark-poi__item">
                <span class="embark-poi__query">{query}</span>
                <span class="embark-poi__status">{statusLabel(status()[query])}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function statusLabel(status: QueryStatus | undefined): string {
  if (status === undefined || status === "queued") return "queued";
  if (status === "searching") return "searching…";
  if (status === "error") return "error";
  return `${status} places`;
}

// Query Nominatim for a free-text place search, mapped to our flat `Place`
// shape. `jsonv2` is requested specifically because it returns a short `name`
// per result; `addressdetails=1` is cheap and handy for future disambiguation.
async function fetchPois(query: string): Promise<Place[]> {
  await reserveNominatimSlot();
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query,
  )}&format=jsonv2&addressdetails=1&limit=10`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  const items = (await response.json()) as NominatimItem[];
  return items.map((item) => ({
    name: shortPlaceName(item),
    lat: Number(item.lat),
    lon: Number(item.lon),
    type: item.addresstype ?? item.type,
  }));
}

// A short, human-friendly name: prefer the place's own `name` tag, falling back
// to the leading segment of `display_name` for results without one (raw
// addresses, etc.). Nominatim appends a parenthetical disambiguator in some
// locales (e.g. "Aachen (district)") which people don't write, so drop it.
function shortPlaceName(item: NominatimItem): string {
  const raw =
    item.name?.trim() || item.display_name.split(",")[0]?.trim() || item.display_name;
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

// Reserve the next free 1s slot so concurrent queries don't exceed Nominatim's
// rate limit.
async function reserveNominatimSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextNominatimSlot);
  nextNominatimSlot = at + NOMINATIM_MIN_GAP_MS;
  const wait = at - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
