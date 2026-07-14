// Page-extractor card behavior, loaded by the shared card shell as this
// package's `dist/card.js`. The card's face is one sentence with two blanks:
// what to extract (free text) and which deck receives the results (a picker
// listing the decks next to this card — see watchNearbyDecks). Whenever the
// browser tab's URL, the prompt, or the target deck changes, the card
// captures the page through the extension bridge
// (`window.patchworkCards.runJs`), asks an LLM for a JSON array of records,
// mints one JSON card per record (see ../json-card.js), and deals them into
// the target deck — replacing whatever it dealt on the previous run, so
// navigating doesn't flood the pile. A reload button re-runs on demand (the
// page may have changed under an unchanged URL). Without the bridge (a
// normal canvas, no extension) a built-in sample page stands in for the tab,
// so the pipeline stays debuggable anywhere.
//
// Bundled (vite) rather than bundleless so the OpenRouter key can be inlined
// at build time from the repo-level .env instead of living in source.

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import "./card.css";

// This package's own automerge url (pushwork rootUrl): the minted JSON cards'
// `src` points back into it.
const PACKAGE_URL = "automerge:eXE2Kjh1YkQEkYS6aAMoAAfYZXn";
const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";
const SELECTION_PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

// The service-worker path a package-relative module is importable at — the
// same form every card doc's `src` uses (see the parts-bin catalog).
const packagePath = (pkg: string, path: string) =>
  `/${encodeURIComponent(pkg)}/${path}`;

// The context-store client, the Highlight channel, and the link walker are
// runtime imports from the deployed packages (same as the bundleless cards
// do), so this card shares the exact vocabulary with everything else.
const { getContextHandle } = (await import(
  /* @vite-ignore */ packagePath(CORE_PACKAGE_URL, "client.js")
)) as ContextClient;
const { Highlight } = (await import(
  /* @vite-ignore */ packagePath(SELECTION_PACKAGE_URL, "channels.js")
)) as SelectionChannels;
const { linkedUrls } = (await import(
  /* @vite-ignore */ packagePath(SCHEMA_MATCHER_PACKAGE_URL, "doc-links.js")
)) as DocLinks;

// Shown on the card face so a published build can be told apart from a stale
// one at a glance. Bump on every sync while iterating.
const BUILD_VERSION = "v6";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
// Inlined at build time from the repo-level .env — see vite.config.ts.
const API_KEY: string | undefined = import.meta.env.VITE_LLM_API_KEY;
const MODEL = "anthropic/claude-sonnet-4.5";

// Re-extract 800ms after the last input change (typing settles, redirects
// finish) so a burst of changes fires one LLM call.
const DEBOUNCE_MS = 800;
// Coalesce a burst of doc changes into a single deck-discovery walk.
const RECOMPUTE_MS = 100;
// Keep the page snippet and the dealt pile bounded.
const MAX_PAGE_TEXT = 40_000;
const MAX_RECORDS = 20;

// The stand-in for the browser tab when the extension bridge is absent, so
// the whole pipeline (prompt, LLM call, minting, dealing) can be exercised on
// a normal canvas. Try "the stalls and what they sell, with prices".
const SAMPLE_PAGE: CapturedPage = {
  url: "sample:riverside-farmers-market",
  title: "Riverside Farmers Market — This Week's Stalls",
  text: `Riverside Farmers Market
Open every Saturday, 9:00–14:00, Riverside Square.

This week's stalls:

Green Acres Farm — organic vegetables. Carrots 2.50/kg, kale 1.80/bunch,
heirloom tomatoes 4.20/kg.

The Bread Barrow — sourdough loaf 4.00, dark rye 3.50, cinnamon knots 1.20
each. Sold out by noon most weeks.

Hilltop Apiary — wildflower honey 6.00/jar, honeycomb 8.50, beeswax candles
5.00/pair.

Fjord & Field — smoked trout 7.80/fillet, pickled herring 5.40/jar.

Luna's Flowers — seasonal bouquets from 9.00, single-stem dahlias 1.50.`,
};

export default function card(
  handle: DocHandle<ExtractorCardDoc>,
  element: ToolElement,
) {
  const dispose = render(() => <Extractor handle={handle} host={element} />, element);
  return () => dispose();
}

