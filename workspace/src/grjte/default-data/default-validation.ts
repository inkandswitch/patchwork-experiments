import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { Heads } from '@automerge/automerge';
import type { ValidationDoc } from '../../workflow/types';

export function createDefaultValidation(
  repo: Repo,
  planDocUrl: AutomergeUrl,
  specDocUrl: AutomergeUrl,
  artifactDocUrls: AutomergeUrl[],
  executionDocUrl: AutomergeUrl,
): { validationDocUrl: AutomergeUrl } {
  // Build headsByDocUrl with placeholder heads for each artifact document.
  // In a real workflow these would be actual Automerge document heads capturing
  // the exact version that was validated.
  const headsByDocUrl: Record<AutomergeUrl, Heads> = {};
  for (const url of artifactDocUrls) {
    // Use an empty heads array — the UI should treat this as "heads at validation time"
    headsByDocUrl[url] = [] as unknown as Heads;
  }

  const validationHandle = repo.create<ValidationDoc & { '@patchwork': { type: string } }>();
  validationHandle.change((d) => {
    d['@patchwork'] = { type: 'validation' };
    d.planDocUrl = planDocUrl;
    d.specDocUrl = specDocUrl;
    d.executionDocUrl = executionDocUrl;
    d.isValidated = false;
    d.headsByDocUrl = headsByDocUrl;
  });

  return { validationDocUrl: validationHandle.url };
}
