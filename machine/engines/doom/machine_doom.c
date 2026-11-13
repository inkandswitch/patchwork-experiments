// Chocolate Doom as a machine engine (../../ENGINE.md, ../machine.h).
//
// Content: the game's arguments and its WAD files (README.md, doom.js).
// Input: per player, the ticcmd that vanilla Doom sends over the network.
// Step: one G_Ticker, as a netgame runs a tic. Output: the step's sounds
// and the music. Frame: a player's screen, drawn by Doom's own renderer.
//
// Setup mirrors D_DoomMain (d_main.c) and G_DoPlayDemo (g_game.c), minus
// the config file, the IWAD search, the network and the main loop.

#include <stdlib.h>
#include <string.h>

#include "doomdef.h"
#include "doomstat.h"
#include "d_iwad.h"
#include "deh_main.h"
#include "deh_str.h"
#include "g_game.h"
#include "hu_stuff.h"
#include "i_system.h"
#include "i_video.h"
#include "m_argv.h"
#include "m_menu.h"
#include "m_misc.h"
#include "p_local.h"
#include "p_setup.h"
#include "p_trace.h"
#include "r_local.h"
#include "s_sound.h"
#include "sounds.h"
#include "st_stuff.h"
#include "v_video.h"
#include "w_main.h"
#include "w_wad.h"
#include "z_zone.h"

#include "machine_doom.h"

#define EXPORT MACHINE_EXPORT

// From d_main.c (0002-machine.patch makes InitGameVersion and LoadIwadDeh
// visible).
void InitGameVersion(void);
void D_IdentifyVersion(void);
void LoadIwadDeh(void);
boolean D_Display(void);

#define INPUT_BYTES 6           // per port: see machine_input

static int numevents;
static void FinishOutput(void);

extern boolean netdemo;     // g_game.c
extern byte machine_palette[256 * 3];
extern void *machine_song;
extern boolean machine_song_loops;

// ---------------------------------------------------------------------
// Content: records of (u32 length, bytes). The first record is the
// argument list, NUL-separated; each one after it is a WAD file, the IWAD
// first. The files are read on demand through the content import.

#define MAXFILES 16

static unsigned int file_base[MAXFILES], file_length[MAXFILES];
static int numfiles;

static unsigned int ReadU32(unsigned int at)
{
    byte b[4];
    machine_content_read(at, 4, b);
    return b[0] | (b[1] << 8) | (b[2] << 16) | ((unsigned int) b[3] << 24);
}

static void ReadContent(void)
{
    unsigned int size = machine_content_size(), at, n, i;
    char *args;

    if (size < 4)
        I_Error("content: empty (build it with doom.js content())");
    n = ReadU32(0);
    if (n == 0x44415749 || n == 0x44415750)    // "IWAD", "PWAD"
        I_Error("content: a bare WAD (build it with doom.js content())");
    if (n > size - 4)
        I_Error("content: arguments overrun the content");

    args = malloc(n + 1);
    machine_content_read(4, n, args);
    args[n] = '\0';
    myargc = 1;
    for (i = 0; i < n; i++)
        myargc += args[i] == '\0';
    myargc += n > 0 && args[n - 1] != '\0';
    myargv = malloc(sizeof(char *) * (myargc + 1));
    myargv[0] = "doom";
    myargc = 1;
    for (i = 0; i < n; i += strlen(args + i) + 1)
        myargv[myargc++] = args + i;
    myargv[myargc] = NULL;

    for (at = 4 + n; at < size; at += 4 + file_length[numfiles++])
    {
        if (numfiles == MAXFILES)
            I_Error("content: more than %d files", MAXFILES);
        if (size - at < 4 || ReadU32(at) > size - at - 4)
            I_Error("content: file %d overruns the content", numfiles + 1);
        file_length[numfiles] = ReadU32(at);
        file_base[numfiles] = at + 4;
    }
    if (numfiles == 0)
        I_Error("content: no IWAD");
}

