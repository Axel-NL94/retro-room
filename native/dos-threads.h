// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 RetroRoom contributors. Browser port, 2026-10-30.
// Cooperative DOSBox Pure execution on one browser thread; no SharedArrayBuffer.
#pragma once
#include <emscripten/fiber.h>
#include <cstdlib>
#include <cstdio>
#define THREAD_CC
namespace rr_fibers {
inline emscripten_fiber_t main_fiber, emu_fiber;
inline bool in_emu = false, initialized = false;
inline void *main_async, *emu_async, *emu_stack;
inline void* (*entry)(void*);
inline void* argument;
inline void yield() {
  bool was_emu = in_emu;
  in_emu = !was_emu;
  emscripten_fiber_swap(was_emu ? &emu_fiber : &main_fiber, was_emu ? &main_fiber : &emu_fiber);
}
inline void run(void*) {
  entry(argument);
  // The native emulation thread exits here; return control to the frontend.
  for (;;) yield();
}
}
struct Thread {
  typedef void* RET_t;
  typedef RET_t (*FUNC_t)(void*);
  static void StartDetached(FUNC_t f, void* p = nullptr) {
    using namespace rr_fibers;
    if (in_emu) { std::fputs("Unsupported additional DOS worker\n", stderr); std::abort(); }
    if (!initialized) {
      main_async = std::malloc(2*1024*1024); emu_async = std::malloc(2*1024*1024); emu_stack = std::malloc(2*1024*1024);
      emscripten_fiber_init_from_current_context(&main_fiber, main_async, 2*1024*1024);
      initialized = true;
    }
    entry = f; argument = p;
    emscripten_fiber_init(&emu_fiber, run, nullptr, emu_stack, 2*1024*1024, emu_async, 2*1024*1024);
  }
};
struct Mutex { void Lock() {} void Unlock() {} };
struct Conditional { void Broadcast() {} void Wait(Mutex&) { rr_fibers::yield(); } };
struct Semaphore {
  bool value = false;
  void Post() { value = true; }
  void Wait() { while (!value) rr_fibers::yield(); value = false; }
};
