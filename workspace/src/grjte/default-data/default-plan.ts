import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { TaskListPlanDoc, TaskDoc } from '../plan/types';

export function createDefaultPlan(
  repo: Repo,
  specDocUrl: AutomergeUrl,
  subSpecUrls: AutomergeUrl[],
): { planDocUrl: AutomergeUrl; taskUrls: AutomergeUrl[] } {
  // Create a task for each sub-spec
  const taskAMUHandle = repo.create<TaskDoc & { '@patchwork': { type: string } }>();
  taskAMUHandle.change((d) => {
    d['@patchwork'] = { type: 'task' };
    d.goal = 'Generate AMU weekly rota satisfying coverage, seniority, and acute assessment competency constraints.';
    d.dependsOn = subSpecUrls.length > 0 ? [subSpecUrls[0]] : [];
    d.status = 'completed';
  });

  const taskWard6Handle = repo.create<TaskDoc & { '@patchwork': { type: string } }>();
  taskWard6Handle.change((d) => {
    d['@patchwork'] = { type: 'task' };
    d.goal = 'Generate Ward 6 weekly rota satisfying coverage, patient ratio, and HCA requirements.';
    d.dependsOn = subSpecUrls.length > 1 ? [subSpecUrls[1]] : [];
    d.status = 'in-progress';
  });

  const planHandle = repo.create<TaskListPlanDoc & { '@patchwork': { type: string } }>();
  planHandle.change((d) => {
    d['@patchwork'] = { type: 'plan' };
    d.goal =
      'Generate weekly staff rotas for AMU and Ward 6 satisfying all trust, Working Time Directive, and ward-specific constraints.';
    d.specDocUrl = specDocUrl;
    d.tasks = [taskAMUHandle.url, taskWard6Handle.url];
  });

  return { planDocUrl: planHandle.url, taskUrls: [taskAMUHandle.url, taskWard6Handle.url] };
}
