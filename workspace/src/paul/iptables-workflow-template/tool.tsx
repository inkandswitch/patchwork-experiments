import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

export const IPTablesWorkflowTemplateTool: ToolRender = (handle, _element) => {
  (handle as DocHandle<{ '@patchwork': { type: string } }>).change((doc) => {
    doc['@patchwork'] = { type: 'workflow' };
  });
  return () => {};
};
