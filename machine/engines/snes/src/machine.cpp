// A Super NES as a machine engine (../../machine.h): MesenCE's SNES core,
// stepped one video frame at a time.
//
// Content is a ROM image (any SNES cartridge; a 512-byte copier header is
// fine). There are five pads, two bytes each: port 1 holds pad 0, and a
// multitap in port 2 holds pads 1-4, so two-player games see pads 0 and 1
// and multitap games see up to five. Each pad is the hardware's 16-bit
// report, little-endian:
//
//   bit 0 B, 1 Y, 2 Select, 3 Start, 4 Up, 5 Down, 6 Left, 7 Right,
//       8 A, 9 X, 10 L, 11 R  (12-15 unused)
//
// A step sets the pads, then runs the console until the PPU starts its next
// vertical blank. The auto-joypad read happens just after that point, so a
// step's pads are what the game reads during that step. The step's audio is
// the DSP's output during it, stereo at 32000 Hz (Mesen's SPC clock); the
// frame is the last one the PPU finished.
#include "pch.h"
#include "SNES/SnesConsole.h"
#include "SNES/SnesPpu.h"
#include "SNES/SnesPpuTypes.h"
#include "SNES/Spc.h"
#include "Shared/Emulator.h"
#include "Shared/BaseControlManager.h"
#include "Shared/BaseControlDevice.h"
#include "Shared/IControllerHub.h"
#include "Shared/Interfaces/IInputProvider.h"
#include "SNES/Input/SnesController.h"
#include "Utilities/VirtualFile.h"
#include "host.h"
extern "C" {
#include "../../machine.h"
}

enum { PADS = 5, PAD_BYTES = 2, MAX_AUDIO = 4096, MAX_W = 512, MAX_H = 478 };

// NTSC: Mesen's master clock over the average frame (262 lines of 1364
// clocks, every other frame 4 clocks short).
static const machine_info_t info = { 21477270, 357366, PADS, PAD_BYTES };

static uint8_t* content;
static uint32_t contentLength;
static uint8_t input[PADS * PAD_BYTES];

static Emulator* emu;
static SnesConsole* console;

static float audio[MAX_AUDIO * 2];
static machine_output_t output;

static const uint16_t* picture; // the PPU's last finished frame
static uint32_t pictureWidth, pictureHeight;
static uint8_t rgba[MAX_W * MAX_H * 4];
static machine_frame_t frame;

// Hardware order, bit i of the report = button order[i].
static const uint8_t order[12] = {
	SnesController::B, SnesController::Y, SnesController::Select, SnesController::Start,
	SnesController::Up, SnesController::Down, SnesController::Left, SnesController::Right,
	SnesController::A, SnesController::X, SnesController::L, SnesController::R,
};

static void setPad(BaseControlDevice* pad, int i)
{
	uint16_t report = input[i * 2] | (input[i * 2 + 1] << 8);
	for(int bit = 0; bit < 12; bit++) {
		pad->SetBitValue(order[bit], (report >> bit) & 1);
	}
}

// Mesen asks every input provider to fill each device whenever it polls.
static class Pads : public IInputProvider
{
public:
	bool SetInput(BaseControlDevice* device) override
	{
		if(device->GetPort() == 0) {
			setPad(device, 0);
			return true;
		}
		if(device->GetPort() == 1) {
			IControllerHub* hub = dynamic_cast<IControllerHub*>(device);
			for(int i = 0; hub && i < hub->GetHubPortCount() && 1 + i < PADS; i++) {
				setPad(hub->GetController(i).get(), 1 + i);
			}
			return true;
		}
		return false;
	}
} pads;

void host_audio(const int16_t* samples, uint32_t count, uint32_t rate)
{
	output.rate = rate;
	for(uint32_t i = 0; i < count && output.count < MAX_AUDIO; i++, output.count++) {
		audio[output.count * 2] = samples[i * 2] / 32768.0f;
		audio[output.count * 2 + 1] = samples[i * 2 + 1] / 32768.0f;
	}
}

void host_frame(const uint16_t* pixels, uint32_t width, uint32_t height)
{
	picture = pixels;
	pictureWidth = width;
	pictureHeight = height;
}

extern "C" {

MACHINE_EXPORT const machine_info_t* machine_info(void) { return &info; }

MACHINE_EXPORT uint8_t* machine_content(uint32_t length)
{
	free(content);
	content = (uint8_t*)malloc(length ? length : 1);
	contentLength = length;
	return content;
}

MACHINE_EXPORT int32_t machine_init(void)
{
	emu = new Emulator();
	console = new SnesConsole(emu);
	host_attach(console);
	VirtualFile rom(content, contentLength, "content.sfc");
	free(content);
	content = nullptr;
	if(console->LoadRom(rom) != LoadRomResult::Success) {
		return 1;
	}
	BaseControlManager* controls = console->GetControlManager();
	controls->RegisterInputProvider(&pads);
	controls->UpdateControlDevices();
	output = { Spc::SpcSampleRate, 2, 0, audio, 0, nullptr };
	frame = { 0, 0, rgba };
	return 0;
}

MACHINE_EXPORT uint8_t* machine_input(void) { return input; }

MACHINE_EXPORT void machine_step(void)
{
	output.count = 0;
	console->GetControlManager()->UpdateInputState();
	console->RunFrame();
}

MACHINE_EXPORT const machine_output_t* machine_output(void) { return &output; }

// The last finished frame as RGBA. 256 wide (512 in hi-res modes); 224
// lines, or 239 when the game turns on overscan (twice that interlaced).
// view is ignored: everyone sees the same screen.
MACHINE_EXPORT const machine_frame_t* machine_frame(int32_t view)
{
	(void)view;
	if(!picture) {
		frame.width = frame.height = 0;
		return &frame;
	}
	uint32_t scale = pictureHeight > 239 ? 2 : 1;
	bool overscan = console->GetPpu()->GetState().OverscanMode;
	uint32_t top = overscan ? 0 : 7 * scale;
	uint32_t height = overscan ? pictureHeight : 224 * scale;
	frame.width = pictureWidth;
	frame.height = height;
	uint8_t* out = rgba;
	for(uint32_t y = 0; y < height; y++) {
		const uint16_t* row = picture + (top + y) * pictureWidth;
		for(uint32_t x = 0; x < pictureWidth; x++) {
			uint16_t c = row[x];
			uint8_t r = c & 0x1F, g = (c >> 5) & 0x1F, b = (c >> 10) & 0x1F;
			*out++ = (r << 3) | (r >> 2);
			*out++ = (g << 3) | (g >> 2);
			*out++ = (b << 3) | (b >> 2);
			*out++ = 255;
		}
	}
	return &frame;
}

}
