#!/usr/bin/env bash
# Build CalculiX (ccx) from its published sources, into a folder of your own.
#
#   daemon/install-calculix.sh [--prefix ~/.patchwork-fea/calculix] [--jobs N] [--keep]
#
# For a machine with no ccx package: macOS, where Homebrew has none in core
# (the costerwi/calculix tap builds one, and is the easier way when Homebrew
# will build from source at all). On Debian or Ubuntu, `apt install
# calculix-ccx` is all it takes, and this isn't needed.
#
# It downloads three archives, checks each against the digest below, builds
# them under <prefix>/build and leaves one program, <prefix>/bin/ccx, which
# a run's code finds there. Nothing is installed anywhere else.
#
#   ccx 2.23      https://www.dhondt.de        the solver (GPL 2+)
#   SPOOLES 2.2   https://www.netlib.org       its direct equation solver, linked in
#                                              (the serial one: see below)
#   arpack-ng     https://github.com/opencollab/arpack-ng   eigenvalues: modal analysis
#
# Needs: a C compiler and make (Xcode's command line tools, or gcc), gfortran
# (macOS: `brew install gcc`), cmake and perl. BLAS and LAPACK come from
# Accelerate on macOS; elsewhere from `-lopenblas`, or what LAPACK_LIBS says.
# The SPOOLES and ccx fixes are the ones costerwi's Homebrew formula makes.
#
# SPOOLES is built WITHOUT its multithreaded solver, which that formula and
# CalculiX's own Makefile_MT turn on. Measured here (an M4, 2026-11-24,
# probes/threads.mjs): with the threaded solver on 8 threads, 9 runs in 30 of
# one small static job came back wrong, displacements off by up to 98%, with
# no error. On 1 solver thread, 0 in 30, the rest of ccx still on 8. So the
# equation solver runs on one core; assembling the matrix and working out the
# stresses use them all.
set -euo pipefail

CCX_VERSION=2.23
CCX_URL="https://www.dhondt.de/ccx_${CCX_VERSION}.src.tar.bz2"
CCX_SHA=9c88385c10fb04f5dc6c4e98027a51bebdd8aee3920e05190d6c1dd08357d6e7
SPOOLES_URL="https://www.netlib.org/linalg/spooles/spooles.2.2.tgz"
SPOOLES_SHA=a84559a0e987a1e423055ef4fdf3035d55b65bbe4bf915efaa1a35bef7f8c5dd
ARPACK_VERSION=3.9.1
ARPACK_URL="https://github.com/opencollab/arpack-ng/archive/refs/tags/${ARPACK_VERSION}.tar.gz"
ARPACK_SHA=f6641deb07fa69165b7815de9008af3ea47eb39b2bb97521fbf74c97aba6e844

prefix="$HOME/.patchwork-fea/calculix"
jobs="$( (sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || nproc 2>/dev/null || echo 4) | head -1)"
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    --jobs) jobs="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null || { echo "install-calculix needs $1${2:+ ($2)}" >&2; exit 1; }; }
need make; need cmake; need perl; need curl
CC="${CC:-cc}"; need "$CC"
FC="${FC:-gfortran}"; need "$FC" "macOS: brew install gcc"

case "$(uname -s)" in
  Darwin) LAPACK_LIBS="${LAPACK_LIBS:--framework Accelerate}" ;;
  *) LAPACK_LIBS="${LAPACK_LIBS:--lopenblas}" ;;
esac

build="$prefix/build"
mkdir -p "$build" "$prefix/bin"
cd "$build"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fetch() { # url file sha256
  if [ ! -f "$2" ] || [ "$(sha "$2")" != "$3" ]; then
    echo "· downloading $1"
    curl -fL --retry 3 -o "$2.part" "$1"
    mv "$2.part" "$2"
  fi
  if [ "$(sha "$2")" != "$3" ]; then echo "$2 isn't the file expected (sha256 $(sha "$2"), wanted $3)" >&2; exit 1; fi
}
fetch "$CCX_URL" ccx.tar.bz2 "$CCX_SHA"
fetch "$SPOOLES_URL" spooles.tgz "$SPOOLES_SHA"
fetch "$ARPACK_URL" arpack.tar.gz "$ARPACK_SHA"

# in place, with a backup suffix: the one form both BSD and GNU sed take
edit() { sed -i.orig "$@"; }