function Extractor(props: {
  handle: DocHandle<ExtractorCardDoc>;
  host: ToolElement;
}) {
  const repo = props.host.repo;
  const api = extensionApi();

  const [doc, setDoc] = createSignal(props.handle.doc());
  const syncDoc = () => setDoc(props.handle.doc());
  props.handle.on("change", syncDoc);
  onCleanup(() => props.handle.off("change", syncDoc));

  const prompt = () => doc()?.prompt ?? "";
  const targetDeckUrl = () => doc()?.targetDeckUrl ?? null;

  // The shell draws `description` at the bottom of the card, under this
  // module's sentence — which already says everything the description said.
  // Clear it off the doc (older mints carried one) so the sentence gets the
  // whole face.
  if (props.handle.doc()?.description) {
    props.handle.change((d) => {
      d.description = "";
    });
  }

  // The prompt blank follows the document except while this instance is being
  // typed into, so a remote edit can't yank the caret mid-word.
  let promptEl: HTMLTextAreaElement | undefined;
  const [draft, setDraft] = createSignal(prompt());
  createEffect(() => {
    const persisted = prompt();
    if (document.activeElement !== promptEl) setDraft(persisted);
  });
  let persistTimer: number | undefined;
  const editPrompt = (value: string) => {
    setDraft(value);
    clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      if (props.handle.doc()?.prompt === value) return;
      props.handle.change((d) => {
        d.prompt = value;
      });
    }, 400);
  };

  // Decks on offer: every deck reachable from the frame's root document (the
  // card stack or canvas this card sits on), plus the current target even
  // when the walk doesn't see it (a deck that was removed from the stack).
  const nearbyDecks = watchNearbyDecks(repo);
  const deckUrls = createMemo(() => {
    const urls = nearbyDecks();
    const target = targetDeckUrl();
    return target && !urls.includes(target) ? [...urls, target] : urls;
  });

  const titles = watchDeckTitles(repo, deckUrls);

  // Hovering the deck word glows the real deck ("point at what you name").
  const highlight = getContextHandle(props.host, Highlight);
  const setHighlight = (urls: string[]) => {
    highlight.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const url of urls) slice[url] = true;
    });
  };
  onCleanup(() => highlight.release());

  const pickDeck = (url: string) =>
    props.handle.change((d) => {
      d.targetDeckUrl = url || null;
    });

  // The live tab URL from the extension bridge; without the bridge the
  // built-in sample page stands in, so the pipeline still runs. The signal's
  // === equality swallows title-only tab updates, so only real navigations
  // re-extract.
  const [tabUrl, setTabUrl] = createSignal<string | null>(
    api ? null : SAMPLE_PAGE.url,
  );
  if (api) {
    api
      .getActiveTab()
      .then((tab) => setTabUrl(tab.url))
      .catch((error) =>
        console.warn("[page-extractor] get-active-tab failed", error),
      );
    onCleanup(api.onTabChanged((tab) => setTabUrl(tab.url)));
  }

  const [status, setStatus] = createSignal<Status>({ state: "idle" });

  // Rerun wiring: any input change schedules one debounced extraction; the
  // generation counter discards responses a newer run has superseded. A run
  // whose inputs match what the card last dealt (the `minted` fingerprint) is
  // skipped, so re-mounting the card doesn't re-spend an LLM call.
  let timer: number | undefined;
  let generation = 0;
  createEffect(() => {
    const inputs = currentInputs();
    if (!inputs) return;
    if (alreadyExtracted(doc(), inputs)) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void run(inputs), DEBOUNCE_MS);
  });
  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(persistTimer);
    generation++;
  });

  const currentInputs = (): ExtractionInputs | null => {
    const url = tabUrl();
    const what = prompt().trim();
    const deckUrl = targetDeckUrl();
    if (!url || !what || !deckUrl) return null;
    return { url, what, deckUrl };
  };

  // The reload button re-runs on the current inputs even though they match
  // the minted fingerprint — for when the page content changed under an
  // unchanged URL.
  const reload = () => {
    const inputs = currentInputs();
    if (!inputs) return;
    clearTimeout(timer);
    void run(inputs, { force: true });
  };

  const run = async (inputs: ExtractionInputs, opts?: { force: boolean }) => {
    // Another instance of this card (a second view of the same doc) may have
    // dealt these inputs while the debounce ran.
    if (!opts?.force && alreadyExtracted(props.handle.doc(), inputs)) return;
    const mine = ++generation;
    setStatus({ state: "extracting" });
    try {
      const page = api ? await capturePage(api) : SAMPLE_PAGE;
      if (mine !== generation) return;
      const records = await extractRecords(inputs.what, page);
      if (mine !== generation) return;
      const cardUrls = records
        .slice(0, MAX_RECORDS)
        .map((record, index) => mintJsonCard(repo, record, index));
      const ids = await dealIntoDeck(
        repo,
        inputs.deckUrl,
        cardUrls,
        props.handle.doc()?.minted,
      );
      if (mine !== generation) return;
      props.handle.change((d) => {
        d.minted = {
          deckUrl: inputs.deckUrl,
          ids,
          url: inputs.url,
          prompt: inputs.what,
        };
      });
      setStatus({ state: "idle" });
    } catch (error) {
      if (mine !== generation) return;
      console.warn("[page-extractor] extraction failed", error);
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // One muted line, only when the situation changes what to believe; the
  // sentence itself is the rest of the face.
  const statusText = () => {
    const s = status();
    if (s.state === "extracting") return "Extracting\u2026";
    if (s.state === "error") return `Extraction failed: ${s.message}`;
    if (prompt().trim() && !targetDeckUrl()) {
      return deckUrls().length > 0
        ? "Pick a deck to put the cards in."
        : "Deal a deck from the parts bin to hold the extracted cards.";
    }
    if (!api)
      return "Browser extension not connected — extracting from a built-in sample page (a farmers market).";
    return null;
  };

  return (
    <div class="page-extractor">
      <p class="page-extractor__sentence">
        Extract{" "}
        <textarea
          ref={promptEl}
          class="page-extractor__prompt"
          rows="1"
          placeholder="what data you want"
          value={draft()}
          on:input={(e) => editPrompt(e.currentTarget.value)}
        />        {" "}
        from this page into{" "}
        <span
          class="page-extractor__deck"
          on:mouseenter={() => {
            const target = targetDeckUrl();
            if (target) setHighlight([target]);
          }}
          on:mouseleave={() => setHighlight([])}
        >
          <select
            class="page-extractor__swap"
            on:change={(e) => pickDeck(e.currentTarget.value)}
          >
            <Show when={!targetDeckUrl()}>
              <option value="" disabled selected>
                a deck
              </option>
            </Show>
            {/* `selected` on the options rather than `value` on the select:
                the options arrive asynchronously (the deck walk, resolved
                titles), after a select value would have been applied. */}
            <For each={deckUrls()}>
              {(url) => (
                <option value={url} selected={url === targetDeckUrl()}>
                  {titles()[url] ?? "Deck"}
                </option>
              )}
            </For>
          </select>
        </span>
        .
      </p>
      <Show when={statusText()}>
        <div
          class="page-extractor__status"
          classList={{
            "is-error": status().state === "error",
            "is-busy": status().state === "extracting",
          }}
        >
          {statusText()}
        </div>
      </Show>
      <div class="page-extractor__footer">
        <button
          type="button"
          class="page-extractor__reload"
          disabled={!currentInputs() || status().state === "extracting"}
          title="Extract again from the current page"
          on:click={reload}
        >
          ↻ Reload
        </button>
        <div class="page-extractor__version">{BUILD_VERSION}</div>
      </div>
    </div>
  );
}

// The bridge the browser extension installs on the patchwork page.
function extensionApi(): PatchworkCardsApi | undefined {
  return (window as unknown as { patchworkCards?: PatchworkCardsApi })
    .patchworkCards;
}

// Whether the card's last dealt run already covers these inputs.
function alreadyExtracted(
  doc: ExtractorCardDoc | undefined,
  inputs: ExtractionInputs,
): boolean {
  const minted = doc?.minted;
  return (
    minted !== undefined &&
    minted.url === inputs.url &&
    minted.prompt === inputs.what &&
    minted.deckUrl === inputs.deckUrl
  );
}

// Track every deck reachable from the frame's root document — the `#doc=`
// hash names the card stack or canvas this card sits on, and its link closure
// (content links only; `linkedUrls` skips `@patchwork` plumbing) covers the
// stack's rows and the canvas's embeds. Deliberately self-contained: the
// extension's stack runs no Schema Matcher card, so the picker can't lean on
// the SchemaMatches channel the way canvas-dwelling cards do.
function watchNearbyDecks(repo: Repo): () => string[] {
  const [decks, setDecks] = createSignal<string[]>([]);
  const watched = new Map<
    string,
    { handle?: DocHandle<unknown>; off?: () => void }
  >();
  let timer: number | undefined;
  let disposed = false;

  const scheduleRecompute = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      recompute();
    }, RECOMPUTE_MS);
  };

  const ensureWatched = (url: string) => {
    let entry = watched.get(url);
    if (entry) return entry;
    entry = {};
    watched.set(url, entry);
    repo
      .find(url as AutomergeUrl)
      .then((handle) => {
        if (disposed || watched.get(url) !== entry) return;
        entry.handle = handle;
        handle.on("change", scheduleRecompute);
        entry.off = () => handle.off("change", scheduleRecompute);
        scheduleRecompute();
      })
      .catch(() => {
        // Unresolvable doc: it simply contributes nothing.
      });
    return entry;
  };

  const dropWatched = (url: string) => {
    const entry = watched.get(url);
    if (!entry) return;
    watched.delete(url);
    entry.off?.();
  };

  // Breadth-first closure from the root doc. Docs still resolving stay
  // watched and join on the recompute their handle triggers once loaded; docs
  // that fall out of the closure are unwatched.
  const recompute = () => {
    const root = rootDocUrl();
    const reached = new Set<string>();
    const found: string[] = [];
    if (root) {
      reached.add(root);
      const queue = [root];
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        const doc = ensureWatched(url).handle?.doc() as TypedDoc | undefined;
        if (!doc) continue;
        if (doc["@patchwork"]?.type === "deck") found.push(url);
        for (const link of linkedUrls(doc)) {
          if (reached.has(link)) continue;
          reached.add(link);
          queue.push(link);
        }
      }
    }
    for (const url of [...watched.keys()]) {
      if (!reached.has(url)) dropWatched(url);
    }
    setDecks((prev) => (sameList(prev, found) ? prev : found));
  };

  window.addEventListener("hashchange", scheduleRecompute);
  recompute();

  onCleanup(() => {
    disposed = true;
    window.removeEventListener("hashchange", scheduleRecompute);
    if (timer !== undefined) clearTimeout(timer);
    for (const url of [...watched.keys()]) dropWatched(url);
  });

  return decks;
}

