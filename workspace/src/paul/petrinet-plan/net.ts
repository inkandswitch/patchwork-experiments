import * as Automerge from '@automerge/automerge';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import { runLLMProcessRaw } from '../../../../llm/src/llm-process';
import type { NetDef, ReadonlyToken, TokenState } from './lib';
import type { PetriNetPlanDoc } from './types';

// ─── Default prompt content ─────────────────────────────────────────────────

export const DEFAULT_OPTIMIZER_PROMPT = 'TODO: describe the optimizer approach';
export const DEFAULT_EVALUATOR_PROMPT = 'TODO: describe the evaluation criteria';

// ─── System prompt: script-execution environment ────────────────────────────

export const PETRINET_SYSTEM_PROMPT = [
  'You are a coding agent that can execute JavaScript to accomplish tasks.',
  '',
  'Execute code by writing it inside <script> tags with a data-description attribute:',
  '',
  '<script data-description="Brief description of what this code does">',
  '// your code here',
  '</script>',
  '',
  'Rules:',
  '- Write one <script> block per iteration; wait for its output before continuing.',
  '- Use `return` to inspect values and `console.log` for intermediate output.',
  '',
  'Working with Automerge documents:',
  '- `repo.find(url)` is async — always `await` it',
  '- Read a document with `await handle.doc()`',
  '- Mutate documents with `handle.change()`',
  '- Use `updateText` from `@automerge/automerge-repo` for text content mutations',
].join('\n');

// ─── Default system prompt templates ────────────────────────────────────────

export const DEFAULT_OPTIMIZER_SYSTEM_PROMPT = [
  'Task: $PROMPT',
  '',
  'Specification: $SPEC_URL',
  'Document to modify: $DOC_URL',
  '',
  'Step 1: Read the specification to understand the goal and constraints.',
  '```',
  'const specHandle = await repo.find("$SPEC_URL")',
  'const specDoc = await specHandle.doc()',
  'return JSON.stringify(specDoc.spec, null, 2)',
  '```',
  '',
  'Step 2: Read any verification docs referenced by the spec.',
  '```',
  'const specHandle = await repo.find("$SPEC_URL")',
  'const specDoc = await specHandle.doc()',
  'const verificationUrls = specDoc.spec?.verificationUrls ?? []',
  'const results = await Promise.all(verificationUrls.map(async url => {',
  '  const h = await repo.find(url)',
  '  const d = await h.doc()',
  '  return { url, title: d.title, constraints: d.constraints, draftText: d.draftText }',
  '}))',
  'return JSON.stringify(results, null, 2)',
  '```',
  '',
  'Step 3: Read the current document.',
  '```',
  'const handle = await repo.find("$DOC_URL")',
  'const doc = await handle.doc()',
  'return doc.content',
  '```',
  '',
  'Step 4: Write your solution to the document using the raw Automerge API:',
  '```',
  'const { updateText } = await import("@automerge/automerge-repo")',
  'const handle = await repo.find("$DOC_URL")',
  'handle.change(d => updateText(d, ["content"], "your improved content here"))',
  '```',
].join('\n');

export const DEFAULT_EVALUATOR_SYSTEM_PROMPT = [
  'Criteria: $PROMPT',
  '',
  'Step 1: Read all solution documents.',
  '```',
  'const urls = $SOLUTION_URLS',
  'const reads = await Promise.all(urls.map(url =>',
  '  repo.find(url).then(h => h.doc()).then(d => ({ url, content: d?.content ?? "" }))',
  '))',
  'return reads.map(r => `--- ${r.url} ---\\n${r.content}`).join("\\n\\n")',
  '```',
  '',
  'Step 2: Pick the best version based on the criteria above.',
  'Respond with ONLY the URL of the winning solution — a single line, nothing else.',
].join('\n');

// ─── Net definition ─────────────────────────────────────────────────────────

