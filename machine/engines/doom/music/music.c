// Doom's music as PCM, for the host to play beside the engine. It is
// presentation, not simulation: the engine says which song should be
// playing (the music record that starts every step's events), and this
// module, a separate .wasm whose state is never in a snapshot, makes it
// audible.
//
// Everything that makes the sound is Chocolate Doom's own, unmodified:
// i_oplmusic.c (DMX's OPL music driver, with the GENMIDI instruments),
// mus2mid.c and midifile.c (reading a MUS or MIDI lump), and the OPL library
// (opl.c, opl_queue.c, the Nuked OPL3 emulator in opl3.c, and opl_sdl.c,
// its software driver). What is here is the platform under them: the one
// file they write and read back, the GENMIDI lump, and SDL for a program
// with one thread (SDL.h, SDL_mixer.h), where rendering is the only thing
// that moves time.
//
// The ABI (doom.js's music() is its host):
//   music_buffer(len) -> *u8      where the host copies a lump, for the next call
//   music_init(rate) -> i32       the buffer holds GENMIDI; 0 on success
//   music_play(loops) -> i32      the buffer holds a song (MUS or MIDI); 0 on success
//   music_stop()
//   music_pause(paused)
//   music_render(frames) -> *i16  the next frames, stereo, interleaved

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <wasi/api.h>

#include "doomtype.h"
#include "i_sound.h"
#include "m_misc.h"
#include "opl.h"
#include "opl_internal.h"
#include "SDL_mixer.h"

#define EXPORT __attribute__((used, visibility("default")))

// ---------------------------------------------------------------------
// SDL with one thread. A mutex has nothing to exclude; a condition has
// nobody to signal it but a callback the OPL queue runs as time passes.
// So waiting is time passing: one sample of the chip, rendered and
// dropped. (Only the OPL detection at init waits: 1 ms of silence.)

static struct SDL_mutex { int unused; } the_mutex;
static struct SDL_cond { int unused; } the_cond;
static Mix_EffectFunc_t mixer;     // opl_sdl.c's OPL_Mix_Callback

int SDL_Init(uint32_t flags) { return 0; }
void SDL_QuitSubSystem(uint32_t flags) {}
void SDL_PauseAudio(int pause) {}
SDL_mutex *SDL_CreateMutex(void) { return &the_mutex; }
void SDL_DestroyMutex(SDL_mutex *m) {}
int SDL_LockMutex(SDL_mutex *m) { return 0; }
int SDL_UnlockMutex(SDL_mutex *m) { return 0; }
SDL_cond *SDL_CreateCond(void) { return &the_cond; }
void SDL_DestroyCond(SDL_cond *c) {}
int SDL_CondSignal(SDL_cond *c) { return 0; }

int SDL_CondWait(SDL_cond *c, SDL_mutex *m)
{
    int16_t sample[2] = { 0, 0 };

    if (mixer != NULL)
        mixer(MIX_CHANNEL_POST, sample, sizeof(sample), NULL);
    return 0;
}