# ---- SPOOLES: the serial library
if [ ! -s spooles/spooles.a ]; then
echo "· building SPOOLES"
rm -rf spooles && mkdir spooles && tar -xzf spooles.tgz -C spooles
(
  cd spooles
  # its makefiles name a compiler from 1999, and its C is of that year too
  edit -e "s|^ *CC = .*|  CC = $CC|" -e "s|^ *CFLAGS = .*|  CFLAGS = -O2 -std=gnu89 -w|" Make.inc
  edit -e "s|drawTree.c|tree.c|" Tree/src/makeGlobalLib
  edit -e "s|IVinit(nfront, NULL)|IVinit(nfront, 0)|" ETree/src/transform.c
  make lib >build.log 2>&1 || { tail -30 build.log >&2; exit 1; }
  test -s spooles.a
)
fi

# ---- ARPACK: a static library
arpack_lib() { find "$build/arpack-ng-$ARPACK_VERSION/out" -name 'libarpack*.a' 2>/dev/null | head -1; }
if [ ! -s "$(arpack_lib)" ]; then
echo "· building ARPACK"
rm -rf "arpack-ng-$ARPACK_VERSION" && tar -xzf arpack.tar.gz
(
  cd "arpack-ng-$ARPACK_VERSION"
  cmake -S . -B out -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DEXAMPLES=OFF -DTESTS=OFF -DMPI=OFF -DICB=OFF \
    -DCMAKE_Fortran_COMPILER="$(command -v "$FC")" -DCMAKE_C_COMPILER="$(command -v "$CC")" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >build.log 2>&1 || { tail -30 build.log >&2; exit 1; }
  cmake --build out -j "$jobs" >>build.log 2>&1 || { tail -30 build.log >&2; exit 1; }
)
fi
arpack="$(arpack_lib)"
test -s "$arpack"

# ---- ccx
echo "· building ccx $CCX_VERSION (a few minutes)"
rm -rf CalculiX && tar -xjf ccx.tar.bz2
(
  cd "CalculiX/ccx_$CCX_VERSION/src"
  # link what LIBS names rather than depend on files that aren't there
  edit -e "s|^ccx_$CCX_VERSION: \$(OCCXMAIN) ccx_$CCX_VERSION.a  \$(LIBS)|ccx_$CCX_VERSION: \$(OCCXMAIN) ccx_$CCX_VERSION.a|" Makefile
  # readnewmesh() is void and ends `return NULL;`: an error to a current compiler
  edit -e '/ratiorfnp=ratiorfn;/,/^}/ s|return NULL;|return;|' readnewmesh.c
  make -j "$jobs" "ccx_$CCX_VERSION" \
    CC="$CC" FC="$FC" \
    CFLAGS="-O2 -w -I$build/spooles -DARCH=Linux -DSPOOLES -DARPACK -DMATRIXSTORAGE" \
    FFLAGS="-O2 -fopenmp -cpp -w" \
    LIBS="$build/spooles/spooles.a $arpack $LAPACK_LIBS -lpthread -lm" >build.log 2>&1 || { tail -40 build.log >&2; exit 1; }
  cp "ccx_$CCX_VERSION" "$prefix/bin/ccx"
)

# ---- does it run? One tetrahedron, pulled at a corner.
echo "· checking it"
check="$build/check"
rm -rf "$check" && mkdir -p "$check"
cat >"$check/bar.inp" <<'INP'
*NODE
1,0,0,0
2,1,0,0
3,0,1,0
4,0,0,1
*ELEMENT,TYPE=C3D4,ELSET=EALL
1,1,2,3,4
*BOUNDARY
1,1,3
3,1,1
4,1,1
3,3,3
*MATERIAL,NAME=M
*ELASTIC
210000,0.3
*SOLID SECTION,ELSET=EALL,MATERIAL=M
*STEP
*STATIC
*CLOAD
2,1,100
*NODE FILE
U
*END STEP
INP
(cd "$check" && OMP_NUM_THREADS=1 "$prefix/bin/ccx" -i bar >bar.log 2>&1) || { tail -20 "$check/bar.log" >&2; echo "ccx was built but doesn't run" >&2; exit 1; }
test -s "$check/bar.frd" || { echo "ccx ran but wrote no results" >&2; exit 1; }

if [ "$keep" = 0 ]; then rm -rf "$build"; fi
echo
echo "ccx $CCX_VERSION is at $prefix/bin/ccx"
