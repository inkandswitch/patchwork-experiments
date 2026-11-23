"""Build the JupyterLite Notebook app that the Patchwork tool iframes.

Everything the notebook needs at runtime is written into dist/lite so it can
be served from Patchwork while offline: the app, our federated extension,
and a Pyodide distribution with the packages the kernel installs on startup
(plus numpy, pandas and matplotlib). Other Pyodide packages still resolve to
the CDN when online.
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
from pyodide_dist import CACHE, ROOT, build_patchwork_wheel, build_pyodide, download_piplite_wheels, run  # noqa: E402

LITE_DIR = ROOT / "lab" / "lite"
OUTPUT = ROOT / "dist" / "lite"
EXTENSION = ROOT / "lab" / "extension" / "labextension"


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


def prune(output: Path) -> None:
    """Drop files JupyterLite copies that are never served."""
    for pattern in ["**/rspack.config*.js", "**/*.js.map", "**/*.LICENSE.txt", "**/package.json.orig"]:
        for path in output.glob(pattern):
            path.unlink()
    for path in [output / "doc", output / "api" / "translations" / "all.json.orig"]:
        if path.is_dir():
            shutil.rmtree(path)


if __name__ == "__main__":
    main()
