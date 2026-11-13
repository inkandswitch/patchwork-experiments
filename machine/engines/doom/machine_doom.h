// Between the machine ABI (machine_doom.c) and Doom's platform layer
// (i_machine.c).
#ifndef MACHINE_DOOM_H
#define MACHINE_DOOM_H

#include "../machine.h"

// The zone's size when the content's arguments do not give -mb.
#define MACHINE_ZONE_MB 6

// Where WAD file `path` lies in the content; false if there is none.
int MACHINE_ContentFile(const char *path, unsigned int *base, unsigned int *length);

#endif
