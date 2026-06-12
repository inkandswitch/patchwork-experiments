import { render } from "solid-js/web";
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { RepoContext, useRepo } from "../vendor/automerge-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { subscribePosition } from "../surface/position";
import { topmostShapeAt } from "../select/geometry";
import type { Point, SurfaceState } from "../surface/types";
import type { LinkFocusDoc } from "./types";
import "./arrow.css";

// Renders the in-flight link arrows while a link is armed in a text editor
// (see link/extension.ts): one arrow per target already in the link, plus a
// live arrow from the link to the mouse that snaps to the midpoint of the
// shape under the cursor. Clicking a shape appends it to the link (the editor
// mirrors it into the text and ends the activation); clicking empty space or
// pressing Escape cancels. The layer holds no document state — the layer doc
// exists only to mount it — everything is driven by the shared focus doc.
export const LinkArrowLayerTool: ToolRender = (handle, element) => {
  element.classList.add("link-arrow-host");

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LinkArrowLayer host={element} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function LinkArrowLayer(props: { host: HTMLElement }): JSX.Element {
  const repo = useRepo();

  const [focusDoc, focusHandle] = subscribeDoc<LinkFocusDoc>(() => props.host, {
    type: "patchwork:focus",
  });
  const [surfaceState] = subscribeDoc<SurfaceState>(() => props.host, {
    type: "surface:state",
  });

  const activeLink = () => focusDoc()?.activeLink;

  // The focus doc is shared across the whole surface hierarchy, so a nested
  // paper with this layer would draw the same arrows a second time. Only the
  // outermost surface renders them; screen coordinates make its arrows land
  // correctly over nested surfaces anyway.
  const [isNested, setIsNested] = createSignal(true);
  onMount(() => {
    const ownRoot = props.host.closest("[data-surface-root]");
    setIsNested(
      Boolean(ownRoot?.parentElement?.closest("[data-surface-root]")),
    );
  });

  // The raw mouse in screen coordinates, from a capture-phase listener:
  // surface roots stop pointer propagation in the bubble phase, and the
  // stamped pointer state goes quiet over non-surface embeds — this always
  // tracks.
  const [mouse, setMouse] = createSignal<Point>();
  onMount(() => {
    const onMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      setMouse({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("pointermove", onMove, true);
    onCleanup(() => window.removeEventListener("pointermove", onMove, true));
  });

  // Escape cancels the activation outright; the editor notices the entry
  // vanish and tears down its side.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeLink()) return;
      focusHandle()?.change((doc) => {
        delete doc.activeLink;
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  // The shape under the cursor, hit-tested in the stamping surface's local
  // space (so shapes inside nested surfaces are found too). The token guards
  // against out-of-order async resolutions on rapid moves.
  const [hoveredUrl, setHoveredUrl] = createSignal<AutomergeUrl>();
  let hitToken = 0;
  createEffect(() => {
    const pointer = surfaceState()?.pointer;
    if (!activeLink() || !pointer) {
      setHoveredUrl(undefined);
      return;
    }
    const token = ++hitToken;
    void topmostShapeAt(
      repo,
      pointer.surfaceUrl,
      pointer.position.x,
      pointer.position.y,
    ).then((url) => {
      if (token === hitToken) setHoveredUrl(url);
    });
  });

  // The hovered shape's midpoint in screen coordinates, via the
  // surface:position provider; resets to undefined whenever the hover moves
  // to another shape.
  const hoveredPosition = subscribePosition(() => props.host, hoveredUrl);

  // Target picking, driven by the stamped pointer's pressed transitions
  // (clicks over non-surface areas never stamp, so they neither pick nor
  // cancel — Escape covers those). A press on a new shape appends it; on
  // anything else it cancels. The editor reacts to either change.
  let wasPressed = false;
  createEffect(() => {
    const pointer = surfaceState()?.pointer;
    if (!pointer) return;
    const startedPress = !wasPressed && pointer.isPressed;
    wasPressed = pointer.isPressed;

    const link = activeLink();
    if (!startedPress || !link) return;

    const focus = focusHandle();
    if (!focus) return;

    const url = hoveredUrl();
    if (url && !link.targets.includes(url)) {
      focus.change((doc) => {
        doc.activeLink?.targets.push(url);
      });
    } else {
      focus.change((doc) => {
        delete doc.activeLink;
      });
    }
  });

  // Screen coordinates → this layer's local space. The host is a full-canvas
  // overlay, so this is a plain offset by its own screen position.
  const toLocal = (point: Point): Point => {
    const rect = props.host.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  };

  const sourceLocal = () => {
    const link = activeLink();
    return link ? toLocal(link.source) : undefined;
  };

  // The live arrow's endpoint: the hovered shape's midpoint when snapped,
  // the raw mouse otherwise.
  const liveEnd = () => {
    const snapped = hoveredUrl() ? hoveredPosition() : undefined;
    const end = snapped ?? mouse();
    return end ? toLocal(end) : undefined;
  };

  // One arrow per target already in the link, each tracking its shape's
  // midpoint through the position provider.
  const TargetArrow = (p: { url: string; from: Point }) => {
    const position = subscribePosition(
      () => props.host,
      () => p.url,
    );
    return (
      <Show when={position()}>
        {(point) => <ArrowPath from={p.from} to={toLocal(point())} />}
      </Show>
    );
  };

  return (
    <Show when={!isNested() && activeLink() && sourceLocal()}>
      {(from) => (
        <svg class="link-arrow-svg">
          <For each={activeLink()!.targets}>
            {(url) => <TargetArrow url={url} from={from()} />}
          </For>
          <Show when={liveEnd()}>
            {(end) => (
              <>
                <ArrowPath from={from()} to={end()} live />
                <Show when={hoveredUrl() && hoveredPosition()}>
                  <circle
                    class="link-arrow-snap"
                    cx={end().x}
                    cy={end().y}
                    r={6}
                  />
                </Show>
              </>
            )}
          </Show>
        </svg>
      )}
    </Show>
  );
}

// A straight arrow with a chevron head drawn as plain segments (no svg
// markers, so several instances never fight over def ids).
function ArrowPath(props: { from: Point; to: Point; live?: boolean }) {
  const HEAD = 10;

  const head = () => {
    const dx = props.to.x - props.from.x;
    const dy = props.to.y - props.from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return "";
    const angle = Math.atan2(dy, dx);
    const left = angle + Math.PI * 0.85;
    const right = angle - Math.PI * 0.85;
    const { x, y } = props.to;
    return (
      `M ${x + HEAD * Math.cos(left)} ${y + HEAD * Math.sin(left)} ` +
      `L ${x} ${y} ` +
      `L ${x + HEAD * Math.cos(right)} ${y + HEAD * Math.sin(right)}`
    );
  };

  return (
    <>
      <line
        class="link-arrow-line"
        classList={{ "link-arrow-live": props.live }}
        x1={props.from.x}
        y1={props.from.y}
        x2={props.to.x}
        y2={props.to.y}
      />
      <path class="link-arrow-line" d={head()} />
    </>
  );
}
