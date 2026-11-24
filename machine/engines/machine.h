/* The engine ABI: what a WASM module exports to be a machine engine.
   The contract, and why each rule is there, is in ../ENGINE.md. */
#ifndef MACHINE_H
#define MACHINE_H
#include <stdint.h>

#define MACHINE_EXPORT __attribute__((used, visibility("default")))

typedef struct {
  uint32_t hz_num, hz_den;   /* ticks per second, as a ratio */
  uint32_t players;          /* input ports */
  uint32_t input_bytes;      /* bytes per port per tick */
} machine_info_t;

typedef struct {
  uint32_t rate, channels, count;  /* count = frames of audio this tick */
  const float *samples;            /* count * channels, interleaved */
  uint32_t events_len;             /* this tick's events, engine-defined bytes */
  const uint8_t *events;
} machine_output_t;

typedef struct {
  uint32_t width, height;
  const uint8_t *rgba;             /* width * height * 4 */
} machine_frame_t;

typedef struct {
  uint32_t len;
  const uint8_t *bytes;            /* len bytes, engine-defined per kind */
} machine_query_t;

/* Required. */
const machine_info_t *machine_info(void);
int32_t machine_init(void);             /* 0 on success */
uint8_t *machine_input(void);           /* players * input_bytes, read by step */
void machine_step(void);

/* Optional. */
uint8_t *machine_content(uint32_t len); /* where the host copies the content in */
const machine_output_t *machine_output(void); /* the last step's; a pure read */
const machine_frame_t *machine_frame(int32_t view); /* may write memory */
const machine_query_t *machine_query(uint32_t kind); /* NULL: no such kind; may write memory */
const char *machine_fault(void);        /* why the last call trapped, NUL-terminated */

/* Imported: the content, read where the engine wants it, so that content
   the engine only consults (an IWAD) never enters memory or a snapshot.
   Pure functions of their arguments: the content never changes. */
#define MACHINE_IMPORT(name) __attribute__((import_module("machine"), import_name(name)))
MACHINE_IMPORT("content_size") uint32_t machine_content_size(void);
MACHINE_IMPORT("content_read") void machine_content_read(uint32_t offset, uint32_t len, void *dst);

#endif
