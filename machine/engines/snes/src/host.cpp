// The parts of Mesen's frontend that its SNES core calls, cut down to what a
// deterministic machine needs. Mesen's own Emulator runs the console on a
// thread and has a frame limiter, rewind, movies, netplay, a debugger and
// file I/O around it; none of that is compiled. What the core reaches for is
// defined here instead:
//
//   - kept: settings (fixed at boot), the memory registry, cheats (none),
//     the system device (reset/power buttons, never pressed).
//   - redirected: audio and the finished frame go to the machine's output
//     buffers (machine.cpp).
//   - absent: files, batteries, MSU-1 tracks and firmware read as missing;
//     the clock never runs; the debugger is never attached.
//
// Anything the core can only reach through a feature that is absent traps
// (UNREACHABLE), so a ROM that needs it faults instead of silently diverging.
#include "pch.h"
#include "Shared/Emulator.h"
#include "Shared/EmuSettings.h"
#include "Shared/SettingTypes.h"
#include "Shared/BatteryManager.h"
#include "Shared/CheatManager.h"
#include "Shared/NotificationManager.h"
#include "Shared/RewindManager.h"
#include "Shared/MessageManager.h"
#include "Shared/KeyManager.h"
#include "Shared/InputHud.h"
#include "Shared/SystemActionManager.h"
#include "Shared/Audio/SoundMixer.h"
#include "Shared/Audio/PcmReader.h"
#include "Shared/Video/VideoDecoder.h"
#include "Shared/Video/VideoRenderer.h"
#include "Shared/Video/BaseVideoFilter.h"
#include "Shared/RenderedFrame.h"
// Complete types for the members of Emulator and of the classes constructed
// below, which their constructors need; nothing from these is called.
#include "Shared/Video/DebugHud.h"
#include "Shared/Video/DebugStats.h"
#include "Shared/Video/ScaleFilter.h"
#include "Shared/Video/RotateFilter.h"
#include "Shared/Video/SystemHud.h"
#include "Shared/Audio/AudioPlayerHud.h"
#include "Shared/Audio/WaveRecorder.h"
#include "Shared/Audio/SoundResampler.h"
#include "Shared/SaveStateManager.h"
#include "Shared/Movies/MovieManager.h"
#include "Shared/HistoryViewer.h"
#include "Shared/FrameLimiter.h"
#include "Shared/DebuggerRequest.h"
#include "Debugger/DebugBreakHelper.h"
#include "Utilities/Audio/Equalizer.h"
#include "Utilities/Audio/CrossFeedFilter.h"
#include "Utilities/Audio/ReverbFilter.h"
#include "Utilities/Video/IVideoRecorder.h"
#include "Debugger/Debugger.h"
#include "SNES/Debugger/SnesPpuTools.h"
#include "SNES/Debugger/DummyArmV3Cpu.h"
#include "GBA/GbaCpu.h"
#include "Shared/EmulatorLock.h"
#include "Utilities/VirtualFile.h"
#include "Utilities/FolderUtilities.h"
#include "Utilities/ArchiveReader.h"
#include "Utilities/Serializer.h"
#include "Utilities/Timer.h"
#include "Utilities/Patches/IpsPatcher.h"
#include "Utilities/Audio/HermiteResampler.h"
#include "Utilities/NTSC/snes_ntsc.h"
#include "SNES/SnesConsole.h"
#include "host.h"

#define UNREACHABLE __builtin_trap()

// ---------------------------------------------------------------- Emulator

static SnesConsole* console;

Emulator::Emulator()
	: _settings(new EmuSettings(this)),
	  _notificationManager(new NotificationManager()),
	  _batteryManager(new BatteryManager()),
	  _soundMixer(new SoundMixer(this)),
	  _videoRenderer(new VideoRenderer(this)),
	  _videoDecoder(new VideoDecoder(this)),
	  _cheatManager(new CheatManager(this)),
	  _rewindManager(new RewindManager(this))
{
	_systemActionManager.reset(new SystemActionManager(this));
	_isRunAheadFrame = false;
	_paused = false;
	_stopFlag = false;
	_consoleType = ConsoleType::Snes;
}

