import { AutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import { useDocument, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import './index.css';
import '@inkandswitch/patchwork-elements';

export const FolderTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <FolderViewer docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};

const FolderViewer = ({ docUrl }: { docUrl: AutomergeUrl }) => {
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
      {/* Header */}
      <div className="flex justify-end items-center border-b border-base-300 pb-2">
        <span className="badge badge-ghost">{folder.docs.length} documents</span>
      </div>

      {/* Document List */}
      <div className="flex flex-col gap-3 overflow-y-auto flex-1 pb-4">
        {folder.docs.length === 0 ? (
          <div className="text-center text-base-content/60 py-8">This folder is empty</div>
        ) : (
          folder.docs.map((docLink, index) => <FolderEntry key={index} docLink={docLink} />)
        )}
      </div>
    </div>
  );
};

type FolderEntryProps = {
  docLink: DocLink;
};

const FolderEntry = ({ docLink }: FolderEntryProps) => {
  const isFolder = docLink.type === 'folder';

  return (
    <div className="card card-bordered bg-base-100 shadow-sm">
      <div className="card-body p-3 max-h-[300px] flex flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <span className="font-medium">{docLink.name}</span>
              <span className="badge badge-sm badge-outline ml-2">{docLink.type}</span>
            </div>
          </div>
          <a
            className="btn btn-link btn-sm"
            href={`#doc=${parseAutomergeUrl(docLink.url).documentId}&type=${docLink.type}`}
          >
            Open
          </a>
        </div>
        {isFolder ? (
          <div className="text-sm text-base-content/60 mt-1">
            Click "Open" to view folder contents
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <div className="h-full overflow-auto">
              {/* @ts-expect-error Custom element from patchwork-elements */}
              <patchwork-view doc-url={docLink.url} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
