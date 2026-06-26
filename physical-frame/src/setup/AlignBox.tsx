import { For, Show } from "solid-js";
import type { CameraViewBox } from "../folder-datatype";

const DIRS = ["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const;

/** The white alignment outline; drag to move, handles to resize (align mode). */
export function AlignBox(props: {
  box: CameraViewBox;
  interactive: boolean;
  onChange: (next: CameraViewBox) => void;
}) {
  let el!: HTMLDivElement;

  const stageRect = () =>
    (el.parentElement as HTMLElement).getBoundingClientRect();

  const startMove = (event: PointerEvent) => {
    if (!props.interactive) return;
    if ((event.target as HTMLElement).classList.contains("sph-resize")) return;
    const rect = stageRect();
    const start = props.box;
    const sx = event.clientX;
    const sy = event.clientY;
    let cur = { ...start };

    const onMove = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / rect.width;
      const dy = (m.clientY - sy) / rect.height;
      cur = {
        ...start,
        x: clamp(start.x + dx, 1 - start.w),
        y: clamp(start.y + dy, 1 - start.h),
      };
      el.style.left = `${cur.x * 100}%`;
      el.style.top = `${cur.y * 100}%`;
    };
    const onUp = (u: PointerEvent) => {
      el.releasePointerCapture(u.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      props.onChange(cur);
    };
    el.setPointerCapture(event.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const startResize = (event: PointerEvent, dir: string) => {
    const rect = stageRect();
    const b = props.box;
    const sx = event.clientX;
    const sy = event.clientY;
    const left = b.x;
    const top = b.y;
    const right = b.x + b.w;
    const bottom = b.y + b.h;
    const min = 0.02;
    let cur = { ...b };

    const onMove = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / rect.width;
      const dy = (m.clientY - sy) / rect.height;
      let l = left;
      let t = top;
      let r = right;
      let bo = bottom;
      if (dir.includes("w")) l = clamp(Math.min(left + dx, right - min), 1);
      if (dir.includes("e")) r = clamp(Math.max(right + dx, left + min), 1);
      if (dir.includes("n")) t = clamp(Math.min(top + dy, bottom - min), 1);
      if (dir.includes("s")) bo = clamp(Math.max(bottom + dy, top + min), 1);
      cur = { x: l, y: t, w: r - l, h: bo - t };
      el.style.left = `${cur.x * 100}%`;
      el.style.top = `${cur.y * 100}%`;
      el.style.width = `${cur.w * 100}%`;
      el.style.height = `${cur.h * 100}%`;
    };
    const onUp = (u: PointerEvent) => {
      el.releasePointerCapture(u.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      props.onChange(cur);
    };
    el.setPointerCapture(event.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={el}
      class="sph-view-box"
      data-interactive={props.interactive ? "" : undefined}
      style={{
        left: `${props.box.x * 100}%`,
        top: `${props.box.y * 100}%`,
        width: `${props.box.w * 100}%`,
        height: `${props.box.h * 100}%`,
      }}
      onPointerDown={startMove}
    >
      <div class="sph-corner tl" />
      <div class="sph-corner tr" />
      <div class="sph-corner bl" />
      <div class="sph-corner br" />
      <Show when={props.interactive}>
        <For each={DIRS}>
          {(dir) => (
            <div
              class="sph-resize"
              data-dir={dir}
              onPointerDown={(e) => {
                startResize(e, dir);
              }}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}