void host_attach(SnesConsole* c) { console = c; }

ConsoleType Emulator::GetConsoleType() { return ConsoleType::Snes; }
uint32_t Emulator::GetFrameCount() { return console ? console->GetFrameCount() : 0; }
void Emulator::ProcessEndOfFrame() {}
void Emulator::ProcessEvent(EventType, std::optional<CpuType>) {}
void Emulator::BreakIfDebugging(CpuType, BreakSource) {}

void Emulator::RegisterMemory(MemoryType type, void* memory, uint32_t size)
{
	_consoleMemory[(int)type] = { memory, size };
}

ConsoleMemoryInfo Emulator::GetMemory(MemoryType type)
{
	return _consoleMemory[(int)type];
}

// Only reached for SPC music files (playlists, reset); content is one ROM.
bool Emulator::LoadRom(VirtualFile, VirtualFile, bool, bool) { UNREACHABLE; }
void Emulator::ReloadRom(bool) { UNREACHABLE; }

// Only reached by the Game Boy core, which runs only inside a Super Game
// Boy, which needs a BIOS file that is never there.
shared_ptr<IConsole> Emulator::GetConsole() { UNREACHABLE; }
uint64_t Emulator::GetMasterClock() { UNREACHABLE; }
uint32_t Emulator::GetMasterClockRate() { UNREACHABLE; }
EmulatorLock Emulator::AcquireLock(bool) { UNREACHABLE; }
EmulatorLock::~EmulatorLock() { UNREACHABLE; }
void Emulator::SetDebuggerDisabled(bool) { UNREACHABLE; }
vector<InternalCheatCode>& CheatManager::GetRamRefreshCheats(CpuType) { UNREACHABLE; }

// The debugger is never attached (_internalDebugger stays null), so the
// core's hooks test a null pointer and go on. These are only their link-time
// definitions, for the instantiations the SNES core and coprocessors use.
template<CpuType t> void Debugger::ProcessInstruction() { UNREACHABLE; }
template<CpuType t, uint8_t w, MemoryAccessFlags f, typename T> void Debugger::ProcessMemoryRead(uint32_t, T&, MemoryOperationType) { UNREACHABLE; }
template<CpuType t, uint8_t w, MemoryAccessFlags f, typename T> bool Debugger::ProcessMemoryWrite(uint32_t, T&, MemoryOperationType) { UNREACHABLE; }
template<CpuType t> void Debugger::ProcessIdleCycle() { UNREACHABLE; }
template<CpuType t> void Debugger::ProcessHaltedCpu() { UNREACHABLE; }
template<CpuType t, typename T> void Debugger::ProcessPpuRead(uint16_t, T&, MemoryType, MemoryOperationType) { UNREACHABLE; }
template<CpuType t, typename T> void Debugger::ProcessPpuWrite(uint16_t, T&, MemoryType) { UNREACHABLE; }
template<CpuType t> void Debugger::ProcessPpuCycle() { UNREACHABLE; }
template<CpuType t> void Debugger::ProcessInterrupt(uint32_t, uint32_t, bool) { UNREACHABLE; }
void Debugger::Log(string) { UNREACHABLE; }
// Emulator's safe_ptr<Debugger> names ~Debugger, though no Debugger is ever
// made. Defining it in C++ would need every debugger type complete, so it is
// defined by its linkage name instead.
extern "C" void* debuggerDestructor(void*) __asm__("_ZN8DebuggerD1Ev");
extern "C" void* debuggerDestructor(void*) { UNREACHABLE; }
PpuTools* Debugger::GetPpuTools(CpuType) { UNREACHABLE; }

