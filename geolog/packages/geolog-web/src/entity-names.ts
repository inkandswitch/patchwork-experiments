/**
 * Deterministic memorable names for entity UUIDs.
 *
 * Given a UUID string, produces a stable "adjective-noun" name by using
 * bytes from the UUID to index into word lists. Both peers derive the
 * same name for the same UUID without any communication.
 */

const ADJECTIVES = [
  "amber", "azure", "bold", "brave", "bright", "calm", "clear", "cool",
  "coral", "crisp", "cyan", "dark", "deep", "dry", "dusk", "fair",
  "fast", "fine", "firm", "fond", "free", "fresh", "glad", "gold",
  "grand", "gray", "green", "hale", "happy", "harsh", "high", "iron",
  "keen", "kind", "last", "late", "lean", "left", "light", "lime",
  "live", "long", "lost", "loud", "low", "mild", "mint", "near",
  "neat", "new", "next", "nice", "noble", "odd", "old", "open",
  "pale", "past", "plain", "plum", "prime", "pure", "quick", "quiet",
  "rapid", "rare", "raw", "real", "red", "rich", "ripe", "rosy",
  "round", "ruby", "rust", "safe", "sage", "salt", "sharp", "shy",
  "silk", "slim", "slow", "small", "snowy", "soft", "sonic", "sour",
  "stark", "steep", "still", "stout", "sunny", "sure", "swift", "tall",
  "tame", "tart", "thin", "tidy", "trim", "true", "vast", "vivid",
  "warm", "wary", "wide", "wild", "wise", "young", "zany", "zinc",
];

const NOUNS = [
  "arch", "aspen", "bass", "bay", "bear", "birch", "bloom", "bluff",
  "bone", "brook", "cape", "cave", "cedar", "cliff", "cloud", "coal",
  "coast", "cone", "cork", "cove", "crane", "creek", "crest", "crow",
  "dale", "dawn", "deer", "dove", "drift", "dune", "dust", "eagle",
  "edge", "elm", "ember", "fawn", "fern", "finch", "fjord", "flame",
  "flint", "forge", "fox", "frost", "gale", "gate", "gem", "glen",
  "grain", "grove", "gull", "hare", "harp", "hawk", "hazel", "heath",
  "heron", "hill", "holly", "horn", "hound", "iris", "isle", "ivy",
  "jade", "jay", "kelp", "lake", "lark", "leaf", "ledge", "lily",
  "lodge", "lotus", "lynx", "maple", "marsh", "mesa", "mist", "moon",
  "moss", "moth", "oak", "opal", "orca", "otter", "palm", "path",
  "peak", "pearl", "pine", "plum", "pond", "quail", "rain", "raven",
  "reef", "ridge", "river", "robin", "rock", "root", "rose", "sage",
  "seal", "shell", "shore", "slope", "snail", "snow", "spark", "spire",
  "stone", "storm", "swamp", "swan", "thorn", "tide", "trail", "trout",
  "vale", "vine", "weed", "whale", "wing", "wolf", "wren", "yew",
];

/**
 * Extract two index values from a UUID string by parsing hex digits.
 * Uses characters 0-3 (first two hex bytes) for the adjective index
 * and characters 4-7 (next two hex bytes) for the noun index.
 * Falls back gracefully if the UUID is short or malformed.
 */
function indicesFromUuid(uuid: string): [number, number] {
  // Strip hyphens
  const hex = uuid.replace(/-/g, "");
  const a = parseInt(hex.slice(0, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 8), 16) || 0;
  return [a % ADJECTIVES.length, b % NOUNS.length];
}

/**
 * Return a deterministic, memorable name for an entity UUID.
 *
 * Example: "brave-falcon"
 *
 * The same UUID always produces the same name. Different UUIDs will
 * almost always produce different names (112 * 128 = 14336 combinations).
 */
export function entityName(uuid: string): string {
  const [ai, ni] = indicesFromUuid(uuid);
  return `${ADJECTIVES[ai]}-${NOUNS[ni]}`;
}