// Files are named by their place in the content: "1.wad" is the IWAD.
int MACHINE_ContentFile(const char *path, unsigned int *base, unsigned int *length)
{
    int i = atoi(path) - 1;

    if (i < 0 || i >= numfiles)
        return 0;
    *base = file_base[i];
    *length = file_length[i];
    return 1;
}

// ---------------------------------------------------------------------

static const machine_info_t info = { TICRATE, 1, MAXPLAYERS, INPUT_BYTES };

EXPORT const machine_info_t *machine_info(void)
{
    return &info;
}

EXPORT int32_t machine_init(void)
{
    char name[16];
    int i, p, players = 1;

    ReadContent();
    Z_Init();

    nomonsters = M_CheckParm("-nomonsters");
    respawnparm = M_CheckParm("-respawn");
    fastparm = M_CheckParm("-fast");
    if (M_CheckParm("-deathmatch"))
        deathmatch = 1;
    if (M_CheckParm("-altdeath"))
        deathmatch = 2;

    V_Init();
    for (i = 0; i < numfiles; i++)
    {
        M_snprintf(name, sizeof(name), "%d.wad", i + 1);
        if (W_AddFile(name) == NULL)
            I_Error("content: file %d is not a WAD", i + 1);
    }
    modifiedgame = numfiles > 1;
    W_CheckCorrectIWAD(doom);
    // The game is told by the IWAD's lumps (E1M1 or MAP01), not its file
    // name; -pack tnt or -pack plutonia names a Final Doom IWAD.
    gamemission = none;
    D_IdentifyVersion();
    InitGameVersion();

    if (W_CheckNumForName("FREEDOOM") >= 0)
        gamevariant = W_CheckNumForName("FREEDM") >= 0 ? freedm : freedoom;
    else if (W_CheckNumForName("DMENUPIC") >= 0)
        gamevariant = bfgedition;
    if (!M_ParmExists("-nodeh"))
        LoadIwadDeh();
    W_GenerateHashTable();

    // -dehlump: the DEHACKED lumps in the PWADs (as D_DoomMain does)
    if (M_ParmExists("-dehlump"))
    {
        int numiwadlumps = numlumps;

        while (!W_IsIWADLump(lumpinfo[numiwadlumps - 1]))
            numiwadlumps--;
        for (i = numiwadlumps; i < numlumps; ++i)
            if (!strncmp(lumpinfo[i]->name, "DEHACKED", 8))
                DEH_LoadLump(i, false, false);
    }

    startskill = sk_medium;
    startepisode = 1;
    startmap = 1;
    if ((p = M_CheckParmWithArgs("-skill", 1)))
        startskill = myargv[p + 1][0] - '1';
    if ((p = M_CheckParmWithArgs("-episode", 1)))
    {
        startepisode = myargv[p + 1][0] - '0';
        startmap = 1;
    }
    timelimit = 0;
    if ((p = M_CheckParmWithArgs("-timer", 1)))
        timelimit = atoi(myargv[p + 1]);
    if (M_CheckParm("-avg"))
        timelimit = 20;
    if ((p = M_CheckParmWithArgs("-warp", 1)))
    {
        if (gamemode == commercial)
            startmap = atoi(myargv[p + 1]);
        else
        {
            startepisode = myargv[p + 1][0] - '0';
            startmap = p + 2 < myargc ? myargv[p + 2][0] - '0' : 1;
        }
    }
    // -players <n>: ports 0 to n-1 are in the game; more than one, or
    // -solo-net, makes it a netgame (co-op unless -deathmatch/-altdeath).
    if ((p = M_CheckParmWithArgs("-players", 1)))
        players = atoi(myargv[p + 1]);
    if (players < 1 || players > MAXPLAYERS)
        I_Error("-players: %d is not 1 to %d", players, MAXPLAYERS);

    M_Init();
    screenblocks = 10;          // a frame is the full-width view and status bar
    R_Init();
    P_Init();
    S_Init(sfxVolume * 8, musicVolume * 8);
    HU_Init();
    ST_Init();

    I_VideoBuffer = Z_Malloc(SCREENWIDTH * SCREENHEIGHT, PU_STATIC, NULL);
    memset(I_VideoBuffer, 0, SCREENWIDTH * SCREENHEIGHT);
    V_RestoreBuffer();

    consoleplayer = displayplayer = 0;
    for (i = 0; i < MAXPLAYERS; i++)
        playeringame[i] = i < players;
    netgame = players > 1 || M_ParmExists("-solo-net");
    netdemo = netgame;          // the inputs carry no consistency check

    // Nothing is precached: the zone holds what the game has touched, and
    // a frame caches what it draws in its own copy.
    precache = false;
    numevents = 1;              // events[0] is the music record
    G_InitNew(startskill, startepisode, startmap);
    R_ExecuteSetViewSize();
    FinishOutput();
    return 0;
}

