const fs = require('fs'),
  path = require('path');

// ---- A guard. A `//` comment runs to the end of its line, so code written after one on the same line is silently switched off
// (this has happened: the line that tells the renderer where the hero is was lost that way). Every source line is checked: find where
// its comment starts (outside any string), and refuse to build if what follows reads as code and not as a remark.
function commentStart(line, st) {
  // st.tpl: inside a template string carried over from the line before
  let q = st.tpl ? '`' : null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') {
      st.tpl = false;
      return i;
    }
  }
  st.tpl = q === '`';
  return -1;
}
const CODEY = [
  /\b(this|hs|st|cs|gs2|S|B|D|fx|gl|bag|stream|world|hero)\.[A-Za-z_$][\w$.]*\s*(=(?!=)|\+=|-=|\()/,
  /\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/,
  /[)\]}]\s*;\s*[A-Za-z_$][\w$.]*\s*(\(|=(?!=)|\+=|-=)/,
  /\bif\s*\([^)]*\)\s*(\{|[A-Za-z_$][\w$.]*\s*(=(?!=)|\())/,
  /\w\([^()]*\);\s*$/
];
function lint(files) {
  const bad = [];
  for (const f of files) {
    const st = { tpl: false };
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, n) => {
        const i = commentStart(line, st);
        if (i < 0) return;
        const c = line.slice(i + 2);
        if (/^\s*(---|\s*$)/.test(c)) return;
        const hit = CODEY.find(r => r.test(c));
        if (hit) bad.push(path.relative(process.cwd(), f) + ':' + (n + 1) + '  ' + c.trim().slice(0, 150));
      });
  }
  return bad;
}
module.exports = lint;
module.exports.commentStart = commentStart;
module.exports.CODEY = CODEY;
