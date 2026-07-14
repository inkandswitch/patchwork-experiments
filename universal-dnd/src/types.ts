export type Cleanup = () => void;

/**
 * Context handed to a {@link ViewDecorator}. `overlay` is THIS decorator's own
 * private, full-size, transparent layer stacked over the view — decorators
 * never touch the tool's content or each other's layers.
 */
export interface ViewLayerContext {
  /** The `<patchwork-view>` (or other handle-bearing element) being augmented. */
  view: HTMLElement;
  /** This decorator's own overlay element (position:absolute; inset:0). */
  overlay: HTMLElement;
  /** The primary doc URL the view represents, if any (`doc-url` etc.). */
  url: string | null;
  /** The tool rendering the view, if known (`tool-id`). */
  toolId: string | null;
}

/**
 * A decorator augments a single view. It receives its own overlay layer and
 * returns a cleanup. Called once per view when layers activate (and again for
 * views that appear while active); cleanup runs on deactivate / view removal.
 */
export type ViewDecorator = (ctx: ViewLayerContext) => Cleanup | void;
