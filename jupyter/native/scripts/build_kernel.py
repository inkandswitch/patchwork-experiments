"""Build what the native notebook's Pyodide kernel loads, into dist/native.

- dist/native/pyodide: Pyodide with the vendored packages, as for the
  JupyterLab tool (see shared/scripts/pyodide_dist.py).
- dist/native/pypi: the piplite index the kernel installs from. It holds the
  wheels @jupyterlite/pyodide-kernel ships (the kernel itself, piplite,
  ipykernel), unchanged because its all.json names them relative to itself,
  plus `comm` and the `patchwork` package.

Needs only the Python standard library, and node_modules from `pnpm install`.
"""

import hashlib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
from pyodide_dist import CACHE, ROOT, build_patchwork_wheel, build_pyodide, download_piplite_wheels  # noqa: E402

OUTPUT = ROOT / "dist" / "native"
KERNEL_PYPI = ROOT / "node_modules" / "@jupyterlite" / "pyodide-kernel" / "pypi"


def main() -> None:
    CACHE.mkdir(exist_ok=True)
    build_pyodide(OUTPUT / "pyodide")
    build_index(OUTPUT / "pypi")


def build_index(target: Path) -> None:
    if not KERNEL_PYPI.is_dir():
        raise SystemExit(f"{KERNEL_PYPI} is missing; run `pnpm install` first")
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    index = json.loads((KERNEL_PYPI / "all.json").read_text())
    for wheel in KERNEL_PYPI.glob("*.whl"):
        shutil.copy(wheel, target / wheel.name)
    for wheel in download_piplite_wheels(CACHE / "wheels") + build_patchwork_wheel(CACHE / "wheels"):
        shutil.copy(wheel, target / wheel.name)
        add_to_index(index, target / wheel.name)
    (target / "all.json").write_text(json.dumps(index, indent=1))
    print(f"piplite index: {', '.join(sorted(index))}")


def add_to_index(index: dict, wheel: Path) -> None:
    """An entry like the ones PyPI's JSON API gives, which piplite reads."""
    name, version = wheel.name.split("-")[:2]
    data = wheel.read_bytes()
    entry = {
        "comment_text": "",
        "digests": {"md5": hashlib.md5(data).hexdigest(), "sha256": hashlib.sha256(data).hexdigest()},
        "downloads": -1,
        "filename": wheel.name,
        "has_sig": False,
        "md5_digest": hashlib.md5(data).hexdigest(),
        "packagetype": "bdist_wheel",
        "python_version": "py3",
        "requires_python": None,
        "size": len(data),
        "url": f"./{wheel.name}",
        "yanked": False,
        "yanked_reason": None,
    }
    index[name.lower().replace("_", "-")] = {"releases": {version: [entry]}}


if __name__ == "__main__":
    main()
