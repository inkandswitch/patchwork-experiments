import { AutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import { useDocument, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import './index.css';

export const EmbeddingsViewerTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <EmbeddingsViewer docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};

const EmbeddingsViewer = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [folder] = useDocument<FolderDoc>(docUrl);

  if (!folder) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-hidden flex flex-col gap-4">
      <div className="flex justify-between items-center border-b border-base-300 pb-2">
        <h2 className="text-lg font-semibold">Embeddings Viewer</h2>
        <span className="badge badge-ghost">{folder.docs.length} documents</span>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto flex-1 pb-4">
        {folder.docs.length === 0 ? (
          <div className="text-center text-base-content/60 py-8">
            This folder is empty
          </div>
        ) : (
          folder.docs.map((docLink, index) => (
            <FolderEntry key={index} docLink={docLink} />
          ))
        )}
      </div>
    </div>
  );
};

const FolderEntry = ({ docLink }: { docLink: DocLink }) => {
  return (
    <div className="card card-bordered bg-base-100 shadow-sm">
      <div className="card-body p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium">{docLink.name}</span>
            <span className="badge badge-sm badge-outline">{docLink.type}</span>
          </div>
          <a
            className="btn btn-link btn-sm"
            href={`#doc=${parseAutomergeUrl(docLink.url).documentId}&type=${docLink.type}`}
          >
            Open
          </a>
        </div>
      </div>
    </div>
  );
};
