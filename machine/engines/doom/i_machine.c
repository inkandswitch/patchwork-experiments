// Doom's platform layer (the i_*.h interfaces) for a machine: no clock, no
// files, no window, no sound device, no network. Everything the game asks
// of the platform is answered from memory or not at all, so nothing about
// the game can live outside the instance. Replaces i_system.c, i_video.c,
// i_sound.c, i_timer.c, w_file*.c and the parts of d_net.c the game calls.

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <wasi/api.h>
#include <emscripten/syscalls.h>

#include "doomdef.h"
#include "doomstat.h"
#include "d_loop.h"
#include "i_input.h"
#include "i_sound.h"
#include "i_system.h"
#include "i_timer.h"
#include "i_video.h"
#include "m_argv.h"
#include "m_misc.h"
#include "v_diskicon.h"
#include "w_file.h"

#include "machine_doom.h"

// ---------------------------------------------------------------------
// System

static char fault[512];

// Why the engine stopped; the host reads it after a trap.
__attribute__((used, visibility("default"))) const char *machine_fault(void)
{
    return fault;
}

void I_Error(const char *error, ...)
{
    va_list ap;
    va_start(ap, error);
    vsnprintf(fault, sizeof(fault), error, ap);
    va_end(ap);
    __builtin_trap();
}

void I_Quit(void)
{
    M_StringCopy(fault, "quit", sizeof(fault));
    __builtin_trap();
}

// The zone is one fixed block, so drawing (on a copy) never grows memory.
// -mb <MiB> sets its size.
byte *I_ZoneBase(int *size)
{
    int p = M_CheckParmWithArgs("-mb", 1);
    *size = (p ? atoi(myargv[p + 1]) : MACHINE_ZONE_MB) * 1024 * 1024;
    return calloc(1, *size);
}

void *I_Realloc(void *ptr, size_t size)
{
    void *r = realloc(ptr, size);
    if (size != 0 && r == NULL)
        I_Error("I_Realloc: failed on reallocation of %zu bytes", size);
    return r;
}

void I_AtExit(atexit_func_t func, boolean run_if_error) {}
void I_Init(void) {}
void I_BindVariables(void) {}
void I_PrintBanner(const char *text) {}
void I_PrintDivider(void) {}
void I_PrintStartupBanner(const char *gamedescription) {}
boolean I_ConsoleStdout(void) { return false; }
void I_Tactile(int on, int off, int total) {}

ticcmd_t *I_BaseTiccmd(void)
{
    static ticcmd_t empty;
    return &empty;
}

// Chocolate Doom's emulation of what DOS had at low addresses, read by its
// spechit and other overrun emulation (from i_system.c, unchanged).
#define DOS_MEM_DUMP_SIZE 10

static const unsigned char mem_dump_dos622[DOS_MEM_DUMP_SIZE] = {
  0x57, 0x92, 0x19, 0x00, 0xF4, 0x06, 0x70, 0x00, 0x16, 0x00};
static const unsigned char mem_dump_win98[DOS_MEM_DUMP_SIZE] = {
  0x9E, 0x0F, 0xC9, 0x00, 0x65, 0x04, 0x70, 0x00, 0x16, 0x00};
static const unsigned char mem_dump_dosbox[DOS_MEM_DUMP_SIZE] = {
  0x00, 0x00, 0x00, 0xF1, 0x00, 0x00, 0x00, 0x00, 0x07, 0x00};
static unsigned char mem_dump_custom[DOS_MEM_DUMP_SIZE];

static const unsigned char *dos_mem_dump = mem_dump_dos622;

boolean I_GetMemoryValue(unsigned int offset, void *value, int size)
{
    static boolean firsttime = true;

    if (firsttime)
    {
        int p, i, val;

        firsttime = false;
        i = 0;
        p = M_CheckParmWithArgs("-setmem", 1);

        if (p > 0)
        {
            if (!strcasecmp(myargv[p + 1], "dos622"))
            {
                dos_mem_dump = mem_dump_dos622;
            }
            if (!strcasecmp(myargv[p + 1], "dos71"))
            {
                dos_mem_dump = mem_dump_win98;
            }
            else if (!strcasecmp(myargv[p + 1], "dosbox"))
            {
                dos_mem_dump = mem_dump_dosbox;
            }
            else
            {
                for (i = 0; i < DOS_MEM_DUMP_SIZE; ++i)
                {
                    ++p;

                    if (p >= myargc || myargv[p][0] == '-')
                    {
                        break;
                    }

                    M_StrToInt(myargv[p], &val);
                    mem_dump_custom[i++] = (unsigned char) val;
                }

                dos_mem_dump = mem_dump_custom;
            }
        }
    }

    switch (size)
    {
    case 1:
        *((unsigned char *) value) = dos_mem_dump[offset];
        return true;
    case 2:
        *((unsigned short *) value) = dos_mem_dump[offset]
                                    | (dos_mem_dump[offset + 1] << 8);
        return true;
    case 4:
        *((unsigned int *) value) = dos_mem_dump[offset]
                                  | (dos_mem_dump[offset + 1] << 8)
                                  | (dos_mem_dump[offset + 2] << 16)
                                  | (dos_mem_dump[offset + 3] << 24);
        return true;
    }

    return false;
}

