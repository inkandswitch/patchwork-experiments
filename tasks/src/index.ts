import { type Datatype, type Tool, Plugin } from '@inkandswitch/patchwork-plugins';
import './index.css';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'task-queue',
    name: 'Task Queue',
    icon: 'CirclePlus',
    async load() {
      const { taskQueueDatatype } = await import('./datatype');
      return taskQueueDatatype;
    },
  } satisfies Datatype,
  {
    type: 'patchwork:tool',
    id: 'task-queue-browser',
    name: 'Task Queue Browser',
    icon: 'CirclePlus',
    supportedDatatypes: ['task-queue'],
    async load() {
      const { Tool } = await import('./tool');
      return Tool;
    },
  } satisfies Tool,
];

export const { TaskRunner } = await import('./task-runner');
