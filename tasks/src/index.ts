import { type Plugin } from '@patchwork/sdk';

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
  },
  {
    type: 'patchwork:tool',
    id: 'task-queue-browser',
    name: 'Task Queue Browser',
    icon: 'CirclePlus',
    supportedDataTypes: ['task-queue'],
    async load() {
      const { Tool } = await import('./tool');
      return Tool;
    },
  },
];

export const { TaskRunner } = await import('./task-runner');