#define RW(t, w, f, T) \
	template void Debugger::ProcessMemoryRead<CpuType::t, w, MemoryAccessFlags::f, T>(uint32_t, T&, MemoryOperationType); \
	template bool Debugger::ProcessMemoryWrite<CpuType::t, w, MemoryAccessFlags::f, T>(uint32_t, T&, MemoryOperationType);
RW(Snes, 1, None, uint8_t)
RW(Spc, 1, None, uint8_t)
RW(Spc, 1, DspAccess, uint8_t)
RW(NecDsp, 1, None, uint16_t)
RW(NecDsp, 1, None, uint32_t)
RW(Sa1, 1, None, uint8_t)
RW(Gsu, 1, None, uint8_t)
RW(Cx4, 1, None, uint8_t)
RW(St018, 1, None, uint32_t)
RW(St018, 4, None, uint32_t)
RW(Gameboy, 1, None, uint8_t)
#undef RW
template void Debugger::ProcessInstruction<CpuType::Snes>();
template void Debugger::ProcessInstruction<CpuType::Spc>();
template void Debugger::ProcessInstruction<CpuType::NecDsp>();
template void Debugger::ProcessInstruction<CpuType::Sa1>();
template void Debugger::ProcessInstruction<CpuType::Gsu>();
template void Debugger::ProcessInstruction<CpuType::Cx4>();
template void Debugger::ProcessInstruction<CpuType::St018>();
template void Debugger::ProcessIdleCycle<CpuType::Snes>();
template void Debugger::ProcessIdleCycle<CpuType::Sa1>();
template void Debugger::ProcessHaltedCpu<CpuType::Snes>();
template void Debugger::ProcessHaltedCpu<CpuType::Sa1>();
template void Debugger::ProcessInterrupt<CpuType::Snes>(uint32_t, uint32_t, bool);
template void Debugger::ProcessInterrupt<CpuType::Sa1>(uint32_t, uint32_t, bool);
template void Debugger::ProcessPpuRead<CpuType::Snes, uint8_t>(uint16_t, uint8_t&, MemoryType, MemoryOperationType);
template void Debugger::ProcessPpuWrite<CpuType::Snes, uint8_t>(uint16_t, uint8_t&, MemoryType);
template void Debugger::ProcessPpuCycle<CpuType::Snes>();
template void Debugger::ProcessInstruction<CpuType::Gameboy>();
template void Debugger::ProcessPpuCycle<CpuType::Gameboy>();
template void Debugger::ProcessHaltedCpu<CpuType::Gameboy>();
template void Debugger::ProcessInterrupt<CpuType::Gameboy>(uint32_t, uint32_t, bool);
template void Debugger::ProcessPpuRead<CpuType::Gameboy, uint8_t>(uint16_t, uint8_t&, MemoryType, MemoryOperationType);
template void Debugger::ProcessPpuWrite<CpuType::Gameboy, uint8_t>(uint16_t, uint8_t&, MemoryType);

void SnesPpuTools::SetPpuScanlineState(uint16_t, uint8_t, int, int, int, int) { UNREACHABLE; }
void SnesPpuTools::SetPpuRowBuffers(uint16_t, uint16_t, uint16_t, uint16_t*, uint16_t*) { UNREACHABLE; }
// The ST-018 sets up its ARM core's tables (compiled, real) and also those of
// the debugger's dummy ARM and of the GBA's CPU, neither of which runs here.
void DummyArmV3Cpu::StaticInit() {}
void GbaCpu::StaticInit() {}

// ---------------------------------------------------------------- settings

