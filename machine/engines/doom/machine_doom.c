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

// The screen as RGBA, through the palette the game last set.
static const machine_frame_t *Picture(void)
{
    byte *rgba;
    int i;

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

EXPORT const machine_frame_t *machine_frame(int32_t view)
{
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
    return Picture();
}

// A camera anywhere in the level: eyes at x, y, z (16.16 map units, z
// absolute) looking along angle (Doom's binary angle: 2^32 is a turn,
// counterclockwise from east). Doom's renderer draws from a player, so the
// camera is a player of its own, holding no weapon, its body nowhere in
// the level's lists, on the copy; the view fills the screen (no status
// bar) and the palette is the plain one (no player's damage or pickup
// tint). Doom has no pitch: its renderer cannot look up or down. Outside
// a level there is nothing to look at, and the frame is 0 by 0.

EXPORT const machine_frame_t *doom_camera(int32_t x, int32_t y, int32_t z, uint32_t angle)
{
    mobj_t body;
    player_t eye;

    if (gamestate != GS_LEVEL)
    {
        frame.width = frame.height = 0;
        frame.rgba = NULL;
        return &frame;
    }
    memset(&body, 0, sizeof(body));
    memset(&eye, 0, sizeof(eye));
    body.x = x;
    body.y = y;
    body.z = z;
    body.angle = angle;
    body.subsector = R_PointInSubsector(x, y);  // whose light the weapon would take
    eye.mo = &body;
    eye.viewz = z;
    R_SetViewSize(11, detailLevel);
    R_ExecuteSetViewSize();
    I_SetPalette(W_CacheLumpName(DEH_String("PLAYPAL"), PU_CACHE));
    R_RenderPlayerView(&eye);
    return Picture();
}

// ---------------------------------------------------------------------
// Queries: the current state, read for a host's views of it (a map, the
// level's geometry with its things in it). Each kind is an array of
// little-endian records, documented in ENGINE.md:
//
//   0 level     one record: where the game is
//   1 players   MAXPLAYERS records: each player's body, eyes and state
//   2 things    every mobj, in thinker order
//   3 sectors   every sector, in the map's order: heights, flats, light
//   4 sides     every sidedef, in the map's order: textures and offsets
//
// The records are made here, in the zone, so the host calls this on a copy
// of the state, as it does a frame.

enum { QUERY_LEVEL, QUERY_PLAYERS, QUERY_THINGS, QUERY_SECTORS, QUERY_SIDES };

typedef struct
{
    uint8_t gamestate;          // 0 level, 1 intermission, 2 finale, 3 demo screen
    uint8_t skill;              // 0-4
    uint8_t episode, map;
    uint8_t paused, deathmatch; // deathmatch: 0, 1, or 2 (altdeath)
    uint8_t ingame;             // bit p: player p is in the game
    uint8_t pad;
    uint32_t leveltime;         // tics in this level
    uint32_t gametic;
} level_record_t;

typedef struct
{
    uint32_t thing;             // its body (a things record's id), 0 if none
    int32_t x, y, z;            // the eyes: the body's x, y and the view height
    uint32_t angle;
    int32_t health, armor;
    uint8_t ingame;
    uint8_t state;              // 0 alive, 1 dead, 2 respawning
    uint8_t weapon;             // readyweapon
    uint8_t extralight;         // a weapon's flash
} player_record_t;

typedef struct
{
    uint32_t id;                // stable while the thing exists; sound events' origin
    int32_t x, y, z;
    uint32_t angle;
    int32_t radius, height;
    uint32_t flags;             // mobj flags (p_mobj.h)
    int32_t health;
    uint16_t type;              // mobjtype_t
    int16_t doomednum;          // the map's thing type, -1 for none
    char sprite[4];
    uint16_t frame;             // the frame's letter index, | 0x8000 if fullbright
    int8_t player;              // whose body it is, or -1
    uint8_t pad;
} thing_record_t;

typedef struct
{
    int32_t floor, ceiling;
    char floorpic[8], ceilingpic[8];
    int16_t light, special, tag, pad;
} sector_record_t;

typedef struct
{
    int32_t xoffset, yoffset;   // texture offsets, 16.16
    char top[8], middle[8], bottom[8];  // "" for none
} side_record_t;

// r_data.c's texture_t begins with its name, the only field read here.
typedef struct { char name[8]; } texture_name_t;
extern texture_name_t **textures;
extern int numtextures;

static machine_query_t query;

static void *Records(int count, int size)
{
    query.len = count * size;
    query.bytes = Z_Malloc(count * size + 1, PU_STATIC, NULL);
    memset((void *) query.bytes, 0, count * size);
    return (void *) query.bytes;
}

static void TextureName(char *dst, int texture)
{
    if (texture > 0 && texture < numtextures)
        memcpy(dst, textures[texture]->name, 8);
}

static boolean IsThing(thinker_t *th)
{
    return th->function.acp1 == (actionf_p1) P_MobjThinker;
}

EXPORT const machine_query_t *machine_query(uint32_t kind)
{
    thinker_t *th;
    int i, n;

    switch (kind)
    {
    case QUERY_LEVEL:
    {
        level_record_t *r = Records(1, sizeof(*r));
        r->gamestate = gamestate;
        r->skill = gameskill;
        r->episode = gameepisode;
        r->map = gamemap;
        r->paused = paused;
        r->deathmatch = deathmatch;
        for (i = 0; i < MAXPLAYERS; i++)
            r->ingame |= (playeringame[i] != 0) << i;
        r->leveltime = leveltime;
        r->gametic = gametic;
        break;
    }
    case QUERY_PLAYERS:
    {
        player_record_t *r = Records(MAXPLAYERS, sizeof(*r));
        for (i = 0; i < MAXPLAYERS; i++, r++)
        {
            player_t *p = &players[i];
            r->ingame = playeringame[i] != 0;
            r->state = p->playerstate;
            r->weapon = p->readyweapon;
            r->extralight = p->extralight;
            r->health = p->health;
            r->armor = p->armorpoints;
            if (p->mo != NULL)
            {
                r->thing = (uint32_t) (uintptr_t) p->mo;
                r->x = p->mo->x;
                r->y = p->mo->y;
                r->z = p->viewz;
                r->angle = p->mo->angle;
            }
        }
        break;
    }
    case QUERY_THINGS:
    {
        thing_record_t *r;
        n = 0;
        for (th = thinkercap.next; th != &thinkercap; th = th->next)
            n += IsThing(th);
        r = Records(n, sizeof(*r));
        for (th = thinkercap.next; th != &thinkercap; th = th->next)
        {
            mobj_t *mo = (mobj_t *) th;
            if (!IsThing(th))
                continue;
            r->id = (uint32_t) (uintptr_t) mo;
            r->x = mo->x;
            r->y = mo->y;
            r->z = mo->z;
            r->angle = mo->angle;
            r->radius = mo->radius;
            r->height = mo->height;
            r->flags = mo->flags;
            r->health = mo->health;
            r->type = mo->type;
            r->doomednum = mo->info->doomednum;
            memcpy(r->sprite, sprnames[mo->sprite], 4);
            r->frame = mo->frame;
            r->player = mo->player != NULL ? mo->player - players : -1;
            r++;
        }
        break;
    }
    case QUERY_SECTORS:
    {
        sector_record_t *r = Records(numsectors, sizeof(*r));
        for (i = 0; i < numsectors; i++, r++)
        {
            sector_t *s = &sectors[i];
            r->floor = s->floorheight;
            r->ceiling = s->ceilingheight;
            memcpy(r->floorpic, lumpinfo[firstflat + s->floorpic]->name, 8);
            memcpy(r->ceilingpic, lumpinfo[firstflat + s->ceilingpic]->name, 8);
            r->light = s->lightlevel;
            r->special = s->special;
            r->tag = s->tag;
        }
        break;
    }
    case QUERY_SIDES:
    {
        side_record_t *r = Records(numsides, sizeof(*r));
        for (i = 0; i < numsides; i++, r++)
        {
            side_t *s = &sides[i];
            r->xoffset = s->textureoffset;
            r->yoffset = s->rowoffset;
            TextureName(r->top, s->toptexture);
            TextureName(r->middle, s->midtexture);
            TextureName(r->bottom, s->bottomtexture);
        }
        break;
    }
    default:
        return NULL;
    }
    return &query;
}

// ---------------------------------------------------------------------
// The trace hashes of patch 0001 (all, strict, then the ten sections), to
// compare with native Chocolate Doom. They stamp ids on mobjs, so the host
// calls this on a copy too.

EXPORT const uint64_t *doom_trace(void)
{
    return TRACE_Hashes();
}
