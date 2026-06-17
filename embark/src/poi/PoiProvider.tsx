import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { subscribeDoc } from "../lib/providers-solid";
import {
  RESPONSES_SELECTOR,
  type SearchResponseDoc,
} from "../canvas/providers/SearchProvider";
import type { Place, PoiResultDoc } from "./datatype";
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
  const [respDoc, respHandle] = subscribeDoc<SearchResponseDoc>(
    props.element,
    { type: RESPONSES_SELECTOR },
  );

  // Per-query debounce timers, the queries we've already answered, and a status
  // map purely for the UI.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const [status, setStatus] = createSignal<Record<string, QueryStatus>>({});

  // The active query set, recomputed only when the set itself changes (not when
  // a contributor's result values change) so writing results never retriggers a
  // fetch.
  const queries = createMemo(
    () => Object.keys(respDoc() ?? {}).sort(),
    [] as string[],
    { equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]) },
  );

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

    // Forget queries the broker dropped: cancel pending fetches and clear status.
    for (const query of [...handled]) {
      if (!active.has(query)) handled.delete(query);
    }
    for (const [query, timer] of [...timers]) {
      if (active.has(query)) continue;
      clearTimeout(timer);
      timers.delete(query);
    }
    setStatus((s) => {
      const next: Record<string, QueryStatus> = {};
      for (const query of active) if (query in s) next[query] = s[query];
      return next;
    });
  });

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  const runSearch = async (query: string) => {
    setStatus((s) => ({ ...s, [query]: "searching" }));
    try {
      const places = await fetchPois(query);
      const handle = respHandle();
      // The broker may have dropped this query while we were fetching; don't
      // resurrect a stale key.
      if (!handle || !(query in (handle.doc() ?? {}))) return;
      // One result document per place so each can be linked separately.
      const urls = places.map(
        (place) =>
          repo.create<PoiResultDoc>({
            "@patchwork": { type: "poi-result" },
            query,
            place,
          }).url,
      );
      handle.change((doc) => {
        if (query in doc) doc[query] = urls;
      });
      handled.add(query);
      setStatus((s) => ({ ...s, [query]: places.length }));
    } catch {
      setStatus((s) => ({ ...s, [query]: "error" }));
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
