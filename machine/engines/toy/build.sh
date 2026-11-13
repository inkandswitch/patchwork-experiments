#!/bin/sh
# Builds the toy engine as a standalone .wasm: no JS glue, so nothing of the
# engine can live on the JS side. Run from anywhere: `pnpm build:engines`.
set -e
cd "$(dirname "$0")"
mkdir -p dist
emcc -O2 toy.c -o dist/toy.wasm \
  -sSTANDALONE_WASM --no-entry -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=128kb -sSTACK_SIZE=16kb -Wl,--stack-first \
  -sEXPORTED_FUNCTIONS=_machine_info,_machine_content,_machine_init,_machine_input,_machine_step,_machine_output,_machine_frame
