import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import {
  createContext,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
  useContext,
  type JSX,
} from 'solid-js';
import { getTasksRepo } from './tasks-repo';

/** The Repo the task framework's documents are read and written through. */
const RepoContext = createContext<Repo>();

export function useRepo() {
  const repo = useContext(RepoContext);
  if (!repo) {
    throw new Error('tasks: a component was rendered outside WithTasksRepo');
  }
  return repo;
}

/**
 * Renders `children` once this tab's tasks Repo (see tasks-repo.ts) is there,
 * with it as the Repo that `useRepo`, `useDoc` and `useHandle` go through.
 */
export function WithTasksRepo(props: { fallback?: JSX.Element; children: JSX.Element }) {
  const [repo] = createResource(getTasksRepo);
  return (
    <Show when={repo()} fallback={props.fallback}>
      {(ready) => <RepoContext.Provider value={ready()}>{props.children}</RepoContext.Provider>}
    </Show>
  );
}

/**
 * The handle on the doc at `url`: undefined until it has loaded, and whenever
 * there is no url.
 *
 * A queue names its tasks, workers and router by url, and a url can get here
 * before the doc it names does. Asking for it then fails with "unavailable",
 * which isn't an error so much as "not yet": this keeps asking, and whatever
 * shows the doc shows a placeholder in the meantime.
 */
export function useHandle<T>(url: () => AutomergeUrl | null | undefined, repo = useRepo()) {
  const [handle, setHandle] = createSignal<DocHandle<T>>();

  createEffect(() => {
    const wanted = url();
    setHandle(undefined);
    if (!wanted) {
      return;
    }

    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const load = () => {
      repo.find<T>(wanted).then(
        (found) => {
          if (!stopped) setHandle(() => found);
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
    });
  });

  return handle;
}

/** The doc at `url`, kept current: undefined until it has loaded. See {@link useHandle}. */
export function useDoc<T>(url: () => AutomergeUrl | null | undefined, repo = useRepo()) {
  return useHandleDocWhenThere(useHandle<T>(url, repo));
}

/** The doc behind a handle that may not have loaded yet, kept current. */
export function useHandleDocWhenThere<T>(handle: () => DocHandle<T> | undefined) {
  const [doc, setDoc] = createSignal<T>();

  createEffect(() => {
    const current = handle();
    setDoc(() => current?.doc());
    if (!current) {
      return;
    }
    const show = () => setDoc(() => current.doc());
    current.on('change', show);
    onCleanup(() => current.off('change', show));
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
