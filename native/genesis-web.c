// SPDX-License-Identifier: MIT
// Copyright (c) 2026 RetroRoom contributors. Written 2026-11-01.
// Independent frontend for Genesis Plus GX; no Mesen/DOSBox/RetroArch code.
// The included upstream core retains its own non-commercial license.
#include <emscripten/emscripten.h>
#include <sys/stat.h>
#include "libretro/libretro.c"

static uint32_t rr_pixels[720 * 576];
static int16_t rr_samples[8192];
static unsigned rr_w, rr_h, rr_count, rr_keys[2];
static bool rr_loaded;
static char rr_clock[8] = "100";
static uint8_t *rr_snapshot;
static const struct retro_core_option_v2_definition *rr_defaults;
static const char *rr_problem = "";
extern unsigned rr_gx_pad_snapshot(unsigned char *buffer, int restore);
struct rr_timing { int refresh; cpu_idle_t poll; uint32_t latch; uint8_t odd; };
static unsigned rr_snapshot_size(void) { return STATE_SIZE + 4 + rr_gx_pad_snapshot(NULL, 0) + sizeof(sram.sram) + sizeof(struct rr_timing); }

static bool rr_environment(unsigned command, void *value) {
  switch (command) {
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned*)value = 2; return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
      rr_defaults = ((struct retro_core_options_v2*)value)->definitions; return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      struct retro_variable *v = value;
      v->value = NULL;
      if (!strcmp(v->key, "genesis_plus_gx_overclock")) v->value = rr_clock;
      else if (!strcmp(v->key, "genesis_plus_gx_system_hw")) v->value = "md";
      else if (!strcmp(v->key, "genesis_plus_gx_bios")) v->value = "disabled";
      else if (!strcmp(v->key, "genesis_plus_gx_frameskip")) v->value = "disabled";
      else if (rr_defaults) for (const struct retro_core_option_v2_definition *d = rr_defaults; d->key; d++) {
        if (!strcmp(d->key, v->key)) { v->value = d->default_value; break; }
      }
      return v->value != NULL;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)value = false; return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: *(const char**)value = "/system"; return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char**)value = "/saves"; return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: return *(unsigned*)value == RETRO_PIXEL_FORMAT_RGB565;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)value = true; return true;
    case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE: *(int*)value = 3; return true;
    case RETRO_ENVIRONMENT_SET_GEOMETRY:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
    case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS: return true;
    default: return false;
  }
}
static void rr_picture(const void *data, unsigned width, unsigned height, size_t pitch) {
  if (!data || width > 720 || height > 576) return;
  rr_w = width; rr_h = height;
  for (unsigned y = 0; y < height; y++) {
    const uint16_t *row = (const uint16_t*)((const uint8_t*)data + y * pitch);
    for (unsigned x = 0; x < width; x++) {
      unsigned c = row[x], r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
      rr_pixels[y * width + x] = 0xff000000u | ((r << 3) | (r >> 2)) |
        (((g << 2) | (g >> 4)) << 8) | (((b << 3) | (b >> 2)) << 16);
    }
  }
}
static size_t rr_sound_batch(const int16_t *data, size_t frames) {
  size_t n = frames * 2;
  if (n <= 8192 - rr_count) { memcpy(rr_samples + rr_count, data, n * sizeof(int16_t)); rr_count += n; }
  return frames;
}
static void rr_sound(int16_t left, int16_t right) { int16_t pair[] = {left, right}; rr_sound_batch(pair, 1); }
static void rr_poll(void) {}
static int16_t rr_controller(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port > 1 || (device & RETRO_DEVICE_MASK) != RETRO_DEVICE_JOYPAD) return 0;
  return id == RETRO_DEVICE_ID_JOYPAD_MASK ? rr_keys[port] : id < 16 && (rr_keys[port] & (1u << id)) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int rr_init(void) {
  mkdir("/system", 0777); mkdir("/saves", 0777);
  retro_set_environment(rr_environment);
  retro_set_video_refresh(rr_picture); retro_set_audio_sample(rr_sound); retro_set_audio_sample_batch(rr_sound_batch);
  retro_set_input_poll(rr_poll); retro_set_input_state(rr_controller); retro_init();
  return 1;
}
EMSCRIPTEN_KEEPALIVE int rr_load(const uint8_t *data, size_t size, unsigned clock) {
  if (clock < 100 || clock > 500 || clock % 100 || size < 512 || size > 8 * 1024 * 1024) return 0;
  if (rr_loaded) retro_unload_game();
  rr_loaded = false; rr_count = rr_w = rr_h = rr_keys[0] = rr_keys[1] = 0;
  snprintf(rr_clock, sizeof(rr_clock), "%u", clock);
  struct retro_game_info game = {"/game.md", data, size, NULL};
  rr_loaded = retro_load_game(&game);
  if (!rr_loaded) { rr_problem = "Genesis Plus GX kon deze ROM niet laden."; return 0; }
  retro_set_controller_port_device(0, RETRO_DEVICE_MDPAD_6B);
  retro_set_controller_port_device(1, RETRO_DEVICE_MDPAD_6B);
  return 1;
}
EMSCRIPTEN_KEEPALIVE int rr_frame(unsigned one, unsigned two) {
  if (!rr_loaded) return 0;
  rr_keys[0] = one; rr_keys[1] = two; rr_count = 0; retro_run(); return 1;
}
EMSCRIPTEN_KEEPALIVE unsigned rr_save(void) {
  if (!rr_loaded) return 0;
  if (!rr_snapshot) rr_snapshot = malloc(rr_snapshot_size());
  if (!rr_snapshot) return 0;
  memset(rr_snapshot, 0, rr_snapshot_size());
  if (!retro_serialize(rr_snapshot, STATE_SIZE)) return 0;
  // Upstream delays overclocking after reset; retain its remaining delay.
  memcpy(rr_snapshot + STATE_SIZE, &overclock_delay, 4);
  unsigned n = rr_gx_pad_snapshot(rr_snapshot + STATE_SIZE + 4, 0);
  memcpy(rr_snapshot + STATE_SIZE + 4 + n, sram.sram, sizeof(sram.sram));
  struct rr_timing timing = {0};
  timing.refresh = m68k.refresh_cycles; timing.poll = m68k.poll; timing.latch = hvc_latch; timing.odd = odd_frame;
  memcpy(rr_snapshot + STATE_SIZE + 4 + n + sizeof(sram.sram), &timing, sizeof(timing));
  return rr_snapshot_size();
}
EMSCRIPTEN_KEEPALIVE const uint8_t *rr_state_ptr(void) { return rr_snapshot; }
EMSCRIPTEN_KEEPALIVE int rr_restore(const uint8_t *data, size_t size) {
  uint32_t delay;
  if (!rr_loaded || size != rr_snapshot_size() || memcmp(data, STATE_VERSION, 16)) return 0;
  memcpy(&delay, data + STATE_SIZE, 4);
  if (delay > OVERCLOCK_FRAME_DELAY) return 0;
  overclock_delay = delay;
  if (!retro_unserialize(data, STATE_SIZE)) return 0;
  unsigned n = rr_gx_pad_snapshot((uint8_t*)data + STATE_SIZE + 4, 1);
  memcpy(sram.sram, data + STATE_SIZE + 4 + n, sizeof(sram.sram));
  struct rr_timing timing;
  memcpy(&timing, data + STATE_SIZE + 4 + n + sizeof(sram.sram), sizeof(timing));
  m68k.refresh_cycles = timing.refresh; m68k.poll = timing.poll; hvc_latch = timing.latch; odd_frame = timing.odd;
  return 1;
}
EMSCRIPTEN_KEEPALIVE const uint32_t *rr_video_ptr(void) { return rr_pixels; }
EMSCRIPTEN_KEEPALIVE unsigned rr_video_width(void) { return rr_w; }
EMSCRIPTEN_KEEPALIVE unsigned rr_video_height(void) { return rr_h; }
EMSCRIPTEN_KEEPALIVE const int16_t *rr_audio_ptr(void) { return rr_samples; }
EMSCRIPTEN_KEEPALIVE unsigned rr_audio_count(void) { return rr_count; }
EMSCRIPTEN_KEEPALIVE double rr_frame_rate(void) { struct retro_system_av_info av; retro_get_system_av_info(&av); return av.timing.fps; }
EMSCRIPTEN_KEEPALIVE const char *rr_error_ptr(void) { return rr_problem; }
EMSCRIPTEN_KEEPALIVE const uint8_t *rr_ram_ptr(void) { return work_ram; }
EMSCRIPTEN_KEEPALIVE void rr_destroy(void) { if (rr_loaded) retro_unload_game(); rr_loaded = false; retro_deinit(); free(rr_snapshot); rr_snapshot = NULL; }
