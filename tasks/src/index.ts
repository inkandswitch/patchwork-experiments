import { Plugin } from '@inkandswitch/patchwork-plugins';
import './index.css';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'task-queue',
    name: 'Task Queue',
    icon: 'CirclePlus',
    async load() {
      const { TaskQueueDatatype } = await import('./datatype');
      return TaskQueueDatatype;
    },
  },
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
  },
  {
    type: 'patchwork:tool',
    id: 'task-titlebar',
    name: 'Task Titlebar',
    icon: 'Square',
    supportedDatatypes: '*',
    unlisted: true,
    forTitleBar: true,
    async load() {
      const { TitlebarTool } = await import('./titlebar-tool');
      return TitlebarTool;
    },
  },
];
