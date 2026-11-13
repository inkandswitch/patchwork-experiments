#!/bin/sh
# Builds Chocolate Doom as a standalone .wasm machine engine: upstream at a
# pinned commit, patches/ applied in order, Doom's own platform layer
# replaced by i_machine.c, and the ABI in machine_doom.c. Run from anywhere:
# `pnpm build:engines`.
#
# Upstream is read from $CHOCOLATE_DOOM, any clone holding the commit
# (default: a clone under $TMPDIR, made if missing). Only `git archive` of
# the commit is used, so the clone's own working tree does not matter, and
# nothing from it is executed: its sources are compiled here directly.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
commit=a2dfd51fcc00d272dc8a17a97ccd6683333ff4ea
repo="${CHOCOLATE_DOOM:-${TMPDIR:-/tmp}/chocolate-doom}"
tree="${OBJ:-${TMPDIR:-/tmp}/machine-doom-src}"

if ! git -C "$repo" cat-file -e "$commit^{commit}" 2>/dev/null; then
  git clone --quiet https://github.com/chocolate-doom/chocolate-doom.git "$repo"
fi
rm -rf "$tree"
mkdir -p "$tree"
git -C "$repo" archive "$commit" | tar -x -C "$tree"
git -C "$tree" init --quiet     # so that git apply works on this tree alone
for p in "$here"/patches/*.patch; do git -C "$tree" apply "$p"; done

# The game (src/doom) and the engine-independent parts it uses (src). Not
# compiled: the i_* platform layer, networking, d_net.c, d_loop.c and the
# config file, which i_machine.c stands in for.
game="am_map d_items d_main deh_ammo deh_bexstr deh_cheat deh_doom deh_frame
  deh_misc deh_ptr deh_sound deh_thing deh_weapon doomdef doomstat dstrings
  f_finale f_wipe g_game hu_lib hu_stuff info m_menu m_random p_ceilng p_doors
  p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg
  p_setup p_sight p_spec p_switch p_telept p_tick p_trace p_user r_bsp r_data
  r_draw r_main r_plane r_segs r_sky r_things s_sound sounds st_lib st_stuff
  statdump wi_stuff"
common="d_event d_iwad d_mode deh_io deh_main deh_mapping deh_str deh_text
  m_argv m_bbox m_cheat m_controls m_fixed m_misc memio p_rejectpad sha1 tables
  v_video w_main w_merge w_wad z_zone"
sources="$here/machine_doom.c $here/i_machine.c"
for f in $game; do sources="$sources $tree/src/doom/$f.c"; done
for f in $common; do sources="$sources $tree/src/$f.c"; done

mkdir -p "$here/dist"
emcc -O2 -Wno-everything -ffile-prefix-map="$tree"=chocolate-doom -ffile-prefix-map="$here"=doom \
  -I"$here/include" -I"$tree/src" -I"$tree/src/doom" $sources -o "$here/dist/doom.wasm" \
  -sSTANDALONE_WASM --no-entry -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=1mb -sSTACK_SIZE=64kb -Wl,--stack-first \
  -sEXPORTED_FUNCTIONS=_machine_info,_machine_init,_machine_input,_machine_step,_machine_output,_machine_frame,_machine_fault,_doom_trace
