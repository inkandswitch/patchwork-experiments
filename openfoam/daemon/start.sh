#!/usr/bin/env bash
# Serve OpenFOAM runs from this machine. Works from any directory:
#
#   TASKS_HOST=/path/to/tasks/dist-node/host.mjs OPENFOAM_PACKAGE=automerge:<this package> \
#     .../openfoam/daemon/start.sh --new-queue "OpenFOAM on my Mac" | --queue automerge:…
#                                  [--jobs N] [--cores N] [--name "…"] [--sync wss://…]
#                                  [--launcher …] [--bashrc …] [--mpirun-args "…"] [--state dir]
#
# A run is a task asked of a task queue; this starts a tasks host (the tasks
# package's Node host, an installed program like OpenFOAM itself: TASKS_HOST
# names it) that serves the queue and runs each run's code from this
# directory (daemon/run-task.mjs; OPENFOAM_PACKAGE is this package's
# automerge url, which the runs' tasks name).
#
# --new-queue makes a queue and prints its link: paste that link into a
# case's Server field. Start it again with --queue <that link> to serve the
# same queue (as on every start after the first).
#
#   --jobs N         runs at once (1). CFD is limited by memory bandwidth: a
#                    laptop gains little from a second; a big server does best
#                    as several runs of a few dozen cores each (192 cores:
#                    --jobs 6 --cores 32)
#   --cores N        cores each run gets (all but two, at most 8)
#   --name "…"       what people see serving the queue ("OpenFOAM on <host>")
#   --launcher …     the OpenFOAM launcher (macOS: found by itself)
#   --bashrc …       or a Linux install's etc/bashrc
#   --mpirun-args …  extra mpirun arguments
#   --state dir      where each run's OpenFOAM case is kept, under runs/ (~/.patchwork-openfoam)
#   --sync wss://…   the sync server
#
# The host keeps its documents in <state>/host. Finds a node (22 or later:
# the one on PATH, else the newest nvm has) and installs this package's
# dependencies the first time.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() { sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 1; }

queue=()
jobs=1
name="OpenFOAM on $(hostname -s)"
while [ $# -gt 0 ]; do
  case "$1" in
    --queue) queue=(--queue "${2:?--queue needs a url}"); shift 2 ;;
    --new-queue) queue=(--new-queue "${2:?--new-queue needs a title}"); shift 2 ;;
    --jobs) jobs="${2:?--jobs needs a number}"; shift 2 ;;
    --cores) export FOAMD_CORES="${2:?--cores needs a number}"; shift 2 ;;
    --name) name="${2:?--name needs a name}"; shift 2 ;;
    --launcher) export FOAMD_LAUNCHER="${2:?--launcher needs a path}"; shift 2 ;;
    --bashrc) export FOAMD_BASHRC="${2:?--bashrc needs a path}"; shift 2 ;;
    --mpirun-args) export FOAMD_MPIRUN_ARGS="${2?--mpirun-args needs a value}"; shift 2 ;;
    --state) export FOAMD_STATE="${2:?--state needs a directory}"; shift 2 ;;
    --sync) export PATCHWORK_SYNC="${2:?--sync needs a url}"; shift 2 ;;
    -h | --help) usage ;;
    *) echo "unknown option $1" >&2; usage ;;
  esac
done
[ ${#queue[@]} -gt 0 ] || { echo "say which queue to serve: --queue automerge:…, or --new-queue \"a title\"" >&2; usage; }
[ -n "${TASKS_HOST:-}" ] && [ -f "$TASKS_HOST" ] || { echo "TASKS_HOST must name the tasks host (the tasks package's dist-node/host.mjs)" >&2; exit 1; }
[[ "${OPENFOAM_PACKAGE:-}" == automerge:* ]] || { echo "OPENFOAM_PACKAGE must be this package's automerge: url (the one its runs' tasks name)" >&2; exit 1; }

node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; }
NODE=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then NODE="$(command -v node)"; fi
if [ -z "$NODE" ]; then
  for n in $(ls -d "$HOME"/.nvm/versions/node/v2[2-9]*/bin/node 2>/dev/null | sort -V -r); do
    if node_ok "$n"; then NODE="$n"; break; fi
  done
fi
if [ -z "$NODE" ]; then echo "the OpenFOAM host needs node 22 or later (none on PATH or in ~/.nvm)" >&2; exit 1; fi
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:$PATH"

if [ ! -d "$here/node_modules/@automerge/automerge-repo" ]; then
  echo "installing the openfoam package's dependencies…" >&2
  (cd "$here" && { command -v pnpm >/dev/null && pnpm install --prod --frozen-lockfile || npm install --omit=dev; }) >&2
fi

data="${FOAMD_STATE:-$HOME/.patchwork-openfoam}/host"
mkdir -p "$data"
exec "$NODE" "$TASKS_HOST" "${queue[@]}" --local "$OPENFOAM_PACKAGE=$here" --workers "$jobs" --data-dir "$data" --name "$name"
