import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocHandle } from '@automerge/automerge-repo';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';

const TitlebarToolComponent: React.FC<{ docUrl: string }> = () => {
  return (
    <div className="h-full flex items-center">
      <span>PQ</span>
    </div>
  );
};

export const TitlebarTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <TitlebarToolComponent docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};

