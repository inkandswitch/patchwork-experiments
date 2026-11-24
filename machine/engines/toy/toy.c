/* A toy engine: a few hundred bytes of state, an LCG, a heap that allocates
   and frees every tick, a function-local static, and an input bit that makes
   it allocate 128 KiB (so memory grows). Nothing here is meant to be fun;
   it is meant to put state everywhere a real engine keeps it. */
#include <stdlib.h>
#include <string.h>
#include "../machine.h"

#define PLAYERS 4
#define INPUT_BYTES 2
#define SIDE 16

enum { ALLOC = 1, FREE = 2, BIG = 0x80 };

typedef struct node {
  struct node *next;
  uint32_t size, sum;
  uint8_t data[];
} node_t;

static struct {
  uint32_t tick, seed;
  int32_t x[PLAYERS], y[PLAYERS];
  uint32_t score[PLAYERS];
  uint8_t grid[SIDE * SIDE];
  node_t *heap;
  uint32_t nodes, bytes;
} s;

static const machine_info_t info = { 35, 1, PLAYERS, INPUT_BYTES };
static uint8_t *content;
static uint32_t content_len;
static uint8_t input[PLAYERS * INPUT_BYTES];

static float audio[64];
static uint8_t events[PLAYERS];
static machine_output_t out;

static uint8_t pixels[SIDE * SIDE * 4];
static machine_frame_t frame;
static uint32_t frames_drawn; /* frame() writes memory: the host draws on a copy */

static uint32_t lcg(void) { return s.seed = s.seed * 1664525u + 1013904223u; }

static void push(uint32_t size) {
  node_t *n = malloc(sizeof(node_t) + size);
  n->size = size;
  n->sum = 0;
  for (uint32_t i = 0; i < size; i += 64) n->sum += n->data[i] = (uint8_t)lcg();
  n->next = s.heap;
  s.heap = n;
  s.nodes++;
  s.bytes += size;
}

static void pop(void) {
  node_t *n = s.heap;
  if (!n) return;
  s.heap = n->next;
  s.nodes--;
  s.bytes -= n->size;
  free(n);
}

MACHINE_EXPORT const machine_info_t *machine_info(void) { return &info; }

MACHINE_EXPORT uint8_t *machine_content(uint32_t len) {
  free(content);
  content_len = len;
  return content = malloc(len ? len : 1);
}

MACHINE_EXPORT int32_t machine_init(void) {
  memset(&s, 0, sizeof s);
  s.seed = 2166136261u;
  for (uint32_t i = 0; i < content_len; i++) s.seed = (s.seed ^ content[i]) * 16777619u;
  for (int i = 0; i < SIDE * SIDE; i++) s.grid[i] = (uint8_t)lcg();
  return 0;
}

MACHINE_EXPORT uint8_t *machine_input(void) { return input; }

MACHINE_EXPORT void machine_step(void) {
  static uint32_t odd; /* state a snapshot of "the variables" would forget */
  for (int p = 0; p < PLAYERS; p++) {
    int8_t dx = (int8_t)input[p * INPUT_BYTES];
    uint8_t buttons = input[p * INPUT_BYTES + 1];
    uint32_t before = s.score[p];
    s.x[p] = (s.x[p] + dx) & (SIDE - 1);
    s.y[p] = (s.y[p] + (int32_t)(lcg() >> 30) - 1) & (SIDE - 1);
    if (buttons & ALLOC) push(1 + lcg() % 400);
    if (buttons & FREE) pop();
    if (buttons & BIG) push(1 << 17);
    s.score[p] += s.grid[s.y[p] * SIDE + s.x[p]];
    events[p] = s.score[p] != before;
  }
  uint32_t sum = 0;
  for (node_t *n = s.heap; n; n = n->next) sum += n->sum;
  if (sum & 1) odd++;
  s.grid[lcg() % (SIDE * SIDE)] ^= content_len ? content[s.tick % content_len] : 0;
  s.grid[s.tick % (SIDE * SIDE)] += (uint8_t)(sum + odd);
  for (int i = 0; i < 64; i++) audio[i] = (float)((s.seed >> (i % 24)) & 0xff) / 255.0f - 0.5f;
  out = (machine_output_t){ 44100, 1, 64, audio, PLAYERS, events };
  s.tick++;
}

MACHINE_EXPORT const machine_output_t *machine_output(void) { return &out; }

MACHINE_EXPORT const machine_frame_t *machine_frame(int32_t view) {
  frames_drawn++;
  for (int i = 0; i < SIDE * SIDE; i++) {
    uint8_t v = s.grid[i];
    pixels[i * 4 + 0] = v;
    pixels[i * 4 + 1] = v >> 1;
    pixels[i * 4 + 2] = (uint8_t)frames_drawn;
    pixels[i * 4 + 3] = 255;
  }
  if (view >= 0 && view < PLAYERS) {
    uint8_t *px = &pixels[(s.y[view] * SIDE + s.x[view]) * 4];
    px[0] = px[1] = px[2] = 255;
  }
  frame = (machine_frame_t){ SIDE, SIDE, pixels };
  return &frame;
}
