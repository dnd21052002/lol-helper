/**
 * lol-watcher — process watcher for League of Legends game start
 *
 * Polls for the LeagueofLegends game process, then execs lol-injector to
 * load lol-overlay.dylib into it.
 *
 * Strategy:
 *   1. Loop: scan all PIDs every 500ms looking for "LeagueofLegends" exec name.
 *   2. When found and not already injected, fork+exec injector binary.
 *   3. Track injected PIDs in a set; skip if already done.
 *
 * kqueue NOTE_FORK requires knowing the parent PID up front and only sees
 * direct children — LeagueClient → LeagueofLegends works, but if the user
 * starts the watcher mid-session we miss the fork. Polling is simpler and
 * covers all cases. 500ms is fast enough since dlopen happens before Metal
 * device init.
 */

#import <Foundation/Foundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <libproc.h>
#include <sys/sysctl.h>
#include <sys/wait.h>

static const char *INJECTOR_PATH    = NULL;  // resolved at startup
static const char *OVERLAY_DYLIB    = NULL;
static const char *TARGET_NAME      = "LeagueofLegends";

#define MAX_INJECTED 64
static pid_t injected_pids[MAX_INJECTED];
static int   injected_count = 0;

static int already_injected(pid_t pid) {
    for (int i = 0; i < injected_count; i++) {
        if (injected_pids[i] == pid) return 1;
    }
    return 0;
}

static void mark_injected(pid_t pid) {
    if (injected_count < MAX_INJECTED) {
        injected_pids[injected_count++] = pid;
    }
}

// Prune dead PIDs from the injected list so we re-inject on relaunch.
static void prune_dead(void) {
    int w = 0;
    for (int r = 0; r < injected_count; r++) {
        if (kill(injected_pids[r], 0) == 0) {
            injected_pids[w++] = injected_pids[r];
        }
    }
    injected_count = w;
}

static void run_injector(pid_t pid) {
    fprintf(stderr, "[lol-watcher] Game pid=%d detected, launching injector\n", pid);

    pid_t child = fork();
    if (child < 0) {
        perror("[lol-watcher] fork");
        return;
    }
    if (child == 0) {
        char pidbuf[16];
        snprintf(pidbuf, sizeof pidbuf, "%d", pid);
        execl(INJECTOR_PATH, INJECTOR_PATH, pidbuf, OVERLAY_DYLIB, (char *)NULL);
        perror("[lol-watcher] execl injector");
        _exit(1);
    }

    int status = 0;
    waitpid(child, &status, 0);
    if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        fprintf(stderr, "[lol-watcher] Injector OK for pid %d\n", pid);
        mark_injected(pid);
    } else {
        fprintf(stderr, "[lol-watcher] Injector failed (status=%d) for pid %d\n",
                status, pid);
    }
}

static void scan_once(void) {
    int pid_count = proc_listallpids(NULL, 0);
    if (pid_count <= 0) return;

    pid_t *pids = calloc((size_t)pid_count, sizeof(pid_t));
    if (!pids) return;

    pid_count = proc_listallpids(pids, pid_count * (int)sizeof(pid_t));

    for (int i = 0; i < pid_count; i++) {
        pid_t pid = pids[i];
        if (pid == 0) continue;

        char name[PROC_PIDPATHINFO_MAXSIZE] = {0};
        if (proc_name(pid, name, sizeof name) <= 0) continue;

        if (strcmp(name, TARGET_NAME) != 0) continue;
        if (already_injected(pid)) continue;

        run_injector(pid);
    }

    free(pids);
}

static volatile sig_atomic_t g_running = 1;
static void on_signal(int sig) {
    (void)sig;
    g_running = 0;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr,
            "usage: %s <injector-path> <overlay-dylib-path>\n", argv[0]);
        return 1;
    }
    INJECTOR_PATH = argv[1];
    OVERLAY_DYLIB = argv[2];

    if (access(INJECTOR_PATH, X_OK) != 0) {
        fprintf(stderr, "[lol-watcher] injector not executable: %s\n", INJECTOR_PATH);
        return 1;
    }
    if (access(OVERLAY_DYLIB, R_OK) != 0) {
        fprintf(stderr, "[lol-watcher] overlay dylib not readable: %s\n", OVERLAY_DYLIB);
        return 1;
    }

    signal(SIGINT,  on_signal);
    signal(SIGTERM, on_signal);

    fprintf(stderr, "[lol-watcher] Watching for %s process. Ctrl-C to stop.\n",
            TARGET_NAME);

    while (g_running) {
        prune_dead();
        scan_once();
        usleep(500 * 1000);  // 500ms
    }

    fprintf(stderr, "[lol-watcher] Stopped.\n");
    return 0;
}
