import { render } from 'solid-js/web';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import '../index.css';

export const SpecTool: ToolRender = (handle, element) => {
  const dispose = render(() => <Spec />, element);
  return () => dispose();
};

function Spec() {
  return (
    <div class="p-4 h-full flex items-center justify-center">
      <p class="text-base-content/60">Spec tool</p>
    </div>
  );
}
