/**
 * A continuous, scroll-preserving PDF preview built on pdf.js.
 *
 * The native `<iframe src=blob>` viewer (V1) reloaded from scratch on every
 * recompile — it flashed and jumped back to page 1. Here we render each
 * page to its own canvas, swap the whole set in one batch (so there's no
 * blank frame), and restore the scroll position by ratio, which gives the
 * seamless Overleaf-style "recompile in place" feel.
 *
 * It also exposes the hooks SyncTeX needs: a `scrollToRect` handle for
 * forward search, and an `onInverseClick` callback that reports the PDF
 * page + position the user clicked, in SyncTeX points.
 *
 * pdf.js is loaded from CDN at runtime (npm only supplies the types) to
 * keep the tool bundle light, mirroring how the TeX engine is loaded.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";

const PDFJS_VERSION = "6.0.227";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFJS_MODULE_URL = `${PDFJS_BASE}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `${PDFJS_BASE}/build/pdf.worker.min.mjs`;

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const mod = (await import(/* @vite-ignore */ PDFJS_MODULE_URL)) as PdfjsModule;
    // Workers must be same-origin, so fetch the CDN worker and run it from
    // a blob URL — the same trick the TeX engine uses for its worker.
    const resp = await fetch(PDFJS_WORKER_URL);
    const blob = new Blob([await resp.text()], {
      type: "application/javascript",
    });
    mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    return mod;
  })();
  pdfjsPromise.catch(() => {
    pdfjsPromise = null;
  });
  return pdfjsPromise;
}

/** A box on a page, in SyncTeX points (top-left origin, y down). */
export type PdfRect = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPreviewHandle = {
  /**
   * Forward search: scroll the given box into view and flash a marker over
   * it. The rect is in SyncTeX points; the preview scales it per page.
   */
  scrollToRect: (rect: PdfRect) => void;
};

type Props = {
  bytes: Uint8Array | null;
  /** Inverse search: user clicked `page` at (xPt, yPt) in SyncTeX points. */
  onInverseClick?: (page: number, xPt: number, yPt: number) => void;
  onReady?: () => void;
};

