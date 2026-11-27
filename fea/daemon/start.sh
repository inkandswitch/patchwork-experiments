#!/usr/bin/env bash
# Serve FEA runs from this machine. Works from any directory:
#
#   TASKS_HOST=/path/to/tasks/dist-node/host.mjs FEA_PACKAGE=automerge:<this package> \
#     .../fea/daemon/start.sh --new-queue "FEA on my Mac" | --queue automerge:…
#                             [--jobs N] [--cores N] [--max-nodes N] [--name "…"]
#                             [--gmsh …] [--ccx …] [--state dir] [--sync wss://…]
#
# A run is a task asked of a task queue; this starts a tasks host (the tasks
# package's Node host, an installed program like gmsh and CalculiX
# themselves: TASKS_HOST names it) that serves the queue and runs each run's
# code from this directory (daemon/run-task.mjs; FEA_PACKAGE is this
# package's automerge url, which the runs' tasks name). The run's code takes
# the Tasks client from the host's own registry, which every host has.
#
# --new-queue makes a queue and prints its link: paste that link into a
# study's Server field. Start it again with --queue <that link> to serve the
# same queue (as on every start after the first).
#
# One host serves a queue. Each machine keeps the meshes it has made (under
# --state, in meshes/) so that runs of one part at one size share a mesh; a
# second host on the same queue would make its own and the runs would no
# longer be comparable. Serve a queue from one machine only.
#
#   --jobs N        runs at once (1)
#   --cores N       cores each run gets (all but two, at most 8)
#   --max-nodes N   the largest mesh it solves (250,000 nodes: CalculiX's
#                   direct solver holds the whole factorised matrix in memory,
#                   a few GB at that size)
#   --name "…"      what people see serving the queue ("FEA on <host>")
#   --gmsh …        the gmsh to use, --ccx … the CalculiX (else found: daemon/tools.mjs)
#   --state dir     where each run's files (runs/<id>/: the mesh, the solver's
#                   input, its .frd results) and the kept meshes go (~/.patchwork-fea)
#   --sync wss://…  the sync server
#
# The host keeps its documents in <state>/host. Finds a node (22 or later:
# the one on PATH, else the newest nvm has) and installs this package's
# dependencies the first time.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() { sed -n '2,38p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 1; }

queue=()
jobs=1
name="FEA on $(hostname -s)"
while [ $# -gt 0 ]; do
  case "$1" in
    --queue) queue=(--queue "${2:?--queue needs a url}"); shift 2 ;;
    --new-queue) queue=(--new-queue "${2:?--new-queue needs a title}"); shift 2 ;;
    --jobs) jobs="${2:?--jobs needs a number}"; shift 2 ;;
    --cores) export FEA_CORES="${2:?--cores needs a number}"; shift 2 ;;
    --max-nodes) export FEA_MAX_NODES="${2:?--max-nodes needs a number}"; shift 2 ;;
    --name) name="${2:?--name needs a name}"; shift 2 ;;
    --gmsh) export GMSH="${2:?--gmsh needs a path}"; shift 2 ;;
    --ccx) export CCX="${2:?--ccx needs a path}"; shift 2 ;;
    --state) export FEA_STATE="${2:?--state needs a directory}"; shift 2 ;;
    --sync) export PATCHWORK_SYNC="${2:?--sync needs a url}"; shift 2 ;;
    -h | --help) usage ;;
    *) echo "unknown option $1" >&2; usage ;;
  esac
done
[ ${#queue[@]} -gt 0 ] || { echo "say which queue to serve: --queue automerge:…, or --new-queue \"a title\"" >&2; usage; }
[ -n "${TASKS_HOST:-}" ] && [ -f "$TASKS_HOST" ] || { echo "TASKS_HOST must name the tasks host (the tasks package's dist-node/host.mjs)" >&2; exit 1; }
[[ "${FEA_PACKAGE:-}" == automerge:* ]] || { echo "FEA_PACKAGE must be this package's automerge: url (the one its runs' tasks name)" >&2; exit 1; }

node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; }
NODE=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then NODE="$(command -v node)"; fi
if [ -z "$NODE" ]; then
  for n in $(ls -d "$HOME"/.nvm/versions/node/v2[2-9]*/bin/node 2>/dev/null | sort -V -r); do
    if node_ok "$n"; then NODE="$n"; break; fi
  done
fi
if [ -z "$NODE" ]; then echo "the FEA host needs node 22 or later (none on PATH or in ~/.nvm)" >&2; exit 1; fi
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:$PATH"

if [ ! -d "$here/node_modules/@automerge/automerge-repo" ]; then
  echo "installing the fea package's dependencies…" >&2
  (cd "$here" && { command -v pnpm >/dev/null && pnpm install --prod --frozen-lockfile || npm install --omit=dev; }) >&2
fi

data="${FEA_STATE:-$HOME/.patchwork-fea}/host"
mkdir -p "$data"
exec "$NODE" "$TASKS_HOST" "${queue[@]}" --local "$FEA_PACKAGE=$here" --workers "$jobs" --data-dir "$data" --name "$name"
