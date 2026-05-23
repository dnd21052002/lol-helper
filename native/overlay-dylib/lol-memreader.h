/**
 * lol-memreader — read enemy spell cooldowns directly from the LoL game
 * process memory.
 *
 * Runs INSIDE the injected dylib, so it shares the LeagueofLegends address
 * space — no `task_for_pid`, no Mach calls, just plain pointer reads. Safety
 * is enforced via vm_region_recurse_64 lookups before each dereference so a
 * stale offset can never crash the game (returns NaN cooldown instead).
 *
 * USAGE
 *   memreader_init();                   // call once from constructor
 *   memreader_set_config(&cfg);         // optional; defaults are no-op
 *   memreader_update(out, MAX_ENEMIES); // every frame in present hook
 *
 * CONFIG
 *   The reader is offset-driven. Until offsets are filled in (via
 *   memreader_set_config or the LOL_MEMREAD_* env vars), update() is a
 *   no-op. See lol-discovery.m for the helper that hunts candidates.
 *
 * THREAD SAFETY
 *   memreader_update() is called from the render thread (present hook).
 *   memreader_set_config() can be called from any thread; updates are
 *   atomic via a single struct copy under a spinlock.
 */

#ifndef LOL_MEMREADER_H
#define LOL_MEMREADER_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define LOL_MEMREADER_MAX_ENEMIES 5

typedef struct {
    /* champion / summoner names (best-effort; reader fills if available) */
    char  championName[32];
    char  summonerName[64];

    /* summoner spells (D = slot 0, F = slot 1) */
    float cdDRemaining;        /* seconds until ready, 0 = ready, NaN = unknown */
    float cdFRemaining;
    char  spellD[32];
    char  spellF[32];

    /* abilities Q/W/E/R (0..3) */
    float cdAbility[4];

    int   level;
    bool  isDead;
    bool  valid;               /* false → reader could not resolve this slot */
} MemReaderEnemy;

/**
 * Offsets are relative to the LeagueofLegends image base + ASLR slide.
 * Values of 0 disable that read (so a partially-filled config is safe).
 *
 * The exact field names are LoL-specific. Names below describe intent so the
 * RE/discovery output can be mapped: replace each 0 with the offset you
 * confirmed, rebuild, ship.
 */
typedef struct {
    /* Pointer to the local player (or to the player list head). */
    uint64_t oLocalPlayer;     /* image+oLocalPlayer → ptr to PlayerCharacter */
    uint64_t oHeroList;        /* image+oHeroList    → ptr to array of players */
    uint64_t oHeroListCount;   /* image+oHeroListCount → int32 count */

    /* Inside a PlayerCharacter struct: */
    uint32_t oTeam;             /* int32: 100 = ORDER, 200 = CHAOS */
    uint32_t oIsDead;           /* int32: 0/1 (or float ≠0 = dead) */
    uint32_t oLevel;            /* int32 */
    uint32_t oChampionName;     /* char[N] inline OR ptr to cstr */
    uint32_t oSummonerName;     /* char[N] inline OR ptr to cstr */
    uint32_t oSpellBook;        /* SpellBook* inside player */

    /* Inside a SpellBook struct: */
    uint32_t oSpellSlots;       /* SpellSlot[6] base (Q/W/E/R/D/F) */
    uint32_t cbSpellSlot;       /* sizeof(SpellSlot) — stride between slots */

    /* Inside a SpellSlot struct: */
    uint32_t oSpellReadyAt;     /* float: game-time when cooldown ends */
    uint32_t oSpellName;        /* char[N] or ptr to cstr (e.g. "SummonerFlash") */

    /* Game time (float seconds). Same struct as gameflow / events table. */
    uint64_t oGameTime;         /* image+oGameTime → float */

    /* Slot index mapping (engine order is usually Q=0,W=1,E=2,R=3,D=4,F=5) */
    uint8_t  slotIndexQ, slotIndexW, slotIndexE, slotIndexR;
    uint8_t  slotIndexD, slotIndexF;

    /* Indirection flags — set if the field is a pointer (not inline). */
    uint8_t  spellNameIsPointer;
    uint8_t  championNameIsPointer;
    uint8_t  summonerNameIsPointer;
} MemReaderConfig;

/* ─── Public API ───────────────────────────────────────────────────────── */

void  memreader_init(void);
void  memreader_set_config(const MemReaderConfig *cfg);
bool  memreader_is_armed(void);   /* true once config has non-zero core offsets */

/**
 * Fills `out[0..maxEnemies-1]` with enemy state. Returns enemy count.
 * Returns 0 if the reader is not armed, base address could not be resolved,
 * or the local player was not found.
 *
 * Cooldown values are computed as max(0, readyAt - gameTime). A negative
 * readyAt or gameTime read is treated as NaN.
 */
int   memreader_update(MemReaderEnemy *out, int maxEnemies);

/* Image base + slide of the LeagueofLegends Mach-O. 0 if not found. */
uint64_t memreader_image_base(void);

/* Read primitives (used by discovery harness too). All bounds-checked: a
 * read into unmapped memory returns false instead of crashing. */
bool memreader_read_bytes(uint64_t addr, void *dst, size_t n);
bool memreader_read_u64  (uint64_t addr, uint64_t *out);
bool memreader_read_u32  (uint64_t addr, uint32_t *out);
bool memreader_read_f32  (uint64_t addr, float    *out);
bool memreader_read_cstr (uint64_t addr, char *dst, size_t cap);

#endif /* LOL_MEMREADER_H */
