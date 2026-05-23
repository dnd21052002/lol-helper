/**
 * lol-memreader.m — implementation
 *
 * In-process pointer reads with bounds checking via vm_region_recurse_64.
 * No Mach IPC; this code runs inside LeagueofLegends, so reads are direct
 * dereferences gated by a "is this address mapped readable" probe.
 */

#import <Foundation/Foundation.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <pthread.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#include "lol-memreader.h"

/* ─── Module state ───────────────────────────────────────────────────────── */

static MemReaderConfig g_cfg;          /* zeroed by default → no-op */
static pthread_mutex_t g_cfgLock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t        g_imageBase = 0;
static bool            g_initialized = false;

/* Tiny TTL cache for vm_region_recurse_64 probes; map can be huge. */
#define PROBE_CACHE_SIZE 64
typedef struct { uint64_t base, end; } ProbeRange;
static ProbeRange g_probeCache[PROBE_CACHE_SIZE];
static int        g_probeHead = 0;
static pthread_mutex_t g_probeLock = PTHREAD_MUTEX_INITIALIZER;

/* ─── Image base resolution ──────────────────────────────────────────────── */

static uint64_t resolve_image_base(void) {
    /* Walk loaded images; pick the one whose name ends with /LeagueofLegends.
     * The injected dylib is in the same process so _dyld_image_count covers
     * everything including the main executable. */
    uint32_t n = _dyld_image_count();
    for (uint32_t i = 0; i < n; i++) {
        const char *name = _dyld_get_image_name(i);
        if (!name) continue;
        const char *slash = strrchr(name, '/');
        const char *base  = slash ? slash + 1 : name;
        if (strcmp(base, "LeagueofLegends") == 0 ||
            strcmp(base, "League of Legends") == 0) {
            const struct mach_header *mh = _dyld_get_image_header(i);
            return (uint64_t)(uintptr_t)mh;
        }
    }
    /* Fallback: image index 0 is always the main executable. */
    if (n > 0) {
        return (uint64_t)(uintptr_t)_dyld_get_image_header(0);
    }
    return 0;
}

/* ─── Bounds-checked reads ───────────────────────────────────────────────── */

static bool probe_cached(uint64_t addr, size_t n) {
    pthread_mutex_lock(&g_probeLock);
    for (int i = 0; i < PROBE_CACHE_SIZE; i++) {
        ProbeRange r = g_probeCache[i];
        if (r.base == 0) continue;
        if (addr >= r.base && (addr + n) <= r.end) {
            pthread_mutex_unlock(&g_probeLock);
            return true;
        }
    }
    pthread_mutex_unlock(&g_probeLock);
    return false;
}

static void probe_remember(uint64_t base, uint64_t end) {
    pthread_mutex_lock(&g_probeLock);
    g_probeCache[g_probeHead] = (ProbeRange){ base, end };
    g_probeHead = (g_probeHead + 1) % PROBE_CACHE_SIZE;
    pthread_mutex_unlock(&g_probeLock);
}

static bool addr_is_readable(uint64_t addr, size_t n) {
    if (addr == 0 || n == 0) return false;
    if (addr < 0x1000) return false;        /* obvious null/garbage */
    if (probe_cached(addr, n)) return true;

    mach_vm_address_t a = (mach_vm_address_t)addr;
    mach_vm_size_t    sz = 0;
    natural_t         depth = 0;
    vm_region_submap_info_data_64_t info;
    mach_msg_type_number_t cnt = VM_REGION_SUBMAP_INFO_COUNT_64;

    kern_return_t kr = mach_vm_region_recurse(
        mach_task_self(), &a, &sz, &depth,
        (vm_region_recurse_info_t)&info, &cnt);
    if (kr != KERN_SUCCESS) return false;
    if ((info.protection & VM_PROT_READ) == 0) return false;
    if (a > addr) return false;
    if ((a + sz) < (addr + n)) return false;

    probe_remember(a, a + sz);
    return true;
}

bool memreader_read_bytes(uint64_t addr, void *dst, size_t n) {
    if (!addr_is_readable(addr, n)) return false;
    memcpy(dst, (const void *)(uintptr_t)addr, n);
    return true;
}

bool memreader_read_u64(uint64_t addr, uint64_t *out) {
    return memreader_read_bytes(addr, out, sizeof(*out));
}
bool memreader_read_u32(uint64_t addr, uint32_t *out) {
    return memreader_read_bytes(addr, out, sizeof(*out));
}
bool memreader_read_f32(uint64_t addr, float *out) {
    return memreader_read_bytes(addr, out, sizeof(*out));
}