// The frame's root document, from the hash the frame router maintains
// (`#frame=<tool>&doc=<documentId>`, or `#doc=<documentId>` in the plain
// document frame), normalized to a bare document url.
function rootDocUrl(): string | undefined {
  const doc = new URLSearchParams(window.location.hash.slice(1)).get("doc");
  if (!doc) return undefined;
  const url = doc.startsWith("automerge:") ? doc : `automerge:${doc}`;
  if (!isValidAutomergeUrl(url)) return undefined;
  return `automerge:${parseAutomergeUrl(url).documentId}`;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Track the titles of the offered decks, so the picker can name them. Handles
// are (re)wired as the url set changes; a rename shows up live.
function watchDeckTitles(
  repo: Repo,
  deckUrls: () => string[],
): () => Record<string, string> {
  const [titles, setTitles] = createSignal<Record<string, string>>({});
  const watched = new Map<
    string,
    { off?: () => void; cancelled?: boolean }
  >();

  createEffect(() => {
    const urls = new Set(deckUrls());
    for (const [url, watch] of watched) {
      if (urls.has(url)) continue;
      watch.cancelled = true;
      watch.off?.();
      watched.delete(url);
      setTitles((t) => {
        const { [url]: _, ...rest } = t;
        return rest;
      });
    }
    for (const url of urls) {
      if (watched.has(url)) continue;
      const watch: { off?: () => void; cancelled?: boolean } = {};
      watched.set(url, watch);
      repo
        .find<DeckDoc>(url as AutomergeUrl)
        .then((handle) => {
          if (watch.cancelled) return;
          const update = () =>
            setTitles((t) => ({
              ...t,
              [url]: handle.doc()?.title || "Untitled deck",
            }));
          handle.on("change", update);
          watch.off = () => handle.off("change", update);
          update();
        })
        .catch(() => {
          // Unresolvable deck: leave it untitled; the option still works.
        });
    }
  });

  onCleanup(() => {
    for (const watch of watched.values()) {
      watch.cancelled = true;
      watch.off?.();
    }
  });

  return titles;
}

// --- extraction pipeline ---------------------------------------------------

// Snapshot the page next to the panel through the extension bridge. Runs in
// the tab itself, so it sees the live DOM (not the original response).
async function capturePage(api: PatchworkCardsApi): Promise<CapturedPage> {
  const value = await api.runJs(
    `(() => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").slice(0, ${MAX_PAGE_TEXT}),
    }))()`,
  );
  const page = value as Partial<CapturedPage> | null;
  if (!page || typeof page.url !== "string") {
    throw new Error("could not read the page (is 'Allow User Scripts' on?)");
  }
  return {
    url: page.url,
    title: typeof page.title === "string" ? page.title : "",
    text: typeof page.text === "string" ? page.text : "",
  };
}

const SYSTEM_PROMPT = `You extract structured data from web pages.
Reply with ONLY a JSON array. Each element is one extracted item: a flat JSON
object with a small number of descriptive fields, values as plain strings,
numbers, booleans, or null. Never nest objects or arrays: every attribute is
its own top-level field — a location becomes top-level "lat" and "long"
number fields, not a nested object. Give every object a short human-readable
"title" field naming the item. No markdown, no code fences, no commentary.
If nothing on the page matches the request, reply with [].`;

// One non-streaming chat call: the user's request plus the page snapshot in,
// a JSON array of records out.
async function extractRecords(
  what: string,
  page: CapturedPage,
): Promise<Record<string, unknown>[]> {
  if (!API_KEY) {
    throw new Error(
      "no API key baked into this build — set VITE_LLM_API_KEY in embark/.env and rebuild",
    );
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Extract: ${what}\n\n` +
            `Page: ${page.title} (${page.url})\n\n` +
            `Page text:\n${page.text}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM API error (${response.status})`);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM returned no content");
  return parseRecords(content);
}

// The model is told to reply with bare JSON, but strip fences and leading
// prose anyway — a mis-formatted reply shouldn't fail the whole run.
function parseRecords(content: string): Record<string, unknown>[] {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("LLM reply held no JSON array");
  }
  const parsed: unknown = JSON.parse(content.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("LLM reply was not an array");
  return parsed.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

// --- minting & dealing -------------------------------------------------------

// The card chrome fields the shell owns on every minted JSON card. Record
// fields with these names are dropped rather than spread — the chrome must
// stay what the design says. Mirrored in json-card.js, which hides them when
// rendering.
const RESERVED_CARD_FIELDS = new Set([
  "@patchwork",
  "src",
  "description",
  "icon",
  "accent",
  "flipped",
]);

// One generic JSON card per record: a `card` document whose module is this
// package's bundleless json-card.js. The record's fields live at the
// document root (no nested `data` wrapper), so other tools see e.g. `lat`
// and `long` as top-level properties.
function mintJsonCard(
  repo: Repo,
  record: Record<string, unknown>,
  index: number,
): AutomergeUrl {
  const fields = Object.fromEntries(
    Object.entries(record).filter(([key]) => !RESERVED_CARD_FIELDS.has(key)),
  );
  return repo.create<JsonCardDoc>({
    ...fields,
    "@patchwork": { type: "card", title: titleOf(record, index) },
    src: packagePath(PACKAGE_URL, "json-card.js"),
    description: "One item extracted from a web page, as JSON.",
    icon: "braces",
    accent: "#64748b",
  }).url;
}

function titleOf(record: Record<string, unknown>, index: number): string {
  const candidate = record.title ?? record.name;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  return `Item ${index + 1}`;
}

// Deal the freshly minted cards into the target deck, first clearing whatever
// this card dealt on its previous run (possibly into a different deck), so a
// re-extraction replaces its pile instead of appending to it.
async function dealIntoDeck(
  repo: Repo,
  deckUrl: string,
  cardUrls: AutomergeUrl[],
  prior: MintedRecord | undefined,
): Promise<string[]> {
  if (prior && prior.deckUrl !== deckUrl) {
    try {
      const oldDeck = await repo.find<DeckDoc>(prior.deckUrl as AutomergeUrl);
      const stale = new Set(prior.ids);
      oldDeck.change((d) => spliceOut(d, stale));
    } catch {
      // The old deck is gone — nothing left to clean up.
    }
  }

  const deck = await repo.find<DeckDoc>(deckUrl as AutomergeUrl);
  const entries = cardUrls.map((url) => ({
    id: crypto.randomUUID(),
    url,
    toolId: "card",
  }));
  const stale = new Set(prior && prior.deckUrl === deckUrl ? prior.ids : []);
  deck.change((d) => {
    spliceOut(d, stale);
    for (const entry of entries) d.cards.push(entry);
  });
  return entries.map((entry) => entry.id);
}

function spliceOut(deck: DeckDoc, ids: Set<string>): void {
  if (ids.size === 0) return;
  for (let i = deck.cards.length - 1; i >= 0; i--) {
    if (ids.has(deck.cards[i].id)) deck.cards.splice(i, 1);
  }
}

// --- shapes ------------------------------------------------------------------

// The shared CardDoc chrome (title, description, icon, accent) plus this
// card's settings and bookkeeping.
type ExtractorCardDoc = {
  "@patchwork": { type: "card"; title: string };
  src: string;
  description: string;
  icon: string;
  accent: string;
  flipped?: boolean;
  // What to extract, verbatim from the sentence's blank.
  prompt: string;
  // The deck the extracted cards are dealt into.
  targetDeckUrl: string | null;
  // What the last run dealt: the deck entries this card owns (replaced on the
  // next run) and the inputs they answer, so an unchanged mount is skipped.
  minted?: MintedRecord;
};

type MintedRecord = {
  deckUrl: string;
  ids: string[];
  url: string;
  prompt: string;
};

// The extracted record's fields sit at the document root, alongside the card
// chrome (see RESERVED_CARD_FIELDS).
type JsonCardDoc = {
  "@patchwork": { type: "card"; title: string };
  src: string;
  description: string;
  icon: string;
  accent: string;
  [field: string]: unknown;
};

// See @embark/dnd deck-types.ts; restated locally so this card carries no
// build dependency on the core workspace.
type DeckDoc = {
  "@patchwork": { type: "deck" };
  title: string;
  fanned: boolean;
  cards: { id: string; url?: AutomergeUrl; toolId?: string }[];
};

type ExtractionInputs = { url: string; what: string; deckUrl: string };

type CapturedPage = { url: string; title: string; text: string };

type Status =
  | { state: "idle" }
  | { state: "extracting" }
  | { state: "error"; message: string };

// The bridge the browser extension installs on the patchwork page (see
// cards-browser-extension/src/page-world.ts).
type ActiveTab = { url: string | null; title: string | null };
type PatchworkCardsApi = {
  getActiveTab(): Promise<ActiveTab>;
  onTabChanged(listener: (tab: ActiveTab) => void): () => void;
  runJs(code: string): Promise<unknown>;
};

// Any document, seen just for its datatype (the deck walk's filter).
type TypedDoc = {
  "@patchwork"?: { type?: string };
};

// Minimal structural types for the runtime imports above.
type ChannelDef = { name: string; empty: object };
type ContextHandle = {
  change(mutate: (slice: Record<string, unknown>) => void): void;
  release(): void;
};
type ContextClient = {
  getContextHandle(node: Node, channel: ChannelDef): ContextHandle;
};
type SelectionChannels = { Highlight: ChannelDef };
type DocLinks = { linkedUrls(doc: unknown): string[] };
