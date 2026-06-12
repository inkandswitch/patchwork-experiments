import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { subscribe } from "../vendor/providers";
import type { ElementSource } from "../vendor/providers-solid";
import type { Point } from "./types";

// The `surface:position` provider protocol: a consumer subscribes with the
// automerge url of a thing rendered somewhere on a surface (shapes and embeds
// stamp theirs as `data-automerge-url`), and the nearest surface whose subtree
// renders it streams back the center of its visual footprint in screen
// (client/viewport) coordinates — once immediately, then on every move.
// Screen coordinates are the one frame valid across nested surfaces in the
// same DOM; consumers convert into their own drawing space themselves.

/**
 * Reactive position of the thing rendering `url`, in screen coordinates.
 * Re-subscribes when `url` changes; reads `undefined` until a surface answers
 * (or forever if nothing renders the url — unclaimed subscriptions never
 * settle).
 */
export function subscribePosition(
  element: ElementSource,
  url: Accessor<string | undefined>,
): Accessor<Point | undefined> {
  const [position, setPosition] = createSignal<Point | undefined>(undefined);

  // createEffect first runs after render, so a ref-based ElementSource is
  // resolvable by the time we dispatch the subscribe event.
  createEffect(() => {
    const currentUrl = url();
    setPosition(undefined);

    const target = typeof element === "function" ? element() : element;
    if (!target || !currentUrl) return;

    const unsubscribe = subscribe<Point>(
      target,
      { type: "surface:position", url: currentUrl },
      (point) => setPosition(point),
    );
    onCleanup(unsubscribe);
  });

  return position;
}

export type PositionRegistry = {
  /**
   * Start streaming the position of `url` to `respond`. Emits immediately if
   * measurable, then on every change. Returns the unsubscribe function (the
   * shape `accept` expects from its producer).
   */
  add(url: string, respond: (point: Point) => void): () => void;
  dispose(): void;
};

type PositionEntry = {
  url: string;
  respond: (point: Point) => void;
  last: Point | null;
};

/**
 * The provider-side bookkeeping for one surface: the set of live position
 * subscriptions, re-measured on a single animation-frame loop that only runs
 * while subscriptions exist and only emits when a center actually moved.
 * Polling catches every cause of movement — doc changes, scrolling, window
 * resize, CSS — without wiring an observer to each.
 */
export function createPositionRegistry(root: HTMLElement): PositionRegistry {
  const entries = new Set<PositionEntry>();
  let frame: number | null = null;

  const measureAll = () => {
    frame = null;
    for (const entry of entries) {
      // Unmeasurable (e.g. the element unmounted): hold the last position
      // rather than emitting anything; it resumes if the element returns.
      const point = positionOfUrl(root, entry.url);
      if (point === null) continue;
      if (entry.last && entry.last.x === point.x && entry.last.y === point.y) {
        continue;
      }
      entry.last = point;
      entry.respond(point);
    }
    schedule();
  };

  const schedule = () => {
    if (frame === null && entries.size > 0) {
      frame = requestAnimationFrame(measureAll);
    }
  };

  return {
    add(url, respond) {
      const entry: PositionEntry = { url, respond, last: null };
      entries.add(entry);

      const point = positionOfUrl(root, url);
      if (point !== null) {
        entry.last = point;
        respond(point);
      }
      schedule();

      return () => {
        entries.delete(entry);
        if (entries.size === 0 && frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
        }
      };
    },
    dispose() {
      entries.clear();
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    },
  };
}

/**
 * Center of the visual footprint of whatever renders `url` under `root`, in
 * screen coordinates, or `null` when nothing measurable does (the provider
 * uses `null` to decline, letting the subscribe event bubble to an ancestor
 * surface). Several elements can carry the same url (an embed's view and its
 * drag handle); the footprint is their union.
 */
export function positionOfUrl(root: HTMLElement, url: string): Point | null {
  const matches = root.querySelectorAll(
    `[data-automerge-url="${cssAttributeValue(url)}"]`,
  );

  const rects: DOMRect[] = [];
  for (const element of matches) {
    const rect = visualRect(element);
    // Zero-size rects are unrendered elements (display:none and the like);
    // including them would drag the union to the origin.
    if (rect !== null && (rect.width > 0 || rect.height > 0)) {
      rects.push(rect);
    }
  }

  const union = unionRects(rects);
  if (union === null) return null;

  return {
    x: union.x + union.width / 2,
    y: union.y + union.height / 2,
  };
}

// The stamped element is not always the visual: the shape layer tools stamp a
// full-canvas svg (width/height 100%) whose inner graphics element carries the
// actual geometry, so measure the union of the svg's children instead.
function visualRect(element: Element): DOMRect | null {
  if (element instanceof SVGSVGElement) {
    return unionRects(
      Array.from(element.children, (child) => child.getBoundingClientRect()),
    );
  }
  return element.getBoundingClientRect();
}

function unionRects(rects: DOMRect[]): DOMRect | null {
  if (rects.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

// Automerge urls never contain quotes or backslashes, but escape them anyway
// so a malformed url can't break out of the attribute selector.
function cssAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
