import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { PlanDoc, TaskDoc } from '../../workflow/types';

export function createDefaultPlan(
  repo: Repo,
  specDocUrl: AutomergeUrl,
  subSpecUrls: AutomergeUrl[],
): { planDocUrl: AutomergeUrl } {
  // Create a task for each sub-spec
  const taskAHandle = repo.create<TaskDoc & { '@patchwork': { type: string } }>();
  taskAHandle.change((d) => {
    d['@patchwork'] = { type: 'task' };
    d.goal = 'Generate Department A weekly schedule satisfying coverage, seniority, and equipment constraints.';
    d.dependsOn = subSpecUrls.length > 0 ? [subSpecUrls[0]] : [];
  });

  const taskBHandle = repo.create<TaskDoc & { '@patchwork': { type: string } }>();
  taskBHandle.change((d) => {
    d['@patchwork'] = { type: 'task' };
    d.goal = 'Generate Department B weekly schedule satisfying coverage, patient ratio, and on-call constraints.';
    d.dependsOn = subSpecUrls.length > 1 ? [subSpecUrls[1]] : [];
  });

  const planHandle = repo.create<PlanDoc & { '@patchwork': { type: string } }>();
  planHandle.change((d) => {
    d['@patchwork'] = { type: 'plan' };
    d.goal =
      'Generate weekly hospital staff schedules for Department A and Department B that satisfy all budget, coverage, and department-specific constraints.';
    d.specDocUrl = specDocUrl;
    d.tasks = [taskAHandle.url, taskBHandle.url];
  });

  return { planDocUrl: planHandle.url };
}
