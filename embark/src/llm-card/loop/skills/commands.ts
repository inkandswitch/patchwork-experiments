import type { Skill } from "./index";

// The slash-command capability: offer `/` command suggestions into editors, and
// then act on the command text the user inserts by decorating it with a sticker
// that shows the result. It is the search skill's sibling (suggestions instead
// of result cards) fused with the annotate skill (match text, attach stickers).
export const COMMANDS_SKILL: Skill = {
  name: "commands",
  summary:
    "offer /-command suggestions (e.g. {Route(from: A to: B)}) and show each command's result inline as a sticker",
  doc: `# Skill: commands

Give the user slash commands. When they type \`/\` in a note, you offer suggestions; picking one inserts a short text snippet like \`{Route(from: Aachen to: Berlin)}\` into the note. Then you watch for that snippet in the text, compute its result, and show the answer inline as a sticker. The effect renders nothing itself - it is pure behavior.

This is two halves working together:
  1. commands:responses - be a SUGGESTION contributor: answer the live \`/\` query with command snippets to insert.
  2. schema:matches + stickers:registry - find the snippets the user inserted and decorate them with their result.

The second half is exactly the \`annotate\` skill (find a data shape, attach stickers). Load it too - \`loadSkill("annotate")\` - for the full schema:matches / stickers:registry / range-target contract; this skill only covers what is specific to commands.

## Choose a command token format

Pick a compact, recognizable token the user can also hand-edit, and one regex that both your suggestions and your matcher agree on. The convention is:

  {Name(arg: value, arg: value)}     e.g. {Route(from: Aachen to: Berlin)}

A matcher for the example above:

  const COMMAND_RE = /\\{Route\\(from:\\s*([^,}]+?)\\s+to:\\s*([^)}]+?)\\)\\}/g;

The args the user ends up with are read from the DOCUMENT TEXT at match time, NOT from the suggestion - the suggestion is just a starting template the user edits in place.

## Half 1: commands:responses - answer the active /-query

  subscribe(element, { type: "commands:responses" }, (responseDocUrl) => { ... })

The callback is invoked once with the url of a fresh response document minted for you. It is a plain map:

  { [query: string]: { label: string, insert: string }[] }

The broker OWNS the keys: it writes the current set of active query strings - i.e. whatever the user has typed after \`/\` in any open menu (the empty string \`""\` means they typed \`/\` with nothing after it yet). You OWN the values: for each query key, write the array of suggestions you offer. Each suggestion is { label, insert }: \`label\` shows in the menu, \`insert\` is the literal text dropped into the note when chosen.

  const handle = await repo.find(responseDocUrl);
  const answer = () => {
    handle.change((doc) => {
      for (const query of Object.keys(doc)) {
        doc[query] = suggestionsFor(query); // filter your commands by the query
      }
    });
  };
  handle.on("change", answer); // re-answer when the broker adds/removes a query
  answer();

Match your commands against the query loosely (case-insensitive prefix/substring on the label or command name) and return [] when nothing fits. Offer your full list for the empty query. In the returned teardown, unsubscribe and remove the "change" listener.

## Half 2: act on the inserted snippet (schema:matches + stickers:registry)

Once the user picks a suggestion, the snippet is ordinary text inside a markdown note - so find it with the SAME schema:matches markdown shape the annotate skill uses, scan each note's \`content\` with your COMMAND_RE, compute the result for each occurrence, and publish a sticker over its character range.

- Build the range target from the matched [from, to) characters with the inline cursor marker (see annotate skill): handle.sub("content", { AUTOMERGE_REF_CURSOR_MARKER: true, start: from, end: to }).url
- Show the result with a TEXT sticker placed after the token, so the original (still editable) command text stays put:
    { type: "text", text: " → 320 km, 3h40", target, slot: "after" }
  (Use slot: "replace" instead if the card should swap the command out for just its result; a style sticker can additionally tint the token.)
- Re-scan a note when its content changes, overwrite that note's registry entry, drop notes that no longer contain a command, and clear everything in teardown.

If results come from the network, the search-skill API rules apply: keyless PUBLIC endpoints only, probe before writing effect.js, throw on fetch failure, and giveUp(...) if it genuinely needs a key. Debounce recomputation and guard against a stale in-flight fetch overwriting a newer one.

## Example effect.js (a /Route command backed by a keyless routing API)

  import { subscribe } from "https://esm.sh/@inkandswitch/patchwork-providers@0.2.2";

  const MARKDOWN_SCHEMA = { type: "object", properties: { "@patchwork": { type: "object", properties: { type: { const: "markdown" } }, required: ["type"] }, content: { type: "string" } }, required: ["@patchwork", "content"] };
  const COMMAND_RE = /\\{Route\\(from:\\s*([^,}]+?)\\s+to:\\s*([^)}]+?)\\)\\}/g;

  export default function activate(element) {
    const repo = element.repo;
    const stops = [];

    // --- Half 1: suggest the command as the user types "/..." ---
    const COMMANDS = [{ label: "Route from … to …", insert: "{Route(from: Aachen to: Berlin)}" }];
    stops.push(subscribe(element, { type: "commands:responses" }, async (responseDocUrl) => {
      const handle = await repo.find(responseDocUrl);
      const answer = () => handle.change((doc) => {
        for (const query of Object.keys(doc)) {
          const q = query.toLowerCase();
          doc[query] = COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || "route".startsWith(q));
        }
      });
      handle.on("change", answer);
      answer();
    }));

    // --- Half 2: find inserted {Route(...)} tokens and sticker their result ---
    let registry; // the sticker registry handle
    const noteHandles = new Map(); // url -> { handle, onChange }
    const geocode = async (place) => {
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(place), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("Nominatim responded " + res.status);
      const hits = await res.json();
      return hits[0] && { lat: Number(hits[0].lat), lon: Number(hits[0].lon) };
    };
    const routeKm = async (from, to) => {
      const a = await geocode(from), b = await geocode(to);
      if (!a || !b) return null;
      const res = await fetch("https://router.project-osrm.org/route/v1/driving/" + a.lon + "," + a.lat + ";" + b.lon + "," + b.lat + "?overview=false");
      if (!res.ok) throw new Error("OSRM responded " + res.status);
      const data = await res.json();
      const r = data.routes && data.routes[0];
      return r ? Math.round(r.distance / 1000) : null;
    };

    const rescan = async (noteUrl) => {
      if (!registry) return;
      const handle = noteHandles.get(noteUrl)?.handle;
      const content = handle?.doc()?.content;
      if (typeof content !== "string") return;
      const stickers = [];
      for (const m of content.matchAll(COMMAND_RE)) {
        const from = m.index, to = m.index + m[0].length;
        const target = handle.sub("content", { AUTOMERGE_REF_CURSOR_MARKER: true, start: from, end: to }).url;
        let text = " → …";
        try { const km = await routeKm(m[1].trim(), m[2].trim()); text = km != null ? " → " + km + " km" : " → no route"; }
        catch (err) { console.error(err); text = " → error"; }
        stickers.push({ type: "text", text, target, slot: "after" });
      }
      registry.change((doc) => { if (stickers.length) doc[noteUrl] = stickers; else delete doc[noteUrl]; });
    };

    stops.push(subscribe(element, { type: "stickers:registry" }, async (registryDocUrl) => {
      registry = await repo.find(registryDocUrl);
      for (const url of noteHandles.keys()) rescan(url);
    }));

    stops.push(subscribe(element, { type: "schema:matches", schema: MARKDOWN_SCHEMA }, async (urls) => {
      const next = new Set(urls);
      for (const [url, entry] of noteHandles) {
        if (next.has(url)) continue;
        entry.handle.off("change", entry.onChange);
        noteHandles.delete(url);
        registry && registry.change((doc) => { delete doc[url]; });
      }
      for (const url of urls) {
        if (noteHandles.has(url)) continue;
        const handle = await repo.find(url);
        const onChange = () => rescan(url);
        handle.on("change", onChange);
        noteHandles.set(url, { handle, onChange });
        rescan(url);
      }
    }));

    return () => {
      for (const stop of stops) stop();
      for (const { handle, onChange } of noteHandles.values()) handle.off("change", onChange);
      if (registry) registry.change((doc) => { for (const k of Object.keys(doc)) delete doc[k]; });
    };
  }

(The two halves are independent: you can ship only Half 1 to provide insertable snippets, or only Half 2 to act on tokens the user types by hand - but together they make a complete command.)`,
};
