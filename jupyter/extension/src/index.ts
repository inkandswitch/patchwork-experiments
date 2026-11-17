import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { EditorExtensionRegistry, IEditorExtensionRegistry, ybinding } from '@jupyterlab/codemirror';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { INotebookTracker, type NotebookPanel } from '@jupyterlab/notebook';
import { automergeBinding } from './binding';
import { connectBridge, type PatchworkBridge } from './bridge';
import { sourceDiff } from './diff-editor';
import { DiffTracker, showDiffs } from './diff-view';
import { PatchworkDrive } from './drive';
import { connectKernels } from './kernel';
import {
  AutomergeCodeCell,
  AutomergeMarkdownCell,
  AutomergeNotebook,
  AutomergeRawCell,
  setAutomerge
} from './model';
import type { Realm } from './model/automerge';

/**
 * Patchwork stores notebooks as Automerge documents: a contents drive hands
 * JupyterLab an Automerge-backed shared model instead of a Yjs one, and the
 * editor binding below replaces `@jupyterlab/codemirror-extension:binding`
 * (disabled in jupyter-lite.json) to sync CodeMirror with it.
 */
const drivePlugin: JupyterFrontEndPlugin<void> = {
  id: '@patchwork/jupyter-extension:drive',
  description: 'Opens Patchwork notebooks from the Automerge repo.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    app.serviceManager.contents.addDrive(drive());
  }
};

const importPlugin: JupyterFrontEndPlugin<void> = {
  id: '@patchwork/jupyter-extension:import',
  description: 'Adds File › Import Notebook… to make a Patchwork notebook from an .ipynb file.',
  autoStart: true,
  requires: [IMainMenu],
  activate: (app: JupyterFrontEnd, mainMenu: IMainMenu) => {
    const command = 'patchwork:import-notebook';
    app.commands.addCommand(command, {
      label: 'Import Notebook…',
      describedBy: { args: { type: 'object', properties: {} } },
      execute: async () => {
        const file = await pickFile('.ipynb,application/x-ipynb+json');
        if (!file) return;
        try {
          await drive().importNotebook(file);
        } catch (error) {
          await showErrorMessage('Could not import the notebook', error as Error);
        }
      }
    });
    mainMenu.fileMenu.addGroup([{ command }], 1);
  }
};

const bindingPlugin: JupyterFrontEndPlugin<void> = {
  id: '@patchwork/jupyter-extension:binding',
  description: 'Binds CodeMirror editors to Automerge (or Yjs) shared models.',
  autoStart: true,
  requires: [IEditorExtensionRegistry],
  activate: (_: JupyterFrontEnd, extensions: IEditorExtensionRegistry) => {
    extensions.addExtension({
      name: 'shared-model-binding',
      factory: options => {
        const sharedModel = options.model.sharedModel as any;
        if (isAutomergeCell(sharedModel)) {
          return EditorExtensionRegistry.createImmutableExtension(automergeBinding(sharedModel));
        }
        return EditorExtensionRegistry.createImmutableExtension(
          ybinding({ ytext: sharedModel.ysource, undoManager: sharedModel.undoManager ?? undefined })
        );
      }
    });
  }
};

const presencePlugin: JupyterFrontEndPlugin<void> = {
  id: '@patchwork/jupyter-extension:presence',
  description: 'Announces the Patchwork user, locks historical views and connects kernels to Patchwork.',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (_: JupyterFrontEnd, tracker: INotebookTracker) => {
    const { user, kernel, handle } = bridge();
    tracker.widgetAdded.connect((_, panel) => {
      if (handle?.isReadOnly?.()) keepKernelOff(panel);
      else if (kernel) connectKernels(panel.sessionContext, kernel);
      void panel.context.ready.then(() => {
        followReadOnly(panel);
        const model = panel.context.model;
        const awareness = (model.sharedModel as any).awareness;
        if (user && awareness?.setLocalStateField) {
          awareness.setLocalStateField('user', { name: user.name, display_name: user.name, color: user.color });
        }
      });
    });
  }
};

const diffPlugin: JupyterFrontEndPlugin<void> = {
  id: '@patchwork/jupyter-extension:diff',
  description: 'Shows what the compared Patchwork drafts changed in the notebook since they forked.',
  autoStart: true,
  requires: [INotebookTracker, IEditorExtensionRegistry],
  activate: (_: JupyterFrontEnd, tracker: INotebookTracker, extensions: IEditorExtensionRegistry) => {
    const { handle, baseline } = bridge();
    if (!handle || !baseline) return;
    const diffs = new DiffTracker(handle, baseline);
    extensions.addExtension({
      name: 'patchwork-diff',
      factory: options => {
        const sharedModel = options.model.sharedModel as any;
        if (!isAutomergeCell(sharedModel)) return null;
        return EditorExtensionRegistry.createImmutableExtension(sourceDiff(sharedModel, diffs));
      }
    });
    tracker.widgetAdded.connect((_, panel) => {
      void panel.context.ready.then(() => showDiffs(panel, diffs));
    });
  }
};

/**
 * Locks the cells while Patchwork shows a point in history. Swapping the
 * document recreates every cell, so unlocking needs nothing and cells keep
 * their own `editable` metadata.
 */
function followReadOnly(panel: NotebookPanel): void {
  const model = panel.context.model;
  const shared = model.sharedModel;
  if (!(shared instanceof AutomergeNotebook)) return;
  const apply = () => {
    if (panel.isDisposed) return;
    model.readOnly = shared.readOnly;
    if (!shared.readOnly) return;
    for (const cell of panel.content.widgets) cell.readOnly = true;
  };
  const later = () => queueMicrotask(apply);
  apply();
  shared.scopeReplaced.connect(later);
  model.cells.changed.connect(later);
}

/** A notebook shown at a point in history, like the version a draft is compared with, runs nothing. */
function keepKernelOff(panel: NotebookPanel): void {
  const session = panel.sessionContext;
  session.kernelPreference = { ...session.kernelPreference, shouldStart: false, canStart: false, autoStartDefault: false };
  void session.ready.then(() => {
    if (session.session?.kernel) void session.shutdown();
  });
}

/** Resolves with the chosen file, or null if the picker was dismissed. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

let sharedDrive: PatchworkDrive | null = null;

function drive(): PatchworkDrive {
  return (sharedDrive ??= new PatchworkDrive(bridge()));
}

let connected: PatchworkBridge | null = null;

function bridge(): PatchworkBridge {
  if (!connected) {
    connected = connectBridge();
    setAutomerge(connected.Automerge, window.parent as unknown as Realm);
  }
  return connected;
}

function isAutomergeCell(model: unknown): model is AutomergeCodeCell | AutomergeMarkdownCell | AutomergeRawCell {
  return (
    model instanceof AutomergeCodeCell || model instanceof AutomergeMarkdownCell || model instanceof AutomergeRawCell
  );
}

export default [drivePlugin, importPlugin, bindingPlugin, presencePlugin, diffPlugin];
