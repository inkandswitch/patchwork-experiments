#!/usr/bin/env bash
# Start the FEA daemon. Works from any directory:
#
#   ~/dev/patchwork-experiments/fea/daemon/start.sh [fead options]
#
# Finds a node (22 or later: the one on PATH, else the newest nvm has),
# installs this package's dependencies the first time, and runs fead, which
# finds gmsh and CalculiX (daemon/tools.mjs says where it looks). Its inbox
# and runs live in ~/.patchwork-fea unless --state says otherwise; the first
# start prints the inbox link to paste into a study.
# Options: --cores N, --jobs N, --max-nodes N, --title "…", --gmsh …, --ccx …, --sync wss://…
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; }
NODE=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then NODE="$(command -v node)"; fi
if [ -z "$NODE" ]; then
  for n in $(ls -d "$HOME"/.nvm/versions/node/v2[2-9]*/bin/node 2>/dev/null | sort -V -r); do
    if node_ok "$n"; then NODE="$n"; break; fi
  done
fi
if [ -z "$NODE" ]; then echo "fead needs node 22 or later (none on PATH or in ~/.nvm)" >&2; exit 1; fi
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:$PATH"

if [ ! -d "$here/node_modules/@automerge/automerge-repo" ]; then
  echo "installing fead's dependencies…" >&2
  (cd "$here" && { command -v pnpm >/dev/null && pnpm install --prod --frozen-lockfile || npm install --omit=dev; }) >&2
fi

exec "$NODE" "$here/daemon/fead.mjs" "$@"