// ---------------------------------------------------------------------
// Input: six bytes per port, the fields of a network ticcmd:
//   0 forwardmove (int8)   1 sidemove (int8)   2-3 angleturn (int16 LE)
//   4 buttons              5 chatchar
// A port nobody holds sends zeros, which is a player standing still.

static byte input[MAXPLAYERS * INPUT_BYTES];
static ticcmd_t cmds[MAXPLAYERS];

EXPORT uint8_t *machine_input(void)
{
    return input;
}

// ---------------------------------------------------------------------
// Output: no audio stream (the host plays the WAD's own sound lumps, see
// doom.js), and events, 28 bytes each, little-endian:
//
//   0  u8   kind: 1 music, 2 sound, 3 stop
//   1  i8   player whose body the origin is, or -1
//   2  u8   volume, 0-127 (sound); 1 if the music loops (music)
//   3  u8   0
//   4  [8]  lump name, NUL-padded: "DSPISTOL", "D_E1M1"
//   12 u32  origin: a handle, the same while the thing exists; 0 for none
//   16 i32  x, y, z: the origin's position in map units, 16.16 fixed
//
// Every step's events begin with one music record, the music that should
// be playing now (no name: none; volume byte: loops; player byte: 1 if the
// game is paused). Sound records follow in the order the game made them.
// A sound with no origin is heard by everyone without position. A new
// sound from an origin replaces the one it was making; a stop ends it.

#define MAXEVENTS 128

typedef struct
{
    uint8_t kind;
    int8_t player;
    uint8_t volume;
    uint8_t pad;
    char name[8];
    uint32_t origin;
    int32_t x, y, z;
} record_t;

static record_t events[MAXEVENTS];
static machine_output_t output;

static boolean InSectors(void *p)
{
    return sectors && (byte *) p >= (byte *) sectors
        && (byte *) p < (byte *) (sectors + numsectors);
}

static record_t *NewEvent(int kind, void *origin)
{
    record_t *e;

    if (numevents == MAXEVENTS)
        return NULL;
    e = &events[numevents++];
    memset(e, 0, sizeof(*e));
    e->kind = kind;
    e->player = -1;
    if (origin != NULL)
    {
        // a mobj, or a sector's sound origin (which shares x, y, z)
        mobj_t *mo = origin;
        e->origin = (uint32_t) (uintptr_t) origin;
        e->x = mo->x;
        e->y = mo->y;
        e->z = mo->z;
        if (!InSectors(origin) && mo->player != NULL)
            e->player = (int8_t) (mo->player - players);
    }
    return e;
}

static void LumpName(char *dst, const char *prefix, const char *name)
{
    char buf[16];
    int i;

    M_snprintf(buf, sizeof(buf), "%s%s", prefix, name);
    for (i = 0; i < 8; i++)
        dst[i] = buf[i] >= 'a' && buf[i] <= 'z' ? buf[i] - 32 : buf[i];
}

void I_SoundEvent(void *origin, int sfx_id)
{
    sfxinfo_t *sfx;
    int volume = 127;
    record_t *e;

    if (sfx_id < 1 || sfx_id >= NUMSFX)
        return;                 // StartSound reports it
    sfx = &S_sfx[sfx_id];
    if (sfx->link)
    {
        // a variant of another sound: its data, at an adjusted volume
        volume += sfx->volume;
        if (volume < 1)
            return;
        if (volume > 127)
            volume = 127;
        sfx = sfx->link;
    }
    if ((e = NewEvent(2, origin)) == NULL)
        return;
    e->volume = volume;
    LumpName(e->name, "ds", DEH_String(sfx->name));
}

