/**
 * empd.c — Emscripten wrapper for libpd with AudioWorklet support.
 *
 * Exposes libpd to JavaScript via exported functions + AudioWorkletProcessor.
 * Patches are loaded dynamically by writing .pd files to the emscripten
 * virtual filesystem from JS, then calling empd_open_patch().
 */

#include <emscripten.h>
#include <emscripten/webaudio.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "z_libpd.h"

#ifdef WITH_ELSE
#include "else_setup.h"
#include "m_pd.h"

/* Stubs for functions that failed to compile for WASM.
   Signatures must exactly match the headers to avoid WASM traps. */
void pdlua_setup(void) {}
void sys_putmidibyte(int p, int b) { (void)p; (void)b; }

/* elsefile.c needs PD GUI/Tcl internals that don't exist in libpd */
typedef void (*t_elsefilefn)(t_pd *, t_symbol *, int, t_atom *);
typedef void (*t_embedfn)(t_pd *, t_binbuf *, t_symbol *);
struct _elsefile { int dummy; };

void elsefile_setup(t_class *c, int embeddable) { (void)c; (void)embeddable; }
void elsefile_free(struct _elsefile *f) { (void)f; }
struct _elsefile *elsefile_new(t_pd *master, t_embedfn embedfn, t_elsefilefn readfn, t_elsefilefn writefn, t_elsefilefn updatefn) {
    (void)master; (void)embedfn; (void)readfn; (void)writefn; (void)updatefn;
    return NULL;
}
void elsefile_editor_open(struct _elsefile *f, char *title, char *owner) { (void)f; (void)title; (void)owner; }
void elsefile_panel_click_open(struct _elsefile *f) { (void)f; }
void elsefile_panel_save(struct _elsefile *f, t_symbol *inidir, t_symbol *inifile) { (void)f; (void)inidir; (void)inifile; }
void else_editor_append(struct _elsefile *f, char *contents) { (void)f; (void)contents; }
void else_editor_close(struct _elsefile *f, int ask) { (void)f; (void)ask; }
void else_editor_setdirty(struct _elsefile *f, int flag) { (void)f; (void)flag; }
int elsefile_ismapped(struct _elsefile *f) { (void)f; return 0; }
int elsefile_isloading(struct _elsefile *f) { (void)f; return 0; }
int elsefile_ispasting(struct _elsefile *f) { (void)f; return 0; }
t_symbol *panel_getopendir(struct _elsefile *f) { (void)f; return &s_; }
void panel_setopendir(struct _elsefile *f, t_symbol *dir) { (void)f; (void)dir; }
t_symbol *panel_getsavedir(struct _elsefile *f) { (void)f; return &s_; }
void panel_setsavedir(struct _elsefile *f, t_symbol *dir) { (void)f; (void)dir; }

/* aubio FFT stubs — only affects beat~ object */
typedef struct { int dummy; } aubio_fft_t;
typedef struct { int dummy; } fvec_t;
typedef struct { int dummy; } cvec_t;
aubio_fft_t *new_aubio_fft(int winsize) { (void)winsize; return NULL; }
void del_aubio_fft(aubio_fft_t *s) { (void)s; }
void aubio_fft_do(aubio_fft_t *s, fvec_t *input, cvec_t *spectrum) { (void)s; (void)input; (void)spectrum; }
void aubio_fft_do_complex(aubio_fft_t *s, fvec_t *input, fvec_t *compspec) { (void)s; (void)input; (void)compspec; }
#endif

static int initialized = 0;
static int audio_started = 0;
static void *patch = NULL;
static int sample_rate = 48000;
static int block_size = 64;
static int input_channels = 0;

/* Print hook — forward pd prints to JS (gated by Module._empdPrint) */
static void empd_print(const char *s) {
    EM_ASM({
        if (Module._empdPrint) Module._empdPrint(UTF8ToString($0));
    }, s);
}

/* ─── Receive hooks ─── */

static void empd_bang_hook(const char *recv) {
    EM_ASM({
        if (Module._onBang) Module._onBang(UTF8ToString($0));
    }, recv);
}

static void empd_float_hook(const char *recv, float val) {
    EM_ASM({
        if (Module._onFloat) Module._onFloat(UTF8ToString($0), $1);
    }, recv, val);
}

static void empd_symbol_hook(const char *recv, const char *sym) {
    EM_ASM({
        if (Module._onSymbol) Module._onSymbol(UTF8ToString($0), UTF8ToString($1));
    }, recv, sym);
}

/* Initialize libpd (called once) */
EMSCRIPTEN_KEEPALIVE
int empd_init(int sr, int inChannels) {
    if (initialized) return 0;
    sample_rate = sr;
    input_channels = inChannels;

    libpd_set_printhook(empd_print);
    libpd_set_banghook(empd_bang_hook);
    libpd_set_floathook(empd_float_hook);
    libpd_set_symbolhook(empd_symbol_hook);

    libpd_init();

#ifdef WITH_ELSE
    else_setup_all();
#endif

    libpd_init_audio(input_channels, 2, sample_rate);

    /* Turn on DSP: [; pd dsp 1( */
    libpd_start_message(1);
    libpd_add_float(1.0f);
    libpd_finish_message("pd", "dsp");

    initialized = 1;
    block_size = libpd_blocksize();
    return 0;
}

/* Open a patch file (must already be in the virtual FS) */
EMSCRIPTEN_KEEPALIVE
int empd_open_patch(const char *filename, const char *dir) {
    if (!initialized) return -1;
    if (patch) {
        libpd_closefile(patch);
        patch = NULL;
    }
    patch = libpd_openfile(filename, dir);
    return patch ? 0 : -1;
}

