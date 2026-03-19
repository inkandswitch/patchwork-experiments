import type { DocHandle, Repo } from '@automerge/automerge-repo';
import { getRegistry } from '@inkandswitch/patchwork-plugins';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createMarkdownCopy(repo: Repo, content: string): Promise<{ url: string }> {
  const { createDocOfDatatype2 } = await import('@inkandswitch/patchwork-plugins');
  const markdownDatatype = (await getRegistry('patchwork:datatype').load('markdown')) as any;
  const h = await createDocOfDatatype2(markdownDatatype, repo, (d: Record<string, unknown>) => {
    d.content = content;
  });
  return { url: h.url as string };
}
import type { NetDef, ReadonlyToken } from './lib';
import type { LLMPetriNetDoc } from './types';
import { runLLMProcess } from '../../llm/src/llm-process';

// ─── Default system prompt templates ──────────────────────────────────────────

export const DEFAULT_OPTIMIZER_SYSTEM_PROMPT = [
  'You are a suspect in a murder mystery. Here is your character:',
  '',
  '$PROMPT',
  '',
  '---',
  '',
  'The case file you are contributing to is at: $DOC_URL',
  '',
  "Your task: Read the current account, then append exactly ONE new beat — a single line of dialogue or action — that your character would say or do next. Think about what you know, what you're hiding, and what you might let slip.",
  '',
  'Step 1: Read the case file.',
  '```',
  'const handle = await repo.find("$DOC_URL")',
  'const doc = await handle.doc()',
  'const content = doc.content',
  'return content',
  '```',
  '',
  'Step 2: Decide what your character does next. Then append it.',
  '```',
  'const { updateText } = await import("@automerge/automerge-repo")',
  'const handle = await repo.find("$DOC_URL")',
  'const doc = await handle.doc()',
  'const myLine = "\\n[CharacterName]: [what they say or do]"',
  'handle.change(d => updateText(d, ["content"], doc.content + myLine))',
  '```',
  '',
  "Replace [CharacterName] with your character's name. Write only the single line — no stage directions, no narration, no explanation.",
].join('\n');

export const DEFAULT_EVALUATOR_SYSTEM_PROMPT = [
  'You are the lead detective sifting through witness accounts. Here is your approach:',
  '',
  '$PROMPT',
  '',
  '---',
  '',
  'Each suspect has contributed a line to the case file. Here are the resulting versions:',
  '',
  'Step 1: Read all versions.',
  '```',
  'const urls = $SOLUTION_URLS',
  'const reads = await Promise.all(urls.map(url =>',
  '  repo.find(url).then(h => h.doc()).then(d => ({ url, content: d?.content ?? "" }))',
  '))',
  'return reads.map(r => `--- ${r.url} ---\\n${r.content}`).join("\\n\\n")',
  '```',
  '',
  'Step 2: Identify which continuation best deepens the mystery or casts the most compelling suspicion. Then write the winning content to the target document.',
  '```',
  'const { updateText } = await import("@automerge/automerge-repo")',
  '// Replace WINNING_URL with the url of the version you chose',
  'const winner = reads.find(r => r.url === "WINNING_URL")',
  'const target = await repo.find("$TARGET_URL")',
  'target.change(d => updateText(d, ["content"], winner.content))',
  '```',
].join('\n');

// ─── Net definition ───────────────────────────────────────────────────────────

