import {
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js";
import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";

/** Find a document and follow it: the latest doc, re-read on every change. */
export function useDoc<T>(
  repo: Repo,
  url: Accessor<AutomergeUrl | undefined>
): [Accessor<T | undefined>, Accessor<DocHandle<T> | undefined>] {
  const [handle, setHandle] = createSignal<DocHandle<T>>();
  const [doc, setDoc] = createSignal<T | undefined>(undefined, {
    equals: false,
  });
  createEffect(() => {
    const target = url();
    setHandle(undefined);
    setDoc(undefined);
    if (!target) return;
    let alive = true;
    let found: DocHandle<T> | undefined;
    const onChange = () => setDoc(() => found?.doc());
    repo.find<T>(target).then(
      (h) => {
        if (!alive) return;
        found = h;
        setHandle(() => h);
        h.on("change", onChange);
        onChange();
      },
      (err) => console.warn(`[patches] ${target} unavailable:`, err)
    );
    onCleanup(() => {
      alive = false;
      found?.off("change", onChange);
    });
  });
  return [doc, handle];
}

/**
 * Find and follow many documents. The accessor re-runs readers whenever any
 * of them changes, or one finishes loading.
 */
export function useHandles<T>(
  repo: Repo,
  urls: Accessor<AutomergeUrl[]>
): Accessor<ReadonlyMap<AutomergeUrl, DocHandle<T>>> {
  const handles = new Map<AutomergeUrl, DocHandle<T>>();
  const stops = new Map<AutomergeUrl, () => void>();
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion((v) => v + 1);

  createEffect(() => {
    const want = new Set(urls());
    for (const [url, stop] of stops) {
      if (want.has(url)) continue;
      stop();
      stops.delete(url);
      handles.delete(url);
    }
    for (const url of want) {
      if (stops.has(url)) continue;
      let alive = true;
      stops.set(url, () => (alive = false));
      repo.find<T>(url).then(
        (h) => {
          if (!alive) return;
          handles.set(url, h);
          h.on("change", bump);
          stops.set(url, () => h.off("change", bump));
          bump();
        },
        (err) => console.warn(`[patches] ${url} unavailable:`, err)
      );
    }
    bump();
  });
  onCleanup(() => {
    for (const stop of stops.values()) stop();
    stops.clear();
    handles.clear();
  });

  return () => {
    version();
    return handles;
  };
}
