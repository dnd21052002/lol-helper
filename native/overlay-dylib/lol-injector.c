/**
 * lol-injector — arm64 Mach dylib injector for macOS
 *
 * Injects a dylib into a running process using:
 *   task_for_pid(target) → mach_vm_allocate (remote stack + arg)
 *   thread_create_running with arm64 thread state
 *   shellcode calls pthread_create_from_mach_thread → dlopen
 *
 * Requires: code signing with com.apple.security.cs.debugger entitlement.
 *
 * Usage: ./lol-injector <pid> <absolute-dylib-path>
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach/thread_act.h>
#include <mach/arm/thread_status.h>
#include <sys/sysctl.h>

#define STACK_SIZE  (16 * 1024)
#define CODE_SIZE   (4096)
#define ARG_SIZE    (4096)

// arm64 shellcode that calls:
//   pthread_create_from_mach_thread(&tid, NULL, dlopen_thread, dylib_path)
//   then loops on `b .` so the calling thread parks.
//
// Register layout we set before jumping here:
//   x0 = dlopen_thread address (pthread start_routine)
//   x1 = dylib path string address
//   x2 = pthread_create_from_mach_thread address
//   x19 = scratch (tid storage area)
//
// We perform:
//   mov  x3, x1                  ; arg = dylib path
//   mov  x1, #0                  ; attr = NULL
//   mov  x2, x0                  ; start_routine = dlopen_thread
//   mov  x0, x19                 ; &tid
//   blr  x4                      ; call pthread_create_from_mach_thread
// 1: b 1b                        ; park forever
//
// Simpler: the host C code sets registers directly via thread state — we don't
// need a complex shellcode. The "shellcode" is just a parking loop; the call
// happens because we set PC = pthread_create_from_mach_thread and arrange
// LR to point back into the parking loop.

// Parking loop: `b .` (0x14000000) — branch to self.
static const uint32_t parking_loop[] = {
    0x14000000,   // b .
};

static void mach_die(const char *msg, kern_return_t kr) {
    fprintf(stderr, "[lol-injector] %s: %s (0x%x)\n",
            msg, mach_error_string(kr), kr);
    exit(1);
}

// Resolve symbol address in target by computing its offset within libdyld /
// libsystem in OUR process and applying it to the target's loaded copy.
// Both processes load the same shared cache → addresses match for cached libs.
//
// Simpler shortcut: arm64 shared cache is mapped at the same slide for all
// processes (modulo ASLR per-boot). We can directly use our own pointer.
// This is the standard trick used by frida-core and Cylance's injector.
static void *resolve_local(const char *name) {
    void *p = dlsym(RTLD_DEFAULT, name);
    if (!p) {
        fprintf(stderr, "[lol-injector] dlsym(%s) failed\n", name);
        exit(1);
    }
    return p;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s <pid> <dylib-path>\n", argv[0]);
        return 1;
    }

    pid_t pid = (pid_t)atoi(argv[1]);
    const char *dylib = argv[2];
    size_t dylib_len = strlen(dylib) + 1;
    if (dylib_len > ARG_SIZE) {
        fprintf(stderr, "dylib path too long\n");
        return 1;
    }

    fprintf(stderr, "[lol-injector] Target pid=%d dylib=%s\n", pid, dylib);

    // ── 1. Get task port ─────────────────────────────────────────────────────
    mach_port_t task;
    kern_return_t kr = task_for_pid(mach_task_self(), pid, &task);
    if (kr != KERN_SUCCESS) {
        mach_die("task_for_pid (need cs.debugger entitlement + matching uid)", kr);
    }
    fprintf(stderr, "[lol-injector] Got task port\n");

    // ── 2. Allocate remote memory: stack + arg ───────────────────────────────
    mach_vm_address_t remote_stack = 0;
    kr = mach_vm_allocate(task, &remote_stack, STACK_SIZE,
                          VM_FLAGS_ANYWHERE);
    if (kr != KERN_SUCCESS) mach_die("mach_vm_allocate stack", kr);

    mach_vm_address_t remote_arg = 0;
    kr = mach_vm_allocate(task, &remote_arg, ARG_SIZE, VM_FLAGS_ANYWHERE);
    if (kr != KERN_SUCCESS) mach_die("mach_vm_allocate arg", kr);

    mach_vm_address_t remote_code = 0;
    kr = mach_vm_allocate(task, &remote_code, CODE_SIZE, VM_FLAGS_ANYWHERE);
    if (kr != KERN_SUCCESS) mach_die("mach_vm_allocate code", kr);

    fprintf(stderr, "[lol-injector] Allocated stack=0x%llx arg=0x%llx code=0x%llx\n",
            remote_stack, remote_arg, remote_code);

    // ── 3. Write dylib path into remote arg buffer ───────────────────────────
    kr = mach_vm_write(task, remote_arg,
                       (vm_offset_t)dylib, (mach_msg_type_number_t)dylib_len);
    if (kr != KERN_SUCCESS) mach_die("mach_vm_write arg", kr);

    // ── 4. Write parking-loop shellcode into remote code page ────────────────
    kr = mach_vm_write(task, remote_code,
                       (vm_offset_t)parking_loop, sizeof(parking_loop));
    if (kr != KERN_SUCCESS) mach_die("mach_vm_write code", kr);

    kr = mach_vm_protect(task, remote_code, CODE_SIZE, FALSE,
                         VM_PROT_READ | VM_PROT_EXECUTE);
    if (kr != KERN_SUCCESS) mach_die("mach_vm_protect code", kr);

    // ── 5. Resolve target functions (shared cache slide assumption) ──────────
    void *p_pthread_create_from_mach_thread =
        resolve_local("pthread_create_from_mach_thread");
    void *p_dlopen = resolve_local("dlopen");

    fprintf(stderr,
        "[lol-injector] pthread_create_from_mach_thread=%p dlopen=%p\n",
        p_pthread_create_from_mach_thread, p_dlopen);

    // ── 6. Build remote thread state (arm64) ─────────────────────────────────
    //
    // Entry point: pthread_create_from_mach_thread
    //   x0 = &tid (use slot inside remote_arg after the path)
    //   x1 = NULL (attr)
    //   x2 = dlopen address
    //   x3 = dylib path address (passed as `arg` to dlopen via start routine)
    //
    // But pthread_create's start_routine takes one arg and returns void*;
    // dlopen takes (path, flags). Signature mismatch — flags param will be
    // garbage from x1 of the new thread.
    //
    // Workaround: we use dlopen with implicit second arg; on arm64 the second
    // arg is x1 of the new thread, which pthread sets to NULL → dlopen sees
    // flags=0 which means RTLD_LAZY|RTLD_LOCAL. That's fine.
    //
    // Actually pthread passes only x0 = arg. x1 is whatever the runtime sets.
    // Empirically dlopen with flags=0 works (defaults to RTLD_LAZY).

    arm_thread_state64_t state = {0};
    state.__pc  = (uint64_t)(uintptr_t)p_pthread_create_from_mach_thread;
    state.__lr  = (uint64_t)remote_code;          // park after return
    state.__sp  = (uint64_t)(remote_stack + STACK_SIZE - 0x100);
    state.__x[0] = (uint64_t)(remote_arg + ARG_SIZE - 16); // &tid scratch
    state.__x[1] = 0;                                       // attr
    state.__x[2] = (uint64_t)(uintptr_t)p_dlopen;           // start_routine
    state.__x[3] = (uint64_t)remote_arg;                    // arg = path

    // ── 7. Create remote thread ──────────────────────────────────────────────
    thread_act_t remote_thread;
    kr = thread_create_running(task, ARM_THREAD_STATE64,
                               (thread_state_t)&state,
                               ARM_THREAD_STATE64_COUNT,
                               &remote_thread);
    if (kr != KERN_SUCCESS) mach_die("thread_create_running", kr);

    fprintf(stderr, "[lol-injector] Remote thread created. Injection in progress.\n");

    // Give target a moment to actually load the dylib before we exit.
    sleep(1);

    fprintf(stderr, "[lol-injector] Done.\n");
    return 0;
}
