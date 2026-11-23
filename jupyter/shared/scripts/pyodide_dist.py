"""Pyodide and the wheels its kernel installs, for both Jupyter tools.

`build_pyodide` writes Pyodide's core plus the vendored packages, so the kernel
runs offline, with every other package still resolving to the CDN.
"""

import base64
import hashlib
import json
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request
import zipfile
from pathlib import Path

PYODIDE_VERSION = "314.0.6"
PYODIDE_CDN = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full/"
PYODIDE_CORE = (
    "https://github.com/pyodide/pyodide/releases/download/"
    f"{PYODIDE_VERSION}/pyodide-core-{PYODIDE_VERSION}.tar.bz2"
)
VENDORED_PACKAGES = [
    # loaded by the kernel worker before the first cell runs
    "micropip", "packaging", "ipython", "jedi",
    # what people reach for first
    "numpy", "pandas", "matplotlib",
]
PIPLITE_WHEELS = [
    # pyodide-kernel depends on comm, which Pyodide does not ship
    "comm",
]

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
PYTHON_PACKAGE = ROOT / "shared" / "python"


def build_pyodide(target: Path) -> None:
    """Pyodide core plus the vendored packages, with the rest pointing at the CDN."""
    core = fetch(PYODIDE_CORE, CACHE / f"pyodide-core-{PYODIDE_VERSION}.tar.bz2")
    shutil.rmtree(target, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(core) as archive:
        archive.extractall(target.parent, filter="data")
    for junk in ["python", "python.bat", "python.exe", "python_cli_entry.mjs", "ffi.d.ts", "pyodide.d.ts"]:
        (target / junk).unlink(missing_ok=True)

    lock_path = target / "pyodide-lock.json"
    lock = json.loads(lock_path.read_text())
    packages = lock["packages"]
    vendored = dependency_closure(packages, VENDORED_PACKAGES)
    for name, package in packages.items():
        file_name = package["file_name"]
        if name in vendored:
            shutil.copy(fetch(PYODIDE_CDN + file_name, CACHE / "pyodide" / file_name), target / file_name)
        else:
            package["file_name"] = PYODIDE_CDN + file_name
    lock_path.write_text(json.dumps(lock))
    print(f"vendored {len(vendored)} Pyodide packages: {', '.join(sorted(vendored))}")


def dependency_closure(packages: dict, names: list[str]) -> set[str]:
    def normalize(name: str) -> str:
        return name.lower().replace("_", "-")

    by_name = {normalize(name): name for name in packages}
    seen: set[str] = set()
    stack = [normalize(name) for name in names]
    while stack:
        name = by_name.get(stack.pop())
        if name is None or name in seen:
            continue
        seen.add(name)
        stack.extend(normalize(dep) for dep in packages[name]["depends"])
    return seen


def download_piplite_wheels(target: Path) -> list[Path]:
    """The latest pure-Python wheel of each of PIPLITE_WHEELS, from PyPI."""
    wheels = []
    for name in PIPLITE_WHEELS:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json") as response:
            release = json.load(response)
        wheel = next(
            (file for file in release["urls"] if file["filename"].endswith("-py3-none-any.whl")),
            None,
        )
        if wheel is None:
            raise RuntimeError(f"{name} {release['info']['version']} has no py3-none-any wheel")
        wheels.append(fetch(wheel["url"], target / wheel["filename"]))
    return wheels


def build_patchwork_wheel(target: Path) -> list[Path]:
    """The `patchwork` Python package, for opening Automerge files from the kernel.

    It is pure Python, so the wheel is zipped directly rather than with pip.
    """
    pyproject = PYTHON_PACKAGE / "pyproject.toml"
    if not pyproject.exists():
        return []
    project = tomllib.loads(pyproject.read_text())["project"]
    name, version = project["name"], project["version"]
    dist_info = f"{name}-{version}.dist-info"
    files: dict[str, bytes] = {}
    for package in tomllib.loads(pyproject.read_text())["tool"]["setuptools"]["packages"]:
        for path in sorted((PYTHON_PACKAGE / package).rglob("*.py")):
            files[path.relative_to(PYTHON_PACKAGE).as_posix()] = path.read_bytes()
    metadata = [
        "Metadata-Version: 2.1",
        f"Name: {name}",
        f"Version: {version}",
        f"Summary: {project.get('description', '')}",
    ]
    if "requires-python" in project:
        metadata.append(f"Requires-Python: {project['requires-python']}")
    files[f"{dist_info}/METADATA"] = ("\n".join(metadata) + "\n").encode()
    files[f"{dist_info}/WHEEL"] = (
        "Wheel-Version: 1.0\nGenerator: pyodide_dist\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    ).encode()
    record = [f"{path},sha256={_digest(data)},{len(data)}" for path, data in files.items()]
    files[f"{dist_info}/RECORD"] = ("\n".join([*record, f"{dist_info}/RECORD,,"]) + "\n").encode()

    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob(f"{name}-*.whl"):
        old.unlink()
    wheel = target / f"{name}-{version}-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, data in files.items():
            archive.writestr(zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    return [wheel]


def _digest(data: bytes) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {url}")
        with urllib.request.urlopen(url) as response, open(path.with_suffix(".part"), "wb") as out:
            shutil.copyfileobj(response, out)
        path.with_suffix(".part").rename(path)
    return path


def run(command: list[str]) -> None:
    print("+", " ".join(command))
    subprocess.run(command, check=True, cwd=ROOT)
