#!/usr/bin/env bash
set -uo pipefail

PUSHWORK="pushwork"

failed=()
succeeded=()

for dir in */; do
  dir="${dir%/}"

  # Skip non-tool directories
  [[ "$dir" == "node_modules" || "$dir" == "scripts" || "$dir" == ".git" ]] && continue

  # Skip directories without pushwork initialized
  [[ -d "$dir/.pushwork" ]] || continue

  echo ""
  echo "━━━ $dir ━━━"

  if (cd "$dir" && $PUSHWORK sync); then
    succeeded+=("$dir")
  else
    echo "  FAILED: $dir"
    failed+=("$dir")
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ${#succeeded[@]} succeeded, ${#failed[@]} failed"

if [[ ${#failed[@]} -gt 0 ]]; then
  echo ""
  echo "  Failed:"
  for f in "${failed[@]}"; do
    echo "    - $f"
  done
  echo ""
  exit 1
fi