export function createNet(repo: Repo, handle: DocHandle<PetriNetPlanDoc>): NetDef {
  return {
    places: ['candidates', 'optimizer_idle', 'optimizer_running', 'evaluator_idle', 'evaluator_running'],

    transitions: [
      {
        id: 'start_optimizing',
        from: ['candidates'],
        fromAll: ['optimizer_idle'],
        to: ['optimizer_running', 'candidates'],

        async onConsumedTokens({ candidates }, { optimizer_idle }, repo) {
          const candidateDoc = candidates.state.documentUrl
            ? await repo.find(candidates.state.documentUrl as AutomergeUrl) as DocHandle<Record<string, unknown>>
            : null;

          const doc = await handle.doc();
          const systemPromptUrl = doc?.systemPromptUrls?.optimizer;
          const systemTemplate = systemPromptUrl
            ? await readDocContent(repo, systemPromptUrl)
            : DEFAULT_OPTIMIZER_SYSTEM_PROMPT;

          const specUrl = candidates.state.specUrl ?? '';
          const produce = [];

          for (const opt of optimizer_idle) {
            const copyHandle = candidateDoc
              ? await createDocumentCopy(repo, candidateDoc)
              : await createMarkdownDoc(repo, '');
            const copyUrl = copyHandle.url as string;

            const charPrompt = opt.state.prompt || DEFAULT_OPTIMIZER_PROMPT;
            const prompt = buildOptimizerPrompt(systemTemplate, charPrompt, copyUrl, specUrl);

            const processHandle = repo.create<Record<string, unknown>>();
            processHandle.change((d) => {
              d['@patchwork'] = { type: 'llm' };
              d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
              d.systemPrompt = PETRINET_SYSTEM_PROMPT;
              d.prompt = prompt;
              d.output = [];
            });

            produce.push({
              state: {
                type: 'llm-process',
                documentUrl: processHandle.url as string,
                optimizerPrompt: charPrompt,
              } as TokenState,
              toPlace: 'optimizer_running',
            });
            produce.push({
              state: {
                type: 'candidate',
                documentUrl: copyUrl,
                specUrl,
                prompt: candidates.state.prompt,
              } as TokenState,
              toPlace: 'candidates',
            });
          }

          return { produce };
        },

        onProducedToken(token, _handle, repo) {
          if (token.placeId === 'optimizer_running') {
            runLLMProcessRaw(repo, token.state.documentUrl as unknown as AutomergeUrl)
              .catch((e) => console.error('[petrinet-plan] optimizer runLLMProcess error', e));
          }
        },
      },

      {
        id: 'finish_optimizing',
        from: ['optimizer_running'],
        to: ['optimizer_idle'],

        async guard({ optimizer_running }, _allTokens, repo) {
          const h = await repo.find(optimizer_running.state.documentUrl as AutomergeUrl);
          const doc = await h.doc() as { done?: boolean } | null;
          return doc?.done === true;
        },

        async onConsumedTokens({ optimizer_running }) {
          return {
            produce: [
              {
                state: {
                  type: 'optimizer',
                  documentUrl: '',
                  prompt: optimizer_running.state.optimizerPrompt,
                },
                toPlace: 'optimizer_idle',
              },
            ],
          };
        },
      },

      {
        id: 'start_evaluating',
        from: ['evaluator_idle'],
        fromAll: ['candidates'],
        to: ['evaluator_running'],

        async guard(_tokens, { candidates }) {
          const withDocs = candidates.filter((c) => c.state.documentUrl);
          return withDocs.length > 1;
        },

        async onConsumedTokens({ evaluator_idle }, { candidates }, repo) {
          const doc = await handle.doc();
          const systemPromptUrl = doc?.systemPromptUrls?.evaluator;
          const systemTemplate = systemPromptUrl
            ? await readDocContent(repo, systemPromptUrl)
            : DEFAULT_EVALUATOR_SYSTEM_PROMPT;

          const evalPrompt = evaluator_idle.state.prompt || DEFAULT_EVALUATOR_PROMPT;
          const solutionUrls = candidates
            .filter((c) => c.state.documentUrl)
            .map((c) => c.state.documentUrl);
          const prompt = buildEvaluatorPrompt(systemTemplate, evalPrompt, solutionUrls);

          const processHandle = repo.create<Record<string, unknown>>();
          processHandle.change((d) => {
            d['@patchwork'] = { type: 'llm' };
            d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
            d.systemPrompt = PETRINET_SYSTEM_PROMPT;
            d.prompt = prompt;
            d.output = [];
          });

          return {
            produce: [
              {
                state: {
                  type: 'llm-process',
                  documentUrl: processHandle.url as string,
                  evaluatorPrompt: evalPrompt,
                  solutionUrls: JSON.stringify(solutionUrls),
                  specUrl: candidates[0]?.state.specUrl ?? '',
                } as TokenState,
                toPlace: 'evaluator_running',
              },
            ],
          };
        },

        onProducedToken(token, _handle, repo) {
          if (token.placeId === 'evaluator_running') {
            runLLMProcessRaw(repo, token.state.documentUrl as unknown as AutomergeUrl)
              .catch((e) => console.error('[petrinet-plan] evaluator runLLMProcess error', e));
          }
        },
      },

      {
        id: 'finish_evaluating',
        from: ['evaluator_running'],
        to: ['evaluator_idle', 'candidates'],

        async guard({ evaluator_running }, _allTokens, repo) {
          const h = await repo.find(evaluator_running.state.documentUrl as AutomergeUrl);
          const doc = await h.doc() as { done?: boolean } | null;
          return doc?.done === true;
        },

        async onConsumedTokens({ evaluator_running }, _allTokens, repo) {
          const processHandle = await repo.find(evaluator_running.state.documentUrl as AutomergeUrl);
          const processDoc = await processHandle.doc() as {
            output?: Array<{ type: string; content?: string }>;
          } | null;
          const outputText = (processDoc?.output ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.content ?? '')
            .join('\n');

          const solutionUrls: string[] = JSON.parse(evaluator_running.state.solutionUrls);
          const specUrl = evaluator_running.state.specUrl;
          const winnerUrl = solutionUrls.find((url) => outputText.includes(url)) ?? solutionUrls[0] ?? '';

          return {
            produce: [
              {
                state: {
                  type: 'evaluator',
                  documentUrl: '',
                  prompt: evaluator_running.state.evaluatorPrompt,
                } as TokenState,
                toPlace: 'evaluator_idle',
              },
              {
                state: {
                  type: 'candidate',
                  documentUrl: winnerUrl,
                  specUrl,
                  prompt: '',
                } as TokenState,
                toPlace: 'candidates',
              },
            ],
          };
        },
      },
    ],

    tokenTypes: [
      {
        id: 'candidate',
        label: 'Candidate',
        color: '#7c3aed',
        create: () => ({
          type: 'candidate',
          documentUrl: '',
          specUrl: '',
          prompt: 'Generate a solution that satisfies this specification.',
        }),
      },
      {
        id: 'optimizer',
        label: 'Optimizer',
        color: '#0891b2',
        create: () => ({
          type: 'optimizer',
          documentUrl: '',
          prompt: DEFAULT_OPTIMIZER_PROMPT,
        }),
      },
      {
        id: 'evaluator',
        label: 'Evaluator',
        color: '#d97706',
        create: () => ({
          type: 'evaluator',
          documentUrl: '',
          prompt: DEFAULT_EVALUATOR_PROMPT,
        }),
      },
      {
        id: 'llm-process',
        label: 'LLM Process',
        color: '#f59e0b',
        create: () => ({
          type: 'llm-process',
          documentUrl: '',
        }),
      },
    ],

    getColor(state) {
      if (state.type === 'candidate') return '#7c3aed';
      if (state.type === 'optimizer') return '#0891b2';
      if (state.type === 'evaluator') return '#d97706';
      if (state.type === 'llm-process') return '#f59e0b';
      return '#6b7280';
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readDocContent(repo: Repo, documentUrl: string): Promise<string> {
  if (!documentUrl) return '';
  const handle = await repo.find(documentUrl as AutomergeUrl);
  const doc = await handle.doc() as { content?: string } | null;
  return doc?.content ?? '';
}

async function createMarkdownDoc(
  repo: Repo,
  content: string,
): Promise<DocHandle<Record<string, unknown>>> {
  const h = repo.create<Record<string, unknown>>();
  h.change((d) => {
    d['@patchwork'] = { type: 'markdown' };
    d.content = content;
  });
  return h;
}

async function createDocumentCopy(
  repo: Repo,
  sourceHandle: DocHandle<Record<string, unknown>>,
): Promise<DocHandle<Record<string, unknown>>> {
  const doc = await sourceHandle.doc();
  if (!doc) throw new Error('Source document is empty');

  const newHandle = repo.import(Automerge.save(Automerge.clone(doc))) as DocHandle<Record<string, unknown>>;

  newHandle.change((d) => {
    const meta = d['@patchwork'] as Record<string, unknown> | undefined;
    if (meta) {
      meta['copyOf'] = sourceHandle.url;
      delete meta['copies'];
    } else {
      d['@patchwork'] = { copyOf: sourceHandle.url };
    }
  });

  sourceHandle.change((d) => {
    const meta = d['@patchwork'] as Record<string, unknown> | undefined;
    if (meta) {
      if (Array.isArray(meta['copies'])) {
        (meta['copies'] as unknown[]).push(newHandle.url);
      } else {
        meta['copies'] = [newHandle.url];
      }
    } else {
      d['@patchwork'] = { copies: [newHandle.url] };
    }
  });

  return newHandle;
}

function buildOptimizerPrompt(
  systemPrompt: string,
  characterPrompt: string,
  docUrl: string,
  specUrl: string,
): string {
  return systemPrompt
    .replace(/\$PROMPT/g, characterPrompt)
    .replace(/\$DOC_URL/g, docUrl)
    .replace(/\$SPEC_URL/g, specUrl);
}

function buildEvaluatorPrompt(
  systemPrompt: string,
  evaluatorPrompt: string,
  solutionUrls: string[],
): string {
  const urlsArray = JSON.stringify(solutionUrls, null, 2);
  return systemPrompt
    .replace(/\$PROMPT/g, evaluatorPrompt)
    .replace(/\$SOLUTION_URLS/g, urlsArray);
}
