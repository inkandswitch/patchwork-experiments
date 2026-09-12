// Preview
// Which page of the built site corresponds to the file someone is editing.
//
// The build knows this mapping exactly, but it does not hand it out: compileEverything() returns
// nothing, and the rules live in CakeWalk's own `dest` computation. Rather than change every
// fork's build system to export it, this reproduces the rule and then *checks the answer against
// what was actually built* — so a guess that is wrong simply falls back to the home page instead
// of pointing the preview at a 500.

/**
 * The built page for a source path, or undefined if that source does not become a page.
 * `built` is the set of paths the build actually produced, which is what makes this safe.
 */
export function previewPathFor(sourcePath, built) {
  if (!sourcePath || !built?.size) return undefined;

  // Only content/ becomes pages. Templates, fonts and the build system do not.
  if (!sourcePath.startsWith("content/")) return undefined;
  let path = sourcePath.slice("content/".length);

  // Markdown becomes HTML; anything that is not a page is copied through under its own name.
  const isPage = /\.(md|html)$/.test(path);
  if (!isPage) return built.has(path) ? path : undefined;
  path = path.replace(/\.md$/, ".html");

  // Clean URLs: name.html is written as name/index.html, unless the page opted out with
  // `clean: false` — which is why the candidates are checked against the build rather than
  // assumed.
  const candidates = [path];
  if (!path.endsWith("/index.html")) candidates.push(path.replace(/\.html$/, "/index.html"));

  return candidates.find((c) => built.has(c));
}