// The configuration is fixed: it is part of what the engine is, not a choice
// a peer makes. NTSC timing, all-zero power-on RAM, every pad a standard
// controller, a multitap in port 2, no frame skipping.
EmuSettings::EmuSettings(Emulator* emu) : _emu(emu), _mt() // std::mt19937's fixed default seed
{
	_flags = 0;
	_debuggerFlags = 0;
	_emulation.EmulationSpeed = 100;
	_snes.Region = ConsoleRegion::Ntsc;
	_snes.RamPowerOnState = RamState::AllZeros;
	_snes.EnableRandomPowerOnState = false;
	_snes.DisableFrameSkipping = true;
	_snes.AllowInvalidInput = true; // a pad reports what is held, as hardware does
	_snes.Port1.Type = ControllerType::SnesController;
	_snes.Port2.Type = ControllerType::Multitap;
	for(ControllerConfig& c : _snes.Port2SubPorts) {
		c.Type = ControllerType::SnesController;
	}
}

SnesConfig& EmuSettings::GetSnesConfig() { return _snes; }
void EmuSettings::SetSnesConfig(SnesConfig& config) { _snes = config; }
VideoConfig& EmuSettings::GetVideoConfig() { return _video; }
InputConfig& EmuSettings::GetInputConfig() { return _input; }
NesConfig& EmuSettings::GetNesConfig() { return _nes; }
GameboyConfig& EmuSettings::GetGameboyConfig() { return _gameboy; }
PcEngineConfig& EmuSettings::GetPcEngineConfig() { return _pce; }
uint32_t EmuSettings::GetEmulationSpeed() { return _emulation.EmulationSpeed; }
bool EmuSettings::IsInputEnabled() { return true; }

// As Mesen's, but the generator is in memory with a fixed seed, so even a
// cartridge that asks for random RAM (the core special-cases one) gets the
// same bytes on every peer.
void EmuSettings::InitializeRam(RamState state, void* data, uint32_t length)
{
	switch(state) {
		default:
		case RamState::AllZeros: memset(data, 0, length); break;
		case RamState::AllOnes: memset(data, 0xFF, length); break;
		case RamState::Random:
			std::uniform_int_distribution<uint64_t> dist(0, std::numeric_limits<uint64_t>::max());
			uint32_t i = 0;
			while(i < length) {
				uint64_t randomData = dist(_mt);
				for(int j = 0; j < 8 && i < length; j++) {
					((uint8_t*)data)[i] = (uint8_t)(randomData >> (8 * j));
					i++;
				}
			}
			break;
	}
}

int EmuSettings::GetRandomValue(int maxValue)
{
	std::uniform_int_distribution<> dist(0, maxValue);
	return dist(_mt);
}

bool EmuSettings::GetRandomBool() { return GetRandomValue(1) == 1; }
void EmuSettings::Serialize(Serializer&) { UNREACHABLE; }

// ---------------------------------------------------------------- outputs

SoundMixer::SoundMixer(Emulator* emu) : _emu(emu) {}
void SoundMixer::PlayAudioBuffer(int16_t* samples, uint32_t sampleCount, uint32_t sourceRate)
{
	host_audio(samples, sampleCount, sourceRate);
}
void SoundMixer::StopAudio(bool) {}
WaveRecorder::~WaveRecorder() { UNREACHABLE; }
void SoundMixer::RegisterAudioProvider(IAudioProvider*) {}
void SoundMixer::UnregisterAudioProvider(IAudioProvider*) {}

VideoDecoder::VideoDecoder(Emulator* emu) : _emu(emu) {}
void VideoDecoder::UpdateFrame(RenderedFrame frame, bool, bool)
{
	host_frame((const uint16_t*)frame.FrameBuffer, frame.Width, frame.Height);
}

VideoRenderer::VideoRenderer(Emulator* emu) : _emu(emu) {}
bool VideoRenderer::IsRecording() { return false; }

// Never rewinds; it is never registered as a listener, provider or recorder.
RewindManager::RewindManager(Emulator* emu) : _emu(emu) {}
RewindManager::~RewindManager() { UNREACHABLE; }
bool RewindManager::IsRewinding() { return false; }
void RewindManager::ProcessNotification(ConsoleNotificationType, void*) { UNREACHABLE; }
void RewindManager::RecordInput(vector<shared_ptr<BaseControlDevice>>) { UNREACHABLE; }
bool RewindManager::SetInput(BaseControlDevice*) { UNREACHABLE; }

