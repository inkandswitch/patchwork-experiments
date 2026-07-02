import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel } from "@embark/context";
import type { Sticker } from "./sticker";

// Sticker sources write their slice keyed by target *document* url; the
// renderer reads `stickers[docUrl]`. Sticker values live inline (plain JSON).
export const Stickers = defineChannel<Record<AutomergeUrl, Sticker[]>>({
  name: "stickers",
  empty: {},
});