export const PdfPreview = forwardRef<PdfPreviewHandle, Props>(
  function PdfPreview({ bytes, onInverseClick, onReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const docRef = useRef<PDFDocumentProxy | null>(null);
    const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
    const genRef = useRef(0);
    // cssScale per 1-based page → maps SyncTeX points to CSS pixels.
    const pageScalesRef = useRef<number[]>([]);
    const onInverseRef = useRef(onInverseClick);
    onInverseRef.current = onInverseClick;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useImperativeHandle(ref, () => ({
      scrollToRect(rect) {
        const container = containerRef.current;
        if (!container) return;
        const pageDiv = container.querySelector<HTMLElement>(
          `.ltx-pdf-page[data-page="${rect.page}"]`
        );
        const cssScale = pageScalesRef.current[rect.page];
        if (!pageDiv || !cssScale) return;
        const leftCss = rect.x * cssScale;
        const topCss = rect.y * cssScale;
        const wCss = Math.max(8, rect.width * cssScale);
        const hCss = Math.max(8, rect.height * cssScale);
        const target =
          pageDiv.offsetTop + topCss - container.clientHeight / 3;
        container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        flash(pageDiv, leftCss, topCss, wCss, hCss);
      },
    }));

    // ── render pump: latest-wins via a generation token ──
    useEffect(() => {
      if (!bytes) return;
      const gen = ++genRef.current;
      let cancelled = false;

      (async () => {
        const pdfjs = await loadPdfjs();
        if (cancelled || gen !== genRef.current) return;

        const container = containerRef.current;
        if (!container) return;

        const prevRatio =
          container.scrollHeight > 0
            ? container.scrollTop / container.scrollHeight
            : 0;

        // Copy the bytes: pdf.js transfers the buffer to its worker, which
        // would detach the array we still need for download/publish.
        const task = pdfjs.getDocument({
          data: bytes.slice(),
          cMapUrl: `${PDFJS_BASE}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
        });
        const doc = await task.promise;

        if (cancelled || gen !== genRef.current) {
          void task.destroy();
          return;
        }

        try {
          await renderAllPages(doc, gen, container);
        } catch {
          void task.destroy();
          return;
        }
        if (cancelled || gen !== genRef.current) {
          void task.destroy();
          return;
        }

        const oldTask = taskRef.current;
        taskRef.current = task;
        docRef.current = doc;
        if (oldTask) void oldTask.destroy();

        container.scrollTop = prevRatio * container.scrollHeight;
        onReadyRef.current?.();
      })();

      return () => {
        cancelled = true;
      };
    }, [bytes]);

    // ── re-render on width changes (debounced) ──
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let timer: number | undefined;
      let lastWidth = container.clientWidth;
      const ro = new ResizeObserver(() => {
        const w = container.clientWidth;
        if (Math.abs(w - lastWidth) < 4) return;
        lastWidth = w;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const doc = docRef.current;
          if (!doc) return;
          const gen = ++genRef.current;
          const prevRatio =
            container.scrollHeight > 0
              ? container.scrollTop / container.scrollHeight
              : 0;
          renderAllPages(doc, gen, container)
            .then(() => {
              if (gen === genRef.current) {
                container.scrollTop = prevRatio * container.scrollHeight;
              }
            })
            .catch(() => {});
        }, 150);
      });
      ro.observe(container);
      return () => {
        ro.disconnect();
        window.clearTimeout(timer);
      };
    }, []);

    // ── inverse search: translate a click into (page, xBp, yBp) ──
    // A single click is enough here — the preview is canvas-only, so there's
    // no text selection to interfere — but we ignore clicks that follow a
    // drag (e.g. a scroll gesture) so jumps only fire on a real tap.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let downX = 0;
      let downY = 0;
      const onDown = (e: PointerEvent) => {
        downX = e.clientX;
        downY = e.clientY;
      };
      const onClick = (e: MouseEvent) => {
        const cb = onInverseRef.current;
        if (!cb) return;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
        const target = e.target as HTMLElement;
        const pageDiv = target.closest<HTMLElement>(".ltx-pdf-page");
        const canvas = pageDiv?.querySelector("canvas");
        if (!pageDiv || !canvas) return;
        const page = Number(pageDiv.dataset.page);
        const cssScale = pageScalesRef.current[page];
        if (!cssScale) return;
        const rect = canvas.getBoundingClientRect();
        const xPt = (e.clientX - rect.left) / cssScale;
        const yPt = (e.clientY - rect.top) / cssScale;
        cb(page, xPt, yPt);
      };
      container.addEventListener("pointerdown", onDown);
      container.addEventListener("click", onClick);
      return () => {
        container.removeEventListener("pointerdown", onDown);
        container.removeEventListener("click", onClick);
      };
    }, []);

    useEffect(() => {
      return () => {
        if (taskRef.current) void taskRef.current.destroy();
      };
    }, []);

    async function renderAllPages(
      doc: PDFDocumentProxy,
      gen: number,
      container: HTMLDivElement
    ) {
      const cssWidth = Math.max(160, container.clientWidth - 32);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const newPages: HTMLDivElement[] = [];
      const scales: number[] = [];

      for (let p = 1; p <= doc.numPages; p++) {
        if (gen !== genRef.current) return;
        const page: PDFPageProxy = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const cssScale = cssWidth / base.width;
        const vp = page.getViewport({ scale: cssScale * dpr });

        const canvas = document.createElement("canvas");
        canvas.className = "ltx-pdf-canvas";
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(base.height * cssScale)}px`;

        await page.render({ canvas, viewport: vp }).promise;
        if (gen !== genRef.current) return;

        const pageDiv = document.createElement("div");
        pageDiv.className = "ltx-pdf-page";
        pageDiv.dataset.page = String(p);
        pageDiv.appendChild(canvas);
        newPages.push(pageDiv);
        scales[p] = cssScale;
        page.cleanup();
      }

      if (gen !== genRef.current) return;
      pageScalesRef.current = scales;
      container.replaceChildren(...newPages);
    }

    return <div ref={containerRef} className="ltx-pdf-scroller" />;
  }
);

/** Flash a fading marker box within a page div (all values in CSS px). */
function flash(
  pageDiv: HTMLElement,
  leftCss: number,
  topCss: number,
  widthCss: number,
  heightCss: number
) {
  const box = document.createElement("div");
  box.className = "ltx-sync-flash";
  box.style.left = `${Math.max(0, leftCss - 2)}px`;
  box.style.top = `${Math.max(0, topCss - 2)}px`;
  box.style.width = `${widthCss + 4}px`;
  box.style.height = `${heightCss + 4}px`;
  pageDiv.appendChild(box);
  window.setTimeout(() => box.remove(), 1200);
}
