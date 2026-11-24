/* i_swap.h's byte order macros. WebAssembly is little-endian. */
#define SDL_LIL_ENDIAN 1234
#define SDL_BIG_ENDIAN 4321
#define SDL_BYTEORDER SDL_LIL_ENDIAN
#define SDL_SwapLE16(x) (x)
#define SDL_SwapLE32(x) (x)
#define SDL_SwapBE16(x) __builtin_bswap16(x)
#define SDL_SwapBE32(x) __builtin_bswap32(x)
