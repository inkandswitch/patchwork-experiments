import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import type { SpecDoc } from '../workflow/types';
import type { LLMProcessDoc, ChatMessage } from '../llm/types';
import { runWorkspaceLLM } from '../llm/llm-process';

export function resolveOwningSpecUrl(
  rootSpecUrl: AutomergeUrl,
  specDocUrls?: AutomergeUrl[],
): AutomergeUrl {
  const mostSpecific = specDocUrls?.find((url) => url !== rootSpecUrl);
  return mostSpecific ?? rootSpecUrl;
}

export function findProjectionDocUrlInMessages(
  messages: ChatMessage[] | undefined,
): AutomergeUrl | undefined {
  let found: AutomergeUrl | undefined;
  for (const msg of messages ?? []) {
    for (const part of msg.content) {
      const candidates: (string | undefined)[] =
        part.type === 'script'
          ? [
              'output' in part ? (part.output as string | undefined) : undefined,
              'error' in part ? (part.error as string | undefined) : undefined,
              part.code,
            ]
          : part.type === 'text'
            ? [part.text]
            : [];
      for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const match = candidate.match(/PROJECTION_DOC_URL:\s*(automerge:[A-Za-z0-9]+)/);
        if (match) found = match[1] as AutomergeUrl;
      }
    }
  }
  return found;
}

export async function createProjectionProcess(
  repo: Repo,
  options: {
    rootSpecUrl: AutomergeUrl;
    owningSpecUrl: AutomergeUrl;
    artifactUrl: AutomergeUrl;
    artifactName: string;
    existingProjectionDocUrl?: AutomergeUrl;
    previousMessages?: ChatMessage[];
    message?: string;
  },
): Promise<DocHandle<LLMProcessDoc>> {
  const processHandle = repo.create<LLMProcessDoc>();
  const userText = buildProjectionUserMessage(options);

  processHandle.change((d) => {
    d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
    d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
    d.messages = [
      ...JSON.parse(JSON.stringify(options.previousMessages ?? [])),
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ];
    d.done = false;
  });

  return processHandle;
}

export async function runProjectionProcessAndPersist(
  repo: Repo,
  processUrl: AutomergeUrl,
  specHandle: DocHandle<SpecDoc>,
) {
  await runWorkspaceLLM(repo, processUrl);
  const processHandle = await repo.find<LLMProcessDoc>(processUrl);
  const processDoc = await processHandle.doc();
  const projectionDocUrl = findProjectionDocUrlInMessages(processDoc?.messages);
  if (!projectionDocUrl) return;

  specHandle.change((d) => {
    if (!d.spec) return;
    d.spec.projectionDocUrl = projectionDocUrl;
  });
}

function buildProjectionUserMessage(options: {
  rootSpecUrl: AutomergeUrl;
  owningSpecUrl: AutomergeUrl;
  artifactUrl: AutomergeUrl;
  artifactName: string;
  existingProjectionDocUrl?: AutomergeUrl;
  message?: string;
}) {
  const followUp = options.message?.trim();
  const base = [
    'Create or update a reusable ProjectionSpecDoc for a GRJTE artifact.',
    `Root spec URL: ${options.rootSpecUrl}`,
    `Owning spec URL: ${options.owningSpecUrl}`,
    `Representative artifact URL: ${options.artifactUrl}`,
    `Artifact name: ${options.artifactName}`,
    options.existingProjectionDocUrl
      ? `Existing projection doc URL: ${options.existingProjectionDocUrl}`
      : 'There is no existing projection doc yet.',
    '',
    'Requirements:',
    '- The projection must be reusable across future executions of the same spec.',
    '- Create a ProjectionSpecDoc with @patchwork.type = "artifact-projection".',
    '- Set artifactDocUrl to the representative artifact URL for this run.',
    '- Choose a sensible row definition and initial visible columns based on the artifact facts.',
    '- Prefer a spreadsheet-like view that helps a human inspect and edit the artifact data.',
    '- If an existing projection doc is provided, update that projection definition instead of making unrelated changes.',
    '- At the end, print exactly: PROJECTION_DOC_URL: <automerge-url>',
    '',
    'You may use repo.create()/repo.find() directly in script blocks. No throwaway docs.',
  ];

  if (followUp) {
    base.push('', `User requested these projection changes:\n${followUp}`);
  }

  return base.join('\n');
}
