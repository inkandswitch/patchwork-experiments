/* The SDL_mixer that opl_sdl.c asks for: the device is always open, at the
   rate music_init was given, and its one effect is the OPL's mixer, which
   music_render calls. Defined in music.c. */
#ifndef MUSIC_SDL_MIXER_H
#define MUSIC_SDL_MIXER_H
#include "SDL.h"

#define MIX_CHANNEL_POST (-2)

typedef void (*Mix_EffectFunc_t)(int chan, void *stream, int len, void *udata);
typedef void (*Mix_EffectDone_t)(int chan, void *udata);

int Mix_QuerySpec(int *frequency, Uint16 *format, int *channels);
int Mix_OpenAudioDevice(int frequency, Uint16 format, int channels, int chunksize,
                        const char *device, int allowed_changes);
void Mix_CloseAudio(void);
const char *Mix_GetError(void);
void Mix_HookMusic(void (*mix_func)(void *udata, Uint8 *stream, int len), void *arg);
int Mix_RegisterEffect(int chan, Mix_EffectFunc_t f, Mix_EffectDone_t d, void *arg);

#endif
