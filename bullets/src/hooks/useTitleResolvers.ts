import { createSignal, type Accessor } from "solid-js";
import type { ImageDoc } from "../datatype.ts";

export function useTitleResolvers(deps: {
  element: HTMLElement;
}) {
  const titleCache = new Map<string, Accessor<string>>();

  function resolveDocTitle(url: string): Accessor<string> {
    const existing = titleCache.get(url);
    if (existing) return existing;

    const [title, setTitle] = createSignal("...");
    titleCache.set(url, title);

    const isPatchworkMode = customElements.get("patchwork-view") !== undefined;

    if (!isPatchworkMode) {
      setTitle("Embedded Doc (requires Tiny Patchwork)");
      return title;
    }

    const repo = (deps.element as Record<string, unknown>).repo as
      | { find(url: string): Promise<{ whenReady(): Promise<void>; doc(): Record<string, unknown> | null; on(event: string, cb: () => void): void }> }
      | undefined;
    if (!repo) return title;

    (async () => {
      try {
        const handle = await repo.find(url);
        await handle.whenReady();
        const d = handle.doc();

        let getTitle: ((doc: Record<string, unknown>) => string) | null = null;
        const type = (d as Record<string, Record<string, unknown>> | null)?.["@patchwork"]?.type;
        if (type) {
          try {
            const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
            const registry = getRegistry("patchwork:datatype");
            const loaded = await registry.load(type as string);
            if (loaded?.module?.getTitle) {
              getTitle = loaded.module.getTitle as (doc: Record<string, unknown>) => string;
            }
          } catch { /* registry unavailable */ }
        }

        const extractTitle = (doc: Record<string, unknown> | null) => {
          if (!doc) return "Untitled";
          if (getTitle) return getTitle(doc) || "Untitled";
          return (doc.title as string) || "Untitled";
        };

        setTitle(extractTitle(d));
        handle.on("change", () => {
          setTitle(extractTitle(handle.doc()));
        });
      } catch {
        setTitle("(error)");
      }
    })();

    return title;
  }

  const ytTitleCache = new Map<string, Accessor<string>>();

  function resolveYouTubeTitle(url: string): Accessor<string> {
    const existing = ytTitleCache.get(url);
    if (existing) return existing;

    const [title, setTitle] = createSignal("...");
    ytTitleCache.set(url, title);

    (async () => {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const res = await fetch(oembedUrl);
        if (res.ok) {
          const data = await res.json();
          setTitle(data.title || "YouTube Video");
        } else {
          setTitle("YouTube Video");
        }
      } catch {
        setTitle("YouTube Video");
      }
    })();

    return title;
  }

  // --- Image src resolution ---

  const imageSrcCache = new Map<string, Accessor<string | null>>();
  const blobUrls: string[] = [];

  function resolveImageSrc(url: string): Accessor<string | null> {
    const existing = imageSrcCache.get(url);
    if (existing) return existing;

    const [src, setSrc] = createSignal<string | null>(null);
    imageSrcCache.set(url, src);

    const repo = (deps.element as Record<string, unknown>).repo as
      | { find(url: string): Promise<{ whenReady(): Promise<void>; doc(): Record<string, unknown> | null }> }
      | undefined;
    if (!repo) return src;

    (async () => {
      try {
        const handle = await repo.find(url);
        await handle.whenReady();
        const d = handle.doc() as ImageDoc | null;
        if (d?.data && d.mimeType) {
          const blob = new Blob([d.data], { type: d.mimeType });
          const blobUrl = URL.createObjectURL(blob);
          blobUrls.push(blobUrl);
          setSrc(blobUrl);
        }
      } catch {
        // image doc failed to load
      }
    })();

    return src;
  }

  function cleanupBlobUrls() {
    for (const url of blobUrls) {
      URL.revokeObjectURL(url);
    }
    blobUrls.length = 0;
  }

  return { resolveDocTitle, resolveYouTubeTitle, resolveImageSrc, cleanupBlobUrls };
}
