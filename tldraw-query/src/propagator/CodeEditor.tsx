import { useRef } from "react";

const KEYWORDS = new Set([
  "return", "const", "let", "var", "function", "if", "else", "for", "while",
  "do", "of", "in", "new", "typeof", "instanceof", "void", "delete", "class",
  "extends", "super", "this", "switch", "case", "break", "continue", "default",
  "try", "catch", "finally", "throw", "yield", "await", "async", "import",
  "export", "from", "true", "false", "null", "undefined",
]);

export interface EditorColors {
  /** base (non-token) text */
  text: string;
  /** muted text (labels) */
  muted: string;
  /** container/panel background */
  panelBg: string;
  /** input/editor field background */
  fieldBg: string;
  border: string;
  accent: string;
  danger: string;
  keyword: string;
  string: string;
  comment: string;
  number: string;
}

// Self-contained palettes so the propagator UI is internally consistent
// regardless of how tldraw's CSS variables resolve in this slot — every colour
// flips together with the `dark` flag.
const LIGHT: EditorColors = {
  text: "#1f2328",
  muted: "#57606a",
  panelBg: "#ffffff",
  fieldBg: "#ffffff",
  border: "rgba(0,0,0,0.13)",
  accent: "#2f80ed",
  danger: "#d1242f",
  keyword: "#cf222e",
  string: "#0a7d33",
  comment: "#6e7781",
  number: "#0550ae",
};
const DARK: EditorColors = {
  text: "#e6edf3",
  muted: "#8b949e",
  panelBg: "#22262b",
  fieldBg: "#161b22",
  border: "#30363d",
  accent: "#4493f8",
  danger: "#ff7b72",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  comment: "#8b949e",
  number: "#79c0ff",
};

export function getEditorColors(dark: boolean): EditorColors {
  return dark ? DARK : LIGHT;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Tiny dependency-free JS tokenizer → highlighted HTML. */
export function highlightJs(src: string, dark: boolean): string {
  const p = dark ? DARK : LIGHT;
  const span = (color: string, text: string) =>
    `<span style="color:${color}">${escapeHtml(text)}</span>`;

  let out = "";
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      out += span(p.comment, src.slice(i, j));
      i = j;
    } else if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      out += span(p.comment, src.slice(i, j));
      i = j;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          j++;
          break;
        }
        j++;
      }
      out += span(p.string, src.slice(i, j));
      i = j;
    } else if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9._a-fA-FxXeE]/.test(src[j])) j++;
      out += span(p.number, src.slice(i, j));
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      out += KEYWORDS.has(word) ? span(p.keyword, word) : escapeHtml(word);
      i = j;
    } else {
      out += escapeHtml(c);
      i++;
    }
  }
  return out;
}

const sharedTextStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  border: "none",
  boxSizing: "border-box",
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  whiteSpace: "pre",
  tabSize: 2,
};

/**
 * Minimal code editor: a transparent <textarea> over a highlighted <pre>,
 * with synced scrolling. Stops wheel events from reaching tldraw so the code
 * scrolls instead of zooming the canvas.
 */
export function CodeEditor({
  value,
  onChange,
  onBlur,
  dark,
  height = 220,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  dark: boolean;
  height?: number;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const p = getEditorColors(dark);

  const syncScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  };

  return (
    <div
      onWheelCapture={(e) => e.stopPropagation()}
      style={{
        position: "relative",
        height,
        borderRadius: "var(--radius-2, 6px)",
        border: `1px solid ${p.border}`,
        background: p.fieldBg,
        overflow: "hidden",
      }}
    >
      <pre
        ref={preRef}
        aria-hidden
        style={{
          ...sharedTextStyle,
          position: "absolute",
          inset: 0,
          overflow: "auto",
          pointerEvents: "none",
          color: p.text,
        }}
      >
        <code
          dangerouslySetInnerHTML={{ __html: highlightJs(value + "\n", dark) }}
        />
      </pre>
      <textarea
        ref={taRef}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onScroll={syncScroll}
        style={{
          ...sharedTextStyle,
          position: "absolute",
          inset: 0,
          overflow: "auto",
          resize: "none",
          background: "transparent",
          color: "transparent",
          caretColor: p.text,
          outline: "none",
        }}
      />
    </div>
  );
}