// ---------------------------------------------------------------------
// Time is the tic count, which is in memory.

int gametic;

int I_GetTime(void) { return gametic; }
int I_GetTimeMS(void) { return gametic * 1000 / TICRATE; }
void I_Sleep(int ms) {}
void I_WaitVBL(int count) {}
void I_InitTimer(void) {}

// ---------------------------------------------------------------------
// Video: the game draws into I_VideoBuffer; machine_frame reads it with
// the palette the game last set.

pixel_t *I_VideoBuffer = NULL;
byte machine_palette[256 * 3];

int usemouse = 0;
int usegamma = 0;
int png_screenshots = 0;
int fullscreen = false;
int aspect_ratio_correct = true;
int integer_scaling = false;
int vga_porch_flash = false;
int force_software_renderer = false;
int smooth_pixel_scaling = false;
int video_display = 0;
int window_width = SCREENWIDTH, window_height = SCREENHEIGHT;
int fullscreen_width = 0, fullscreen_height = 0;
char *video_driver = "";
char *window_position = "";
boolean screensaver_mode = false;
boolean screenvisible = true;
unsigned int joywait = 0;

void I_SetPalette(byte *palette)
{
    memcpy(machine_palette, palette, sizeof(machine_palette));
}

// The closest palette entry to a colour (as i_video.c computes it).
int I_GetPaletteIndex(int r, int g, int b)
{
    int best = 0, best_diff = 0x7fffffff, i;

    for (i = 0; i < 256; ++i)
    {
        int dr = r - machine_palette[i * 3];
        int dg = g - machine_palette[i * 3 + 1];
        int db = b - machine_palette[i * 3 + 2];
        int diff = dr * dr + dg * dg + db * db;

        if (diff < best_diff)
        {
            best = i;
            best_diff = diff;
        }
        if (diff == 0)
            break;
    }
    return best;
}

void I_ReadScreen(pixel_t *scr)
{
    memcpy(scr, I_VideoBuffer, SCREENWIDTH * SCREENHEIGHT * sizeof(*scr));
}

void I_InitGraphics(void) {}
void I_GraphicsCheckCommandLine(void) {}
void I_ShutdownGraphics(void) {}
void I_UpdateNoBlit(void) {}
void I_FinishUpdate(void) {}
void I_BeginRead(void) {}
void I_SetWindowTitle(const char *title) {}
void I_CheckIsScreensaver(void) {}
void I_SetGrabMouseCallback(grabmouse_callback_t func) {}
void I_DisplayFPSDots(boolean dots_on) {}
void I_BindVideoVariables(void) {}
void I_InitWindowTitle(void) {}
void I_RegisterWindowIcon(const unsigned int *icon, int width, int height) {}
void I_InitWindowIcon(void) {}
void I_StartFrame(void) {}
void I_StartTic(void) {}
void I_EnableLoadingDisk(int xoffs, int yoffs) {}
void V_BeginRead(size_t nbytes) {}
void I_StartTextInput(int x1, int y1, int x2, int y2) {}
void I_GetWindowPosition(int *x, int *y, int w, int h) {}

// ---------------------------------------------------------------------
// Sound: no device. Doom keeps its channel bookkeeping as without a sound
// card; what was played reaches the host through I_SoundEvent and the music
// record (machine_doom.c).

int snd_samplerate = 44100;
int snd_cachesize = 64 * 1024 * 1024;
int snd_maxslicetime_ms = 28;
char *snd_musiccmd = "";
int snd_pitchshift = -1;
int snd_musicdevice = SNDDEVICE_NONE;
int snd_sfxdevice = SNDDEVICE_NONE;

void I_InitSound(GameMission_t mission) {}
void I_ShutdownSound(void) {}
int I_GetSfxLumpNum(sfxinfo_t *sfxinfo) { return 0; }
void I_UpdateSound(void) {}
void I_UpdateSoundParams(int channel, int vol, int sep) {}
int I_StartSound(sfxinfo_t *sfxinfo, int channel, int vol, int sep, int pitch) { return 0; }
void I_StopSound(int channel) {}
boolean I_SoundIsPlaying(int channel) { return false; }
void I_PrecacheSounds(sfxinfo_t *sounds, int num_sounds) {}
void I_BindSoundVariables(void) {}
void I_SetOPLDriverVer(opl_driver_ver_t ver) {}
void I_OPL_DevMessages(char *result, size_t result_len) { result[0] = '\0'; }