// Adds src to dst, saturating: dst is zeroed before the mixer runs, so this
// is the chip's output as it made it.
void SDL_MixAudioFormat(Uint8 *dst, const Uint8 *src, Uint16 format, uint32_t len, int volume)
{
    int16_t *d = (int16_t *) dst;
    const int16_t *s = (const int16_t *) src;
    uint32_t i;

    for (i = 0; i < len / 2; i++)
    {
        int v = d[i] + s[i];
        d[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
}

int Mix_QuerySpec(int *frequency, Uint16 *format, int *channels)
{
    *frequency = opl_sample_rate;
    *format = AUDIO_S16SYS;
    *channels = 2;
    return 1;                   // open: opl_sdl.c then neither opens nor closes it
}

int Mix_OpenAudioDevice(int frequency, Uint16 format, int channels, int chunksize,
                        const char *device, int allowed_changes) { return -1; }
void Mix_CloseAudio(void) {}
const char *Mix_GetError(void) { return ""; }
void Mix_HookMusic(void (*mix_func)(void *, Uint8 *, int), void *arg) {}

int Mix_RegisterEffect(int chan, Mix_EffectFunc_t f, Mix_EffectDone_t d, void *arg)
{
    mixer = f;
    return 1;
}

// ---------------------------------------------------------------------
// The platform i_oplmusic.c, midifile.c and mus2mid.c stand on.

int snd_samplerate;

static byte *genmidi;           // the instruments; i_oplmusic.c keeps pointers into it

void *W_CacheLumpName(const char *name, int tag) { return genmidi; }
void W_ReleaseLumpName(const char *name) {}
const char *DEH_String(const char *s) { return s; }

// RegisterSong writes the song as a MIDI file, loads it, and removes it.
// The one file there is lives here.
static void *file;
static size_t file_length;

char *M_TempFile(const char *s) { return M_StringDuplicate(s); }

char *M_StringDuplicate(const char *s)
{
    char *d = malloc(strlen(s) + 1);
    strcpy(d, s);
    return d;
}

boolean M_WriteFile(const char *name, const void *source, int length)
{
    free(file);
    file = malloc(length > 0 ? length : 1);
    memcpy(file, source, length);
    file_length = length;
    return true;
}

FILE *M_fopen(const char *filename, const char *mode)
{
    return file != NULL ? fmemopen(file, file_length, "rb") : NULL;
}

int M_remove(const char *path)
{
    free(file);
    file = NULL;
    file_length = 0;
    return 0;
}

int M_vsnprintf(char *buf, size_t buf_len, const char *s, va_list args)
{
    int result;

    if (buf_len < 1)
        return 0;
    result = vsnprintf(buf, buf_len, s, args);
    if (result < 0 || result >= buf_len)
    {
        buf[buf_len - 1] = '\0';
        result = buf_len - 1;
    }
    return result;
}

int M_snprintf(char *buf, size_t buf_len, const char *s, ...)
{
    va_list args;
    int result;

    va_start(args, s);
    result = M_vsnprintf(buf, buf_len, s, args);
    va_end(args);
    return result;
}

boolean M_StringConcat(char *dest, const char *src, size_t dest_size)
{
    size_t offset = strlen(dest);

    if (offset > dest_size)
        offset = dest_size;
    return M_snprintf(dest + offset, dest_size - offset, "%s", src) == strlen(src);
}

static char fault[256];

void I_Error(const char *error, ...);

void *I_Realloc(void *ptr, size_t size)
{
    void *p = realloc(ptr, size);
    if (p == NULL && size != 0)
        I_Error("I_Realloc: failed on reallocation of %zu bytes", size);
    return p;
}

// memio.c's allocations; the zone is the engine's, not the player's.
void *Z_Malloc(int size, int tag, void *user)
{
    void *p = malloc(size > 0 ? size : 1);
    if (p == NULL)
        I_Error("Z_Malloc: failed on allocation of %i bytes", size);
    return p;
}

void Z_Free(void *ptr) { free(ptr); }

void I_Error(const char *error, ...)
{
    va_list ap;
    va_start(ap, error);
    vsnprintf(fault, sizeof(fault), error, ap);
    va_end(ap);
    __builtin_trap();
}

// Why the last call trapped, as the engines have it.
EXPORT const char *music_fault(void)
{
    return fault;
}

// libc's WASI calls, answered from nothing, so the module imports none:
// printing goes nowhere, there is no environment (no DMXOPTION: an OPL2,
// as Doom 1.9's DMX drove by default), no clock and no file.

__wasi_errno_t __wasi_fd_write(__wasi_fd_t fd, const __wasi_ciovec_t *iovs,
                               size_t n, __wasi_size_t *written)
{
    size_t i, total = 0;
    for (i = 0; i < n; i++)
        total += iovs[i].buf_len;
    *written = total;
    return 0;
}

__wasi_errno_t __wasi_fd_read(__wasi_fd_t fd, const __wasi_iovec_t *iovs,
                              size_t n, __wasi_size_t *nread) { return __WASI_ERRNO_BADF; }
__wasi_errno_t __wasi_fd_seek(__wasi_fd_t fd, __wasi_filedelta_t offset,
                              __wasi_whence_t whence, __wasi_filesize_t *pos) { return __WASI_ERRNO_BADF; }
__wasi_errno_t __wasi_fd_close(__wasi_fd_t fd) { return __WASI_ERRNO_BADF; }

__wasi_errno_t __wasi_clock_time_get(__wasi_clockid_t id, __wasi_timestamp_t precision,
                                     __wasi_timestamp_t *time)
{
    *time = 0;
    return 0;
}

__wasi_errno_t __wasi_environ_sizes_get(__wasi_size_t *count, __wasi_size_t *size)
{
    *count = *size = 0;
    return 0;
}

__wasi_errno_t __wasi_environ_get(uint8_t **environ, uint8_t *buf) { return 0; }

void __wasi_proc_exit(__wasi_exitcode_t code)
{
    M_snprintf(fault, sizeof(fault), "exit %d", code);
    __builtin_trap();
}

// ---------------------------------------------------------------------
// The ABI.

#define MAX_FRAMES 4096         // per call of the mixer; opl_sdl.c wants under a second

static byte *buffer;
static size_t buffer_length;
static const music_module_t *opl = &music_opl_module;
static void *song;              // the registered song, or NULL
static boolean paused;
static int16_t *pcm;
static uint32_t pcm_frames;

EXPORT uint8_t *music_buffer(uint32_t len)
{
    free(buffer);
    buffer = malloc(len > 0 ? len : 1);
    buffer_length = len;
    return buffer;
}

EXPORT int32_t music_init(uint32_t rate)
{
    if (genmidi != NULL || rate == 0)
        return 1;
    if (buffer_length < 8 || memcmp(buffer, "#OPL_II#", 8) != 0)
        return 2;
    genmidi = buffer;           // kept: the instruments point into it
    buffer = NULL;
    buffer_length = 0;
    snd_samplerate = rate;
    if (!opl->Init())
        return 3;
    opl->SetMusicVolume(127);   // full; the host sets the level
    return 0;
}

EXPORT void music_stop(void)
{
    if (song == NULL)
        return;
    opl->StopSong();
    opl->UnRegisterSong(song);
    song = NULL;
}

EXPORT int32_t music_play(int32_t loops)
{
    if (genmidi == NULL)
        return 1;
    music_stop();
    song = opl->RegisterSong(buffer, buffer_length);
    if (song == NULL)
        return 2;
    opl->PlaySong(song, loops != 0);    // which also resumes, as DMX did
    paused = false;
    return 0;
}

EXPORT void music_pause(int32_t pause)
{
    if (genmidi == NULL || (pause != 0) == paused)
        return;
    paused = pause != 0;
    if (paused)
        opl->PauseMusic();
    else
        opl->ResumeMusic();
}

EXPORT const int16_t *music_render(uint32_t frames)
{
    uint32_t done, n;

    if (frames > pcm_frames)
    {
        free(pcm);
        pcm = malloc(frames * 4);
        pcm_frames = frames;
    }
    memset(pcm, 0, frames * 4);
    for (done = 0; mixer != NULL && done < frames; done += n)
    {
        n = frames - done < MAX_FRAMES ? frames - done : MAX_FRAMES;
        mixer(MIX_CHANNEL_POST, pcm + done * 2, n * 4, NULL);
    }
    return pcm;
}
