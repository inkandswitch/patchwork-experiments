import { Plugin } from '@inkandswitch/patchwork-plugins';
import {
  LEGACY_QUEUE_DATATYPE_ID,
  QUEUE_DATATYPE_ID,
  QUEUE_TOOL_ID,
  TITLEBAR_TOOL_ID,
  TRAY_COMPONENT_ID,
} from './ids';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: QUEUE_DATATYPE_ID,
    name: 'Task Queue (experimental)',
    icon: 'CirclePlus',
    // Listed, so a queue can be made the way any document is. Opening it then
    // offers to join it (see the queue browser).
    load: async () => (await import('./datatype')).TaskQueueDatatype
  },
  {
    type: 'patchwork:tool',
    id: QUEUE_TOOL_ID,
    name: 'Task Queue Browser (experimental)',
    icon: 'CirclePlus',
    supportedDatatypes: [QUEUE_DATATYPE_ID, LEGACY_QUEUE_DATATYPE_ID],
    load: async () => (await import('./task-queue-tool')).TaskQueueTool,
  },
  {
    type: 'patchwork:tool',
    id: TITLEBAR_TOOL_ID,
    name: 'Tasks (experimental)',
    icon: 'Square',
    supportedDatatypes: '*',
    unlisted: true,
    tags: ['titlebar-tool'],
    load: async () => (await import('./titlebar-tool')).TitlebarTool,
  },
  {
    // The same badge for frames that have a system tray rather than title bar
    // slots (see titlebar-tool.tsx). Either one starts the task workers.
    type: 'patchwork:component',
    id: TRAY_COMPONENT_ID,
    name: 'Tasks (experimental)',
    icon: 'CirclePlus',
    tags: ['system-tray'],
    load: async () => (await import('./titlebar-tool')).TaskTray,
  },
];
