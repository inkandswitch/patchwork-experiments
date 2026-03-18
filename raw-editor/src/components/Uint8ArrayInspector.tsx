import { useMemo, useState } from "react";

type InspectMode = "hex" | "decimal" | "utf8" | "base64";

const INSPECT_MODES: { key: InspectMode; label: string }[] = [
  { key: "hex", label: "Hex" },
  { key: "decimal", label: "Decimal" },
  { key: "utf8", label: "UTF-8" },
  { key: "base64", label: "Base64" },
];

function renderInspectContent(bytes: Uint8Array, mode: InspectMode): string {
  if (mode === "base64") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  if (mode === "utf8") {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  if (mode === "decimal") {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const slice = bytes.slice(i, i + 16);
      lines.push(
        Array.from(slice)
          .map((b) => b.toString().padStart(3, " "))
          .join(" "),
      );
    }
    return lines.join("\n");
  }
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.slice(i, i + 16);
    lines.push(
      Array.from(slice)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
    );
  }
  return lines.join("\n");
}

export function Uint8ArrayInspector({ bytes }: { bytes: Uint8Array }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<InspectMode>("hex");
  const content = useMemo(
    () => renderInspectContent(bytes, mode),
    [bytes, mode],
  );

  return (
    <span className="u8-node">
      <span className="u8-badge">Uint8Array</span>
      <span className="u8-size">{bytes.byteLength} bytes</span>
      <span
        className="u8-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
      >
        {expanded ? "hide" : "inspect"}
      </span>
      {expanded && (
        <span className="u8-dump">
          <span className="u8-mode-bar">
            {INSPECT_MODES.map((m) => (
              <span
                key={m.key}
                className={`u8-mode-btn${mode === m.key ? " u8-mode-btn--active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode(m.key);
                }}
              >
                {m.label}
              </span>
            ))}
          </span>
          <pre className="u8-pre">{content}</pre>
        </span>
      )}
    </span>
  );
}
