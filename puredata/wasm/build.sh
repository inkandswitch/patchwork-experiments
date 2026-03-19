#!/bin/bash
# Build empd WASM module from libpd (optionally with ELSE library)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIBPD_DIR="/tmp/libpd-emscripten"
ELSE_BUILD="/tmp/else-emscripten-build"
OUT_DIR="$SCRIPT_DIR/../dist"

mkdir -p "$OUT_DIR"

source ~/emsdk/emsdk_env.sh 2>/dev/null

# Check if ELSE library is built
ELSE_FLAGS=""
ELSE_LIBS=""
if [ -f "$ELSE_BUILD/libelse.a" ] && [ -f "$ELSE_BUILD/else_setup.h" ]; then
    echo "ELSE library found — building with ELSE support"
    ELSE_FLAGS="-DWITH_ELSE -I$ELSE_BUILD"
    ELSE_LIBS="-L$ELSE_BUILD -lelse"
else
    echo "No ELSE library found — building without ELSE (run build-else.sh first)"
fi

emcc \
    -O2 \
    -I"$LIBPD_DIR/pure-data/src" \
    -I"$LIBPD_DIR/libpd_wrapper" \
    $ELSE_FLAGS \
    -o "$OUT_DIR/empd.js" \
    "$SCRIPT_DIR/empd.c" \
    -L"$LIBPD_DIR/build/libs" -lpd $ELSE_LIBS -lm \
    -s EXPORTED_FUNCTIONS='["_empd_init","_empd_open_patch","_empd_close_patch","_empd_process","_empd_get_block_size","_empd_send_float","_empd_send_bang","_empd_send_symbol","_empd_bind","_empd_unbind","_empd_array_size","_empd_read_array","_empd_write_array","_empd_resize_array","_empd_start_message","_empd_add_float","_empd_add_symbol","_empd_finish_list","_empd_finish_message","_empd_get_dollar_zero","_empd_noteon","_empd_controlchange","_empd_pitchbend","_empd_programchange","_empd_aftertouch","_empd_polyaftertouch","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS","UTF8ToString","stringToUTF8","lengthBytesUTF8","HEAPU8","HEAPF32","HEAPU8","HEAPF32"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createEmpdModule' \
    -s ENVIRONMENT='web' \
    -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
    -s FORCE_FILESYSTEM=1 \
    -s EXPORT_ES6=1 \
    --no-entry

echo "Built: $OUT_DIR/empd.js + $OUT_DIR/empd.wasm"
