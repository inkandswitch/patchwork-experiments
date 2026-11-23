import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import { createContext, createEffect, createSignal, onCleanup, useContext } from 'solid-js';

/** The Repo the component was mounted with. */
export const RepoContext = createContext<Repo>();

export function useRepo() {
  const repo = useContext(RepoContext);
  if (!repo) {
    throw new Error('tasks: a component was rendered outside a RepoContext.Provider');
  }
  return repo;
}

/**
 * The doc at `url`, kept current: undefined until it has loaded, and whenever
 * there is no url.
 *
 * A queue names its tasks, workers and router by url, and a url can get here
 * before the doc it names does. Asking for it then fails with "unavailable",
 * which isn't an error so much as "not yet": this keeps asking, and whatever
 * shows the doc shows a placeholder in the meantime.
 */
export function useDoc<T>(url: () => AutomergeUrl | null | undefined) {
  const repo = useRepo();
  const [doc, setDoc] = createSignal<T>();

  createEffect(() => {
    const wanted = url();
    setDoc(undefined);
    if (!wanted) {
      return;
    }

    let handle: DocHandle<T> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const show = () => setDoc(() => handle!.doc());

    const load = () => {
      repo.find<T>(wanted).then(
        (found) => {
          if (stopped) return;
          handle = found;
          show();
          handle.on('change', show);
        },
        () => {
          if (!stopped) retry = setTimeout(load, 2_000);
        },
      );
    };
    load();

    onCleanup(() => {
      stopped = true;
      clearTimeout(retry);
      handle?.off('change', show);
    });
  });

  return doc;
}

/** The doc behind a handle the caller already has, kept current. */
export function useHandleDoc<T>(handle: DocHandle<T>) {
  const [doc, setDoc] = createSignal<T>(handle.doc());
  const show = () => setDoc(() => handle.doc());
  handle.on('change', show);
  onCleanup(() => handle.off('change', show));
  return doc;
}