// Music: the song is the cached lump; the host is told which one by name.
void *machine_song = NULL;
boolean machine_song_loops = false;

void I_InitMusic(void) {}
void I_ShutdownMusic(void) {}
void I_SetMusicVolume(int volume) {}
void I_PauseSong(void) {}
void I_ResumeSong(void) {}
void *I_RegisterSong(void *data, int len) { return data; }
void I_UnRegisterSong(void *handle) {}

void I_PlaySong(void *handle, boolean looping)
{
    machine_song = handle;
    machine_song_loops = looping;
}

void I_StopSong(void)
{
    machine_song = NULL;
}

boolean I_MusicIsPlaying(void)
{
    return machine_song != NULL;
}

// ---------------------------------------------------------------------
// Network: the machine is the network. Every port's ticcmd arrives with
// each step; netcmds points at them.

ticcmd_t *netcmds;

// i_input.c's, read by a menu option the machine never shows.
float mouse_acceleration = 2.0;
int mouse_threshold = 10;
int ticdup = 1;

void NetUpdate(void) {}

// Demo playback (G_DoPlayDemo) is not a machine's business.
boolean D_NonVanillaPlayback(boolean conditional, int lumpnum, const char *feature)
{
    return false;
}

// ---------------------------------------------------------------------
// Files: the only files are the WADs in the content, read through the
// content import at explicit offsets. Their bytes never enter memory except
// as lumps the game caches in its zone.

typedef struct
{
    wad_file_t wad;
    unsigned int base;          // where the file starts in the content
} content_file_t;

static wad_file_class_t content_file_class;

wad_file_t *W_OpenFile(const char *path)
{
    unsigned int base, length;
    content_file_t *f;

    if (!MACHINE_ContentFile(path, &base, &length))
        return NULL;
    f = malloc(sizeof(*f));
    f->wad.file_class = &content_file_class;
    f->wad.mapped = NULL;
    f->wad.length = length;
    f->wad.path = M_StringDuplicate(path);
    f->base = base;
    return &f->wad;
}

void W_CloseFile(wad_file_t *wad)
{
    free((char *) wad->path);
    free(wad);
}

size_t W_Read(wad_file_t *wad, unsigned int offset, void *buffer, size_t len)
{
    content_file_t *f = (content_file_t *) wad;

    if (offset > wad->length)
        return 0;
    if (len > wad->length - offset)
        len = wad->length - offset;
    machine_content_read(f->base + offset, len, buffer);
    return len;
}

// No other file can be opened, written or found. libc reaches the host
// through these WASI calls; here they answer from nothing, so the module
// imports none of them.

__wasi_errno_t __wasi_fd_write(__wasi_fd_t fd, const __wasi_ciovec_t *iovs,
                               size_t n, __wasi_size_t *written)
{
    size_t i, total = 0;
    for (i = 0; i < n; i++)
        total += iovs[i].buf_len;
    *written = total;           // printing goes nowhere
    return 0;
}

__wasi_errno_t __wasi_fd_read(__wasi_fd_t fd, const __wasi_iovec_t *iovs,
                              size_t n, __wasi_size_t *nread)
{
    return __WASI_ERRNO_BADF;
}

__wasi_errno_t __wasi_fd_seek(__wasi_fd_t fd, __wasi_filedelta_t offset,
                              __wasi_whence_t whence, __wasi_filesize_t *pos)
{
    return __WASI_ERRNO_BADF;
}

__wasi_errno_t __wasi_fd_close(__wasi_fd_t fd)
{
    return __WASI_ERRNO_BADF;
}

__wasi_errno_t __wasi_clock_time_get(__wasi_clockid_t id,
                                     __wasi_timestamp_t precision,
                                     __wasi_timestamp_t *time)
{
    *time = 0;                  // no clock: time stands still
    return 0;
}

__wasi_errno_t __wasi_environ_sizes_get(__wasi_size_t *count, __wasi_size_t *size)
{
    *count = *size = 0;         // no environment
    return 0;
}

__wasi_errno_t __wasi_environ_get(uint8_t **environ, uint8_t *buf)
{
    return 0;
}

int __syscall_unlinkat(int dirfd, const char *path, int flags) { return -ENOENT; }
int __syscall_rmdir(const char *path) { return -ENOENT; }
int __syscall_renameat(int olddirfd, const char *oldpath, int newdirfd,
                       const char *newpath) { return -ENOENT; }

void __wasi_proc_exit(__wasi_exitcode_t code)
{
    M_StringCopy(fault, "exit", sizeof(fault));
    __builtin_trap();
}
