// Example document for fresh accounts (aggregated into the bundle's init.js):
// a chat with a few messages already in it. Standalone: builds the doc shape
// inline (mirrors ChitterDatatype.init) instead of going through the plugin
// registry. Messages use the inline shape ({id, name, text, timestamp}).

// The full chitter feature preset — mirrors CHITTER_FULL_IDS in src/datatype.ts.
const PLUGINS = [
  // features
  "reactions",
  "sidebar",
  "voice",
  "gifSelfie",
  "emoticons",
  "call",
  "notifications",
  "computer",
  // slash commands
  "me",
  "slap",
  "font",
  "colour",
  "face",
  "marquee",
  "shrug",
  "tableflip",
  "addfont",
  "emoticon",
  // message actions
  "react",
  "delete",
  // parser extensions
  "sub",
  "sup",
  "underline-em",
  "underline",
  "spoiler",
  "inverted",
  "strike",
];

export default async function example(repo) {
  const now = Date.now();
  const msg = (name, text, minutesAgo) => ({
    id: crypto.randomUUID(),
    name,
    text,
    timestamp: now - minutesAgo * 60_000,
  });

  const handle = await repo.create2({
    "@patchwork": {
      type: "chitter",
      suggestedImportUrl: new URL("./dist/index.js", import.meta.url).href,
    },
    title: "Chitter",
    messages: [
      msg("goose", "welcome to chitter!! this whole chat is a document", 34),
      msg(
        "goose",
        "share it with someone and you're chatting. no server, no signup",
        33
      ),
      msg(
        "gander",
        "try */shrug* or */tableflip* — and there are ~spoilers~ and __underlines__ too",
        21
      ),
      msg("gander", "leave a reaction on this one 👇", 20),
    ],
    docs: [],
    plugins: PLUGINS,
  });

  return { name: "Chitter", type: "chitter", url: handle.url };
}
