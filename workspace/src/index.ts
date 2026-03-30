import type { Plugin, Tool, Datatype } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'workspace',
    name: 'Workspace',
    supportedDatatypes: ['workspace'],
    async load() {
      const { WorkspaceTool } = await import('./workspace/tool');
      return WorkspaceTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'workspace',
    name: 'Workspace',
    icon: 'Layout',
    async load() {
      const { WorkspaceDatatype } = await import('./workspace/datatype');
      return WorkspaceDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'spec-viewer',
    name: 'Spec Viewer',
    supportedDatatypes: ['spec'],
    async load() {
      const { SpecTool } = await import('./spec/tool');
      return SpecTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'spec',
    name: 'Spec',
    icon: 'FileText',
    async load() {
      const { SpecDatatype } = await import('./spec/datatype');
      return SpecDatatype;
    },
  } as Datatype,
  {
    type: 'patchwork:tool',
    id: 'workspace-chat',
    name: 'Workspace Chat',
    supportedDatatypes: ['workspace-chat'],
    async load() {
      const { WorkspaceChatTool } = await import('./workspace-chat/tool');
      return WorkspaceChatTool;
    },
  } satisfies Tool,
  {
    type: 'patchwork:datatype',
    id: 'workspace-chat',
    name: 'Workspace Chat',
    icon: 'MessageSquare',
    async load() {
      const { WorkspaceChatDatatype } = await import('./workspace-chat/datatype');
      return WorkspaceChatDatatype;
    },
  } as Datatype,
];

console.log('load workspace plugins', 3);
