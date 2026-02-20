import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLShape,
} from "@tldraw/tldraw";

export const PATCHWORK_TOKEN_TYPE = "patchwork-token" as const;

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [PATCHWORK_TOKEN_TYPE]: { w: number; h: number; data: string };
  }
}

export type PatchworkTokenShape = TLShape<typeof PATCHWORK_TOKEN_TYPE>;

export interface PatchworkDndItem {
  id: string;
  url: string;
  type: string;
  name: string;
  source: string;
}

export interface PatchworkDndData {
  source: string;
  items: PatchworkDndItem[];
}

export class PatchworkTokenShapeUtil extends BaseBoxShapeUtil<PatchworkTokenShape> {
  static override type = PATCHWORK_TOKEN_TYPE as string;

  static override props = {
    w: T.number,
    h: T.number,
    data: T.string,
  };

  override canResize() {
    return false;
  }

  override hideResizeHandles() {
    return true;
  }

  override getDefaultProps(): PatchworkTokenShape["props"] {
    return {
      w: 220,
      h: 120,
      data: "{}",
    };
  }

  override component(shape: PatchworkTokenShape) {
    let parsed: PatchworkDndData | null = null;
    try {
      parsed = JSON.parse(shape.props.data);
    } catch {
      // invalid JSON — render fallback
    }

    return (
      <HTMLContainer
        style={{
          padding: 10,
          fontSize: 12,
          fontFamily: "sans-serif",
          overflow: "hidden",
          background: "#f8f8f8",
          border: "1px solid #ccc",
          borderRadius: 6,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          pointerEvents: "all",
        }}
      >
        {parsed ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 2, color: "#555" }}>
              {parsed.source ?? "unknown source"}
            </div>
            {parsed.items?.map((item, i) => (
              <div
                key={item.id ?? i}
                style={{
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  padding: "3px 6px",
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    color: "#888",
                    fontSize: 10,
                    textTransform: "uppercase",
                  }}
                >
                  {item.type}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.name}
                </span>
              </div>
            ))}
          </>
        ) : (
          <div style={{ color: "#999" }}>Invalid drop data</div>
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: PatchworkTokenShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} ry={6} />;
  }
}