bool memreader_read_cstr(uint64_t addr, char *dst, size_t cap) {
    if (cap == 0) return false;
    dst[0] = 0;
    /* Read up to (cap-1) bytes, stop at NUL. Probe in chunks of 16 to
     * tolerate strings spanning page-end. */
    size_t out = 0;
    while (out + 1 < cap) {
        size_t chunk = 16;
        if (out + chunk >= cap) chunk = cap - 1 - out;
        char buf[16];
        if (!memreader_read_bytes(addr + out, buf, chunk)) return out > 0;
        for (size_t i = 0; i < chunk; i++) {
            dst[out++] = buf[i];
            if (buf[i] == 0) return true;
            if (out + 1 >= cap) { dst[out] = 0; return true; }
        }
    }
    dst[cap - 1] = 0;
    return true;
}

/* ─── Field readers (handle inline vs. pointer indirection) ──────────────── */

static bool read_string_field(uint64_t structAddr, uint32_t off,
                              uint8_t isPointer, char *dst, size_t cap) {
    if (off == 0) return false;
    uint64_t fieldAddr = structAddr + off;
    if (isPointer) {
        uint64_t ptr = 0;
        if (!memreader_read_u64(fieldAddr, &ptr)) return false;
        return memreader_read_cstr(ptr, dst, cap);
    }
    return memreader_read_cstr(fieldAddr, dst, cap);
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

void memreader_init(void) {
    if (g_initialized) return;
    g_imageBase = resolve_image_base();
    fprintf(stderr, "[lol-memreader] image base = 0x%llx\n", g_imageBase);

    /* Allow env-var override for quick iteration without rebuilding the
     * Electron writer. Format: hex with or without 0x prefix. */
    #define ENV_OFFSET(field, name) do { \
        const char *v = getenv(name); \
        if (v && *v) g_cfg.field = (uint64_t)strtoull(v, NULL, 0); \
    } while (0)

    ENV_OFFSET(oLocalPlayer,    "LOL_MEMREAD_OLOCALPLAYER");
    ENV_OFFSET(oHeroList,       "LOL_MEMREAD_OHEROLIST");
    ENV_OFFSET(oHeroListCount,  "LOL_MEMREAD_OHEROLISTCOUNT");
    ENV_OFFSET(oGameTime,       "LOL_MEMREAD_OGAMETIME");
    #undef ENV_OFFSET

    g_initialized = true;
}

void memreader_set_config(const MemReaderConfig *cfg) {
    if (!cfg) return;
    pthread_mutex_lock(&g_cfgLock);
    g_cfg = *cfg;
    pthread_mutex_unlock(&g_cfgLock);
    fprintf(stderr,
        "[lol-memreader] config: oLocal=0x%llx oHeroList=0x%llx oGameTime=0x%llx\n",
        cfg->oLocalPlayer, cfg->oHeroList, cfg->oGameTime);
}

bool memreader_is_armed(void) {
    /* Need at least: a way to enumerate players, a SpellBook offset, a
     * SpellSlot offset, a readyAt offset, a slot index. Without those, we
     * cannot produce cooldowns. */
    pthread_mutex_lock(&g_cfgLock);
    bool armed =
        g_imageBase != 0 &&
        (g_cfg.oHeroList != 0 || g_cfg.oLocalPlayer != 0) &&
        g_cfg.oSpellBook != 0 &&
        g_cfg.oSpellSlots != 0 &&
        g_cfg.cbSpellSlot != 0 &&
        g_cfg.oSpellReadyAt != 0;
    pthread_mutex_unlock(&g_cfgLock);
    return armed;
}

uint64_t memreader_image_base(void) { return g_imageBase; }

/* ─── Per-frame update ───────────────────────────────────────────────────── */

static float compute_cd(float readyAt, float gameTime) {
    if (!isfinite(readyAt) || !isfinite(gameTime)) return NAN;
    float r = readyAt - gameTime;
    if (r < 0)   r = 0;
    if (r > 600) return NAN;   /* sanity clamp; nothing in LoL is > 10 min */
    return r;
}

static bool read_slot_cd(uint64_t playerAddr, uint8_t slotIndex,
                         const MemReaderConfig *cfg, float gameTime,
                         float *outCd, char *outName, size_t nameCap) {
    *outCd = NAN;
    if (slotIndex == 0xFF) return false;

    uint64_t bookAddr = 0;
    if (!memreader_read_u64(playerAddr + cfg->oSpellBook, &bookAddr)) return false;
    if (bookAddr == 0) return false;

    uint64_t slotAddr = bookAddr + cfg->oSpellSlots
                      + (uint64_t)slotIndex * cfg->cbSpellSlot;

    float readyAt = NAN;
    memreader_read_f32(slotAddr + cfg->oSpellReadyAt, &readyAt);
    *outCd = compute_cd(readyAt, gameTime);

    if (outName && nameCap && cfg->oSpellName) {
        read_string_field(slotAddr, cfg->oSpellName,
                          cfg->spellNameIsPointer, outName, nameCap);
    }
    return true;
}

