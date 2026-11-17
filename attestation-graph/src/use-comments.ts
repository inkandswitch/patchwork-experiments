// The tool's side of the comments sidebar: who the user is (to sign a new
// thread), the shared `patchwork:focus` doc (what's selected, what the
// sidebar highlights), and the unresolved threads on this graph. Threads
// live in the project's root doc: the frame creates them (`comments:create`)
// and lists them (`patchwork:comments`); this doc is never written to. See
// comments.ts for the ref format.

import { request, subscribe } from "@inkandswitch/patchwork-providers";
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { type CommentEntry, type FocusDoc, refsOfThread, urlsKey } from "./comments";

/** The slice of the focus doc's DocHandle this uses. */
type FocusHandle = {
  doc(): FocusDoc | undefined;
  change(fn: (doc: FocusDoc) => void): void;
  on(event: "change", fn: () => void): void;
  off(event: "change", fn: () => void): void;
};

/** The slice of the graph's DocHandle this uses. */
export type CommentsHandle = {
  url: string;
  sub?(...segments: unknown[]): { url: string };
};

type RepoLike = { find(url: string): unknown };

const keys = (m: Record<string, true> | undefined) => Object.keys(m ?? {});

export function useComments(element: HTMLElement, handle: CommentsHandle) {
  const [contact, setContact] = createSignal<string | undefined>();
  const [focus, setFocus] = createSignal<FocusDoc | undefined>(undefined, { equals: false });
  /** unresolved threads pointing into this graph, as the provider lists them */
  const [entries, setEntries] = createSignal<CommentEntry[]>([]);
  let focusHandle: FocusHandle | undefined;
  let disposed = false;

  onCleanup(() => (disposed = true));
  onCleanup(
    subscribe(element, { type: "patchwork:contact" }, (url) =>
      setContact(typeof url === "string" && url ? url : undefined),
    ),
  );
  onCleanup(
    subscribe(element, { type: "patchwork:comments", url: handle.url }, (value) =>
      setEntries(Array.isArray(value) ? (value as unknown as CommentEntry[]) : []),
    ),
  );
  onCleanup(
    subscribe(element, { type: "patchwork:focus" }, (url) => {
      const repo: RepoLike | undefined = (window as any).repo ?? (element as any).repo;
      if (typeof url !== "string" || !url || !repo) return;
      void Promise.resolve(repo.find(url)).then((h) => {
        if (disposed) return;
        const fh = h as FocusHandle;
        focusHandle?.off("change", sync);
        focusHandle = fh;
        fh.on("change", sync);
        sync();
      });
    }),
  );
  const sync = () => setFocus(focusHandle?.doc());
  onCleanup(() => focusHandle?.off("change", sync));

  /** what the focus doc says to emphasise: the selection and the sidebar's highlight */
  const emphasised = createMemo(() => {
    const f = focus();
    return new Set([...keys(f?.selection), ...keys(f?.highlight)]);
  });

  // the selection this tool last wrote, so it isn't revealed back to itself
  let written: string | null = null;
  /** Replace the focus selection with `urls`, unless it already is that. */
  const writeSelection = (urls: string[]) => {
    const key = urlsKey(urls);
    written = key;
    const fh = focusHandle;
    if (!fh || urlsKey(keys(fh.doc()?.selection)) === key) return;
    fh.change((d) => {
      d.selection = Object.fromEntries(urls.map((u) => [u, true as const]));
    });
  };

  /**
   * The tool's selection became `urls` because the focus asked for it (or
   * cleared for it): not written back, so the focus stays as it was.
   */
  const adopt = (urls: string[]) => {
    written = urlsKey(urls);
  };

  /** Call `fn` with the focus selection whenever someone else changes it. */
  const onForeignSelection = (fn: (urls: string[]) => void) => {
    createEffect(
      on(
        createMemo(() => urlsKey(keys(focus()?.selection))),
        (key) => {
          if (key === written) return;
          written = null;
          if (key) fn(key.split("\n"));
        },
      ),
    );
  };

  const subUrl = (fallback: string, ...segments: unknown[]) =>
    typeof handle.sub === "function" ? handle.sub(...segments).url : fallback;

  /**
   * Ask the frame to start a thread on `refs` (it adds a draft comment by
   * the current contact and opens the sidebar on it), then make `refs` the
   * focus. Resolves to the thread's url, or null if the frame couldn't.
   */
  const createThread = async (refs: string[]): Promise<string | null> => {
    if (!refs.length) return null;
    let threadUrl: string | null = null;
    try {
      const url = await request<string | null>(element, { type: "comments:create", refs });
      threadUrl = typeof url === "string" && url ? url : null;
    } catch (err) {
      console.warn("attestation-graph: comments:create failed", err);
    }
    if (disposed) return threadUrl;
    if (!threadUrl) {
      console.warn("attestation-graph: the frame didn't create a comment thread");
      return null;
    }
    writeSelection(refs);
    return threadUrl;
  };

  /** Focus the thread at `threadUrl` (its refs in this graph) and open the sidebar on it. */
  const showThread = (threadUrl: string) => {
    const refs = refsOfThread(entries(), threadUrl);
    if (refs.length) writeSelection(refs);
    element.dispatchEvent(
      new CustomEvent("patchwork:show-comments", {
        bubbles: true,
        composed: true,
        detail: { threadUrl },
      }),
    );
  };

  return {
    contact,
    entries,
    emphasised,
    writeSelection,
    adopt,
    onForeignSelection,
    createThread,
    showThread,
    subUrl,
  };
}