void NotificationManager::SendNotification(ConsoleNotificationType, void*) {}

CheatManager::CheatManager(Emulator* emu) : _emu(emu) {}
void CheatManager::RefreshRamCheats(CpuType) {}
// No cheats are ever added, so HasCheats() is false and this is never called.
template<CpuType t> void CheatManager::ApplyCheat(uint32_t, uint8_t&) { UNREACHABLE; }
template void CheatManager::ApplyCheat<CpuType::Snes>(uint32_t, uint8_t&);
template void CheatManager::ApplyCheat<CpuType::Gameboy>(uint32_t, uint8_t&);

// No battery files: save RAM starts at its power-on state and is never written out.
void BatteryManager::Initialize(string, bool) {}
vector<uint8_t> BatteryManager::LoadBattery(string) { return {}; }
void BatteryManager::LoadBattery(string, uint8_t*, uint32_t) {}
void BatteryManager::SaveBattery(string, uint8_t*, uint32_t) {}

void MessageManager::Log(string) {}
void MessageManager::DisplayMessage(string, string, string, string) {}

// Pads are set by the machine's input provider; no keyboard is ever pressed.
void KeyManager::RefreshKeyState() {}
bool KeyManager::IsKeyPressed(uint16_t) { return false; }
optional<int16_t> KeyManager::GetAxisPosition(uint16_t) { return std::nullopt; }
MouseMovement KeyManager::GetMouseMovement(Emulator*, uint32_t) { return {}; }
MousePosition KeyManager::GetMousePosition() { return {}; }
uint16_t KeyManager::GetKeyCode(string) { return 0; }
void KeyManager::SetForceFeedback(uint16_t, uint16_t) {}
void KeyManager::SetForceFeedback(uint16_t) {}

void InputHud::DrawButton(int, int, int, int, bool) { UNREACHABLE; }
void InputHud::DrawNumber(int, int, int) { UNREACHABLE; }
void InputHud::DrawOutline(int, int) { UNREACHABLE; }
void InputHud::DrawMousePosition(MousePosition) { UNREACHABLE; }
void InputHud::EndDrawController() { UNREACHABLE; }

// The core's video filters convert the frame for Mesen's renderer; the
// machine converts its own (machine_frame), so these are never constructed.
BaseVideoFilter::BaseVideoFilter(Emulator*) { UNREACHABLE; }
BaseVideoFilter::~BaseVideoFilter() { UNREACHABLE; }
void BaseVideoFilter::OnBeforeApplyFilter() { UNREACHABLE; }
FrameInfo BaseVideoFilter::GetFrameInfo() { UNREACHABLE; }
OverscanDimensions BaseVideoFilter::GetOverscan() { UNREACHABLE; }
uint32_t* BaseVideoFilter::GetOutputBuffer() { UNREACHABLE; }
bool BaseVideoFilter::IsOddFrame() { UNREACHABLE; }
void BaseVideoFilter::InitConversionMatrix(double, double) { UNREACHABLE; }
void BaseVideoFilter::ApplyColorOptions(uint8_t&, uint8_t&, uint8_t&, double, double) { UNREACHABLE; }
extern "C" {
void snes_ntsc_init(snes_ntsc_t*, snes_ntsc_setup_t const*) { UNREACHABLE; }
void snes_ntsc_blit(snes_ntsc_t const*, SNES_NTSC_IN_T const*, long, int, int, int, void*, long) { UNREACHABLE; }
void snes_ntsc_blit_hires(snes_ntsc_t const*, SNES_NTSC_IN_T const*, long, int, int, int, void*, long) { UNREACHABLE; }
}

// ---------------------------------------------------------------- files

