import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import { buildCanvasContextText, resolveEmbedMetadata } from './context.js';
import {
  makeDocumentProjection,
  RepoContext,
  useRepo,
} from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { buildLLMMessages, runLLMProcess } from '@patchwork/llm';
import type { ChatMessage, ContentPart, LLMDoc, LLMWorkspaceDoc } from '@patchwork/llm';
import { domToDataUrl } from 'modern-screenshot';
import { For, Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc } from '../../paper/types.js';
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

      const workspaceHandle = repo.create<LLMWorkspaceDoc>();
      workspaceHandle.change((d) => {
        d['@patchwork'] = { type: 'llm-workspace' };
        d.title = 'Paper build workspace';
        d.urls = [paperUrl, __SKILLS_FOLDER_URL__ as AutomergeUrl];
      });

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
