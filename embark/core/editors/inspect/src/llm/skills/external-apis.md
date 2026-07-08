# Fetching external data

Cards fetch straight from the browser with `fetch` — no server, no proxy, so
the API must allow CORS and should be keyless.

## Keyless APIs already proven in cards

- **Open-Meteo** (weather): `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`
- **frankfurter.app** (exchange rates, ECB data): `https://api.frankfurter.app/latest?from=USD` → `{ rates: { EUR: ..., } }`
- **Nominatim** (geocoding, OpenStreetMap): `https://nominatim.openstreetmap.org/search?q=<query>&format=jsonv2&limit=10`. Usage policy: **max 1 request per second** — serialize calls through a shared timestamp slot; send `Accept: application/json`.
- **OSRM demo server** (driving routes): `https://router.project-osrm.org/route/v1/driving/<lon>,<lat>;<lon>,<lat>?overview=full&geometries=polyline6`
- **Valhalla** (multi-mode routes): POST `https://valhalla1.openstreetmap.de/route`
- **Wikipedia REST** (summaries/images): `https://en.wikipedia.org/api/rest_v1/page/summary/<title>`

(eBird exists in the corpus but is keyed — avoid keyed APIs unless the spec
provides a key.)

## Etiquette that keeps cards well-behaved

**Debounce** user-driven triggers (typing, map panning) — 250–500ms after the
last change, one request.

**Discard stale responses** with a generation counter when a newer trigger
supersedes an in-flight fetch:

```js
let generation = 0;
const run = async () => {
  const mine = ++generation;
  const data = await fetchThing();
  if (mine !== generation) return; // superseded — drop it
  apply(data);
};
```

For providers answering query channels, additionally re-check the query is
still active after every await (see request-response-provider).

**Cache at module level** so repeated inputs and multiple card instances
share one fetch:

```js
let ratesPromise = null;
function loadRates() {
  if (!ratesPromise) {
    ratesPromise = fetch(RATES_URL).then((r) => r.json()).catch(() => {
      ratesPromise = null; // allow a retry later
      return null;
    });
  }
  return ratesPromise;
}
```

**Rate-limit** APIs that ask for it by reserving time slots:

```js
let nextSlot = 0;
async function reserveSlot(minGapMs) {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + minGapMs;
  const wait = at - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
```

**Fail quiet.** On error, leave the answer unwritten (a provider's query
re-queues on the next edit) or show a short status line — never throw out of
your module or spam retries in a loop.

**Abort on cleanup** for long-lived fetch loops: keep an `AbortController`,
pass its signal, abort in the teardown.
