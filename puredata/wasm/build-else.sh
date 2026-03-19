#!/bin/bash
# Build ELSE library as a static library for Emscripten
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELSE_DIR="/tmp/else-emscripten"
LIBPD_DIR="/tmp/libpd-emscripten"
BUILD_DIR="/tmp/else-emscripten-build"
OUT_LIB="$BUILD_DIR/libelse.a"

source ~/emsdk/emsdk_env.sh 2>/dev/null

# Clone ELSE if not present
if [ ! -d "$ELSE_DIR" ]; then
    echo "Cloning pd-else..."
    git clone --depth 1 https://github.com/porres/pd-else.git "$ELSE_DIR"
fi

mkdir -p "$BUILD_DIR/obj"

PD_SRC="$LIBPD_DIR/pure-data/src"
ELSE_SRC="$ELSE_DIR/Source"
SHARED_DIR="$ELSE_SRC/Shared"

# Common include paths
INCLUDES=(
    -I"$PD_SRC"
    -I"$LIBPD_DIR/libpd_wrapper"
    -I"$SHARED_DIR"
    -I"$SHARED_DIR/aubio/src"
    -I"$SHARED_DIR/fftease"
    -I"$SHARED_DIR/kiss_fft"
    -I"$SHARED_DIR/libsamplerate"
)

CFLAGS="-O2 -DHAVE_UNISTD_H -DHAVE_ALLOCA_H -DPD"

# ─── Step 1: Compile else_shared sources ───
echo "Compiling else_shared..."
SHARED_SOURCES=(
    "$SHARED_DIR/buffer.c"
    "$SHARED_DIR/magic.c"
    "$SHARED_DIR/mifi.c"
    "$SHARED_DIR/random.c"
    "$SHARED_DIR/elsefile.c"
    "$SHARED_DIR/mouse_gui.c"
    "$SHARED_DIR/s_elseutf8.c"
)

# Add aubio sources
for f in "$SHARED_DIR"/aubio/src/*.c "$SHARED_DIR"/aubio/src/*/*.c; do
    [ -f "$f" ] && SHARED_SOURCES+=("$f")
done

# Add fftease sources (directly in fftease/, not fftease/src/)
for f in "$SHARED_DIR"/fftease/*.c; do
    [ -f "$f" ] && SHARED_SOURCES+=("$f")
done

# Add kiss_fft
if [ -f "$SHARED_DIR/kiss_fft/kiss_fft.c" ]; then
    SHARED_SOURCES+=("$SHARED_DIR/kiss_fft/kiss_fft.c")
fi
if [ -f "$SHARED_DIR/kiss_fft/kiss_fftr.c" ]; then
    SHARED_SOURCES+=("$SHARED_DIR/kiss_fft/kiss_fftr.c")
fi

# Add libsamplerate
for f in "$SHARED_DIR"/libsamplerate/*.c; do
    [ -f "$f" ] && SHARED_SOURCES+=("$f")
done

OBJ_FILES=()
for src in "${SHARED_SOURCES[@]}"; do
    name=$(basename "$src" .c)
    obj="$BUILD_DIR/obj/shared_${name}.o"
    emcc $CFLAGS "${INCLUDES[@]}" -c "$src" -o "$obj" 2>/dev/null || {
        echo "  [skip shared] $name"
        continue
    }
    OBJ_FILES+=("$obj")
done
echo "  Compiled ${#OBJ_FILES[@]} shared sources"

# ─── Step 2: Compile ELSE external sources ───
echo "Compiling ELSE externals..."

# Skip files that need complex deps (ffmpeg, Ableton Link, sfizz, FluidLite, etc.)
SKIP_PATTERNS=(
    "play.file~" "sfload" "sfinfo" "streamin~" "streamout~"
    "pdlink" "sfont~" "sfz~"
    "numbox~" "popmenu"
)

should_skip() {
    local name="$1"
    for pat in "${SKIP_PATTERNS[@]}"; do
        if [[ "$name" == *"$pat"* ]]; then
            return 0
        fi
    done
    return 1
}

SETUP_FUNCS=()
EXTERN_COUNT=0
SKIP_COUNT=0

for src in "$ELSE_SRC"/Audio/*.c "$ELSE_SRC"/Control/*.c "$ELSE_SRC"/Extra/Aliases/*.c; do
    [ -f "$src" ] || continue
    name=$(basename "$src" .c)

    if should_skip "$name"; then
        SKIP_COUNT=$((SKIP_COUNT + 1))
        continue
    fi

    obj="$BUILD_DIR/obj/ext_${name}.o"
    if emcc $CFLAGS "${INCLUDES[@]}" -c "$src" -o "$obj" 2>/dev/null; then
        OBJ_FILES+=("$obj")
        EXTERN_COUNT=$((EXTERN_COUNT + 1))

        # Extract the actual setup function name from the compiled object file
        # Look for both conventions: foo_setup (suffix) and setup_foo (prefix for dotted names)
        actual_setup=$("$EMSDK/upstream/bin/llvm-nm" "$obj" 2>/dev/null | grep -E ' T (setup_\w+|\w+_setup)$' | awk '{print $3}' | head -1)
        if [ -z "$actual_setup" ]; then
            # Fallback: extract from source
            actual_setup=$(grep -oE '\b(setup_\w+|\w+_setup)\b' "$src" 2>/dev/null | head -1)
        fi
        if [ -z "$actual_setup" ]; then
            echo "  [warn] no setup func found for $name"
            continue
        fi
        SETUP_FUNCS+=("$actual_setup")
    else
        echo "  [skip] $name"
        SKIP_COUNT=$((SKIP_COUNT + 1))
    fi
done

echo "  Compiled $EXTERN_COUNT externals, skipped $SKIP_COUNT"

# ─── Step 3: Bundle into static library ───
echo "Creating libelse.a..."
emar rcs "$OUT_LIB" "${OBJ_FILES[@]}"

# ─── Step 4: Generate setup header ───
HEADER="$BUILD_DIR/else_setup.h"
echo "// Auto-generated: ELSE setup declarations" > "$HEADER"
echo "#ifndef ELSE_SETUP_H" >> "$HEADER"
echo "#define ELSE_SETUP_H" >> "$HEADER"
echo "" >> "$HEADER"
for func in "${SETUP_FUNCS[@]}"; do
    echo "void ${func}(void);" >> "$HEADER"
done
echo "" >> "$HEADER"
echo "static inline void else_setup_all(void) {" >> "$HEADER"
for func in "${SETUP_FUNCS[@]}"; do
    echo "    ${func}();" >> "$HEADER"
done
echo "}" >> "$HEADER"
echo "" >> "$HEADER"
echo "#endif" >> "$HEADER"

echo "Generated $HEADER with ${#SETUP_FUNCS[@]} setup functions"
echo "Built: $OUT_LIB"
echo "Done!"
