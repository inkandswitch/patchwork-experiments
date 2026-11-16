"""Build the JupyterLite Notebook app that the Patchwork tool iframes.

Everything the notebook needs at runtime is written into dist/lite so it can
be served from Patchwork while offline: the app, our federated extension,
and a Pyodide distribution with the packages the kernel installs on startup
(plus numpy, pandas and matplotlib). Other Pyodide packages still resolve to
the CDN when online.
"""

import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
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

ROOT = Path(__file__).resolve().parent.parent
LITE_DIR = ROOT / "lite"
CACHE = ROOT / ".cache"
OUTPUT = ROOT / "dist" / "lite"
EXTENSION = ROOT / "extension" / "labextension"
PYTHON_PACKAGE = ROOT / "python"


def main() -> None:
    CACHE.mkdir(exist_ok=True)
    build_pyodide(LITE_DIR / "static" / "pyodide")
    wheels = download_piplite_wheels(CACHE / "wheels") + build_patchwork_wheel(CACHE / "wheels")
    shutil.rmtree(OUTPUT, ignore_errors=True)
    # doit remembers finished tasks, and would skip patching the fresh config
    (ROOT / ".jupyterlite.doit.db").unlink(missing_ok=True)
    run(
        [
            sys.executable, "-m", "jupyter", "lite", "build",
            "--lite-dir", str(LITE_DIR),
            "--output-dir", str(OUTPUT),
            "--apps", "notebooks",
            "--no-sourcemaps",
            "--no-unused-shared-packages",
            f"--LiteBuildConfig.federated_extensions={EXTENSION}",
            *[f"--piplite-wheels={wheel}" for wheel in wheels],
        ]
    )
    prune(OUTPUT)


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
    target.mkdir(parents=True, exist_ok=True)
    run([sys.executable, "-m", "pip", "download", "--no-deps", "--only-binary=:all:", "-d", str(target), *PIPLITE_WHEELS])
    return sorted(path for path in target.glob("*.whl") if not path.name.startswith("patchwork-"))


def build_patchwork_wheel(target: Path) -> list[Path]:
    """The `patchwork` Python package, for opening Automerge files from the kernel."""
    if not (PYTHON_PACKAGE / "pyproject.toml").exists():
        return []
    for old in target.glob("patchwork-*.whl"):
        old.unlink()
    run([sys.executable, "-m", "pip", "wheel", "--no-deps", "-w", str(target), str(PYTHON_PACKAGE)])
    return sorted(target.glob("patchwork-*.whl"))


def prune(output: Path) -> None:
    """Drop files JupyterLite copies that are never served."""
    for pattern in ["**/rspack.config*.js", "**/*.js.map", "**/*.LICENSE.txt", "**/package.json.orig"]:
        for path in output.glob(pattern):
            path.unlink()
    for path in [output / "doc", output / "api" / "translations" / "all.json.orig"]:
        if path.is_dir():
            shutil.rmtree(path)


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


if __name__ == "__main__":
    main()
