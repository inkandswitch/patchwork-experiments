// Pick a CodeMirror language extension from a file's mime type / name / extension.
// Each language pack is DYNAMICALLY imported so it's a separate chunk — loaded only
// when a file of that type is opened, instead of bloating the editor bundle with all
// ~15 grammars up front. `languageFor` is async; the editor reconfigures once it
// resolves (see codemirrorEditor).
export async function languageFor({ mimeType, name, extension } = {}) {
  const ext = (extension || (name ? name.split(".").pop() : "") || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("javascript") || mime.includes("typescript") || /^(js|jsx|mjs|cjs|ts|tsx)$/.test(ext))
    return (await import("@codemirror/lang-javascript")).javascript({ jsx: /x$/.test(ext), typescript: /^tsx?$/.test(ext) });
  if (mime.includes("markdown") || /^(md|markdown|mdx)$/.test(ext)) return (await import("@codemirror/lang-markdown")).markdown();
  if (mime.includes("css") || ext === "css") return (await import("@codemirror/lang-css")).css();
  if (mime.includes("yaml") || /^ya?ml$/.test(ext)) return (await import("@codemirror/lang-yaml")).yaml();
  if (mime.includes("json") || ext === "json") return (await import("@codemirror/lang-json")).json();
  if (mime.includes("html") || /^(html?|xhtml)$/.test(ext)) return (await import("@codemirror/lang-html")).html();
  if (mime.includes("xml") || /^(xml|svg|rss|atom)$/.test(ext)) return (await import("@codemirror/lang-xml")).xml();
  if (mime.includes("python") || /^(py|pyw)$/.test(ext)) return (await import("@codemirror/lang-python")).python();
  if (mime.includes("rust") || ext === "rs") return (await import("@codemirror/lang-rust")).rust();
  if (/^(c|h|cc|cpp|cxx|hpp|hh)$/.test(ext)) return (await import("@codemirror/lang-cpp")).cpp();
  if (ext === "java") return (await import("@codemirror/lang-java")).java();
  if (mime.includes("php") || ext === "php") return (await import("@codemirror/lang-php")).php();
  if (mime.includes("sql") || ext === "sql") return (await import("@codemirror/lang-sql")).sql();
  if (/^(wat|wast)$/.test(ext)) return (await import("@codemirror/lang-wast")).wast();
  return null;
}
