import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  type TLShape,
  type RecordProps,
} from "@tldraw/tldraw";
import { useEffect, useState, useCallback } from "react";

export const MONSTER_SHAPE_TYPE = "monster" as const;

declare module "@tldraw/tldraw" {
  export interface TLGlobalShapePropsMap {
    [MONSTER_SHAPE_TYPE]: { w: number; h: number; text: string };
  }
}

export type MonsterShape = TLShape<typeof MONSTER_SHAPE_TYPE>;

// SVG viewBox for the monster head only
const SVG_VB_W = 200;
const SVG_VB_H = 160;

const LEFT_EYE = { cx: 70, cy: 65, r: 22 };
const RIGHT_EYE = { cx: 130, cy: 65, r: 22 };
const PUPIL_R = 8;
const MAX_PUPIL_OFFSET = 10;

const HEAD_RATIO = 0.55;

function MonsterEyes({
  shapeX,
  shapeY,
  shapeW,
  headH,
}: {
  shapeX: number;
  shapeY: number;
  shapeW: number;
  headH: number;
}) {
  const editor = useEditor();
  const [pupils, setPupils] = useState({ lx: 0, ly: 0, rx: 0, ry: 0 });

  useEffect(() => {
    const container = editor.getContainer();
    const scaleX = shapeW / SVG_VB_W;
    const scaleY = headH / SVG_VB_H;

    const onPointerMove = (e: PointerEvent) => {
      const pagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const calc = (eye: { cx: number; cy: number }) => {
        const eyePageX = shapeX + eye.cx * scaleX;
        const eyePageY = shapeY + eye.cy * scaleY;
        const dx = pagePoint.x - eyePageX;
        const dy = pagePoint.y - eyePageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return { ox: 0, oy: 0 };
        const t = Math.min(1, dist / (60 * scaleX));
        return {
          ox: (dx / dist) * MAX_PUPIL_OFFSET * t,
          oy: (dy / dist) * MAX_PUPIL_OFFSET * t,
        };
      };
      const left = calc(LEFT_EYE);
      const right = calc(RIGHT_EYE);
      setPupils({ lx: left.ox, ly: left.oy, rx: right.ox, ry: right.oy });
    };

    container.addEventListener("pointermove", onPointerMove);
    return () => container.removeEventListener("pointermove", onPointerMove);
  }, [editor, shapeX, shapeY, shapeW, headH]);

  return (
    <>
      <ellipse cx={LEFT_EYE.cx} cy={LEFT_EYE.cy} rx={LEFT_EYE.r} ry={LEFT_EYE.r + 2} fill="white" stroke="black" strokeWidth={3} />
      <circle cx={LEFT_EYE.cx + pupils.lx} cy={LEFT_EYE.cy + pupils.ly} r={PUPIL_R} fill="black" />
      <ellipse cx={RIGHT_EYE.cx} cy={RIGHT_EYE.cy} rx={RIGHT_EYE.r} ry={RIGHT_EYE.r + 2} fill="white" stroke="black" strokeWidth={3} />
      <circle cx={RIGHT_EYE.cx + pupils.rx} cy={RIGHT_EYE.cy + pupils.ry} r={PUPIL_R} fill="black" />
    </>
  );
}

function PaperArea({
  shapeId,
  shapeType,
  text,
}: {
  shapeId: string;
  shapeType: string;
  text: string;
}) {
  const editor = useEditor();

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      editor.updateShape({
        id: shapeId as any,
        type: shapeType,
        props: { text: e.currentTarget.value },
      });
    },
    [editor, shapeId, shapeType]
  );

  const stopProp = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      style={{
        flex: 1,
        margin: "0 8px 8px 8px",
        borderRadius: 6,
        border: "1.5px solid #bbb",
        background: `white repeating-linear-gradient(
          to bottom,
          transparent 0px,
          transparent 23px,
          #ccc 23px,
          #ccc 24px
        )`,
        backgroundPositionY: 7,
        overflow: "hidden",
        display: "flex",
      }}
    >
      <textarea
        value={text}
        onChange={onChange}
        onPointerDown={stopProp}
        onTouchStart={stopProp}
        onTouchEnd={stopProp}
        onKeyDown={stopProp}
        placeholder="Write here..."
        style={{
          flex: 1,
          border: "none",
          background: "transparent",
          resize: "none",
          fontFamily: "sans-serif",
          fontSize: 14,
          lineHeight: "24px",
          color: "#333",
          padding: "8px 12px",
          margin: 0,
          outline: "none",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

export class MonsterShapeUtil extends BaseBoxShapeUtil<MonsterShape> {
  static override type = MONSTER_SHAPE_TYPE as string;
  static override props: RecordProps<MonsterShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
  };

  override canResize() {
    return true;
  }

  override getDefaultProps(): MonsterShape["props"] {
    return {
      w: 240,
      h: 350,
      text: "",
    };
  }

  override component(shape: MonsterShape) {
    const { w, h, text } = shape.props;
    const headH = Math.round(h * HEAD_RATIO);

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Monster head */}
        <div style={{ width: "100%", height: headH, flexShrink: 0 }}>
          <svg
            viewBox={`0 0 ${SVG_VB_W} ${SVG_VB_H}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              x={10}
              y={10}
              width={180}
              height={140}
              rx={14}
              ry={14}
              fill="#8BC34A"
              stroke="black"
              strokeWidth={3.5}
            />

            <MonsterEyes
              shapeX={shape.x}
              shapeY={shape.y}
              shapeW={w}
              headH={headH}
            />

            <path
              d={`
                M 55 110
                C 60 125, 65 128, 75 126
                L 80 118 L 88 128 L 96 116
                L 104 128 L 112 118 L 120 126
                C 130 128, 138 125, 145 110
              `}
              fill="none"
              stroke="black"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Paper / notepad area */}
        <PaperArea
          shapeId={shape.id}
          shapeType={shape.type}
          text={text}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: MonsterShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