export function createNet(repo: Repo, handle: DocHandle<LLMPetriNetDoc>): NetDef {
  return {
    places: ['problems', 'optimizer', 'solutions', 'evaluators'],

    transitions: [
      {
        id: 'optimizing',
        from: ['problems'],
        fromAll: ['optimizer'],
        to: ['solutions', 'optimizer'],

        async onConsumedTokens({ problems }, { optimizer }, repo) {
          const storyContent = await readStoryContent(repo, problems.state.documentUrl);
          const doc = await handle.doc();
          const systemTemplate = doc?.systemPrompts?.optimizer ?? DEFAULT_OPTIMIZER_SYSTEM_PROMPT;
          const produce = [];

          for (const opt of optimizer) {
            const { copyUrl, processUrl } = await launchOptimizerRun(repo, storyContent, opt, systemTemplate);
            produce.push({ state: { type: 'solution', documentUrl: copyUrl, processUrl }, toPlace: 'solutions' });
            produce.push({ state: opt.state, toPlace: 'optimizer' });
          }

          return { produce };
        },

        onProducedToken(token, _handle, repo) {
          if (token.placeId === 'solutions' && token.state.processUrl) {
            runLLMProcess(repo, token.state.processUrl as unknown as import('@automerge/automerge-repo').AutomergeUrl)
              .catch((e) => console.error('[llm-petrinet] optimizer runLLMProcess error', e));
          }
        },
      },

      {
        id: 'evaluating',
        from: ['evaluators'],
        fromAll: ['solutions'],
        to: ['problems', 'evaluators'],

        async guard(_tokens, { solutions }) {
          return solutions.length > 0;
        },

        async onConsumedTokens({ evaluators }, { solutions }, repo) {
          const doc = await handle.doc();
          const systemTemplate = doc?.systemPrompts?.evaluator ?? DEFAULT_EVALUATOR_SYSTEM_PROMPT;
          const { newProblemUrl, processUrl } = await launchEvaluatorRun(repo, solutions, evaluators.state.prompt, systemTemplate);

          return {
            produce: [
              { state: evaluators.state, toPlace: 'evaluators' },
              { state: { type: 'problem', documentUrl: newProblemUrl, processUrl }, toPlace: 'problems' },
            ],
          };
        },

        onProducedToken(token, _handle, repo) {
          if (token.placeId === 'problems' && token.state.processUrl) {
            runLLMProcess(repo, token.state.processUrl as unknown as import('@automerge/automerge-repo').AutomergeUrl)
              .catch((e) => console.error('[llm-petrinet] evaluator runLLMProcess error', e));
          }
        },
      },
    ],

    tokenTypes: [
      {
        id: 'problem',
        label: 'Problem',
        color: '#7c3aed',
        async create() {
          const { url } = await createMarkdownCopy(repo, '# The Scene of the Crime\n\n');
          return { type: 'problem', documentUrl: url };
        },
      },
      {
        id: 'optimizer',
        label: 'Optimizer',
        color: '#0891b2',
        async create() {
          return { type: 'optimizer', prompt: 'The nervous butler who discovered the body and is hiding something.', documentUrl: '' };
        },
      },
      {
        id: 'evaluator',
        label: 'Evaluator',
        color: '#d97706',
        async create() {
          return { type: 'evaluator', prompt: 'Favour the version that introduces the most chilling new revelation or casts suspicion onto a fresh suspect.', documentUrl: '' };
        },
      },
      {
        id: 'solution',
        label: 'Solution',
        color: '#16a34a',
        async create() {
          return { type: 'solution', documentUrl: '' };
        },
      },
    ],

    getColor(state) {
      if (state.type === 'problem') return '#7c3aed';
      if (state.type === 'optimizer') return '#0891b2';
      if (state.type === 'evaluator') return '#d97706';
      if (state.type === 'solution') return '#16a34a';
      return '#6b7280';
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readStoryContent(repo: Repo, documentUrl: string): Promise<string> {
  if (!documentUrl) return '';
  const handle = await repo.find(documentUrl as import('@automerge/automerge-repo').AutomergeUrl);
  const doc = await handle.doc() as { content?: string } | null;
  return doc?.content ?? '';
}

async function launchOptimizerRun(
  repo: Repo,
  storyContent: string,
  optimizer: ReadonlyToken,
  systemTemplate: string,
): Promise<{ copyUrl: string; processUrl: string }> {
  const { url: copyUrl } = await createMarkdownCopy(repo, storyContent);
  const prompt = buildOptimizerPrompt(systemTemplate, optimizer.state.prompt, copyUrl);

  const processHandle = repo.create<Record<string, unknown>>();
  processHandle.change((d) => {
    d['@patchwork'] = { type: 'llm' };
    d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
    d.prompt = prompt;
    d.output = [];
  });

  return { copyUrl, processUrl: processHandle.url as string };
}

async function launchEvaluatorRun(
  repo: Repo,
  solutions: ReadonlyToken[],
  evaluatorPrompt: string,
  systemTemplate: string,
): Promise<{ newProblemUrl: string; processUrl: string }> {
  const { url: newProblemUrl } = await createMarkdownCopy(repo, '');
  const solutionUrls = solutions.map((s) => s.state.documentUrl).filter(Boolean);
  const prompt = buildEvaluatorPrompt(systemTemplate, evaluatorPrompt, solutionUrls, newProblemUrl);

  const processHandle = repo.create<Record<string, unknown>>();
  processHandle.change((d) => {
    d['@patchwork'] = { type: 'llm' };
    d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' };
    d.prompt = prompt;
    d.output = [];
  });

  return { newProblemUrl, processUrl: processHandle.url as string };
}

function buildOptimizerPrompt(systemPrompt: string, characterPrompt: string, docUrl: string): string {
  return systemPrompt
    .replace(/\$PROMPT/g, characterPrompt)
    .replace(/\$DOC_URL/g, docUrl);
}

function buildEvaluatorPrompt(
  systemPrompt: string,
  evaluatorPrompt: string,
  solutionUrls: string[],
  targetUrl: string,
): string {
  const urlsArray = JSON.stringify(solutionUrls, null, 2);
  return systemPrompt
    .replace(/\$PROMPT/g, evaluatorPrompt)
    .replace(/\$SOLUTION_URLS/g, urlsArray)
    .replace(/\$TARGET_URL/g, targetUrl);
}