int memreader_update(MemReaderEnemy *out, int maxEnemies) {
    if (!out || maxEnemies <= 0) return 0;
    if (!g_initialized) return 0;

    /* Snapshot config under lock so live edits don't tear. */
    MemReaderConfig cfg;
    pthread_mutex_lock(&g_cfgLock);
    cfg = g_cfg;
    pthread_mutex_unlock(&g_cfgLock);

    if (!memreader_is_armed()) return 0;

    /* 1. Game time. */
    float gameTime = 0;
    if (cfg.oGameTime) {
        memreader_read_f32(g_imageBase + cfg.oGameTime, &gameTime);
    }
    if (!isfinite(gameTime)) gameTime = 0;

    /* 2. Local player (used to determine our team → enemies are the rest). */
    uint64_t localAddr = 0;
    int      localTeam = 0;
    if (cfg.oLocalPlayer) {
        memreader_read_u64(g_imageBase + cfg.oLocalPlayer, &localAddr);
        if (localAddr && cfg.oTeam) {
            uint32_t t = 0;
            memreader_read_u32(localAddr + cfg.oTeam, &t);
            localTeam = (int)t;
        }
    }

    /* 3. Walk hero list. */
    uint64_t listPtr = 0, count = 0;
    if (cfg.oHeroList) {
        memreader_read_u64(g_imageBase + cfg.oHeroList, &listPtr);
    }
    if (cfg.oHeroListCount) {
        uint32_t c32 = 0;
        memreader_read_u32(g_imageBase + cfg.oHeroListCount, &c32);
        count = c32;
    }
    if (count == 0 || count > 64) count = 10;     /* sanity */

    int enemyCount = 0;
    for (uint64_t i = 0; i < count && enemyCount < maxEnemies; i++) {
        uint64_t slot = 0;
        if (!memreader_read_u64(listPtr + i * sizeof(uint64_t), &slot)) continue;
        if (slot == 0 || slot == localAddr) continue;

        /* Filter by team if we know our team. */
        if (cfg.oTeam && localTeam) {
            uint32_t t = 0;
            if (!memreader_read_u32(slot + cfg.oTeam, &t)) continue;
            if ((int)t == localTeam) continue;     /* ally, skip */
        }

        MemReaderEnemy *e = &out[enemyCount];
        memset(e, 0, sizeof(*e));
        e->valid = true;
        e->cdDRemaining = NAN;
        e->cdFRemaining = NAN;
        for (int k = 0; k < 4; k++) e->cdAbility[k] = NAN;

        if (cfg.oLevel) {
            uint32_t lv = 0;
            memreader_read_u32(slot + cfg.oLevel, &lv);
            e->level = (int)lv;
        }
        if (cfg.oIsDead) {
            uint32_t dead = 0;
            memreader_read_u32(slot + cfg.oIsDead, &dead);
            e->isDead = (dead != 0);
        }
        read_string_field(slot, cfg.oChampionName,  cfg.championNameIsPointer,
                          e->championName, sizeof e->championName);
        read_string_field(slot, cfg.oSummonerName,  cfg.summonerNameIsPointer,
                          e->summonerName, sizeof e->summonerName);

        read_slot_cd(slot, cfg.slotIndexD, &cfg, gameTime,
                     &e->cdDRemaining, e->spellD, sizeof e->spellD);
        read_slot_cd(slot, cfg.slotIndexF, &cfg, gameTime,
                     &e->cdFRemaining, e->spellF, sizeof e->spellF);
        read_slot_cd(slot, cfg.slotIndexQ, &cfg, gameTime,
                     &e->cdAbility[0], NULL, 0);
        read_slot_cd(slot, cfg.slotIndexW, &cfg, gameTime,
                     &e->cdAbility[1], NULL, 0);
        read_slot_cd(slot, cfg.slotIndexE, &cfg, gameTime,
                     &e->cdAbility[2], NULL, 0);
        read_slot_cd(slot, cfg.slotIndexR, &cfg, gameTime,
                     &e->cdAbility[3], NULL, 0);

        enemyCount++;
    }

    return enemyCount;
}
