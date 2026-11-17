// A label as both versions have it, word by word: what only this version
// says in <mark data-side="ours">, what only the other says in
// <mark data-side="theirs">, the rest as it is. Neither is taken for the
// older: they're just two versions. Or, given who changed it (`by`), the
// other is what it was before: what they put in is marked
// <mark data-side=by data-op="added">, what they took out
// <mark data-side=by data-op="removed">. Pure.
//
// Both labels come in sanitized (tags without attributes), and this one's
// tags all go out unchanged while the other's own tags are dropped, so the
// markup stays this label's, well formed, with only the marks added around
// runs of text.

const TOKEN = /<[^>]*>|&[a-z0-9#]+;|\s+|[^\s<&]+/gi;
// past this many token pairs, a label isn't worth diffing word by word
const LIMIT = 40_000;

type Side = "ours" | "theirs";
export type By = Side | "both";
type Op = { op: "same" | Side; token: string };

export function wordDiff(ours: string, theirs: string, by?: By): string | null {
  if (ours === theirs) return null;
  const a = ours.match(TOKEN) ?? [];
  const b = theirs.match(TOKEN) ?? [];
  if (a.length * b.length > LIMIT) return null;
  return render(regions(diff(a, b)), by);
}

/**
 * Changes read as phrases: a space both share between two changes joins
 * them, and in each run of changes what the other says comes first, then
 * what this one says.
 */
function regions(ops: Op[]): Op[] {
  const changed = (o: Op | undefined) => !!o && o.op !== "same";
  const out: Op[] = [];
  let theirs: Op[] = [];
  let ours: Op[] = [];
  const close = () => {
    out.push(...theirs, ...ours);
    theirs = [];
    ours = [];
  };
  ops.forEach((o, i) => {
    if (o.op === "theirs") theirs.push(o);
    else if (o.op === "ours") ours.push(o);
    else if (isSpace(o.token) && changed(ops[i - 1]) && changed(ops[i + 1])) {
      theirs.push({ op: "theirs", token: o.token });
      ours.push({ op: "ours", token: o.token });
    } else {
      close();
      out.push(o);
    }
  });
  close();
  return out;
}

/** Longest common subsequence, then walked forward: the other's words before this one's. */
function diff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ op: "same", token: a[i++] });
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      ops.push({ op: "theirs", token: b[j++] });
    } else {
      ops.push({ op: "ours", token: a[i++] });
    }
  }
  return ops;
}

const isTag = (token: string) => token.startsWith("<");
const isSpace = (token: string) => /^\s+$/.test(token);

function render(ops: Op[], by?: By): string {
  let out = "";
  // the run of text only one version has, collecting
  let runOp: Side | null = null;
  let runText = "";
  const flush = () => {
    if (!runOp) return;
    // space only the other has is dropped, this one's kept, and either way
    // it stays outside the mark
    const [, before, words, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(runText)!;
    const space = (s: string) => (runOp === "ours" ? s : "");
    const attrs = by
      ? `data-side="${by}" data-op="${runOp === "ours" ? "added" : "removed"}"`
      : `data-side="${runOp}"`;
    out += words ? `${space(before)}<mark ${attrs}>${words}</mark>${space(after)}` : space(runText);
    runOp = null;
    runText = "";
  };
  for (const { op, token } of ops) {
    if (isTag(token)) {
      flush();
      // this label's tags stay; the other's own are left out
      if (op !== "theirs") out += token;
    } else if (op === "same") {
      flush();
      out += token;
    } else {
      if (runOp !== op) flush();
      runOp = op;
      runText += token;
    }
  }
  flush();
  return out;
}
