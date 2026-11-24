/* The SDL that Chocolate Doom's OPL library (opl.c, opl_sdl.c) asks for,
   for a player with one thread: mutexes and conditions are tokens, and
   waiting on a condition is time passing. Defined in music.c. */
#ifndef MUSIC_SDL_H
#define MUSIC_SDL_H
#include <stdint.h>

typedef uint8_t Uint8;
typedef uint16_t Uint16;
typedef struct SDL_mutex SDL_mutex;
typedef struct SDL_cond SDL_cond;

#define SDL_INIT_AUDIO 0x10
#define AUDIO_S16SYS 0x8010
#define SDL_MIX_MAXVOLUME 128
#define SDL_AUDIO_ALLOW_FREQUENCY_CHANGE 1

int SDL_Init(uint32_t flags);
void SDL_QuitSubSystem(uint32_t flags);
void SDL_PauseAudio(int pause);
SDL_mutex *SDL_CreateMutex(void);
void SDL_DestroyMutex(SDL_mutex *m);
int SDL_LockMutex(SDL_mutex *m);
int SDL_UnlockMutex(SDL_mutex *m);
SDL_cond *SDL_CreateCond(void);
void SDL_DestroyCond(SDL_cond *c);
int SDL_CondSignal(SDL_cond *c);
int SDL_CondWait(SDL_cond *c, SDL_mutex *m);
void SDL_MixAudioFormat(Uint8 *dst, const Uint8 *src, Uint16 format, uint32_t len, int volume);

#endif
