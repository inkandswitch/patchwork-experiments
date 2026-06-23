# Bullets Tool

An infinitely nested bullet list tool, built with SolidJS and Automerge. Designed for use as a patchwork tool or as a standalone app.

## Standalone Usage

### Quick Start

```bash
pnpm install
pnpm dev:standalone
```

This starts a local dev server at `http://localhost:5560` with IndexedDB storage (browser-only, no network sync).

### Disk Persistence

To persist documents to a local directory (dev server only):

```bash
VITE_STORAGE_DIR=./bullets-data pnpm dev:standalone
```

This runs an automerge sync server on the Vite dev server at `/automerge-sync`, backed by `NodeFSStorageAdapter`. Documents are saved to the specified directory and survive browser cache clears.

### Sync Server

To connect to an external automerge sync server:

```bash
VITE_SYNC_URL=ws://localhost:3030 pnpm dev:standalone
```

### Both

Both options can be combined:

```bash
VITE_STORAGE_DIR=./bullets-data VITE_SYNC_URL=ws://localhost:3030 pnpm dev:standalone
```

See `.env.example` for all available environment variables.

### Build

```bash
pnpm build:standalone
```

The built standalone app uses IndexedDB only. For sync/persistence beyond IndexedDB, point `VITE_SYNC_URL` at a separate sync server.

## Patchwork Tool Usage

```bash
pnpm build
pnpm dev    # watch mode
```

Produces `dist/main.js` for use as a patchwork tool plugin.