/* Close current patch */
EMSCRIPTEN_KEEPALIVE
void empd_close_patch(void) {
    if (patch) {
        libpd_closefile(patch);
        patch = NULL;
    }
}

/* Process one block of audio (called from AudioWorklet or ScriptProcessor) */
EMSCRIPTEN_KEEPALIVE
void empd_process(float *input, float *output, int frames, int inChannels) {
    if (!initialized || !patch) {
        memset(output, 0, frames * 2 * sizeof(float));
        return;
    }

    int inBufSize = block_size * (inChannels > 0 ? inChannels : 1);
    float *inbuf = (float *)alloca(inBufSize * sizeof(float));

    int pos = 0;
    int remaining = frames;

    while (remaining > 0) {
        /* Prepare input block */
        if (input && inChannels > 0) {
            int inPos = (frames - remaining) * inChannels;
            int n = remaining < block_size ? remaining : block_size;
            for (int i = 0; i < n * inChannels; i++) {
                inbuf[i] = input[inPos + i];
            }
            if (n < block_size) {
                memset(inbuf + n * inChannels, 0, (block_size - n) * inChannels * sizeof(float));
            }
        } else {
            memset(inbuf, 0, inBufSize * sizeof(float));
        }

        float outblock[64][2];
        libpd_process_float(1, inbuf, &outblock[0][0]);

        int n = remaining < block_size ? remaining : block_size;
        for (int i = 0; i < n; i++) {
            output[pos++] = outblock[i][0];
            output[pos++] = outblock[i][1];
        }
        remaining -= n;
    }
}

/* Get the block size */
EMSCRIPTEN_KEEPALIVE
int empd_get_block_size(void) {
    return block_size;
}

/* Send a float to a named receiver */
EMSCRIPTEN_KEEPALIVE
int empd_send_float(const char *recv, float val) {
    if (!initialized) return -1;
    return libpd_float(recv, val);
}

/* Send a bang to a named receiver */
EMSCRIPTEN_KEEPALIVE
int empd_send_bang(const char *recv) {
    if (!initialized) return -1;
    return libpd_bang(recv);
}

/* Send a symbol to a named receiver */
EMSCRIPTEN_KEEPALIVE
int empd_send_symbol(const char *recv, const char *sym) {
    if (!initialized) return -1;
    return libpd_symbol(recv, sym);
}

/* ─── Bind / Unbind ─── */

EMSCRIPTEN_KEEPALIVE
void *empd_bind(const char *sym) {
    if (!initialized) return NULL;
    return libpd_bind(sym);
}

EMSCRIPTEN_KEEPALIVE
void empd_unbind(void *ptr) {
    if (!initialized || !ptr) return;
    libpd_unbind(ptr);
}

/* ─── Array access ─── */

EMSCRIPTEN_KEEPALIVE
int empd_array_size(const char *name) {
    if (!initialized) return -1;
    return libpd_arraysize(name);
}

EMSCRIPTEN_KEEPALIVE
int empd_read_array(float *dest, const char *name, int offset, int n) {
    if (!initialized) return -1;
    return libpd_read_array(dest, name, offset, n);
}

EMSCRIPTEN_KEEPALIVE
int empd_write_array(const char *name, int offset, const float *src, int n) {
    if (!initialized) return -1;
    return libpd_write_array(name, offset, (float *)src, n);
}

EMSCRIPTEN_KEEPALIVE
int empd_resize_array(const char *name, long size) {
    if (!initialized) return -1;
    return libpd_resize_array(name, size);
}

/* ─── Compound messages ─── */

EMSCRIPTEN_KEEPALIVE
int empd_start_message(int maxlen) {
    return libpd_start_message(maxlen);
}

EMSCRIPTEN_KEEPALIVE
void empd_add_float(float val) {
    libpd_add_float(val);
}

EMSCRIPTEN_KEEPALIVE
void empd_add_symbol(const char *sym) {
    libpd_add_symbol(sym);
}

EMSCRIPTEN_KEEPALIVE
int empd_finish_list(const char *recv) {
    return libpd_finish_list(recv);
}

EMSCRIPTEN_KEEPALIVE
int empd_finish_message(const char *recv, const char *msg) {
    return libpd_finish_message(recv, msg);
}

/* ─── MIDI input ─── */

EMSCRIPTEN_KEEPALIVE
int empd_noteon(int channel, int pitch, int velocity) {
    if (!initialized) return -1;
    return libpd_noteon(channel, pitch, velocity);
}

EMSCRIPTEN_KEEPALIVE
int empd_controlchange(int channel, int controller, int value) {
    if (!initialized) return -1;
    return libpd_controlchange(channel, controller, value);
}

EMSCRIPTEN_KEEPALIVE
int empd_pitchbend(int channel, int value) {
    if (!initialized) return -1;
    return libpd_pitchbend(channel, value);
}

EMSCRIPTEN_KEEPALIVE
int empd_programchange(int channel, int value) {
    if (!initialized) return -1;
    return libpd_programchange(channel, value);
}

EMSCRIPTEN_KEEPALIVE
int empd_aftertouch(int channel, int value) {
    if (!initialized) return -1;
    return libpd_aftertouch(channel, value);
}

EMSCRIPTEN_KEEPALIVE
int empd_polyaftertouch(int channel, int pitch, int value) {
    if (!initialized) return -1;
    return libpd_polyaftertouch(channel, pitch, value);
}

/* ─── Dollar zero ─── */

EMSCRIPTEN_KEEPALIVE
int empd_get_dollar_zero(void) {
    if (!initialized || !patch) return 0;
    return libpd_getdollarzero(patch);
}
