import type { DocHandle, Repo } from '@automerge/automerge-repo';
import { decodeHeads } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import { diff, getHeads } from '@automerge/automerge';
import { AnnotationSet } from '@inkandswitch/annotations';
import { annotations as globalAnnotations } from '@inkandswitch/annotations-context';
import { diffAnnotationsOfDoc } from '@inkandswitch/annotations-diff';
import { buildCanvasContextText, resolveEmbedMetadata } from './context.js';
import {
  createDocumentProjection,
  makeDocumentProjection,
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import { buildLLMMessages, runLLMProcess } from '@patchwork/llm';
import type { ChatMessage, ContentPart, LLMDoc, LLMWorkspaceDoc } from '@patchwork/llm';
import { domToDataUrl } from 'modern-screenshot';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc } from '../../paper/types.js';
import { applyPatches } from '../../automerge-repo-solid-primitives/apply_patches.js';
import './build-panel.css';

const VERSION = '1.2.0';

// ─── Entry point ──────────────────────────────────────────────────────────────

function paperBuildPanelTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(
    () => (
      <RepoContext.Provider value={(element as any).repo}>
        <BuildPanelUI handle={handle} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
}

// ─── Build Panel UI ───────────────────────────────────────────────────────────

function BuildPanelUI(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);
  const repo = useRepo();
  const [prompt, setPrompt] = createSignal('');
  const [isBuilding, setIsBuilding] = createSignal(false);
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);

  const contactUrl = () =>
    (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;

  const buildRuns = () => {
    const url = contactUrl();
    return url ? (doc.userState?.[url]?.buildRuns ?? []) : [];
  };

  const lastRunUrl = () => {
    const runs = buildRuns() as AutomergeUrl[];
    return runs.length > 0 ? runs[runs.length - 1] : undefined;
  };

  const [lastRunDoc] = useDocument<LLMDoc>(lastRunUrl);
  const workspaceUrl = () => lastRunDoc()?.workspaceUrl;
  const [workspaceDoc] = useDocument<LLMWorkspaceDoc>(workspaceUrl);

  const embedDocUrls = createMemo(() => {
    const shapes = doc.shapes ?? {};
    const urls = new Set<string>();
    for (const shape of Object.values(shapes)) {
      if (shape.type === 'embed' && (shape as any).docUrl) {
        urls.add((shape as any).docUrl as string);
      }
    }
    return urls;
  });

  const changedEntries = createMemo(() => {
    const ws = workspaceDoc();
    if (!ws?.entries) return [];
    const embeds = embedDocUrls();
    return Object.entries(ws.entries)
      .filter(([url, entry]) => entry.changedAt !== null && embeds.has(url))
      .map(([url]) => url as AutomergeUrl);
  });

  // ── Diff annotations ────────────────────────────────────────────────────────

  const diffAnnotationSet = new AnnotationSet();
  globalAnnotations.add(diffAnnotationSet);
  console.log('[build-panel] registered diff annotation set with global annotations');
  onCleanup(() => {
    globalAnnotations.remove(diffAnnotationSet);
    console.log('[build-panel] removed diff annotation set from global annotations');
  });

  const [diffVersion, setDiffVersion] = createSignal(0);

  createEffect(() => {
    const entries = changedEntries();
    console.log('[build-panel] subscribing to doc changes for', entries.length, 'entries');
    const handleCleanups: (() => void)[] = [];
    for (const url of entries) {
      repo.find(url).then((handle) => {
        const listener = () => setDiffVersion((v) => v + 1);
        handle.on('change', listener);
        handleCleanups.push(() => handle.off('change', listener));
      });
    }
    onCleanup(() => handleCleanups.forEach((fn) => fn()));
  });

  createEffect(() => {
    const entries = changedEntries();
    const ws = workspaceDoc();
    const version = diffVersion();

    const toCompute = entries
      .map((url) => ({ url, changedAt: ws?.entries[url]?.changedAt }))
      .filter(
        (e): e is { url: AutomergeUrl; changedAt: NonNullable<typeof e.changedAt> } =>
          e.changedAt != null,
      );

    console.log(
      '[build-panel] recomputing diffs: entries=%d, toCompute=%d, version=%d',
      entries.length,
      toCompute.length,
      version,
    );

    if (toCompute.length === 0) {
      diffAnnotationSet.change(() => diffAnnotationSet.clear());
      return;
    }

    Promise.all(
      toCompute.map(async ({ url, changedAt }) => {
        const handle = await repo.find(url);
        const set = diffAnnotationsOfDoc(handle, decodeHeads(changedAt as any));
        console.log('[build-panel] computed diff for', url.slice(0, 20));
        return set;
      }),
    ).then((sets) => {
      diffAnnotationSet.change(() => {
        diffAnnotationSet.clear();
        for (const set of sets) diffAnnotationSet.add(set);
      });
      console.log('[build-panel] published %d diff annotation sets', sets.length);
    });
  });

  async function handleAccept(url: AutomergeUrl) {
    const wsUrl = workspaceUrl();
    if (!wsUrl) return;
    const wsHandle = await repo.find<LLMWorkspaceDoc>(wsUrl);
    wsHandle.change((d) => {
      if (d.entries[url]) d.entries[url].changedAt = null;
    });
  }

  async function handleReject(url: AutomergeUrl) {
    const wsUrl = workspaceUrl();
    if (!wsUrl) return;

    const wsHandle = await repo.find<LLMWorkspaceDoc>(wsUrl);
    const wsDoc = await wsHandle.doc();
    const entry = wsDoc?.entries[url];
    if (!entry?.changedAt) return;

    const docHandle = await repo.find(url);
    const docValue = await docHandle.doc();
    if (!docValue) return;
    const reversePatches = diff(docValue, getHeads(docValue), entry.changedAt);

    docHandle.change((d) => {
      applyPatches(d, reversePatches);
    });

    wsHandle.change((d) => {
      if (d.entries[url]) d.entries[url].changedAt = null;
    });
  }

  function handleStop() {
    abortController()?.abort();
  }

  function handleClear() {
    const url = contactUrl();
    if (!url) return;
    props.handle.change((d) => {
      if (!d.userState) d.userState = {};
      if (!d.userState[url]) d.userState[url] = {};
      d.userState[url].buildRuns = [];
    });
  }

  async function handleBuild() {
    const text = prompt().trim();
    if (!text || isBuilding()) return;

    const url = contactUrl();
    if (!url) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsBuilding(true);

    try {
      const selection = doc.userState?.[url]?.selection ?? {};
      const allShapes = doc.shapes ?? {};
      const selectedIds = Object.keys(selection);
      const contextShapes =
        selectedIds.length > 0
          ? Object.fromEntries(
              selectedIds.map((id) => [id, allShapes[id]]).filter(([, s]) => s != null),
            )
          : allShapes;

      const viewportEl = findViewport(props.element);
      let screenshotDataUrl: string | null = null;
      if (viewportEl) {
        try {
          screenshotDataUrl = await domToDataUrl(viewportEl);
        } catch (err) {
          console.warn('[build-panel] screenshot failed:', err);
        }
      }

      const previousMessages = await buildContextMessages(repo, buildRuns() as AutomergeUrl[]);

      const paperUrl = props.handle.url;
      const embedMeta = await resolveEmbedMetadata(repo, contextShapes);
      const contextContent: ContentPart[] = [
        {
          type: 'text',
          text: buildCanvasContextText(paperUrl, contextShapes, embedMeta),
        },
      ];
      if (screenshotDataUrl) {
        contextContent.push({ type: 'image_url', image_url: { url: screenshotDataUrl } });
      }

      const contextMessage: ChatMessage = { role: 'user', content: contextContent };

      const workspaceHandle = await getOrCreateWorkspace(
        repo,
        buildRuns() as AutomergeUrl[],
        paperUrl,
      );

      const runHandle = repo.create<LLMDoc>();
      runHandle.change((d) => {
        d['@patchwork'] = { type: 'llm' };
        d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-4-5' };
        d.workspaceUrl = workspaceHandle.url;
        d.prompt = text;
        d.output = [];
        const messages: ChatMessage[] = [...previousMessages, contextMessage];
        if (messages.length > 0) {
          d.previousMessages = messages;
        }
      });

      props.handle.change((d) => {
        if (!d.userState) d.userState = {};
        if (!d.userState[url]) d.userState[url] = {};
        if (!d.userState[url].buildRuns) d.userState[url].buildRuns = [];
        d.userState[url].buildRuns!.push(runHandle.url);
      });

      setPrompt('');

      await runLLMProcess(repo, runHandle.url, controller.signal);
    } finally {
      setIsBuilding(false);
      setAbortController(null);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleBuild();
    }
  }

  return (
    <div class="paper-build-panel">
      <div class="paper-build-header">
        <span class="paper-build-title">Build</span>
        <div class="paper-build-header-right">
          <Show when={buildRuns().length > 0}>
            <button class="paper-build-clear-btn" onClick={handleClear} title="Clear runs">
              Clear
            </button>
          </Show>
          <span class="paper-build-version">v{VERSION}</span>
        </div>
      </div>

      <Show when={buildRuns().length > 0}>
        <div class="paper-build-runs">
          <For each={buildRuns()}>
            {(runUrl) => (
              <div class="paper-build-run">
                <patchwork-view attr:doc-url={runUrl} attr:tool-id="llm" />
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={changedEntries().length > 0}>
        <div class="paper-build-changes">
          <div class="paper-build-changes-header">Changes</div>
          <For each={changedEntries()}>
            {(entryUrl) => (
              <ChangeRow
                url={entryUrl}
                onAccept={() => handleAccept(entryUrl)}
                onReject={() => handleReject(entryUrl)}
              />
            )}
          </For>
        </div>
      </Show>

      <div class="paper-build-input-bar">
        <textarea
          class="paper-build-textarea"
          placeholder="Describe what to build… (⌘↵)"
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={isBuilding()}
          rows={2}
        />
        <Show
          when={isBuilding()}
          fallback={
            <button class="paper-build-btn" onClick={handleBuild} disabled={!prompt().trim()}>
              Build
            </button>
          }
        >
          <button class="paper-build-btn paper-build-btn--stop" onClick={handleStop}>
            Stop
          </button>
        </Show>
      </div>
    </div>
  );
}

// ─── Change row ──────────────────────────────────────────────────────────────

function ChangeRow(props: { url: AutomergeUrl; onAccept: () => void; onReject: () => void }) {
  const handle = useDocHandle<any>(() => props.url);
  const docProjection = createDocumentProjection<any>(handle);
  const docType = () => (docProjection() as any)?.['@patchwork']?.type ?? '';
  const [datatype] = createResource(docType, (dt) =>
    dt ? getRegistry('patchwork:datatype').load(dt) : Promise.resolve(null),
  );
  const title = () =>
    (datatype()?.module as any)?.getTitle?.(docProjection()) ??
    props.url.replace('automerge:', '').slice(0, 12) + '\u2026';

  return (
    <div class="paper-build-change-row">
      <span class="paper-build-change-url" title={props.url}>
        {title()}
      </span>
      <button class="paper-build-accept-btn" onClick={props.onAccept}>
        Accept
      </button>
      <button class="paper-build-reject-btn" onClick={props.onReject}>
        Reject
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateWorkspace(
  repo: Repo,
  runUrls: AutomergeUrl[],
  paperUrl: AutomergeUrl,
): Promise<DocHandle<LLMWorkspaceDoc>> {
  if (runUrls.length > 0) {
    const lastRun = await repo.find<LLMDoc>(runUrls[runUrls.length - 1]);
    const lastRunDoc = await lastRun.doc();
    if (lastRunDoc?.workspaceUrl) {
      return await repo.find<LLMWorkspaceDoc>(lastRunDoc.workspaceUrl);
    }
  }
  const wsHandle = repo.create<LLMWorkspaceDoc>();
  wsHandle.change((d) => {
    d['@patchwork'] = { type: 'llm-workspace' };
    d.title = 'Paper build workspace';
    d.entries = {};
    d.entries[paperUrl] = { url: paperUrl, changedAt: null };
    d.entries[__SKILLS_FOLDER_URL__ as AutomergeUrl] = {
      url: __SKILLS_FOLDER_URL__ as AutomergeUrl,
      changedAt: null,
    };
  });
  return wsHandle;
}

function findViewport(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const vp = cur.parentElement?.querySelector('.paper-viewport');
    if (vp) return vp as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

async function buildContextMessages(repo: Repo, runUrls: AutomergeUrl[]): Promise<ChatMessage[]> {
  const allMessages: ChatMessage[] = [];
  for (const url of runUrls) {
    const handle = await repo.find<LLMDoc>(url);
    const runDoc = await handle.doc();
    if (!runDoc) continue;
    const messages = buildLLMMessages(runDoc);
    for (const msg of messages) {
      if (msg.role !== 'system') {
        allMessages.push({ role: msg.role, content: msg.content });
      }
    }
  }
  return allMessages;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: 'paper-build-panel',
    name: 'Build Panel',
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return paperBuildPanelTool;
    },
  },
];
