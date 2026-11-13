#!/bin/sh
# Fetches Freedoom 0.13.0's freedoom1.wad, the IWAD the Doom tests play,
# into this directory (it is not committed: 28 MB). Checks both hashes.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
zip="${TMPDIR:-/tmp}/freedoom-0.13.0.zip"
[ -f "$zip" ] || curl -fsSL -o "$zip" https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip
echo "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59  $zip" | shasum -a 256 -c -
unzip -p "$zip" freedoom-0.13.0/freedoom1.wad > "$here/freedoom1.wad"
echo "7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d  $here/freedoom1.wad" | shasum -a 256 -c -
