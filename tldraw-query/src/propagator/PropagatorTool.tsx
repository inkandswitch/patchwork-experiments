import {
  DefaultToolbar,
  DefaultToolbarContent,
  StateNode,
  createShapeId,
  useEditor,
  useValue,
  type Editor,
  type TLUiOverrides,
  type TLUiToolsContextType,
} from "@tldraw/tldraw";
import {
  PROPAGATOR_MEMBER_BINDING_TYPE,
  PROPAGATOR_SHAPE_TYPE,
  DEFAULT_TRANSFORM,
  type PropagatorShape,
} from "./PropagatorShape.tsx";

export const PROPAGATOR_TOOL_ID = "propagator";

/**
 * Wraps the currently-selected shapes in a new propagator: creates a
 * propagator shape at the page origin and a `propagator-member` binding to
 * each selected shape, then returns to the select tool.
 */
export function createPropagatorFromSelection(editor: Editor): void {
  const memberIds = editor
    .getSelectedShapeIds()
    .filter((id) => editor.getShape(id)?.type !== PROPAGATOR_SHAPE_TYPE);

  if (memberIds.length === 0) {
    console.warn("[propagator] no shapes selected — select shapes first");
    return;
  }

  const propagatorId = createShapeId();

  editor.run(() => {
    editor.createShape<PropagatorShape>({
      id: propagatorId,
      type: PROPAGATOR_SHAPE_TYPE,
      x: 0,
      y: 0,
      parentId: editor.getCurrentPageId(),
      props: { target: "", transform: DEFAULT_TRANSFORM },
    });

    for (const memberId of memberIds) {
      editor.createBinding({
        type: PROPAGATOR_MEMBER_BINDING_TYPE,
        fromId: propagatorId,
        toId: memberId,
        props: {},
      });
    }
  });

  console.log("[propagator] created propagator", propagatorId, "with members", memberIds);
  editor.select(propagatorId);
}

// ---------------------------------------------------------------------------
// StateNode tool — acts immediately on activation, using the live selection
// ---------------------------------------------------------------------------

export class PropagatorTool extends StateNode {
  static override id = PROPAGATOR_TOOL_ID;

  override onEnter() {
    createPropagatorFromSelection(this.editor);
    this.editor.setCurrentTool("select");
  }
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

export const propagatorUiOverrides: TLUiOverrides = {
  tools(editor: Editor, tools: TLUiToolsContextType) {
    tools[PROPAGATOR_TOOL_ID] = {
      id: PROPAGATOR_TOOL_ID,
      icon: "tool-arrow" as never,
      label: "Propagator" as never,
      kbd: "p",
      onSelect() {
        editor.setCurrentTool(PROPAGATOR_TOOL_ID);
      },
    };
    return tools;
  },
};

export function PropagatorToolbar() {
  const editor = useEditor();
  const hasSelection = useValue(
    "propagator-has-selection",
    () => editor.getSelectedShapeIds().length > 0,
    [editor]
  );

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      <div
        style={{
          width: 1,
          height: 20,
          background: "#ddd",
          margin: "0 4px",
          flexShrink: 0,
        }}
      />
      <button
        type="button"
        onClick={() => createPropagatorFromSelection(editor)}
        title="Wrap the selected shapes in a propagator (P)"
        disabled={!hasSelection}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: 32,
          padding: "0 10px",
          border: "none",
          borderRadius: 6,
          background: hasSelection ? "#eef0ff" : "transparent",
          color: hasSelection ? "#4348c0" : "#aaa",
          cursor: hasSelection ? "pointer" : "default",
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        ⛓ Propagate
      </button>
    </DefaultToolbar>
  );
}
