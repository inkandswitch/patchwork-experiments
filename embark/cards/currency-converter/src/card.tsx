import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  runStickerSource,
  type ScanContext,
  type Sticker,
} from "@embark/stickers";

// Currency Converter card behavior, loaded by the shared card shell as this
// package's `card.js`. It scans text for amounts in other currencies and
// annotates each with today's value in US dollars. Unlike the unit converter its
// `scan` needs live exchange rates, so it fetches them once on mount (keyless,
// from frankfurter.app / ECB data) and forces a rescan when they land. The
// card's face is drawn by the shell, so it renders nothing into the middle slot.
const card: ToolRender = (_handle, element) =>
  render(() => <CurrencyConverter element={element} />, element);

function CurrencyConverter(props: { element: ToolElement }) {
  onMount(() => {
    const source = runStickerSource(props.element, { scan: scanCurrency });
    // Kick off the (deduped, module-level) rate fetch, then re-publish stickers
    // once rates land — scans before that point produce nothing.
    void loadRates().then((ok) => {
      if (ok) source.rescanAll();
    });
    onCleanup(source.stop);
  });

  return null;
}

export default card;

// USD-based rates: `rates[C]` is how much of currency C one USD buys, so an
// amount in C is worth `amount / rates[C]` dollars. Cached module-side and
// shared across every card instance.
let rates: Record<string, number> | null = null;
let ratesPromise: Promise<boolean> | null = null;

const RATES_URL = "https://api.frankfurter.app/latest?from=USD";

function loadRates(): Promise<boolean> {
  if (!ratesPromise) {
    ratesPromise = fetch(RATES_URL)
      .then((response) => response.json())
      .then((data: { rates?: Record<string, number> }) => {
        rates = data?.rates ?? null;
        return rates != null;
      })
      .catch(() => {
        ratesPromise = null; // allow a later card to retry
        return false;
      });
  }
  return ratesPromise;
}

// Currency symbols that prefix an amount, mapped to their ISO code.
const SYMBOLS: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "₣": "CHF",
  "₽": "RUB",
};

// Spelled-out currency names mapped to their ISO code (`10 euro`, `500 yen`).
// "pound(s)" is intentionally absent — it collides with the unit converter's
// weight, and "dollar" is left to USD; unsupported names no-op via `toUsd`.
const NAMES: Record<string, string> = {
  euro: "EUR",
  euros: "EUR",
  yen: "JPY",
  franc: "CHF",
  francs: "CHF",
  rupee: "INR",
  rupees: "INR",
  yuan: "CNY",
  renminbi: "CNY",
  won: "KRW",
  ruble: "RUB",
  rubles: "RUB",
  rouble: "RUB",
  roubles: "RUB",
};

// `€10` / `£ 5` (symbol then number); `1000 JPY` / `10 eur` (number then 3-letter
// code); `10 euro` / `500 yen` (number then spelled-out name, longest first so a
// plural matches whole). USD (`$`, `USD`, "dollar") is deliberately left alone.
const SYMBOL_RE = /([€£¥₹₩₣₽])\s*(\d+(?:[.,]\d+)?)/g;
const CODE_RE = /(\d+(?:[.,]\d+)?)\s*([A-Za-z]{3})\b/g;
const NAME_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*(${Object.keys(NAMES)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b`,
  "gi",
);

type Amount = { from: number; to: number; text: string };

function scanCurrency(ctx: ScanContext): Sticker[] {
  if (!rates) return [];
  const found: Amount[] = [];

  for (const match of ctx.content.matchAll(SYMBOL_RE)) {
    const usd = toUsd(parseAmount(match[2]), SYMBOLS[match[1]]);
    if (usd == null) continue;
    const from = match.index ?? 0;
    found.push({ from, to: from + match[0].length, text: format(usd) });
  }
  for (const match of ctx.content.matchAll(CODE_RE)) {
    const usd = toUsd(parseAmount(match[1]), match[2].toUpperCase());
    if (usd == null) continue;
    const from = match.index ?? 0;
    found.push({ from, to: from + match[0].length, text: format(usd) });
  }
  for (const match of ctx.content.matchAll(NAME_RE)) {
    const usd = toUsd(parseAmount(match[1]), NAMES[match[2].toLowerCase()]);
    if (usd == null) continue;
    const from = match.index ?? 0;
    found.push({ from, to: from + match[0].length, text: format(usd) });
  }

  // Drop overlaps so a span isn't annotated twice, then emit "after" stickers.
  found.sort((a, b) => a.from - b.from);
  const stickers: Sticker[] = [];
  let cursor = 0;
  for (const amount of found) {
    if (amount.from < cursor) continue;
    cursor = amount.to;
    stickers.push({
      type: "text",
      text: amount.text,
      target: ctx.target(amount.from, amount.to),
      slot: "after",
    });
  }
  return stickers;
}

function toUsd(amount: number, code: string | undefined): number | null {
  if (!code || code === "USD" || !Number.isFinite(amount)) return null;
  const rate = rates?.[code];
  if (!rate) return null;
  return amount / rate;
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function format(usd: number): string {
  return `(${usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })})`;
}
