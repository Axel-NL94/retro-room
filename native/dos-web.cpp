// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 RetroRoom contributors. Browser port, 2026-10-30.
#include "dosbox_pure_libretro.cpp"
#include <emscripten/emscripten.h>
#include <map>
#include <sys/stat.h>
#include <sys/time.h>
#include "include/pic.h"

static std::map<std::string,std::string> rr_options;
static std::vector<uint32_t> rr_pixels;
static std::vector<int16_t> rr_samples;
static std::vector<uint8_t> rr_state;
static unsigned rr_width=640,rr_height=400,rr_buttons[2]={};
static double rr_fps=60,rr_rate=48000;
static std::string rr_error;
static bool rr_loaded=false;
static size_t rr_result=0;
static uint64_t rr_clock=1000000;
static retro_keyboard_event_t rr_keyboard=nullptr;
struct RRSnapshotSection{std::string name;size_t start,end;};
static std::vector<RRSnapshotSection> rr_sections;
void rr_snapshot_section(const char* name,size_t start,size_t end){rr_sections.push_back({name,start,end});}
static uint8_t rr_keys[512]={},rr_physical[2][512]={};
static bool rr_external=false,rr_joy_enabled[2]={};
static int rr_mouse[2][4]={},rr_joy[2][3]={};
static unsigned rr_modifiers[2]={},rr_old_joy_buttons[2]={};
static retro_time_t rr_time() { return rr_clock; }
// Optional 3dfx is absent from this browser build, including its state section.
Bit8u voodoo_ogl_scale=1;
bool voodoo_ogl_is_showing(){return false;}
bool voodoo_is_active(){return false;}
bool voodoo_ogl_have_new_image(){return false;}
bool voodoo_ogl_display(){return false;}
bool voodoo_ogl_mainthread(){return false;}
void voodoo_ogl_cleanup(){}
void voodoo_ogl_resetcontext(){}
void voodoo_ogl_initfailed(){}
void DBPSerialize_Voodoo(DBPArchive&){}
DBP_SERIALIZE_SET_POINTER_LIST(PIC_EventHandler, Voodoo, nullptr);
static void rr_log(enum retro_log_level level,const char* fmt,...) {
  if(level < RETRO_LOG_WARN) return;
  char text[2048];va_list args;va_start(args,fmt);vsnprintf(text,sizeof(text),fmt,args);va_end(args);
  rr_error=text;
}
static bool rr_environment(unsigned cmd,void* data) {
  switch(cmd) {
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned*)data=2;return true;
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
      for(auto d=((retro_core_options_v2*)data)->definitions;d&&d->key;++d)
        rr_options[d->key]=d->default_value ? d->default_value : d->values[0].value;
      rr_options["dosbox_pure_cpu_core"]="normal";
      rr_options["dosbox_pure_cycles"]="3000";
      rr_options["dosbox_pure_cycles_scale"]="1.0";
      rr_options["dosbox_pure_savestate"]="rewind";
      rr_options["dosbox_pure_midi"]="disabled";
      rr_options["dosbox_pure_voodoo"]="disabled";
      rr_options["dosbox_pure_auto_mapping"]="false";
      rr_options["dosbox_pure_force60fps"]="60";
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      auto v=(retro_variable*)data;auto i=rr_options.find(v->key);
      v->value=i==rr_options.end()?nullptr:i->second.c_str();return v->value!=nullptr;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)data=false;return true;
    case RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK: rr_keyboard=((retro_keyboard_callback*)data)->callback;return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: *(const char**)data="/system";return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char**)data="/saves";return true;
    case RETRO_ENVIRONMENT_GET_CONTENT_DIRECTORY: *(const char**)data="/games";return true;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((retro_log_callback*)data)->log=rr_log;return true;
    case RETRO_ENVIRONMENT_GET_PERF_INTERFACE: memset(data,0,sizeof(retro_perf_callback));((retro_perf_callback*)data)->get_time_usec=rr_time;return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)data=true;return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: return *(retro_pixel_format*)data==RETRO_PIXEL_FORMAT_XRGB8888;
    case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
      auto a=(retro_system_av_info*)data;rr_fps=a->timing.fps;rr_rate=a->timing.sample_rate;return true;
    }
    default: return false;
  }
}
static void rr_video(const void* data,unsigned w,unsigned h,size_t pitch) {
  if(!data||w>1600||h>1200)return;
  rr_width=w;rr_height=h;rr_pixels.resize(w*h);
  for(unsigned y=0;y<h;++y)for(unsigned x=0;x<w;++x) {
    uint32_t c=((const uint32_t*)((const uint8_t*)data+y*pitch))[x];
    rr_pixels[y*w+x]=0xff000000|((c&255)<<16)|(c&0xff00)|((c>>16)&255);
  }
}
static size_t rr_audio(const int16_t* data,size_t frames) {
  if(rr_samples.size()+frames*2<65536)rr_samples.insert(rr_samples.end(),data,data+frames*2);return frames;
}
static void rr_sample(int16_t l,int16_t r){int16_t s[2]={l,r};rr_audio(s,1);}
static void rr_poll(){}
static int16_t rr_input(unsigned port,unsigned device,unsigned index,unsigned id) {
  if((device&255)==RETRO_DEVICE_KEYBOARD)return id<512?rr_keys[id]:0;
  if((device&255)==RETRO_DEVICE_MOUSE) {
    if(id==RETRO_DEVICE_ID_MOUSE_X||id==RETRO_DEVICE_ID_MOUSE_Y)return (int16_t)std::max(-32767,std::min(32767,rr_mouse[0][id]+rr_mouse[1][id]));
    int buttons=rr_mouse[0][3]|rr_mouse[1][3];
    if(id==RETRO_DEVICE_ID_MOUSE_LEFT)return !!(buttons&1);
    if(id==RETRO_DEVICE_ID_MOUSE_RIGHT)return !!(buttons&2);
    if(id==RETRO_DEVICE_ID_MOUSE_MIDDLE)return !!(buttons&4);
    if(id==RETRO_DEVICE_ID_MOUSE_WHEELUP)return (rr_mouse[0][2]+rr_mouse[1][2])<0;
    if(id==RETRO_DEVICE_ID_MOUSE_WHEELDOWN)return (rr_mouse[0][2]+rr_mouse[1][2])>0;
    return 0;
  }
  if(port>1||(device&255)!=RETRO_DEVICE_JOYPAD||dbp_game_running)return 0;
  unsigned b=rr_buttons[port];
  // The launch menu consumes RetroPad input rather than DOS keyboard events.
  // Keep physical arrows, Enter and Escape useful before a game is launched.
  if(rr_external&&port==0){if(rr_keys[273])b|=16;if(rr_keys[274])b|=32;if(rr_keys[276])b|=64;if(rr_keys[275])b|=128;if(rr_keys[13]||rr_keys[271])b|=1;if(rr_keys[27])b|=2;}
  unsigned pad=(b&0xcfc)|((b&1)<<8)|((b>>1)&1)|((b&0x100)<<1)|((b&0x200)>>8);
  return id==RETRO_DEVICE_ID_JOYPAD_MASK?pad:(id<16&&(pad&(1u<<id))?1:0);
}
extern "C" {
time_t __wrap_time(time_t* out) { time_t t=1704067200+(time_t)(rr_clock/1000000);if(out)*out=t;return t; }
int __wrap_gettimeofday(struct timeval* out,void*){out->tv_sec=1704067200+rr_clock/1000000;out->tv_usec=rr_clock%1000000;return 0;}
int __wrap_clock_gettime(clockid_t,struct timespec* out) { out->tv_sec=1704067200+rr_clock/1000000;out->tv_nsec=(rr_clock%1000000)*1000;return 0; }
EMSCRIPTEN_KEEPALIVE int rr_init() {
  mkdir("/system",0777);mkdir("/saves",0777);mkdir("/games",0777);
  retro_set_environment(rr_environment);retro_set_video_refresh(rr_video);
  retro_set_audio_sample(rr_sample);retro_set_audio_sample_batch(rr_audio);
  retro_set_input_poll(rr_poll);retro_set_input_state(rr_input);retro_init();return 1;
}
EMSCRIPTEN_KEEPALIVE int rr_load(const char* path,unsigned overclock) {
  rr_result=0;
  if(rr_loaded)retro_unload_game();
  rr_external=false;memset(rr_physical,0,sizeof(rr_physical));memset(rr_mouse,0,sizeof(rr_mouse));memset(rr_joy,0,sizeof(rr_joy));memset(rr_joy_enabled,0,sizeof(rr_joy_enabled));memset(rr_old_joy_buttons,0,sizeof(rr_old_joy_buttons));
  rr_clock=1000000;rr_buttons[0]=rr_buttons[1]=0;rr_samples.clear();memset(rr_keys,0,sizeof(rr_keys));
  rr_options["dosbox_pure_cycles"]=std::to_string(3000*overclock/100);
  retro_game_info info={path,nullptr,0,nullptr};rr_loaded=retro_load_game(&info);
  if(rr_loaded){retro_system_av_info av={};retro_get_system_av_info(&av);rr_fps=av.timing.fps;rr_rate=av.timing.sample_rate;}
  rr_result=rr_loaded?1:0;return rr_loaded;
}
EMSCRIPTEN_KEEPALIVE void rr_set_input(unsigned port,const uint16_t* keys,unsigned count,unsigned modifiers,int dx,int dy,int wheel,unsigned mouse_buttons,unsigned joy,int jx,int jy,unsigned joy_buttons) {
  if(port>1||count>128)return;rr_external=true;memset(rr_physical[port],0,512);
  for(unsigned i=0;i<count;++i)if(keys[i]<512)rr_physical[port][keys[i]]=1;
  rr_modifiers[port]=modifiers&127;rr_mouse[port][0]=dx;rr_mouse[port][1]=dy;rr_mouse[port][2]=wheel;rr_mouse[port][3]=mouse_buttons&7;
  rr_joy_enabled[port]=joy;rr_joy[port][0]=jx;rr_joy[port][1]=jy;rr_joy[port][2]=joy_buttons&3;
}
EMSCRIPTEN_KEEPALIVE int rr_frame(unsigned p1,unsigned p2) {
  rr_clock+=(uint64_t)(1000000.0/rr_fps);rr_buttons[0]=p1;rr_buttons[1]=p2;rr_samples.clear();
  if(rr_keyboard && (dbp_game_running||rr_external)) {
    static const unsigned map[2][12]={{306,308,27,13,273,274,276,275,32,9,113,101},{102,103,27,13,119,115,97,100,104,114,116,121}};
    uint8_t keys[512]={};
    if(rr_external)for(unsigned key=0;key<512;++key)keys[key]=rr_physical[0][key]|rr_physical[1][key];
    else for(unsigned port=0;port<2;++port)for(unsigned bit=0;bit<12;++bit)if(rr_buttons[port]&(1<<bit))keys[map[port][bit]]=1;
    // Press modifiers before letters, and release them after letters. Keyboard
    // snapshots otherwise turn simultaneous Shift+B / Ctrl+C into plain letters.
    unsigned modifiers=rr_modifiers[0]|rr_modifiers[1];
    for(unsigned key=303;key<=313;++key)if(keys[key]&&!rr_keys[key])rr_keyboard(true,key,0,modifiers);
    for(unsigned key=0;key<512;++key)if((key<303||key>313)&&keys[key]!=rr_keys[key])rr_keyboard(keys[key],key,0,modifiers);
    for(unsigned key=303;key<=313;++key)if(!keys[key]&&rr_keys[key])rr_keyboard(false,key,0,modifiers);
    memcpy(rr_keys,keys,sizeof(rr_keys));
  }
  if(rr_external&&dbp_game_running)for(unsigned port=0;port<2;++port) {
    JOYSTICK_Enable(port,rr_joy_enabled[port]);
    DBP_QueueEvent(port?DBPET_JOY2X:DBPET_JOY1X,DBP_NO_PORT,rr_joy_enabled[port]?rr_joy[port][0]:0);
    DBP_QueueEvent(port?DBPET_JOY2Y:DBPET_JOY1Y,DBP_NO_PORT,rr_joy_enabled[port]?rr_joy[port][1]:0);
    unsigned buttons=rr_joy_enabled[port]?rr_joy[port][2]:0;
    for(unsigned b=0;b<2;++b)if((buttons^rr_old_joy_buttons[port])&(1<<b))DBP_QueueEvent(port?(buttons&(1<<b)?DBPET_JOY2DOWN:DBPET_JOY2UP):(buttons&(1<<b)?DBPET_JOY1DOWN:DBPET_JOY1UP),DBP_NO_PORT,b);
    rr_old_joy_buttons[port]=buttons;
  }
  retro_run();
  for(unsigned port=0;port<2;++port)rr_mouse[port][0]=rr_mouse[port][1]=rr_mouse[port][2]=0;
  rr_result=1;return 1;
}
static size_t rr_prefix_size(){return sizeof(rr_clock)+sizeof(rr_keys)+sizeof(rr_physical)+sizeof(rr_mouse)+sizeof(rr_joy)+sizeof(rr_joy_enabled)+sizeof(rr_modifiers)+sizeof(rr_old_joy_buttons)+sizeof(rr_external);}
static void rr_prefix(uint8_t* data,bool load){size_t offset=0;
  #define RR_FIELD(value) if(load)memcpy(&value,data+offset,sizeof(value));else memcpy(data+offset,&value,sizeof(value));offset+=sizeof(value);
  RR_FIELD(rr_clock);RR_FIELD(rr_keys);RR_FIELD(rr_physical);RR_FIELD(rr_mouse);RR_FIELD(rr_joy);RR_FIELD(rr_joy_enabled);RR_FIELD(rr_modifiers);RR_FIELD(rr_old_joy_buttons);RR_FIELD(rr_external);
  #undef RR_FIELD
}
EMSCRIPTEN_KEEPALIVE size_t rr_save() {
  rr_result=0;rr_sections.clear();
  size_t size=retro_serialize_size();if(!size||size>64*1024*1024)return 0;
  size_t prefix=rr_prefix_size();rr_state.resize(size+prefix);rr_prefix(rr_state.data(),false);
  rr_result=retro_serialize(rr_state.data()+prefix,size)?rr_state.size():0;return rr_result;
}
EMSCRIPTEN_KEEPALIVE int rr_restore(const uint8_t* data,size_t size) {
  rr_result=0;size_t prefix=rr_prefix_size();if(size<=prefix)return 0;
  if(!retro_unserialize(data+prefix,size-prefix))return 0;
  rr_prefix((uint8_t*)data,true);rr_result=1;return 1;
}
EMSCRIPTEN_KEEPALIVE unsigned rr_section_count(){return rr_sections.size();}
EMSCRIPTEN_KEEPALIVE const char* rr_section_name(unsigned i){return i<rr_sections.size()?rr_sections[i].name.c_str():"";}
EMSCRIPTEN_KEEPALIVE unsigned rr_section_start(unsigned i){return i<rr_sections.size()?rr_prefix_size()+rr_sections[i].start:0;}
EMSCRIPTEN_KEEPALIVE unsigned rr_section_end(unsigned i){return i<rr_sections.size()?rr_prefix_size()+rr_sections[i].end:0;}
// Fiber unwinding discards an export's immediate return value. The synchronous
// trampoline finishes its side effects before JS reads this separate accessor.
EMSCRIPTEN_KEEPALIVE unsigned rr_peek(unsigned address){return address<0x1000000?mem_readb(address):0;}
EMSCRIPTEN_KEEPALIVE unsigned rr_key_down(unsigned key){return key<512?rr_keys[key]:0;}
EMSCRIPTEN_KEEPALIVE unsigned rr_joystick(unsigned port,unsigned field){if(port>1)return 0;return field==0?JOYSTICK_IsEnabled(port):field==1?(unsigned)(32767*JOYSTICK_GetMove_X(port)):field==2?(unsigned)(32767*JOYSTICK_GetMove_Y(port)):JOYSTICK_GetButton(port,field-3);}
EMSCRIPTEN_KEEPALIVE size_t rr_last_result(){return rr_result;}
EMSCRIPTEN_KEEPALIVE const uint8_t* rr_state_ptr(){return rr_state.data();}
EMSCRIPTEN_KEEPALIVE const uint32_t* rr_video_ptr(){return rr_pixels.data();}
EMSCRIPTEN_KEEPALIVE unsigned rr_video_width(){return rr_width;}
EMSCRIPTEN_KEEPALIVE unsigned rr_video_height(){return rr_height;}
EMSCRIPTEN_KEEPALIVE const int16_t* rr_audio_ptr(){return rr_samples.data();}
EMSCRIPTEN_KEEPALIVE unsigned rr_audio_count(){return rr_samples.size();}
EMSCRIPTEN_KEEPALIVE double rr_frame_rate(){return rr_fps;}
EMSCRIPTEN_KEEPALIVE double rr_sample_rate(){return rr_rate;}
EMSCRIPTEN_KEEPALIVE const char* rr_error_ptr(){return rr_error.c_str();}
EMSCRIPTEN_KEEPALIVE void rr_destroy(){if(rr_loaded)retro_unload_game();rr_loaded=false;retro_deinit();}
}
