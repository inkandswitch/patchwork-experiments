import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { ValidationDoc } from '../../workflow/types';

export function createDefaultValidation(
  repo: Repo,
  planDocUrl: AutomergeUrl,
  specDocUrl: AutomergeUrl,
  executionDocUrl: AutomergeUrl,
): { validationDocUrl: AutomergeUrl } {
  const validationHandle = repo.create<ValidationDoc & { '@patchwork': { type: string } }>();
  validationHandle.change((d) => {
    d['@patchwork'] = { type: 'validation' };
    d.planDocUrl = planDocUrl;
    d.specDocUrl = specDocUrl;
    d.executionDocUrl = executionDocUrl;
    d.approval = {
      status: 'pending',
      headsByDocUrl: {},
    };
  });

  return { validationDocUrl: validationHandle.url };
}
