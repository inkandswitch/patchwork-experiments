import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import { runLLMProcessRaw } from '../../../../llm/src/llm-process';
import { evaluateSolution } from './evaluate';
import type { NetDef, ReadonlyToken, TokenState } from './lib';
import type { CandidateDoc, PetriNetPlanDoc } from './types';

// ─── Default prompt content ─────────────────────────────────────────────────

export const DEFAULT_OPTIMIZER_PROMPT = 'TODO: describe the optimizer approach';

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

// ─── Default optimizer system prompt template ───────────────────────────────

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

// ─── Net definition ─────────────────────────────────────────────────────────

export function createNet(repo: Repo, planHandle: DocHandle<PetriNetPlanDoc>): NetDef {
  return {
    places: ['spec', 'candidates', 'running'],

    transitions: [
      {
        id: 'decompose',
        from: [],
        readFrom: ['spec', 'candidates', 'running'],
        to: ['running'],

        async guard(_tokens, _allTokens, repo, readTokens) {
          const specToken = readTokens.spec?.[0];
          if (!specToken) return false;
          const candidateTokens = readTokens.candidates ?? [];
          const runningTokens = readTokens.running ?? [];
          const unsolved = await getUnsolvedSubSpecs(repo, specToken, candidateTokens, runningTokens);
          return unsolved.length > 0;
        },

        async onConsumedTokens(_tokens, _allTokens, repo, readTokens) {
          const specToken = readTokens.spec![0];
          const candidateTokens = readTokens.candidates ?? [];
          const runningTokens = readTokens.running ?? [];
          const unsolved = await getUnsolvedSubSpecs(repo, specToken, candidateTokens, runningTokens);

          const doc = await planHandle.doc();
          const systemPromptUrl = doc?.systemPromptUrls?.optimizer;
          const systemTemplate = systemPromptUrl
            ? await readDocContent(repo, systemPromptUrl)
            : DEFAULT_OPTIMIZER_SYSTEM_PROMPT;

          const produce = [];
          for (const subSpecUrl of unsolved) {
            const copyHandle = await createMarkdownDoc(repo, '');
            const copyUrl = copyHandle.url as string;

            const prompt = buildOptimizerPrompt(systemTemplate, DEFAULT_OPTIMIZER_PROMPT, copyUrl, subSpecUrl);

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
                taskSpecUrl: subSpecUrl,
                taskDocUrl: copyUrl,
              } as TokenState,
              toPlace: 'running',
            });
          }

          return { produce };
        },

        onProducedToken(token, _handle, repo) {
          if (token.placeId === 'running') {
            runLLMProcessRaw(repo, token.state.documentUrl as unknown as AutomergeUrl)
              .catch((e) => console.error('[petrinet-plan] runLLMProcess error', e));
          }
        },
      },

      {
        id: 'finish',
        from: ['running'],
        to: ['candidates'],

        async guard({ running }, _allTokens, repo) {
          const h = await repo.find(running.state.documentUrl as AutomergeUrl);
          const doc = await h.doc() as { done?: boolean } | null;
          return doc?.done === true;
        },

        async onConsumedTokens({ running }, _allTokens, repo) {
          const taskSpecUrl = (running.state.taskSpecUrl ?? '') as string;
          const taskDocUrl = (running.state.taskDocUrl ?? '') as string;

          const candidateHandle = repo.create<CandidateDoc>();
          candidateHandle.change((d) => {
            d['@patchwork'] = { type: 'candidate' };
            d.specUrl = taskSpecUrl;
            d.documents = { [taskSpecUrl]: taskDocUrl };
          });

          return {
            produce: [
              {
                state: {
                  type: 'candidate',
                  documentUrl: candidateHandle.url as string,
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
        id: 'spec',
        label: 'Spec',
        color: '#059669',
        create: () => ({ type: 'spec', documentUrl: '', specUrl: '' }),
      },
      {
        id: 'candidate',
        label: 'Candidate',
        color: '#7c3aed',
        create: () => ({ type: 'candidate', documentUrl: '' }),
      },
      {
        id: 'llm-process',
        label: 'LLM Process',
        color: '#f59e0b',
        create: () => ({ type: 'llm-process', documentUrl: '' }),
      },
    ],

    getColor(state) {
      if (state.type === 'spec') return '#059669';
      if (state.type === 'candidate') return '#7c3aed';
      if (state.type === 'llm-process') return '#f59e0b';
      return '#6b7280';
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUnsolvedSubSpecs(
  repo: Repo,
  specToken: ReadonlyToken,
  candidateTokens: ReadonlyToken[],
  runningTokens: ReadonlyToken[],
): Promise<string[]> {
  const specDoc = await readSpecDoc(repo, specToken.state.specUrl);
  const subSpecUrls = specDoc?.subSpecUrls ?? [];
  if (subSpecUrls.length === 0) return [];

  const runningSpecUrls = new Set(
    runningTokens.map((t) => t.state.taskSpecUrl).filter(Boolean),
  );

  const candidatesBySpec = new Map<string, CandidateDoc[]>();
  for (const ct of candidateTokens) {
    if (!ct.state.documentUrl) continue;
    const handle = await repo.find<CandidateDoc>(ct.state.documentUrl as AutomergeUrl);
    const doc = await handle.doc();
    if (!doc?.specUrl) continue;
    const existing = candidatesBySpec.get(doc.specUrl) ?? [];
    existing.push(doc);
    candidatesBySpec.set(doc.specUrl, existing);
  }

  const unsolved: string[] = [];
  for (const url of subSpecUrls) {
    if (runningSpecUrls.has(url)) continue;

    const candidates = candidatesBySpec.get(url) ?? [];
    let foundValid = false;
    for (const candidate of candidates) {
      const solutionUrl = candidate.documents?.[url];
      if (!solutionUrl) continue;
      const result = await evaluateSolution(repo, url, solutionUrl);
      if (result.valid) {
        foundValid = true;
        break;
      }
    }
    if (!foundValid) {
      unsolved.push(url);
    }
  }
  return unsolved;
}

async function readSpecDoc(
  repo: Repo,
  specUrl: string,
): Promise<{ subSpecUrls?: string[]; verificationUrls?: string[] } | null> {
  if (!specUrl) return null;
  const handle = await repo.find(specUrl as AutomergeUrl);
  const doc = await handle.doc() as { spec?: { subSpecUrls?: string[]; verificationUrls?: string[] } } | null;
  return doc?.spec ?? null;
}

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
