// A tiny, dependency-free fuzzy matcher for short labels (place names, command
// names). It is case- and whitespace-insensitive: a match is either a substring
// containment in either direction, or a small edit distance scaled to the query
// length (so "berln" still matches "Berlin"). An empty query never matches.

/**
 * @param {string} text
 * @param {string} query
 * @returns {boolean}
 */
export function fuzzyMatch(text, query) {
  const a = normalize(text);
  const b = normalize(query);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const tolerance = Math.max(1, Math.floor(b.length / 4));
  return levenshtein(a, b) <= tolerance;
}

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

// Standard Levenshtein DP over a single rolling row — O(a*b), fine for the
// short strings compared here.
function levenshtein(a, b) {
  const cols = b.length + 1;
  const row = new Array(cols);
  for (let j = 0; j < cols; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j < cols; j++) {
      const above = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = above;
    }
  }
  return row[cols - 1];
}