void I_StopSoundEvent(void *origin)
{
    NewEvent(3, origin);
}

// Finishes the output of a step (or of init): the music record first,
// then the sounds. Output is written here, never when it is read, so a
// peer that reads it stays in the same state as one that does not.
static void FinishOutput(void)
{
    record_t *e = &events[0];
    int i;

    memset(e, 0, sizeof(*e));
    e->kind = 1;
    e->player = paused ? 1 : 0;
    for (i = 1; i < NUMMUSIC && machine_song != NULL; i++)
        if (S_music[i].handle == machine_song)
        {
            LumpName(e->name, "d_", DEH_String(S_music[i].name));
            e->volume = machine_song_loops;
            break;
        }
    output.events_len = numevents * sizeof(record_t);
    output.events = (const uint8_t *) events;
}

EXPORT const machine_output_t *machine_output(void)
{
    return &output;
}

// ---------------------------------------------------------------------

EXPORT void machine_step(void)
{
    int i;

    numevents = 1;              // events[0] is the music record
    for (i = 0; i < MAXPLAYERS; i++)
    {
        byte *in = input + i * INPUT_BYTES;
        ticcmd_t *cmd = &cmds[i];

        memset(cmd, 0, sizeof(*cmd));
        cmd->forwardmove = (signed char) in[0];
        cmd->sidemove = (signed char) in[1];
        cmd->angleturn = (short) (in[2] | (in[3] << 8));
        cmd->buttons = in[4];
        cmd->chatchar = in[5];
        // Saving to a file is not something a machine does: its snapshots
        // are its saves. The save button is dropped; pause stays.
        if ((cmd->buttons & BT_SPECIAL)
         && (cmd->buttons & BT_SPECIALMASK) == BTS_SAVEGAME)
            cmd->buttons = 0;
    }
    // The step consumes its input: the state after it holds what the game
    // made of the input (each player's cmd), not the bytes that came in.
    memset(input, 0, sizeof(input));
    netcmds = cmds;
    G_Ticker();
    gametic++;
    FinishOutput();
}

// ---------------------------------------------------------------------
// Frame: what player `view` sees, as D_Display draws it: the 3D view, the
// status bar and messages, or the intermission or finale. The host calls
// this on a copy of the state (ENGINE.md), since drawing writes memory.

static machine_frame_t frame;

EXPORT const machine_frame_t *machine_frame(int32_t view)
{
    byte *rgba;
    int i;

    if (view >= 0 && view < MAXPLAYERS && playeringame[view]
     && view != consoleplayer)
    {
        consoleplayer = displayplayer = view;
        if (gamestate == GS_LEVEL)
        {
            ST_Start();         // the status bar and messages follow
            HU_Start();         // consoleplayer
        }
    }
    D_Display();

    rgba = Z_Malloc(SCREENWIDTH * SCREENHEIGHT * 4, PU_STATIC, NULL);
    for (i = 0; i < SCREENWIDTH * SCREENHEIGHT; i++)
    {
        byte *c = machine_palette + I_VideoBuffer[i] * 3;
        rgba[i * 4] = c[0];
        rgba[i * 4 + 1] = c[1];
        rgba[i * 4 + 2] = c[2];
        rgba[i * 4 + 3] = 255;
    }
    frame.width = SCREENWIDTH;
    frame.height = SCREENHEIGHT;
    frame.rgba = rgba;
    return &frame;
}

// ---------------------------------------------------------------------
// The trace hashes of patch 0001 (all, strict, then the ten sections), to
// compare with native Chocolate Doom. They stamp ids on mobjs, so the host
// calls this on a copy too.

EXPORT const uint64_t *doom_trace(void)
{
    return TRACE_Hashes();
}
