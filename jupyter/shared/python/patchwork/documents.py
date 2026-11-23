"""Read Patchwork documents from a notebook as plain Python.

    import patchwork
    reg = patchwork.load("automerge:...")          # the document itself
    reg["entries"]["pack_series"]["value"]["nominal"]
    values = patchwork.load("register", as_="json")  # its datatype's JSON view
    values["pack_series"]

`load` takes a document URL or the name of one of the notebook's imports. It
is synchronous: before every run the notebook tool reads every document the
run can load (its imports, and every automerge: URL written in its code
cells) and writes them here, so nothing is fetched while a cell runs. That is
also what makes the run's record complete: a document no cell names can't be
loaded, and `load` says how to make it loadable.

What a cell reads is recorded, down to the keys it looked at: a value read
(`d["entries"]["pack_series"]`), the keys of a mapping or the length of a
list (iterating, `len`, `in`), or a whole subtree (`.plain()`, `repr`, `==`).
The notebook keeps these reads in its run record, so it can tell later
whether a change to the document touched anything the run read.

Values come back as read-only mappings and sequences; `.plain()` gives
ordinary dicts and lists (and records the whole subtree as read). Automerge's
values arrive as plain Python: strings (immutable or collaborative) as str,
counters as int, bytes as bytes, dates as ISO 8601 str (UTC); keys starting
with "@" (Patchwork's bookkeeping) are left out. The notebook tool converts
them (docToJson in shared/imports.ts); bytes travel as {"$bytes": base64}.
"""

import base64
import copy
import json
import os
from collections.abc import Mapping, Sequence

__all__ = ["load", "reads"]

ROOT = "/tmp/patchwork_documents"
MAX_PATHS = 200

_index = None
_reads = {}  # (url, view) -> set of (kind, path)


def _begin(index):
    """Called by the notebook tool before each run, with what the run can load."""
    global _index, _reads
    _index = index
    _reads = {}


BYTES_TAG = "$bytes"


def _decode(obj):
    if len(obj) == 1 and BYTES_TAG in obj:
        return base64.b64decode(obj[BYTES_TAG])
    return obj


def _strip(ref):
    return str(ref).strip().split("#")[0]


def load(ref, as_="raw"):
    """A document as plain Python data: by URL (automerge:...) or by import name.

    `as_="json"` gives the document's datatype's JSON view (an assumptions
    register's is a flat id -> value dict), or the document itself when its
    datatype has none.
    """
    if as_ not in ("raw", "json"):
        raise ValueError('as_ is "raw" (the document) or "json" (its datatype\'s JSON view)')
    index = _index
    if index is None:
        try:
            with open(os.path.join(ROOT, "index.json"), encoding="utf-8") as f:
                index = json.load(f)
        except OSError:
            index = {"names": {}, "documents": {}}
    url = index.get("names", {}).get(ref) or _strip(ref)
    entry = index.get("documents", {}).get(url)
    if entry is None:
        raise LookupError(
            f"{ref!r} isn't a document this run read. Write its URL in a code cell as a literal "
            "(patchwork.load(\"automerge:...\")) or link it as an import, so the notebook reads it before the run."
        )
    if entry.get("problem"):
        raise LookupError(f"couldn't open {entry.get('title') or url}: {entry['problem']}")
    view = "json" if as_ == "json" and entry.get("json") else "raw"
    with open(os.path.join(ROOT, entry[view]), encoding="utf-8") as f:
        data = json.load(f, object_hook=_decode)
    record = _reads.setdefault((url, view), set())
    return _wrap(data, (), record)


def reads():
    """What this run's cells read, for the run record."""
    out = []
    for (url, view), seen in _reads.items():
        paths = sorted(seen, key=lambda r: (len(r[1]), [str(p) for p in r[1]], r[0]))
        if len(paths) > MAX_PATHS:
            paths = [("value", ())]
        out.append({"docUrl": url, "as": view, "paths": [{"path": list(p), "keys": kind == "keys"} for kind, p in paths]})
    return out


def _wrap(value, path, record):
    if isinstance(value, dict):
        return DocumentMap(value, path, record)
    if isinstance(value, list):
        return DocumentList(value, path, record)
    record.add(("value", path))
    return value


class _Tracked:
    __slots__ = ("_data", "_path", "_record")

    def __init__(self, data, path, record):
        self._data = data
        self._path = path
        self._record = record

    def plain(self):
        """Ordinary dicts and lists; the whole subtree counts as read."""
        self._record.add(("value", self._path))
        return copy.deepcopy(self._data)

    def __eq__(self, other):
        self._record.add(("value", self._path))
        return self._data == (other._data if isinstance(other, _Tracked) else other)

    __hash__ = None

    def __repr__(self):
        self._record.add(("value", self._path))
        return repr(self._data)


class DocumentMap(_Tracked, Mapping):
    """A mapping in a document, recording what is read from it."""

    __slots__ = ()

    def __getitem__(self, key):
        child = self._path + (key,)
        if key not in self._data:
            self._record.add(("value", child))  # its absence was read
            raise KeyError(key)
        return _wrap(self._data[key], child, self._record)

    def __contains__(self, key):
        self._record.add(("value", self._path + (key,)))
        return key in self._data

    def __iter__(self):
        self._record.add(("keys", self._path))
        return iter(list(self._data))

    def __len__(self):
        self._record.add(("keys", self._path))
        return len(self._data)


class DocumentList(_Tracked, Sequence):
    """A list in a document, recording what is read from it."""

    __slots__ = ()

    def __getitem__(self, index):
        if isinstance(index, slice):
            self._record.add(("value", self._path))
            return copy.deepcopy(self._data[index])
        if not -len(self._data) <= index < len(self._data):
            self._record.add(("keys", self._path))
            raise IndexError(index)
        i = index % len(self._data)
        return _wrap(self._data[i], self._path + (i,), self._record)

    def __iter__(self):
        self._record.add(("keys", self._path))
        for i in range(len(self._data)):
            yield _wrap(self._data[i], self._path + (i,), self._record)

    def __len__(self):
        self._record.add(("keys", self._path))
        return len(self._data)
