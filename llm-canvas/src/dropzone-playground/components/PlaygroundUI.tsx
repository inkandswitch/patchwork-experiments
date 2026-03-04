import { useState } from "react";
import { TokenDropZone, type PatchworkItem } from "../../shared/dnd/index.ts";
import { DocChip, ToolChip } from "../../shared/tokens.tsx";

type LogEntry = {
  id: number;
  zone: string;
  items: PatchworkItem[];
  time: string;
};

let nextId = 0;

export function PlaygroundUI() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [zoneA, setZoneA] = useState<PatchworkItem[]>([]);
  const [zoneB, setZoneB] = useState<PatchworkItem[]>([]);

  const addLog = (zone: string, items: PatchworkItem[]) => {
    const entry: LogEntry = {
      id: nextId++,
      zone,
      items,
      time: new Date().toLocaleTimeString(),
    };
    setLog((prev) => [entry, ...prev].slice(0, 50));
  };

  const handleDropA = (items: PatchworkItem[]) => {
    addLog("Zone A", items);
    setZoneA((prev) => {
      const existing = new Set(prev.map((i) => i.url));
      return [...prev, ...items.filter((i) => !existing.has(i.url))];
    });
  };

  const handleDropB = (items: PatchworkItem[]) => {
    addLog("Zone B", items);
    setZoneB((prev) => {
      const existing = new Set(prev.map((i) => i.url));
      return [...prev, ...items.filter((i) => !existing.has(i.url))];
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        gap: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, color: "#111" }}>TokenDropZone Playground</div>
        <div style={{ color: "#888", marginTop: 2 }}>
          Drag tokens from embed titlebars into the zones below to test drop handling.
        </div>
      </div>

      {/* Drop zones */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          flexShrink: 0,
        }}
      >
        <DropArea label="Zone A" items={zoneA} onDrop={handleDropA} onClear={() => setZoneA([])} />
        <DropArea label="Zone B" items={zoneB} onDrop={handleDropB} onClear={() => setZoneB([])} />
      </div>

      {/* Log */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "0 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 6,
            position: "sticky",
            top: 0,
            background: "#fff",
          }}
        >
          <span style={{ fontWeight: 600, color: "#555" }}>Drop log</span>
          {log.length > 0 && (
            <button
              style={{
                fontSize: 11,
                border: "none",
                background: "none",
                color: "#aaa",
                cursor: "pointer",
                padding: "2px 4px",
              }}
              onClick={() => setLog([])}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Clear
            </button>
          )}
        </div>

        {log.length === 0 ? (
          <div style={{ color: "#ccc", padding: "8px 0" }}>No drops yet.</div>
        ) : (
          log.map((entry) => (
            <div
              key={entry.id}
              style={{
                borderBottom: "1px solid #f0f0f0",
                padding: "6px 0",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: "#333" }}>{entry.zone}</span>
                <span style={{ color: "#aaa", fontSize: 10 }}>{entry.time}</span>
                <span style={{ color: "#888" }}>
                  {entry.items.length} item{entry.items.length !== 1 ? "s" : ""}
                </span>
              </div>
              {entry.items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: "#555",
                    background: "#f7f7f7",
                    borderRadius: 4,
                    padding: "3px 6px",
                    marginBottom: 2,
                    wordBreak: "break-all",
                  }}
                >
                  <span style={{ color: item.type === "tool" ? "#6366f1" : "#059669", fontWeight: 600 }}>
                    {item.type}
                  </span>{" "}
                  <span style={{ color: "#333" }}>{item.name}</span>
                  <br />
                  <span style={{ color: "#aaa" }}>{item.url}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DropArea({
  label,
  items,
  onDrop,
  onClear,
}: {
  label: string;
  items: PatchworkItem[];
  onDrop: (items: PatchworkItem[]) => void;
  onClear: () => void;
}) {
  return (
    <div style={{ flex: 1 }}>
      <TokenDropZone onDrop={onDrop}>
        {(isDraggedOver) => (
          <div
            style={{
              minHeight: 90,
              border: `2px dashed ${isDraggedOver ? "#1a73e8" : "#d0d0d0"}`,
              borderRadius: 8,
              background: isDraggedOver ? "#e8f0fe" : "#fafafa",
              padding: "8px 10px",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: isDraggedOver ? "#1a73e8" : "#bbb",
                  transition: "color 0.15s",
                }}
              >
                {label}
              </span>
              {items.length > 0 && (
                <button
                  style={{
                    fontSize: 10,
                    border: "none",
                    background: "none",
                    color: "#bbb",
                    cursor: "pointer",
                    padding: "1px 3px",
                  }}
                  onClick={onClear}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  Clear
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <span style={{ fontSize: 11, color: "#ccc" }}>Drop tokens here</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {items.map((item) =>
                  item.type === "tool" ? (
                    <ToolChip key={item.url} docUrl={item.url} name={item.name} path={item.path} draggable={false} />
                  ) : (
                    <DocChip key={item.url} docUrl={item.url} name={item.name} draggable={false} />
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </TokenDropZone>
    </div>
  );
}