// The only file is the content, which machine.cpp hands over as a buffer.
// Anything looked up by name (firmware, MSU-1 data, .bs packs, SPC
// playlists) is not there.
VirtualFile::VirtualFile() {}
VirtualFile::VirtualFile(const string&) {}
VirtualFile::VirtualFile(const string&, const string) {}
VirtualFile::VirtualFile(const void* buffer, size_t size, string fileName) : _path(fileName), _data((const uint8_t*)buffer, (const uint8_t*)buffer + size), _fileSize((int64_t)size) {}
VirtualFile::operator std::string() const { return _path; }
bool VirtualFile::IsValid() { return _fileSize >= 0; }
bool VirtualFile::IsArchive() { return false; }
string VirtualFile::GetFilePath() { return _path; }
string VirtualFile::GetFolderPath() { return ""; }
string VirtualFile::GetFileName() { return _path; }
size_t VirtualFile::GetSize() { return _fileSize < 0 ? 0 : (size_t)_fileSize; }
bool VirtualFile::ReadFile(vector<uint8_t>& out)
{
	if(!IsValid()) return false;
	out = _data;
	return true;
}
bool VirtualFile::ReadFile(uint8_t* out, uint32_t expectedSize)
{
	if(!IsValid() || _data.size() != expectedSize) return false;
	memcpy(out, _data.data(), expectedSize);
	return true;
}

string FolderUtilities::GetExtension(string filename)
{
	size_t dot = filename.find_last_of('.');
	string ext = dot == string::npos ? "" : filename.substr(dot);
	std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
	return ext;
}
string FolderUtilities::GetFilename(string filepath, bool includeExtension)
{
	if(includeExtension) return filepath;
	size_t dot = filepath.find_last_of('.');
	return dot == string::npos ? filepath : filepath.substr(0, dot);
}
string FolderUtilities::CombinePath(string folder, string filename) { return folder + "/" + filename; }
string FolderUtilities::GetHomeFolder() { return ""; }
string FolderUtilities::GetFirmwareFolder() { return ""; }
vector<string> FolderUtilities::GetFilesInFolder(string, std::unordered_set<string>, bool, int) { return {}; }
unique_ptr<ArchiveReader> ArchiveReader::GetReader(string) { return nullptr; }
vector<string> ArchiveReader::GetFileList(std::initializer_list<string>) { UNREACHABLE; }

// Satellaview memory packs need files that are never there.
vector<uint8_t> IpsPatcher::CreatePatch(vector<uint8_t>, vector<uint8_t>) { UNREACHABLE; }
bool IpsPatcher::PatchBuffer(vector<uint8_t>&, vector<uint8_t>&, vector<uint8_t>&) { UNREACHABLE; }

// MSU-1 is only created when its data file exists, which it never does.
PcmReader::PcmReader() { UNREACHABLE; }
PcmReader::~PcmReader() { UNREACHABLE; }
bool PcmReader::Init(string, bool, uint32_t) { UNREACHABLE; }
bool PcmReader::IsPlaybackOver() { UNREACHABLE; }
void PcmReader::SetSampleRate(uint32_t) { UNREACHABLE; }
void PcmReader::SetLoopFlag(bool) { UNREACHABLE; }
void PcmReader::ApplySamples(int16_t*, size_t, uint8_t) { UNREACHABLE; }
uint32_t PcmReader::GetOffset() { UNREACHABLE; }

// Never serialised: snapshots are the engine's memory, not Mesen's save states.
void Serializer::PushNamePrefix(const char*, int) { UNREACHABLE; }
void Serializer::PopNamePrefix() { UNREACHABLE; }
string Serializer::NormalizeName(const char*, int) { UNREACHABLE; }

// The clock never runs. With frame skipping off, nothing reads it to decide
// anything, and a wall clock would make two peers differ.
Timer::Timer() {}
void Timer::Reset() {}
double Timer::GetElapsedMS() const { return 0; }
