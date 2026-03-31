import { render } from 'solid-js/web';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import '../index.css';

export const WorkspaceTool: ToolRender = (handle, element) => {
  const dispose = render(() => <Workspace />, element);
  return () => dispose();
};

function Workspace() {
  return (
    <div class="p-4 h-full flex items-center justify-center">
      <p class="text-base-content/60">Workspace tool</p>
    </div>
  );
}
