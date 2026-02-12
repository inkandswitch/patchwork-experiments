import { StateNode, type TLPointerEventInfo, type TLShapeId, type TLStateNodeConstructor, createShapeId, maybeSnapToGrid } from "tldraw";

const EMBED_TYPE = "patchwork-embed";
const MIN_SIZE = 50;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;

class Idle extends StateNode {
  static override id = "idle";

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition("pointing", info);
  }

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }

  override onCancel() {
    this.editor.setCurrentTool("select");
  }
}

class Pointing extends StateNode {
  static override id = "pointing";

  override onPointerMove(info: TLPointerEventInfo) {
    if (this.editor.inputs.getIsDragging()) {
      const originPagePoint = this.editor.inputs.getOriginPagePoint();
      const id = createShapeId();
      const newPoint = maybeSnapToGrid(originPagePoint, this.editor);

      this.editor.markHistoryStoppingPoint(`creating_embed:${id}`);
      this.editor.createShapes([
        {
          id,
          type: EMBED_TYPE as any,
          x: newPoint.x,
          y: newPoint.y,
          props: {
            w: MIN_SIZE,
            h: MIN_SIZE,
          },
        },
      ]);
      this.editor.select(id);
      this.parent.transition("dragging", { shapeId: id });
    }
  }

  override onPointerUp() {
    this.complete();
  }

  override onCancel() {
    this.cancel();
  }

  override onInterrupt() {
    this.cancel();
  }

  private complete() {
    const originPagePoint = this.editor.inputs.getOriginPagePoint();
    const id = createShapeId();

    this.editor.markHistoryStoppingPoint(`creating_embed:${id}`);
    const newPoint = maybeSnapToGrid(originPagePoint, this.editor);

    this.editor.createShapes([
      {
        id,
        type: EMBED_TYPE as any,
        x: newPoint.x - DEFAULT_WIDTH / 2,
        y: newPoint.y - DEFAULT_HEIGHT / 2,
        props: {
          w: DEFAULT_WIDTH,
          h: DEFAULT_HEIGHT,
        },
      },
    ]);
    this.editor.select(id);

    if (this.editor.getInstanceState().isToolLocked) {
      this.parent.transition("idle");
    } else {
      this.editor.setCurrentTool("select.idle");
    }
  }

  private cancel() {
    this.parent.transition("idle");
  }
}

class Dragging extends StateNode {
  static override id = "dragging";
  shapeId!: TLShapeId;

  override onEnter(info: { shapeId: TLShapeId }) {
    this.shapeId = info.shapeId;
  }

  override onPointerMove() {
    const shape = this.editor.getShape(this.shapeId);
    if (!shape || shape.type !== EMBED_TYPE) return;

    const originPagePoint = this.editor.inputs.getOriginPagePoint();
    const currentPagePoint = this.editor.inputs.getCurrentPagePoint();

    const minX = Math.min(originPagePoint.x, currentPagePoint.x);
    const minY = Math.min(originPagePoint.y, currentPagePoint.y);
    const maxX = Math.max(originPagePoint.x, currentPagePoint.x);
    const maxY = Math.max(originPagePoint.y, currentPagePoint.y);

    const w = Math.max(MIN_SIZE, maxX - minX);
    const h = Math.max(MIN_SIZE, maxY - minY);

    this.editor.updateShape({
      id: this.shapeId,
      type: EMBED_TYPE as any,
      x: minX,
      y: minY,
      props: {
        w,
        h,
      },
    });
  }

  override onPointerUp() {
    if (this.editor.getInstanceState().isToolLocked) {
      this.parent.transition("idle");
    } else {
      this.editor.setCurrentTool("select.idle");
    }
  }

  override onCancel() {
    this.editor.deleteShape(this.shapeId);
    this.parent.transition("idle");
  }

  override onInterrupt() {
    this.editor.deleteShape(this.shapeId);
    this.parent.transition("idle");
  }
}

export class EmbedShapeTool extends StateNode {
  static override id = "embed";
  static override initial = "idle";
  static override children(): TLStateNodeConstructor[] {
    return [Idle, Pointing, Dragging];
  }

  override shapeType = EMBED_TYPE as any;
}
