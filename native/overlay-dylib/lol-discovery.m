/**
 * lol-discovery — auto-find oGameTime + pointer chain from inside the
 * injected dylib. No Cheat Engine needed.
 *
 * STAGE 1 — gameTime absolute address
 *   Game time is a float that increases by ~1.0/sec. Sampling at fixed
 *   intervals isolates it: any aligned float whose value rises by exactly
 *   the wall-clock delta (within tolerance) over multiple passes is a
 *   candidate. After 4 samples spaced 3s apart, real gameTime survives,
 *   most other timers don't (animations reset, respawns are integer).
 *
 * STAGE 2 — static offset (image-relative)
 *   Walk the LeagueofLegends Mach-O __DATA / __DATA_CONST segments. For
 *   every aligned u64, check if its value points within
 *   [gameTimeAddr - 0x2000, gameTimeAddr]. If yes:
 *     staticOff  = pointer slot - imageBase
 *     fieldOff   = gameTimeAddr - *pointer slot
 *   gameTime is then accessed as:
 *     ptr  = *(u64*)(imageBase + staticOff)
 *     time = *(float*)(ptr + fieldOff)
 *
 *   For memreader's flat oGameTime model (image+offset → float), one-level
 *   indirection requires a pointer-chain extension. We log both the direct
 *   absolute address (for one-shot reads) and the indirect chain (for
 *   stable-across-runs reads).
 *
 * Output: /tmp/lol-overlay-discovery.log
 *
 * Activation: env LOL_MEMREAD_DISCOVER=1.
 */

#import <Foundation/Foundation.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <pthread.h>
#include <unistd.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "lol-memreader.h"

#define DISCOVERY_LOG     "/tmp/lol-overlay-discovery.log"
#define MAX_CANDIDATES    (1 << 16)   /* 65536 */
#define SAMPLE_GAP_SEC    3
#define SAMPLE_PASSES     4           /* total snapshots = 1 init + 3 retain */
#define DELTA_TOL         0.6f        /* per pass tolerance, seconds */
#define WARMUP_SEC        15

typedef struct {
    uint64_t addr;
    float    samples[SAMPLE_PASSES];
} GameTimeCand;

static GameTimeCand *g_cands = NULL;
static int           g_candCount = 0;
static FILE         *g_log = NULL;
static volatile int  g_running = 0;

/* ─── Logging ────────────────────────────────────────────────────────────── */

