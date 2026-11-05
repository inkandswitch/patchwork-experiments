"""Open Patchwork files and folders as ordinary files.

    import patchwork
    path = await patchwork.mount("automerge:...")
    open(f"{path}/data.csv").read()

A mounted folder is mirrored into the kernel's filesystem and kept up to date
as collaborators edit it. Whatever Python writes, creates or deletes there is
written back to the documents as soon as Python is idle, or when `sync()` is
called.
"""

import json

__all__ = ["mount", "unmount", "sync", "flush", "connected"]

MOUNT_ROOT = "/patchwork"

_node = None


async def mount(url: str, path: str | None = None) -> str:
    """Mirror a Patchwork file or folder at `path` and return where it is."""
    path = path or f"{MOUNT_ROOT}/{_document_id(url)}"
    return await _require_node().mount(url, path.rstrip("/"))


def unmount(path: str) -> None:
    _require_node().unmount(path.rstrip("/"))


def sync() -> None:
    """Write changes under mounted paths back to their documents now."""
    _require_node().sync()


async def flush() -> None:
    """Wait until synced changes are saved."""
    await _require_node().flush()


def connected() -> bool:
    return _node is not None


async def _connect(module_url: str, config: dict) -> None:
    """Called by the notebook tool when the kernel starts."""
    global _node
    if _node is not None:
        return
    import js
    import pyodide_js
    from pyodide.code import run_js
    from pyodide.ffi import to_js

    node = await run_js(f"import({json.dumps(module_url)})")
    await node.connect(to_js(config, dict_converter=js.Object.fromEntries), pyodide_js.FS)
    _node = node


def _require_node():
    if _node is None:
        raise RuntimeError("patchwork is not connected; open this notebook with the Patchwork notebook tool")
    return _node


def _document_id(url: str) -> str:
    return url.removeprefix("automerge:").split("#")[0].split("/")[0]
