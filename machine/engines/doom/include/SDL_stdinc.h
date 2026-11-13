/* m_argv.c includes this only for SDL_qsort, in code the machine never calls. */
#include <stdlib.h>
#define SDL_qsort qsort
