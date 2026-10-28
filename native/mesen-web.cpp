// SPDX-License-Identifier: GPL-3.0-or-later
// Single-threaded browser frontend for the pinned MesenCE Libretro core.
#include "Libretro/libretro.cpp"
#include "Core/NES/BaseNesPpu.h"
#include "Core/SNES/SnesMemoryManager.h"
#include <emscripten/emscripten.h>
#include <unordered_map>

static std::unordered_map<std::string, std::string> rr_options;
static std::vector<uint32_t> rr_pixels;
static std::vector<int16_t> rr_samples;
static std::string rr_state;
static std::string rr_error;
static unsigned rr_width = 256, rr_height = 240;
static unsigned rr_buttons[2] = {};
static bool rr_loaded = false;
static double rr_fps = 60.0988;

static bool rr_environment(unsigned cmd, void* data) {
  switch(cmd) {
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2: {
      auto options = (retro_core_options_v2*)data;
      for(auto d = options->definitions; d && d->key; ++d) {
        const char* value = d->default_value ? d->default_value : d->values[0].value;
        if(value) rr_options[d->key] = value;
      }
      // A shared deterministic power-on state is essential for netplay.
      rr_options["mesen_ramstate"] = "All 0s";
      rr_options["mesen_audio_sample_rate"] = "48000";
      rr_options["mesen_randomize_mapper_power_on_state"] = "disabled";
      rr_options["mesen_randomize_cpu_ppu_alignment"] = "disabled";
      return true;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      auto v = (retro_variable*)data; auto i = rr_options.find(v->key);
      v->value = i == rr_options.end() ? nullptr : i->second.c_str(); return v->value != nullptr;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)data = false; return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: *(const char**)data = "/system"; return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char**)data = "/saves"; return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: return *(retro_pixel_format*)data == RETRO_PIXEL_FORMAT_XRGB8888;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)data = true; return true;
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned*)data = 2; return true;
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTENT_INFO_OVERRIDE:
    case RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO:
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY:
    case RETRO_ENVIRONMENT_SET_GEOMETRY: return true;
    default: return false;
  }
}
static void rr_video(const void* data, unsigned w, unsigned h, size_t pitch) {
  if(!data || w > 1024 || h > 1024) return;
  rr_width = w; rr_height = h; rr_pixels.resize(w*h);
  for(unsigned y=0; y<h; ++y) {
    const uint32_t* row = (const uint32_t*)((const uint8_t*)data+y*pitch);
    for(unsigned x=0; x<w; ++x) {
      uint32_t c=row[x]; rr_pixels[y*w+x]=0xff000000 | ((c&0xff)<<16) | (c&0xff00) | ((c>>16)&0xff);
    }
  }
}
static size_t rr_audio_batch(const int16_t* data, size_t frames) {
  if(rr_samples.size()+frames*2 <= 32768) rr_samples.insert(rr_samples.end(), data, data+frames*2);
  return frames;
}
static void rr_audio(int16_t l, int16_t r) { int16_t data[2]={l,r}; rr_audio_batch(data,1); }
static void rr_poll() {}
static int16_t rr_input(unsigned port,unsigned device,unsigned index,unsigned id) {
  if(port>1 || (device&0xff)!=RETRO_DEVICE_JOYPAD) return 0;
  if(id==RETRO_DEVICE_ID_JOYPAD_MASK) return rr_buttons[port];
  return id<16 && (rr_buttons[port]&(1u<<id)) ? 1 : 0;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int rr_init() {
  try {
    mkdir("/system",0777); mkdir("/saves",0777);
    retro_set_environment(rr_environment); retro_set_video_refresh(rr_video);
    retro_set_audio_sample(rr_audio); retro_set_audio_sample_batch(rr_audio_batch);
    retro_set_input_poll(rr_poll); retro_set_input_state(rr_input); retro_init(); return 1;
  } catch(const std::exception& e) { rr_error=e.what(); return 0; }
}
EMSCRIPTEN_KEEPALIVE int rr_load(const uint8_t* data, size_t size, const char* path, unsigned overclock) {
  try {
    if(overclock < 100 || overclock > 500 || overclock % 100) {
      rr_error="Kies een CPU-overclock van 100%, 200%, 300%, 400% of 500%."; return 0;
    }
    if(rr_loaded) retro_unload_game();
    rr_loaded=false; rr_buttons[0]=rr_buttons[1]=0; rr_samples.clear(); rr_pixels.clear();
    // Desktop Mesen randomizes SNES RAM by default. Both online players must
    // start with the same memory before the very first emulated frame.
    SnesConfig snes = _emu->GetSettings()->GetSnesConfig();
    snes.RamPowerOnState = RamState::AllZeros;
    snes.EnableRandomPowerOnState = false;
    snes.PpuExtraScanlinesBeforeNmi = snes.PpuExtraScanlinesAfterNmi = 0;
    _emu->GetSettings()->SetSnesConfig(snes);
    retro_game_info game={path,data,size,nullptr};
    rr_loaded=retro_load_game(&game);
    if(!rr_loaded) { rr_error="Mesen kon deze ROM niet laden."; return 0; }
    // Extra CPU time per video frame, using Mesen's before-NMI overclock.
    // Video cadence and the APU retain their normal speed. This is an
    // approximate CPU-time percentage, not a literal hardware MHz multiplier.
    unsigned baseLines = _emu->GetRegion() == ConsoleRegion::Ntsc ? 262 : 312;
    unsigned extraLines = (baseLines * (overclock - 100) + 50) / 100;
    if(auto nes = std::dynamic_pointer_cast<NesConsole>(_emu->GetConsole())) {
      NesConfig config = _emu->GetSettings()->GetNesConfig();
      config.PpuExtraScanlinesBeforeNmi = extraLines; config.PpuExtraScanlinesAfterNmi = 0;
      _emu->GetSettings()->SetNesConfig(config);
      nes->GetPpu()->UpdateTimings(_emu->GetRegion());
    } else if(std::dynamic_pointer_cast<SnesConsole>(_emu->GetConsole())) {
      snes = _emu->GetSettings()->GetSnesConfig();
      snes.PpuExtraScanlinesBeforeNmi = extraLines; snes.PpuExtraScanlinesAfterNmi = 0;
      _emu->GetSettings()->SetSnesConfig(snes);
    }
    retro_system_av_info info={}; retro_get_system_av_info(&info); rr_fps=info.timing.fps;
    return 1;
  } catch(const std::exception& e) { rr_error=e.what(); return 0; }
}
EMSCRIPTEN_KEEPALIVE int rr_frame(unsigned p1,unsigned p2) {
  try {
    rr_buttons[0]=p1; rr_buttons[1]=p2; rr_samples.clear(); retro_run(); return 1;
  } catch(const std::exception& e) { rr_error=e.what(); return 0; }
}
EMSCRIPTEN_KEEPALIVE size_t rr_save() {
  try { std::stringstream s; _emu->Serialize(s,false,0); rr_state=s.str(); return rr_state.size(); }
  catch(const std::exception& e) { rr_error=e.what(); return 0; }
}
EMSCRIPTEN_KEEPALIVE const char* rr_state_ptr() { return rr_state.data(); }
EMSCRIPTEN_KEEPALIVE int rr_restore(const uint8_t* data,size_t size) {
  try {
    std::stringstream s(std::string((const char*)data,size));
    return _emu->Deserialize(s,SaveStateManager::FileFormatVersion,false,std::nullopt,false)==DeserializeResult::Success;
  } catch(const std::exception& e) { rr_error=e.what(); return 0; }
}
EMSCRIPTEN_KEEPALIVE const uint32_t* rr_video_ptr() { return rr_pixels.data(); }
EMSCRIPTEN_KEEPALIVE unsigned rr_video_width() { return rr_width; }
EMSCRIPTEN_KEEPALIVE unsigned rr_video_height() { return rr_height; }
EMSCRIPTEN_KEEPALIVE const int16_t* rr_audio_ptr() { return rr_samples.data(); }
EMSCRIPTEN_KEEPALIVE unsigned rr_audio_count() { return rr_samples.size(); }
EMSCRIPTEN_KEEPALIVE double rr_frame_rate() { return rr_fps; }
EMSCRIPTEN_KEEPALIVE const uint8_t* rr_ram_ptr() {
  if(auto snes = std::dynamic_pointer_cast<SnesConsole>(_emu->GetConsole())) return snes->GetMemoryManager()->DebugGetWorkRam();
  return (const uint8_t*)retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
}
EMSCRIPTEN_KEEPALIVE const char* rr_error_ptr() { return rr_error.c_str(); }
}
