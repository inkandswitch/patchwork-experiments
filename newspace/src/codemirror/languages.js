// Pick a CodeMirror language extension from a file's mime type / name / extension
// — the codemirror node reads these off the opstream complement.
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";

export function languageFor({ mimeType, name, extension } = {}) {
  const ext = (extension || (name ? name.split(".").pop() : "") || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("javascript") || mime.includes("typescript") || /^(js|jsx|mjs|cjs|ts|tsx)$/.test(ext))
    return javascript({ jsx: /x$/.test(ext), typescript: /^tsx?$/.test(ext) });
  if (mime.includes("markdown") || /^(md|markdown|mdx)$/.test(ext)) return markdown();
  if (mime.includes("css") || ext === "css") return css();
  if (mime.includes("yaml") || /^ya?ml$/.test(ext)) return yaml();
  if (mime.includes("json") || ext === "json") return json();
  return null;
}
