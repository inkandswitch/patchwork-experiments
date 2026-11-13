// What host.cpp (Mesen's frontend, cut down) hands to machine.cpp.
#pragma once
#include <stdint.h>

class SnesConsole;

void host_attach(SnesConsole* console);
// One batch of the DSP's stereo samples (count frames) at rate Hz.
void host_audio(const int16_t* samples, uint32_t count, uint32_t rate);
// The PPU finished a frame: RGB555 pixels, width x height (256x239 or 512x478).
void host_frame(const uint16_t* pixels, uint32_t width, uint32_t height);
