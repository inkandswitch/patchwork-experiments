import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  accept,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The base context providers (shipped by patchwork-base) that we mount via the
 * `<patchwork-view component="…">` mechanism. Each answers a `patchwork:*`
 * subscription bubbling up from descendant tools:
 *   - account → `patchwork:contact` (the current user's contact doc)
 *   - comments → `patchwork:comments` (threads across all mounted docs)
 *   - focus → `patchwork:focus` (a shared selection/highlight doc)
 *   - toolStorage → `patchwork:tool-storage` (a private per-tool doc, lazily
 *     created; lets a tool persist account-scoped data without a `docUrl`)
 * Selection (`patchwork:selected-doc` / `patchwork:selected-view`) is answered
 * by our own {@link SelectionProvider} instead, so it tracks the active panel.
 */
const BASE_PROVIDER_IDS = {
  account: "patchwork-account-provider",
  comments: "patchwork-comments-provider",
  focus: "patchwork-focus-provider",
  toolStorage: "patchwork-tool-storage-provider",
} as const;

const REQUIRED_PROVIDERS = Object.values(BASE_PROVIDER_IDS);

type SelectedView = { url: AutomergeUrl; toolId: string | null };

/** One document on screen, as `patchwork:open-views` reports it. */
export type OpenView = {
  url: AutomergeUrl;
  toolId: string | null;
  selected: boolean;
};

/**
 * Answers `patchwork:selected-doc` and `patchwork:selected-view` subscriptions
 * with the tiling frame's active *content* panel, re-emitting whenever that
 * selection changes. Unlike the base `SelectedDocProvider` (which tracks the
 * last-opened document), this mirrors what the frame visually marks as selected
 * so context tools (history, …) and the wayfinding chips always agree.
 *
 * Also answers `patchwork:open-views`: every content panel's document, with the
 * selected one marked — for tools (the ambient agent) whose context is
 * everything on screen, not just the selection. Frames that show one document
 * at a time needn't answer it; subscribers fall back to `selected-doc`.
 */
const SelectionProvider = ({
  selectedDocUrl,
  selectedToolId,
  openViews,
  children,
}: {
  selectedDocUrl: AutomergeUrl | undefined;
  selectedToolId: string | null;
  openViews: OpenView[];
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const docSubscribers = useRef(new Set<(urls: AutomergeUrl[]) => void>());
  const viewSubscribers = useRef(
    new Set<(view: SelectedView | null) => void>(),
  );
  const openSubscribers = useRef(new Set<(views: OpenView[]) => void>());
  const currentOpen = useRef<OpenView[]>([]);
  currentOpen.current = openViews;

  // Hold the latest selection so newly-arriving subscribers get the current
  // value synchronously inside `accept`.
  const current = useRef<{ url: AutomergeUrl | undefined; toolId: string | null }>(
    { url: undefined, toolId: null },
  );
  current.current = { url: selectedDocUrl, toolId: selectedToolId };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onSubscribe = (event: Event) => {
      const subscribeEvent = event as SubscribeEvent;
      const type = subscribeEvent.detail.selector.type;
      if (type === "patchwork:selected-doc") {
        accept<AutomergeUrl[]>(subscribeEvent, (respond) => {
          respond(current.current.url ? [current.current.url] : []);
          docSubscribers.current.add(respond);
          return () => docSubscribers.current.delete(respond);
        });
      } else if (type === "patchwork:selected-view") {
        accept<SelectedView | null>(subscribeEvent, (respond) => {
          respond(
            current.current.url
              ? { url: current.current.url, toolId: current.current.toolId }
              : null,
          );
          viewSubscribers.current.add(respond);
          return () => viewSubscribers.current.delete(respond);
        });
      } else if (type === "patchwork:open-views") {
        accept<OpenView[]>(subscribeEvent, (respond) => {
          respond(currentOpen.current);
          openSubscribers.current.add(respond);
          return () => openSubscribers.current.delete(respond);
        });
      }
    };
    el.addEventListener("patchwork:subscribe", onSubscribe);
    return () => el.removeEventListener("patchwork:subscribe", onSubscribe);
  }, []);

  useEffect(() => {
    const urls = selectedDocUrl ? [selectedDocUrl] : [];
    for (const emit of docSubscribers.current) emit(urls);
    const view: SelectedView | null = selectedDocUrl
      ? { url: selectedDocUrl, toolId: selectedToolId }
      : null;
    for (const emit of viewSubscribers.current) emit(view);
  }, [selectedDocUrl, selectedToolId]);

  // `openViews` is a fresh array whenever the layout changes; only re-emit
  // when what it describes changed.
  const openKey = JSON.stringify(openViews);
  useEffect(() => {
    for (const emit of openSubscribers.current) emit(currentOpen.current);
  }, [openKey]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
};

/**
 * Mounts the base context providers around the frame and supplies the
 * tiling-frame's own selection provider. Tool subscriptions are request/answer
 * over a MessagePort, so the providers' listeners must be attached before tools
 * subscribe — we gate the children on every base provider's
 * `patchwork:mounted` signal, with a grace-period fallback so a runtime missing
 * a provider still renders the app (that context just stays unavailable).
 */
export const FrameProviders = ({
  accountDocUrl,
  selectedDocUrl,
  selectedToolId,
  openViews,
  children,
}: {
  accountDocUrl: AutomergeUrl;
  selectedDocUrl: AutomergeUrl | undefined;
  selectedToolId: string | null;
  openViews: OpenView[];
  children: ReactNode;
}) => {
  const accountRef = useRef<HTMLElement>(null);
  const toolStorageRef = useRef<HTMLElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const focusRef = useRef<HTMLElement>(null);
  const mounted = useRef(new Set<string>());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const elements = [
      accountRef.current,
      toolStorageRef.current,
      commentsRef.current,
      focusRef.current,
    ].filter((el): el is HTMLElement => el != null);

    const onMounted = (event: Event) => {
      const id = (event as CustomEvent<{ componentId?: string }>).detail
        ?.componentId;
      if (!id) return;
      mounted.current.add(id);
      if (REQUIRED_PROVIDERS.every((req) => mounted.current.has(req))) {
        setReady(true);
      }
    };

    elements.forEach((el) =>
      el.addEventListener("patchwork:mounted", onMounted),
    );
    const fallback = setTimeout(() => setReady(true), 2500);
    return () => {
      elements.forEach((el) =>
        el.removeEventListener("patchwork:mounted", onMounted),
      );
      clearTimeout(fallback);
    };
  }, []);

  return (
      <patchwork-view
        component={BASE_PROVIDER_IDS.account}
        doc-url={accountDocUrl}
        ref={accountRef}
        style={{ display: "contents" }}
      >
        <patchwork-view
          component={BASE_PROVIDER_IDS.toolStorage}
          doc-url={accountDocUrl}
          ref={toolStorageRef}
          style={{ display: "contents" }}
        >
          <patchwork-view
            component={BASE_PROVIDER_IDS.comments}
            ref={commentsRef}
            style={{ display: "contents" }}
          >
            <patchwork-view
              component={BASE_PROVIDER_IDS.focus}
              ref={focusRef}
              style={{ display: "contents" }}
            >
              <SelectionProvider
                selectedDocUrl={selectedDocUrl}
                selectedToolId={selectedToolId}
                openViews={openViews}
              >
                {ready ? children : null}
              </SelectionProvider>
            </patchwork-view>
          </patchwork-view>
        </patchwork-view>
      </patchwork-view>
  );
};
