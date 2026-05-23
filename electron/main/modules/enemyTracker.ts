/**
 * Enemy Spell Tracker Module
 *
 * Polls the Riot Live Client Data API every second while a game is running.
 * Tracks enemy summoner spell cooldowns in realtime by detecting when a spell
 * name disappears from the player list (indicating it was used) and computing
 * the remaining cooldown based on elapsed time.
 *
 * Summoner spell cooldowns (seconds) — standard values, reduced by CDR/Ionian boots:
 * https://leagueoflegends.fandom.com/wiki/Summoner_spell
 */

import log from 'electron-log';
import { liveClientApi } from '../lcu/liveClient';
import type { EnemyTrackerData, EnemySpellInfo, SummonerSpellState } from '../../../shared/ipc';

// Base cooldowns in seconds for common summoner spells
const SPELL_COOLDOWNS: Record<string, number> = {
  SummonerFlash: 300,
  SummonerIgnite: 180,
  SummonerExhaust: 210,
  SummonerHeal: 240,
  SummonerBarrier: 180,
  SummonerBoost: 210,       // Cleanse
  SummonerDot: 180,         // Ignite (alt key)
  SummonerTeleport: 360,
  SummonerMana: 240,        // Clarity
  SummonerSmite: 90,
  SummonerSnowball: 80,
  SummonerPoroRecall: 4,
  // Fallback for unknown spells
  Unknown: 210
};

// Map display names → internal key for cooldown lookup
const DISPLAY_NAME_TO_KEY: Record<string, string> = {
  Flash: 'SummonerFlash',
  Ignite: 'SummonerIgnite',
  Exhaust: 'SummonerExhaust',
  Heal: 'SummonerHeal',
  Barrier: 'SummonerBarrier',
  Cleanse: 'SummonerBoost',
  Teleport: 'SummonerTeleport',
  Clarity: 'SummonerMana',
  Smite: 'SummonerSmite',
  'Mark': 'SummonerSnowball',
};

function getCooldown(displayName: string): number {
  const key = DISPLAY_NAME_TO_KEY[displayName];
  return key ? (SPELL_COOLDOWNS[key] ?? SPELL_COOLDOWNS.Unknown) : SPELL_COOLDOWNS.Unknown;
}

type Listener = (data: EnemyTrackerData) => void;

interface SpellCooldownEntry {
  lastUsedAt: number;   // ms timestamp
  cooldownTotal: number; // seconds
}

class EnemyTrackerModule {
  private listeners = new Set<Listener>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private data: EnemyTrackerData = { enemies: [], lastUpdatedAt: 0 };

  // Track cooldown state per player+slot: key = `${summonerName}:${slot}`
  private cooldownMap = new Map<string, SpellCooldownEntry>();
  // Track last known spell names to detect changes
  private lastSpellNames = new Map<string, string>();

  start(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => void this.poll(), 1000);
    log.info('[enemyTracker] started');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.cooldownMap.clear();
    this.lastSpellNames.clear();
    this.data = { enemies: [], lastUpdatedAt: 0 };
    log.info('[enemyTracker] stopped');
  }

  getData(): EnemyTrackerData {
    return this.data;
  }

  onDataChanged(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async poll(): Promise<void> {
    try {
      const [allPlayers, activePlayer] = await Promise.all([
        liveClientApi.getAllPlayers(),
        liveClientApi.getActivePlayer()
      ]);

      const localName = activePlayer.summonerName;
      const localPlayer = allPlayers.find((p) => p.summonerName === localName);
      const localTeam = localPlayer?.team ?? 'ORDER';

      const enemies = allPlayers.filter((p) => p.team !== localTeam);
      const now = Date.now();

      const enemyInfos: EnemySpellInfo[] = enemies.map((player) => {
        const spell1 = this.resolveSpell(player.summonerName, 'spell1', player.summonerSpells.summonerSpellOne.displayName, now);
        const spell2 = this.resolveSpell(player.summonerName, 'spell2', player.summonerSpells.summonerSpellTwo.displayName, now);
        return {
          summonerName: player.summonerName,
          championName: player.championName,
          spell1,
          spell2
        };
      });

      this.data = { enemies: enemyInfos, lastUpdatedAt: now };
      this.listeners.forEach((l) => l(this.data));
    } catch {
      // Game not running or API unavailable — silently skip
    }
  }

  private resolveSpell(
    summonerName: string,
    slot: 'spell1' | 'spell2',
    displayName: string,
    now: number
  ): SummonerSpellState {
    const key = `${summonerName}:${slot}`;
    const lastNameKey = `${key}:name`;
    const prevName = this.lastSpellNames.get(lastNameKey);

    // Detect spell usage: Live Client API sets displayName to empty string or
    // a different value when the spell is on cooldown in some versions.
    // More reliably: we track the spell name; if it was previously known and
    // now the name is empty/changed, we record usage time.
    if (prevName !== undefined && prevName !== '' && displayName === '') {
      // Spell just used
      const cooldownTotal = getCooldown(prevName);
      this.cooldownMap.set(key, { lastUsedAt: now, cooldownTotal });
    }

    this.lastSpellNames.set(lastNameKey, displayName);

    const entry = this.cooldownMap.get(key);
    if (!entry) {
      return {
        name: displayName || prevName || 'Unknown',
        cooldownRemaining: 0,
        cooldownTotal: getCooldown(displayName || prevName || ''),
        lastUsedAt: 0
      };
    }

    const elapsedSec = (now - entry.lastUsedAt) / 1000;
    const remaining = Math.max(0, entry.cooldownTotal - elapsedSec);

    return {
      name: displayName || prevName || 'Unknown',
      cooldownRemaining: Math.round(remaining),
      cooldownTotal: entry.cooldownTotal,
      lastUsedAt: entry.lastUsedAt
    };
  }
}

export const enemyTracker = new EnemyTrackerModule();
