// Currency Converter card behavior, loaded by the shared card shell as this
// package's `card.js`. It scans text for amounts in other currencies and
// annotates each with today's value in US dollars. Unlike the unit converter
// its `scan` needs live exchange rates, so it fetches them once on mount
// (keyless, from frankfurter.app / ECB data) and forces a rescan when they
// land. The card's face is drawn by the shell, so it renders nothing into the
// middle slot.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards are imported with relative paths (every card lives in the one shared
// cards package) and the core platform comes from ../platform.js.

import { runStickerSource } from "../stickers-card/engine.js";

export default function card(_handle, element) {
  const source = runStickerSource(element, { scan: scanCurrency });
  // Kick off the (deduped, module-level) rate fetch, then re-publish stickers
  // once rates land — scans before that point produce nothing.
  void loadRates().then((ok) => {
    if (ok) source.rescanAll();
  });
  return source.stop;
}

// USD-based rates: `rates[C]` is how much of currency C one USD buys, so an
// amount in C is worth `amount / rates[C]` dollars. Cached module-side and
// shared across every card instance.
let rates = null;
let ratesPromise = null;

const RATES_URL = "https://api.frankfurter.app/latest?from=USD";

function loadRates() {
  if (!ratesPromise) {
    ratesPromise = fetch(RATES_URL)
      .then((response) => response.json())
      .then((data) => {
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
const SYMBOLS = {
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
const NAMES = {
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

function scanCurrency(ctx) {
  if (!rates) return [];
  const found = [];

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
  const stickers = [];
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

function toUsd(amount, code) {
  if (!code || code === "USD" || !Number.isFinite(amount)) return null;
  const rate = rates?.[code];
  if (!rate) return null;
  return amount / rate;
}

function parseAmount(raw) {
  return Number(raw.replace(/,/g, ""));
}

function format(usd) {
  return `(${usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })})`;
}
