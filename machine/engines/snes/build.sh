#!/bin/sh
# Builds the SNES engine as a standalone .wasm: MesenCE's SNES core (with the
# Game Boy core it links for Super Game Boy carts), unmodified, plus the
# frontend in src/. Run from anywhere: `pnpm build:engines`.
#
# MesenCE is fetched at a pinned commit into $MESENCE (default: a directory
# under $TMPDIR), outside this package, and nothing from it is executed.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
commit=4b8a196e299b3de297b204fd1208d2981562c89b
src="${MESENCE:-${TMPDIR:-/tmp}/mesence-$commit}"
obj="${SNES_OBJ:-${TMPDIR:-/tmp}/machine-snes-obj}"

if [ ! -d "$src/.git" ]; then
  git clone --quiet https://github.com/nesdev-org/MesenCE.git "$src"
fi
git -C "$src" -c advice.detachedHead=false checkout --quiet "$commit"

flags="-O2 -std=c++17 -DNDEBUG -Wno-everything -ffile-prefix-map=$src=mesence -ffile-prefix-map=$here=snes \
  -I$src -I$src/Core -I$src/Utilities"

# The SNES core and coprocessors, the Game Boy core, and the few shared
# pieces they use as they are. Debuggers, filters, and Mesen's Emulator are
# not compiled; src/host.cpp stands in for what the core calls.
sources=$(cd "$src" && {
  find Core/SNES Core/Gameboy -name '*.cpp' -not -path '*/Debugger/*'
  echo Core/Shared/BaseControlDevice.cpp
  echo Core/Shared/BaseControlManager.cpp
  echo Utilities/SimpleLock.cpp
  echo Utilities/AutoResetEvent.cpp
  echo Utilities/CRC32.cpp
  echo Utilities/sha1.cpp
  echo Utilities/HexUtilities.cpp
  echo Utilities/Audio/HermiteResampler.cpp
  echo Utilities/Audio/BiquadFilter.cpp
  echo Utilities/Audio/BiquadCascadeFilter.cpp
  echo Utilities/Audio/blip_buf.cpp
} | LC_ALL=C sort)

# Objects are reused only when built from this commit by this compiler with
# these flags: the stamp names all three, and any change empties the cache.
# (A source's own change is caught by its time; a header's, only by the
# commit, so a cache never outlives the commit it was made from.)
stamp="$commit $(em++ --version | head -n 1) $flags"
if [ "$(cat "$obj/stamp" 2>/dev/null)" != "$stamp" ]; then
  rm -rf "$obj"
  mkdir -p "$obj"
  printf '%s\n' "$stamp" > "$obj/stamp"
fi
mkdir -p "$here/dist"
objects=""
for f in $sources; do
  o="$obj/$(echo "$f" | tr / _).o"
  if [ ! -f "$o" ] || [ "$src/$f" -nt "$o" ]; then
    em++ -c $flags "$src/$f" -o "$o"
  fi
  objects="$objects $o"
done
for f in machine.cpp host.cpp; do
  em++ -c $flags "$here/src/$f" -o "$obj/frontend_$f.o"
  objects="$objects $obj/frontend_$f.o"
done
emcc -c -O2 "$here/src/wasi.c" -o "$obj/frontend_wasi.o"
objects="$objects $obj/frontend_wasi.o"

em++ -O2 $objects -o "$here/dist/snes.wasm" \
  -sSTANDALONE_WASM --no-entry -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=2mb -sSTACK_SIZE=256kb -Wl,--stack-first \
  -sEXPORTED_FUNCTIONS=_machine_info,_machine_content,_machine_init,_machine_input,_machine_step,_machine_output,_machine_frame,_machine_query