static void dlog(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void dlog(const char *fmt, ...) {
    if (!g_log) return;
    va_list ap;
    va_start(ap, fmt);
    vfprintf(g_log, fmt, ap);
    va_end(ap);
    fflush(g_log);
}

/* ─── Region walk ────────────────────────────────────────────────────────── */

static void walk_dynamic_regions(void (^visit)(uint64_t base, uint64_t size)) {
    mach_vm_address_t addr = 1;
    while (1) {
        mach_vm_size_t sz = 0;
        natural_t depth = 0;
        vm_region_submap_info_data_64_t info;
        mach_msg_type_number_t cnt = VM_REGION_SUBMAP_INFO_COUNT_64;

        kern_return_t kr = mach_vm_region_recurse(
            mach_task_self(), &addr, &sz, &depth,
            (vm_region_recurse_info_t)&info, &cnt);
        if (kr != KERN_SUCCESS) break;

        bool readable = (info.protection & VM_PROT_READ) != 0;
        bool writable = (info.protection & VM_PROT_WRITE) != 0;
        if (readable && writable && sz <= (256ull << 20) && sz >= 4096) {
            visit((uint64_t)addr, (uint64_t)sz);
        }

        addr += sz;
        if (addr == 0) break;
    }
}

/* ─── Stage 1: lock gameTime absolute address ────────────────────────────── */

static void initial_snapshot(void) {
    g_candCount = 0;
    walk_dynamic_regions(^(uint64_t base, uint64_t size) {
        if (g_candCount >= MAX_CANDIDATES) return;
        const float *p = (const float *)(uintptr_t)base;
        size_t n = size / sizeof(float);
        for (size_t i = 0; i < n && g_candCount < MAX_CANDIDATES; i++) {
            float v = p[i];
            /* In-game gameTime starts at 0 and grows. Filter to the
             * plausible window for an active game: 0..3600. Reject
             * subnormals/NaN/Inf. */
            if (!isfinite(v))   continue;
            if (v < 0.0f)        continue;
            if (v > 3600.0f)     continue;
            /* Reject exactly-zero floods (uninitialized memory). Real
             * gameTime is rarely exactly 0 once we've waited WARMUP_SEC. */
            if (v < 0.5f)        continue;
            g_cands[g_candCount].addr       = base + i * sizeof(float);
            g_cands[g_candCount].samples[0] = v;
            g_candCount++;
        }
    });
    dlog("[discover] initial snapshot: %d float candidates in [0.5, 3600]\n",
         g_candCount);
}

/* Re-read pass `passIdx` (0-based after initial); keep candidates whose
 * delta from previous pass ≈ SAMPLE_GAP_SEC ± DELTA_TOL. */
static void refine_pass(int passIdx) {
    int kept = 0;
    for (int i = 0; i < g_candCount; i++) {
        float prev = g_cands[i].samples[passIdx];
        float now = 0;
        if (!memreader_read_f32(g_cands[i].addr, &now)) continue;
        if (!isfinite(now) || now < 0 || now > 3600) continue;

        float delta = now - prev;
        float expected = (float)SAMPLE_GAP_SEC;
        if (fabsf(delta - expected) > DELTA_TOL) continue;

        g_cands[kept] = g_cands[i];
        g_cands[kept].samples[passIdx + 1] = now;
        kept++;
    }
    g_candCount = kept;
    dlog("[discover] pass %d: kept %d candidates after Δ≈%ds±%.1fs filter\n",
         passIdx + 1, g_candCount, SAMPLE_GAP_SEC, DELTA_TOL);
}

/* ─── Stage 2: pointer-chain finder ──────────────────────────────────────── */

typedef struct { uint64_t base, size; } Segment;

#define MAX_SEGS 16
static Segment g_dataSegs[MAX_SEGS];
static int     g_dataSegCount = 0;

static void enumerate_image_data_segments(void) {
    g_dataSegCount = 0;
    uint64_t imageBase = memreader_image_base();
    if (!imageBase) return;

    const struct mach_header_64 *mh =
        (const struct mach_header_64 *)(uintptr_t)imageBase;
    if (mh->magic != MH_MAGIC_64) return;

    intptr_t slide = 0;
    /* Locate the matching dyld image to derive slide. */
    uint32_t n = _dyld_image_count();
    for (uint32_t i = 0; i < n; i++) {
        if (_dyld_get_image_header(i) == (const struct mach_header *)mh) {
            slide = _dyld_get_image_vmaddr_slide(i);
            break;
        }
    }

    const uint8_t *cmd = (const uint8_t *)(mh + 1);
    for (uint32_t i = 0; i < mh->ncmds && g_dataSegCount < MAX_SEGS; i++) {
        const struct load_command *lc = (const struct load_command *)cmd;
        if (lc->cmd == LC_SEGMENT_64) {
            const struct segment_command_64 *seg =
                (const struct segment_command_64 *)cmd;
            if (strncmp(seg->segname, "__DATA", 6) == 0) {
                /* Capture segment with slide applied. Skip oversized; we
                 * only want pointer-table-bearing data segments. */
                if (seg->vmsize > 0 && seg->vmsize < (32ull << 20)) {
                    g_dataSegs[g_dataSegCount].base = seg->vmaddr + slide;
                    g_dataSegs[g_dataSegCount].size = seg->vmsize;
                    dlog("[discover] image seg %.*s base=0x%llx size=0x%llx\n",
                         (int)sizeof seg->segname, seg->segname,
                         g_dataSegs[g_dataSegCount].base,
                         g_dataSegs[g_dataSegCount].size);
                    g_dataSegCount++;
                }
            }
        }
        cmd += lc->cmdsize;
    }
}

static void find_pointer_chain(uint64_t targetAddr) {
    uint64_t imageBase = memreader_image_base();
    int matches = 0;
    for (int s = 0; s < g_dataSegCount; s++) {
        const uint64_t *p = (const uint64_t *)(uintptr_t)g_dataSegs[s].base;
        size_t n = g_dataSegs[s].size / sizeof(uint64_t);
        for (size_t i = 0; i < n; i++) {
            uint64_t v = p[i];
            /* Direct hit: pointer points at gameTime field itself. */
            if (v == targetAddr) {
                uint64_t slotAddr = g_dataSegs[s].base + i * sizeof(uint64_t);
                dlog("[discover] CHAIN direct: imageBase+0x%llx → 0x%llx (=target)\n",
                     slotAddr - imageBase, v);
                dlog("            config: oGameTime via *(u64*)(image+0x%llx) + 0x0\n",
                     slotAddr - imageBase);
                matches++;
                if (matches >= 16) return;
                continue;
            }
            /* Containing struct: pointer points within 0x2000 below target. */
            if (v < targetAddr && (targetAddr - v) <= 0x2000) {
                uint64_t slotAddr = g_dataSegs[s].base + i * sizeof(uint64_t);
                /* Confirm v is readable (rejects scalars that happen to
                 * sit in pointer range). */
                uint8_t probe = 0;
                if (!memreader_read_bytes(v, &probe, 1)) continue;
                dlog("[discover] CHAIN indirect: imageBase+0x%llx → 0x%llx, "
                     "fieldOffset=0x%llx\n",
                     slotAddr - imageBase, v, targetAddr - v);
                dlog("            config: ptr = *(u64*)(image+0x%llx); "
                     "gameTime = *(float*)(ptr + 0x%llx)\n",
                     slotAddr - imageBase, targetAddr - v);
                matches++;
                if (matches >= 16) return;
            }
        }
    }
    if (matches == 0) {
        dlog("[discover] no static pointer chain found within 0x2000 of target. "
             "May need deeper indirection or stack-resident state.\n");
    }
}

/* ─── Background thread ──────────────────────────────────────────────────── */

static void *discovery_thread(void *arg) {
    (void)arg;
    pthread_setname_np("lol-discovery");

    g_log = fopen(DISCOVERY_LOG, "a");
    if (!g_log) return NULL;

    dlog("\n========================================\n");
    dlog("[discover] start pid=%d image=0x%llx\n",
         getpid(), memreader_image_base());

    /* Allocate candidate buffer once; ~1.3 MB. */
    g_cands = calloc(MAX_CANDIDATES, sizeof(GameTimeCand));
    if (!g_cands) {
        dlog("[discover] calloc failed\n");
        return NULL;
    }

    enumerate_image_data_segments();

    dlog("[discover] sleeping %ds for game to warm up "
         "(load past loading screen)…\n", WARMUP_SEC);
    sleep(WARMUP_SEC);

    initial_snapshot();
    if (g_candCount == 0) {
        dlog("[discover] no candidates — game probably not in-progress yet. "
             "Re-run after the round actually starts.\n");
        free(g_cands);
        return NULL;
    }

    for (int p = 0; p < SAMPLE_PASSES - 1; p++) {
        sleep(SAMPLE_GAP_SEC);
        refine_pass(p);
        if (g_candCount == 0) break;
    }

    if (g_candCount == 0) {
        dlog("[discover] no survivors. game paused, replay scrubbing, "
             "or filter too tight (try DELTA_TOL=1.0).\n");
        free(g_cands);
        return NULL;
    }

    dlog("[discover] FINAL: %d gameTime candidates\n", g_candCount);
    int show = g_candCount < 32 ? g_candCount : 32;
    for (int i = 0; i < show; i++) {
        GameTimeCand *c = &g_cands[i];
        dlog("  addr=0x%llx samples=", c->addr);
        for (int k = 0; k < SAMPLE_PASSES; k++) {
            dlog("%.2f%s", c->samples[k],
                 (k + 1 < SAMPLE_PASSES) ? "," : "");
        }
        dlog("\n");
    }

    /* Pointer chain hunt for the first few candidates. The real gameTime
     * almost always has a static pointer in __DATA; competing matches
     * (animation timers) often don't, so this naturally narrows. */
    int chainHunt = g_candCount < 4 ? g_candCount : 4;
    for (int i = 0; i < chainHunt; i++) {
        dlog("[discover] hunting chain for candidate %d (addr=0x%llx)…\n",
             i, g_cands[i].addr);
        find_pointer_chain(g_cands[i].addr);
    }

    dlog("[discover] done. Action items:\n"
         "  1. Pick the candidate whose final sample matches the in-game timer\n"
         "  2. Use the corresponding 'config:' line to set MemReaderConfig\n"
         "  3. Re-launch with LOL_MEMREAD=1 to enable per-frame reads\n");

    free(g_cands);
    return NULL;
}

/* ─── Stage 4: champion-name finder ──────────────────────────────────────── */

/* Forward decls — actual definitions appear later in this file (drop static
 * there too). */
typedef struct { uint64_t addr; uint64_t regionBase, regionEnd; } NameHit;
typedef struct { uint64_t slotAddr; uint64_t regionBase, regionEnd; } PtrHit;
#define MAX_NAME_HITS 64
#define MAX_PTRTONAME_HITS 256
extern NameHit g_nameHits[MAX_NAME_HITS];
extern int     g_nameHitCount;
extern PtrHit  g_ptrHits[MAX_PTRTONAME_HITS];
extern int     g_ptrHitCount;
int memmem_count(const uint8_t *hay, size_t haylen,
                 const uint8_t *needle, size_t nlen,
                 uint64_t regionBase, uint64_t regionEnd);

/* Same pipeline as find-player but scans for a champion name (e.g. "Syndra").
 * Champion strings appear inside PlayerCharacter (often inline char[N] or as
 * a heap pointer). Auto-chains into ptr-to-name + heap-dump.
 *
 * Trigger: /tmp/lol-overlay.find-champion containing one line:
 *     <championName>
 * e.g. "Syndra".
 */
#define FIND_CHAMPION_TRIGGER_FILE "/tmp/lol-overlay.find-champion"

static void *find_champion_thread(void *arg) {
    (void)arg;
    pthread_setname_np("lol-find-champion");
    if (!g_log) g_log = fopen(DISCOVERY_LOG, "a");
    if (!g_log) return NULL;

    FILE *f = fopen(FIND_CHAMPION_TRIGGER_FILE, "r");
    if (!f) return NULL;
    char name[64] = {0};
    if (!fgets(name, sizeof name, f)) { fclose(f); return NULL; }
    fclose(f);
    size_t nlen = strlen(name);
    while (nlen > 0 && (name[nlen-1] == '\n' || name[nlen-1] == '\r' ||
                        name[nlen-1] == ' '  || name[nlen-1] == '\t')) {
        name[--nlen] = 0;
    }
    if (nlen < 3) { dlog("[champ] name too short\n"); return NULL; }

    dlog("\n[champ] scan for champion='%s' (len=%zu)\n", name, nlen);
    if (g_dataSegCount == 0) enumerate_image_data_segments();

    dlog("[champ] sleep 8s…\n");
    sleep(8);

    g_nameHitCount = 0;
    char *needle = strdup(name);
    size_t needleLen = nlen;
    walk_dynamic_regions(^(uint64_t base, uint64_t size) {
        if (g_nameHitCount >= MAX_NAME_HITS) return;
        memmem_count((const uint8_t *)(uintptr_t)base, (size_t)size,
                     (const uint8_t *)needle, needleLen, base, base + size);
    });
    free(needle);
    dlog("[champ] hits: %d\n", g_nameHitCount);

    uint64_t imageBase = memreader_image_base();
    int show = g_nameHitCount < 32 ? g_nameHitCount : 32;
    for (int h = 0; h < show; h++) {
        uint64_t a = g_nameHits[h].addr;
        bool inImage = false;
        for (int s = 0; s < g_dataSegCount; s++) {
            if (a >= g_dataSegs[s].base &&
                a <  g_dataSegs[s].base + g_dataSegs[s].size) {
                inImage = true; break;
            }
        }
        dlog("[champ] hit %d: 0x%llx (%s)\n",
             h, a, inImage ? "image" : "heap");
    }

    /* Pick first heap hit, scan u64 == hit. */
    int heapHit = -1;
    for (int h = 0; h < g_nameHitCount; h++) {
        uint64_t a = g_nameHits[h].addr;
        bool inImage = false;
        for (int s = 0; s < g_dataSegCount; s++) {
            if (a >= g_dataSegs[s].base &&
                a <  g_dataSegs[s].base + g_dataSegs[s].size) {
                inImage = true; break;
            }
        }
        if (!inImage) { heapHit = h; break; }
    }
    if (heapHit < 0) {
        /* No heap hit — try image hit (champion name is read-only string). */
        if (g_nameHitCount > 0) heapHit = 0;
        else { dlog("[champ] no hits at all\n"); return NULL; }
    }

    uint64_t targetName = g_nameHits[heapHit].addr;
    dlog("\n[champ-ptr] scan u64==0x%llx\n", targetName);

    g_ptrHitCount = 0;
    __block uint64_t targetCap = targetName;
    walk_dynamic_regions(^(uint64_t base, uint64_t size) {
        if (g_ptrHitCount >= MAX_PTRTONAME_HITS) return;
        const uint64_t *pp = (const uint64_t *)(uintptr_t)base;
        size_t nn = size / sizeof(uint64_t);
        for (size_t i = 0; i < nn && g_ptrHitCount < MAX_PTRTONAME_HITS; i++) {
            if (pp[i] == targetCap) {
                g_ptrHits[g_ptrHitCount].slotAddr   = base + i * sizeof(uint64_t);
                g_ptrHits[g_ptrHitCount].regionBase = base;
                g_ptrHits[g_ptrHitCount].regionEnd  = base + size;
                g_ptrHitCount++;
            }
        }
    });
    dlog("[champ-ptr] hits: %d\n", g_ptrHitCount);

    int pshow = g_ptrHitCount < 16 ? g_ptrHitCount : 16;
    for (int h = 0; h < pshow; h++) {
        uint64_t slotAddr = g_ptrHits[h].slotAddr;
        bool inImage = false;
        for (int s = 0; s < g_dataSegCount; s++) {
            if (slotAddr >= g_dataSegs[s].base &&
                slotAddr <  g_dataSegs[s].base + g_dataSegs[s].size) {
                inImage = true; break;
            }
        }
        dlog("[champ-ptr] slot %d: 0x%llx (%s)\n",
             h, slotAddr, inImage ? "image" : "heap");
        if (!inImage) {
            /* hunt static chain */
            int matches = 0;
            for (int s = 0; s < g_dataSegCount && matches < 4; s++) {
                const uint64_t *pp = (const uint64_t *)(uintptr_t)g_dataSegs[s].base;
                size_t cnt = g_dataSegs[s].size / sizeof(uint64_t);
                for (size_t i = 0; i < cnt && matches < 4; i++) {
                    uint64_t v = pp[i];
                    if (v == 0 || v > slotAddr) continue;
                    if ((slotAddr - v) > 0x4000) continue;
                    uint8_t probe = 0;
                    if (!memreader_read_bytes(v, &probe, 1)) continue;
                    uint64_t staticSlot = g_dataSegs[s].base + i * sizeof(uint64_t);
                    dlog("       CHAIN: image+0x%llx → struct@0x%llx, "
                         "champOff=0x%llx\n",
                         staticSlot - imageBase, v, slotAddr - v);
                    matches++;
                }
            }
        }
    }

    /* Dump first heap slot. */
    int heapSlot = -1;
    for (int h = 0; h < g_ptrHitCount; h++) {
        uint64_t a = g_ptrHits[h].slotAddr;
        bool inImage = false;
        for (int s = 0; s < g_dataSegCount; s++) {
            if (a >= g_dataSegs[s].base &&
                a <  g_dataSegs[s].base + g_dataSegs[s].size) {
                inImage = true; break;
            }
        }
        if (!inImage) { heapSlot = h; break; }
    }
    if (heapSlot < 0) {
        dlog("[champ-dump] no heap slot\n");
        return NULL;
    }

    uint64_t slotAddr = g_ptrHits[heapSlot].slotAddr;
    uint64_t dumpBase = slotAddr - 0x300;
    dlog("\n[champ-dump] slot %d: 0x%llx → dump [0x%llx..0x%llx], slot at +0x300\n",
         heapSlot, slotAddr, dumpBase, dumpBase + 0x800);

    uint8_t row[16];
    for (int r = 0; r < 0x800 / 16; r++) {
        uint64_t a = dumpBase + r * 16;
        if (!memreader_read_bytes(a, row, 16)) {
            dlog("[champ-dump] +0x%03x: <unreadable>\n", r * 16);
            continue;
        }
        char hex[64], asc[20];
        for (int i = 0; i < 16; i++) {
            sprintf(hex + i*3, "%02x ", row[i]);
            asc[i] = (row[i] >= 0x20 && row[i] < 0x7f) ? (char)row[i] : '.';
        }
        asc[16] = 0;
        const char *marker = (r * 16 == 0x300) ? "  <-- SLOT" : "";
        dlog("[champ-dump] +0x%03x: %s |%s|%s\n", r * 16, hex, asc, marker);
    }
    dlog("[champ-dump] field hints (slot=+0x300):\n");
    for (int o = 0; o < 0x800; o += 4) {
        uint32_t u = 0;
        if (!memreader_read_u32(dumpBase + o, &u)) continue;
        if (u == 100 || u == 200) {
            dlog("       +0x%03x (slot%+d): u32=%u  ← oTeam?\n",
                 o, o - 0x300, u);
        }
        if (u >= 1 && u <= 18) {
            dlog("       +0x%03x (slot%+d): u32=%u  ← oLevel?\n",
                 o, o - 0x300, u);
        }
    }
    for (int o = 0; o < 0x800; o += 8) {
        uint64_t v = 0;
        if (!memreader_read_u64(dumpBase + o, &v)) continue;
        if (v == 0) continue;
        char s[40] = {0};
        if (memreader_read_cstr(v, s, sizeof s)) {
            size_t L = strlen(s);
            if (L >= 3 && L <= 36) {
                bool printable = true;
                for (size_t k = 0; k < L; k++) {
                    if (s[k] < 0x20 || s[k] >= 0x7f) { printable = false; break; }
                }
                if (printable) {
                    dlog("       +0x%03x (slot%+d): u64=0x%llx → cstr='%s'\n",
                         o, o - 0x300, v, s);
                }
            }
        }
    }
    dlog("[champ-dump] done\n");
    return NULL;
}

/* ─── Stage 3.6: pointer-to-name finder ─────────────────────────────────── */

/* Most LoL player structs hold name as POINTER to a string pool, not inline.
 * Stage 3 hits the string pool itself. Stage 3.6 takes a known name addr
 * (from stage 3 log) and scans writable regions for u64 slots whose value
 * equals that addr. Each hit is a struct that carries a `&summonerName`
 * field — one of them is PlayerCharacter.
 *
 * Trigger: /tmp/lol-overlay.find-ptr-to-name containing one line:
 *     <nameAddr hex>
 * e.g. "0x12f07ee20".
 */
#define FIND_PTRTONAME_TRIGGER_FILE "/tmp/lol-overlay.find-ptr-to-name"

PtrHit g_ptrHits[MAX_PTRTONAME_HITS];
int    g_ptrHitCount = 0;

static void *find_ptr_to_name_thread(void *arg) {
    (void)arg;
    pthread_setname_np("lol-find-ptrtoname");
    if (!g_log) g_log = fopen(DISCOVERY_LOG, "a");
    if (!g_log) return NULL;

    FILE *f = fopen(FIND_PTRTONAME_TRIGGER_FILE, "r");
    if (!f) return NULL;
    char buf[64] = {0};
    if (!fgets(buf, sizeof buf, f)) { fclose(f); return NULL; }
    fclose(f);
    uint64_t target = (uint64_t)strtoull(buf, NULL, 0);
    if (target == 0) { dlog("[ptr] bad target\n"); return NULL; }

    if (g_dataSegCount == 0) enumerate_image_data_segments();

    dlog("\n[ptr] sleep 8s, then scan writable regions for u64==0x%llx\n", target);
    sleep(8);

    g_ptrHitCount = 0;
    __block uint64_t targetCap = target;
    walk_dynamic_regions(^(uint64_t base, uint64_t size) {
        if (g_ptrHitCount >= MAX_PTRTONAME_HITS) return;
        const uint64_t *p = (const uint64_t *)(uintptr_t)base;
        size_t n = size / sizeof(uint64_t);
        for (size_t i = 0; i < n && g_ptrHitCount < MAX_PTRTONAME_HITS; i++) {
            if (p[i] == targetCap) {
                g_ptrHits[g_ptrHitCount].slotAddr   = base + i * sizeof(uint64_t);
                g_ptrHits[g_ptrHitCount].regionBase = base;
                g_ptrHits[g_ptrHitCount].regionEnd  = base + size;
                g_ptrHitCount++;
            }
        }
    });
    dlog("[ptr] hits: %d\n", g_ptrHitCount);

    /* For each slot, hunt static chain: is there a static u64 pointing within
     * 0x4000 below slotAddr? That static u64 = oLocalPlayer (or hero list
     * entry); slotAddr - chainTarget = oSummonerName field offset. */
    uint64_t imageBase = memreader_image_base();
    int show = g_ptrHitCount < 32 ? g_ptrHitCount : 32;
    for (int h = 0; h < show; h++) {
        uint64_t slotAddr = g_ptrHits[h].slotAddr;
        dlog("[ptr] slot %d: addr=0x%llx (region 0x%llx..0x%llx)\n",
             h, slotAddr, g_ptrHits[h].regionBase, g_ptrHits[h].regionEnd);

        int chainMatches = 0;
        for (int s = 0; s < g_dataSegCount && chainMatches < 4; s++) {
            const uint64_t *p = (const uint64_t *)(uintptr_t)g_dataSegs[s].base;
            size_t cnt = g_dataSegs[s].size / sizeof(uint64_t);
            for (size_t i = 0; i < cnt && chainMatches < 4; i++) {
                uint64_t v = p[i];
                if (v == 0 || v > slotAddr) continue;
                if ((slotAddr - v) > 0x4000) continue;
                uint8_t probe = 0;
                if (!memreader_read_bytes(v, &probe, 1)) continue;
                uint64_t staticSlot = g_dataSegs[s].base + i * sizeof(uint64_t);
                dlog("       CHAIN: image+0x%llx → struct@0x%llx, "
                     "nameOff=0x%llx\n",
                     staticSlot - imageBase, v, slotAddr - v);
                dlog("       config: oLocalPlayer=0x%llx oSummonerName=0x%llx "
                     "summonerNameIsPointer=1\n",
                     staticSlot - imageBase, slotAddr - v);
                chainMatches++;
            }
        }
        if (chainMatches == 0) {
            dlog("       no static chain (heap-only or deeper indirection)\n");
        }
    }
    dlog("[ptr] done\n");
    return NULL;
}

/* ─── Stage 3.5: player struct dumper ────────────────────────────────────── */

/* Trigger: /tmp/lol-overlay.dump-player containing one line:
 *     <oLocalPlayer hex>
 * e.g. "0x23b82b0". Dumper does:
 *     ptr = *(u64*)(imageBase + offset)
 *     hexdump(ptr, 0x800) with ASCII gutter
 *     scan for floats in [1..3600], int32s in [1..18] (level), [100,200] (team)
 * so user can spot oTeam, oLevel, oChampionName, oSpellBook by inspection. */
#define DUMP_PLAYER_TRIGGER_FILE "/tmp/lol-overlay.dump-player"

static void *dump_player_thread(void *arg) {
    (void)arg;
    pthread_setname_np("lol-dump-player");
    if (!g_log) g_log = fopen(DISCOVERY_LOG, "a");
    if (!g_log) return NULL;

    FILE *f = fopen(DUMP_PLAYER_TRIGGER_FILE, "r");
    if (!f) return NULL;
    char buf[64] = {0};
    if (!fgets(buf, sizeof buf, f)) { fclose(f); return NULL; }
    fclose(f);
    uint64_t off = (uint64_t)strtoull(buf, NULL, 0);
    if (off == 0) { dlog("[dump] bad offset\n"); return NULL; }

    dlog("[dump] sleeping 8s for game stability…\n");
    sleep(8);

    uint64_t imageBase = memreader_image_base();
    uint64_t slotAddr = imageBase + off;
    uint64_t ptr = 0;
    if (!memreader_read_u64(slotAddr, &ptr)) {
        dlog("[dump] cannot read slot at image+0x%llx\n", off);
        return NULL;
    }
    dlog("\n[dump] image+0x%llx → struct@0x%llx\n", off, ptr);

    /* Hex-dump 0x800 bytes, 16 per row. */
    uint8_t row[16];
    for (int r = 0; r < 0x800 / 16; r++) {
        uint64_t a = ptr + r * 16;
        if (!memreader_read_bytes(a, row, 16)) {
            dlog("[dump] +0x%03x: <unreadable>\n", r * 16);
            break;
        }
        char hex[64], asc[20];
        for (int i = 0; i < 16; i++) {
            sprintf(hex + i*3, "%02x ", row[i]);
            asc[i] = (row[i] >= 0x20 && row[i] < 0x7f) ? (char)row[i] : '.';
        }
        asc[16] = 0;
        dlog("[dump] +0x%03x: %s |%s|\n", r * 16, hex, asc);
    }

    /* Heuristic field hunt. Scan first 0x800 bytes as int32s and floats. */
    dlog("[dump] field hints:\n");
    for (int o = 0; o < 0x800; o += 4) {
        uint32_t u = 0;
        if (!memreader_read_u32(ptr + o, &u)) continue;
        /* Team = 100 (ORDER) or 200 (CHAOS) */
        if (u == 100 || u == 200) {
            dlog("       +0x%03x: u32=%u  ← possible oTeam\n", o, u);
        }
        /* Level 1..18 */
        if (u >= 1 && u <= 18) {
            float fv;
            memreader_read_f32(ptr + o, &fv);
            /* avoid noise from generic small ints — only flag if neighbor floats look like XP */
            if (o >= 4 && o < 0x800 - 4) {
                dlog("       +0x%03x: u32=%u  ← possible oLevel/index\n", o, u);
            }
        }
    }
    /* Scan for embedded cstrings (champion name, etc.) */
    for (int o = 0; o < 0x800; o++) {
        char s[32];
        if (!memreader_read_cstr(ptr + o, s, sizeof s)) continue;
        size_t L = strlen(s);
        if (L < 4 || L > 24) continue;
        bool printable = true;
        for (size_t k = 0; k < L; k++) {
            if (s[k] < 0x20 || s[k] >= 0x7f) { printable = false; break; }
        }
        if (!printable) continue;
        dlog("       +0x%03x: cstr='%s'\n", o, s);
        o += L;        /* skip past string */
    }

    dlog("[dump] done\n");
    return NULL;
}

/* ─── Stage 3: player struct finder ──────────────────────────────────────── */

/* Trigger: /tmp/lol-overlay.find-player containing one line = summoner name
 * (case-sensitive, trimmed). Scans every writable region for the literal
 * string, treats each hit as the start of a name field, then probes nearby
 * u64 slots in __DATA/__DATA_CONST for a pointer that lands within the
 * containing struct (within 0x4000 below name addr). Logs candidates so user
 * can pick oLocalPlayer + oSummonerName + struct size. */
#define FIND_PLAYER_TRIGGER_FILE "/tmp/lol-overlay.find-player"

NameHit g_nameHits[MAX_NAME_HITS];
int     g_nameHitCount = 0;

int memmem_count(const uint8_t *hay, size_t haylen,
                 const uint8_t *needle, size_t nlen,
                 uint64_t regionBase, uint64_t regionEnd) {
    if (nlen == 0 || haylen < nlen) return 0;
    int found = 0;
    for (size_t i = 0; i + nlen <= haylen; i++) {
        if (hay[i] != needle[0]) continue;
        if (memcmp(hay + i, needle, nlen) != 0) continue;
        /* Require NUL or non-printable byte after to avoid matching substrings
         * inside longer strings. */
        uint8_t after = (i + nlen < haylen) ? hay[i + nlen] : 0;
        if (after != 0 && (after >= 0x20 && after < 0x7f)) continue;
        if (g_nameHitCount < MAX_NAME_HITS) {
            g_nameHits[g_nameHitCount].addr       = regionBase + i;
            g_nameHits[g_nameHitCount].regionBase = regionBase;
            g_nameHits[g_nameHitCount].regionEnd  = regionEnd;
            g_nameHitCount++;
            found++;
        }
    }
    return found;
}

static void *find_player_thread(void *arg) {
    (void)arg;
    pthread_setname_np("lol-find-player");
    if (!g_log) g_log = fopen(DISCOVERY_LOG, "a");
    if (!g_log) return NULL;

    /* Read summoner name. */
    FILE *f = fopen(FIND_PLAYER_TRIGGER_FILE, "r");
    if (!f) { dlog("[find] cannot open %s\n", FIND_PLAYER_TRIGGER_FILE); return NULL; }
    char name[128] = {0};
    if (!fgets(name, sizeof name, f)) { fclose(f); return NULL; }
    fclose(f);
    /* Trim trailing whitespace/newline. */
    size_t nlen = strlen(name);
    while (nlen > 0 && (name[nlen-1] == '\n' || name[nlen-1] == '\r' ||
                        name[nlen-1] == ' '  || name[nlen-1] == '\t')) {
        name[--nlen] = 0;
    }
    if (nlen < 2) { dlog("[find] name too short: '%s'\n", name); return NULL; }

    dlog("\n[find] scan for summoner='%s' (len=%zu)\n", name, nlen);

    /* Need data segs for pointer scan. */
    if (g_dataSegCount == 0) enumerate_image_data_segments();

    /* Sleep so user is in-game. */
    dlog("[find] sleeping 10s (be in-game with that summoner visible)…\n");
    sleep(10);

    /* Scan writable regions for the name. Block needs pointer (not array)
     * to capture, so duplicate name on heap. */
    g_nameHitCount = 0;
    char *needle = strdup(name);
    size_t needleLen = nlen;
    walk_dynamic_regions(^(uint64_t base, uint64_t size) {
        if (g_nameHitCount >= MAX_NAME_HITS) return;
        memmem_count((const uint8_t *)(uintptr_t)base, (size_t)size,
                     (const uint8_t *)needle, needleLen, base, base + size);
    });
    free(needle);
    dlog("[find] name hits: %d\n", g_nameHitCount);

    /* For each hit, hunt static pointer chain that lands within 0x4000 below
     * the name address (i.e., the containing struct's start). */
    uint64_t imageBase = memreader_image_base();
    int show = g_nameHitCount < 16 ? g_nameHitCount : 16;
    for (int h = 0; h < show; h++) {
        uint64_t nameAddr = g_nameHits[h].addr;
        dlog("[find] hit %d: name@0x%llx (region 0x%llx..0x%llx)\n",
             h, nameAddr, g_nameHits[h].regionBase, g_nameHits[h].regionEnd);

        int chainMatches = 0;
        for (int s = 0; s < g_dataSegCount && chainMatches < 8; s++) {
            const uint64_t *p = (const uint64_t *)(uintptr_t)g_dataSegs[s].base;
            size_t cnt = g_dataSegs[s].size / sizeof(uint64_t);
            for (size_t i = 0; i < cnt && chainMatches < 8; i++) {
                uint64_t v = p[i];
                /* Pointer must land at or below nameAddr, within 0x4000. */
                if (v == 0) continue;
                if (v > nameAddr) continue;
                if ((nameAddr - v) > 0x4000) continue;
                /* Probe readable. */
                uint8_t probe = 0;
                if (!memreader_read_bytes(v, &probe, 1)) continue;
                uint64_t slotAddr = g_dataSegs[s].base + i * sizeof(uint64_t);
                dlog("       PLAYER chain: image+0x%llx → struct@0x%llx, "
                     "nameOffset=0x%llx\n",
                     slotAddr - imageBase, v, nameAddr - v);
                dlog("       config: oLocalPlayer=0x%llx oSummonerName=0x%llx\n",
                     slotAddr - imageBase, nameAddr - v);
                chainMatches++;
            }
        }
        if (chainMatches == 0) {
            dlog("       no static chain within 0x4000. Heap-only struct.\n");
        }
    }

    dlog("[find] done. If multiple chains found: pick one whose nameOffset is\n"
         "       small (typically 0x10..0x200) and consistent across re-runs.\n");

    /* Stage 3.6 auto-chain: name addr is heap, regenerated every session.
     * Take the first heap hit (region NOT in __DATA / __DATA_CONST), scan
     * writable regions for u64 == nameAddr to find structs that hold name as
     * a POINTER. Real PlayerCharacter is one of those. */
    int heapHit = -1;
    for (int h = 0; h < g_nameHitCount; h++) {
        uint64_t a = g_nameHits[h].addr;
        bool inImage = false;
        for (int s = 0; s < g_dataSegCount; s++) {
            if (a >= g_dataSegs[s].base &&
                a <  g_dataSegs[s].base + g_dataSegs[s].size) {
                inImage = true; break;
            }
        }
        if (!inImage) { heapHit = h; break; }
    }
    if (heapHit < 0) {
        dlog("[find] no heap name hit, skip ptr-to-name auto-chain\n");
        return NULL;
    }

    uint64_t targetName = g_nameHits[heapHit].addr;
    dlog("\n[ptr-auto] scan u64==0x%llx (heap name from hit %d)\n",
         targetName, heapHit);

    g_ptrHitCount = 0;
    __block uint64_t targetCap = targetName;
    walk_dynamic_regions(^(uint64_t base, uint64_t size) {
        if (g_ptrHitCount >= MAX_PTRTONAME_HITS) return;
        const uint64_t *pp = (const uint64_t *)(uintptr_t)base;
        size_t nn = size / sizeof(uint64_t);
        for (size_t i = 0; i < nn && g_ptrHitCount < MAX_PTRTONAME_HITS; i++) {
            if (pp[i] == targetCap) {
                g_ptrHits[g_ptrHitCount].slotAddr   = base + i * sizeof(uint64_t);
                g_ptrHits[g_ptrHitCount].regionBase = base;
                g_ptrHits[g_ptrHitCount].regionEnd  = base + size;
                g_ptrHitCount++;
            }
        }
    });
    dlog("[ptr-auto] hits: %d\n", g_ptrHitCount);

    int pshow = g_ptrHitCount < 16 ? g_ptrHitCount : 16;
    for (int h = 0; h < pshow; h++) {
        uint64_t slotAddr = g_ptrHits[h].slotAddr;
        dlog("[ptr-auto] slot %d: addr=0x%llx\n", h, slotAddr);

        int matches = 0;
        for (int s = 0; s < g_dataSegCount && matches < 4; s++) {
            const uint64_t *pp = (const uint64_t *)(uintptr_t)g_dataSegs[s].base;
            size_t cnt = g_dataSegs[s].size / sizeof(uint64_t);
            for (size_t i = 0; i < cnt && matches < 4; i++) {
                uint64_t v = pp[i];
                if (v == 0 || v > slotAddr) continue;
                if ((slotAddr - v) > 0x4000) continue;
                uint8_t probe = 0;
                if (!memreader_read_bytes(v, &probe, 1)) continue;
                uint64_t staticSlot = g_dataSegs[s].base + i * sizeof(uint64_t);
                dlog("       CHAIN: image+0x%llx → struct@0x%llx, "
                     "nameOff=0x%llx\n",
                     staticSlot - imageBase, v, slotAddr - v);
                dlog("       config: oLocalPlayer=0x%llx oSummonerName=0x%llx "
                     "summonerNameIsPointer=1\n",
                     staticSlot - imageBase, slotAddr - v);
                matches++;
            }
        }
        if (matches == 0) {
            dlog("       no static chain (heap-only)\n");
        }
    }
    dlog("[ptr-auto] done\n");

    /* Stage 3.7 auto-chain: dump 0x800 bytes around first heap slot. The slot
     * is the `&summonerName` field inside the real PlayerCharacter; struct
     * head lives at slot - oSummonerName (unknown), so dump backward 0x300
     * and forward 0x500 to bracket it. User eyeballs team/level/champion. */
    int heapSlot = -1;
    for (int h = 0; h < g_ptrHitCount; h++) {
        uint64_t a = g_ptrHits[h].slotAddr;
        bool inImage = false;
        for (int s = 0; s < g_dataSegCount; s++) {
            if (a >= g_dataSegs[s].base &&
                a <  g_dataSegs[s].base + g_dataSegs[s].size) {
                inImage = true; break;
            }
        }
        if (!inImage) { heapSlot = h; break; }
    }
    if (heapSlot < 0) {
        dlog("[heap-dump] no heap ptr-slot to dump\n");
        return NULL;
    }
    uint64_t slotAddr = g_ptrHits[heapSlot].slotAddr;
    uint64_t dumpBase = slotAddr - 0x300;
    dlog("\n[heap-dump] slot %d: 0x%llx → dump [0x%llx..0x%llx], slot at +0x300\n",
         heapSlot, slotAddr, dumpBase, dumpBase + 0x800);

    uint8_t row[16];
    for (int r = 0; r < 0x800 / 16; r++) {
        uint64_t a = dumpBase + r * 16;
        if (!memreader_read_bytes(a, row, 16)) {
            dlog("[heap-dump] +0x%03x: <unreadable>\n", r * 16);
            continue;
        }
        char hex[64], asc[20];
        for (int i = 0; i < 16; i++) {
            sprintf(hex + i*3, "%02x ", row[i]);
            asc[i] = (row[i] >= 0x20 && row[i] < 0x7f) ? (char)row[i] : '.';
        }
        asc[16] = 0;
        const char *marker = (r * 16 == 0x300) ? "  <-- SLOT" : "";
        dlog("[heap-dump] +0x%03x: %s |%s|%s\n", r * 16, hex, asc, marker);
    }

    dlog("[heap-dump] field hints (relative to dump base; slot=+0x300):\n");
    for (int o = 0; o < 0x800; o += 4) {
        uint32_t u = 0;
        if (!memreader_read_u32(dumpBase + o, &u)) continue;
        if (u == 100 || u == 200) {
            dlog("       +0x%03x (slot%+d): u32=%u  ← oTeam?\n",
                 o, o - 0x300, u);
        }
        if (u >= 1 && u <= 18) {
            dlog("       +0x%03x (slot%+d): u32=%u  ← oLevel?\n",
                 o, o - 0x300, u);
        }
    }
    /* Pull out cstrings + pointers in the dump range. */
    for (int o = 0; o < 0x800; o += 8) {
        uint64_t v = 0;
        if (!memreader_read_u64(dumpBase + o, &v)) continue;
        if (v == 0) continue;
        /* If this u64 is a heap pointer to readable memory, log it (likely
         * SpellBook / ChampionName ptr / etc.) */
        uint8_t probe = 0;
        if (!memreader_read_bytes(v, &probe, 1)) continue;
        /* Filter out vtable-ish pointers (image-resident) too, to keep noise
         * down — we mostly care about heap object pointers. */
        char s[32] = {0};
        if (memreader_read_cstr(v, s, sizeof s)) {
            size_t L = strlen(s);
            if (L >= 3 && L <= 28) {
                bool printable = true;
                for (size_t k = 0; k < L; k++) {
                    if (s[k] < 0x20 || s[k] >= 0x7f) { printable = false; break; }
                }
                if (printable) {
                    dlog("       +0x%03x (slot%+d): u64=0x%llx → cstr='%s'\n",
                         o, o - 0x300, v, s);
                    continue;
                }
            }
        }
        dlog("       +0x%03x (slot%+d): u64=0x%llx (heap ptr)\n",
             o, o - 0x300, v);
    }
    dlog("[heap-dump] done\n");
    return NULL;
}

/* ─── Stage 2.5: gameTime offset verifier ────────────────────────────────── */

/* After discovery picks a candidate, user writes the chosen offset (hex) into
 * /tmp/lol-overlay.verify-gametime, e.g.:
 *     echo 0x23db6ec > /tmp/lol-overlay.verify-gametime
 * Verifier reads imageBase+offset as float every 1s for 60 ticks and logs
 * the values so user can eyeball-compare against in-game timer. */
#define VERIFY_TRIGGER_FILE "/tmp/lol-overlay.verify-gametime"

static void *verify_thread(void *arg) {
    (void)arg;
    pthread_setname_np("lol-verify-gametime");

    if (!g_log) g_log = fopen(DISCOVERY_LOG, "a");
    if (!g_log) return NULL;

    /* Read offset from trigger file. */
    FILE *f = fopen(VERIFY_TRIGGER_FILE, "r");
    if (!f) {
        dlog("[verify] cannot open %s\n", VERIFY_TRIGGER_FILE);
        return NULL;
    }
    char buf[64] = {0};
    if (!fgets(buf, sizeof buf, f)) { fclose(f); return NULL; }
    fclose(f);
    uint64_t offset = (uint64_t)strtoull(buf, NULL, 0);
    if (offset == 0) {
        dlog("[verify] invalid offset in %s: '%s'\n", VERIFY_TRIGGER_FILE, buf);
        return NULL;
    }

    uint64_t imageBase = memreader_image_base();
    uint64_t target = imageBase + offset;
    dlog("\n[verify] start: image=0x%llx offset=0x%llx target=0x%llx\n",
         imageBase, offset, target);
    dlog("[verify] reading float every 1s for 60 ticks. Compare with in-game timer.\n");

    for (int i = 0; i < 60; i++) {
        float v = NAN;
        bool ok = memreader_read_f32(target, &v);
        dlog("[verify] t+%02ds  read=%s  value=%.3f\n",
             i, ok ? "OK" : "FAIL", v);
        sleep(1);
    }
    dlog("[verify] done\n");
    return NULL;
}

/* ─── Public entry ───────────────────────────────────────────────────────── */

/* Game process does NOT inherit env vars from the shell that launched the
 * watcher — LeagueClient spawns LeagueofLegends from launchd. So gating on
 * getenv() never fires. Use a sentinel file instead: user touches
 * /tmp/lol-overlay.discover before/during the game and the dylib picks it
 * up at constructor time. */
#define DISCOVER_TRIGGER_FILE "/tmp/lol-overlay.discover"

void discovery_start(void) {
    if (g_running) return;
    int has_discover = (access(DISCOVER_TRIGGER_FILE,        F_OK) == 0);
    int has_verify   = (access(VERIFY_TRIGGER_FILE,          F_OK) == 0);
    int has_find     = (access(FIND_PLAYER_TRIGGER_FILE,     F_OK) == 0);
    int has_dump     = (access(DUMP_PLAYER_TRIGGER_FILE,     F_OK) == 0);
    int has_ptr      = (access(FIND_PTRTONAME_TRIGGER_FILE,  F_OK) == 0);
    int has_champ    = (access(FIND_CHAMPION_TRIGGER_FILE,   F_OK) == 0);
    fprintf(stderr,
        "[lol-discovery] start gate: discover=%d verify=%d find=%d dump=%d ptr=%d champ=%d\n",
        has_discover, has_verify, has_find, has_dump, has_ptr, has_champ);

    if (has_verify) {
        pthread_t v;
        pthread_create(&v, NULL, verify_thread, NULL);
        pthread_detach(v);
    }
    if (has_find) {
        pthread_t fp;
        pthread_create(&fp, NULL, find_player_thread, NULL);
        pthread_detach(fp);
    }
    if (has_dump) {
        pthread_t dp;
        pthread_create(&dp, NULL, dump_player_thread, NULL);
        pthread_detach(dp);
    }
    if (has_ptr) {
        pthread_t pt;
        pthread_create(&pt, NULL, find_ptr_to_name_thread, NULL);
        pthread_detach(pt);
    }
    if (has_champ) {
        pthread_t ch;
        pthread_create(&ch, NULL, find_champion_thread, NULL);
        pthread_detach(ch);
    }
    if (has_discover) {
        pthread_t t;
        pthread_create(&t, NULL, discovery_thread, NULL);
        pthread_detach(t);
    }
    if (has_discover || has_verify || has_find || has_dump || has_ptr || has_champ)
        g_running = 1;
}
