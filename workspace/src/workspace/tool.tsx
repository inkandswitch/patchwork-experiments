import { render } from 'solid-js/web';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import '../index.css';

export const WorkspaceTool: ToolRender = (handle, element) => {
  const dispose = render(() => <Workspace />, element);
  return () => dispose();
};

function Workspace() {
  return (
    <div class="workspace-placeholder">
      <p>Workspace tool</p>
    </div>
  );
}
