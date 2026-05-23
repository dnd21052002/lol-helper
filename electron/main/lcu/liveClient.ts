/**
 * Riot Live Client Data API
 *
 * Available at https://127.0.0.1:2999/liveclientdata/... when a game is running.
 * Official Riot API — no ToS risk.
 * Docs: https://developer.riotgames.com/docs/lol#game-client-api
 */

import https from 'node:https';

const BASE_URL = 'https://127.0.0.1:2999/liveclientdata';
const TIMEOUT_MS = 2000;

const agent = new https.Agent({ rejectUnauthorized: false });

// ─── Live Client API types ────────────────────────────────────────────────────

export interface LiveSummonerSpell {
  displayName: string;
  rawDescription: string;
  rawDisplayName: string;
}

export interface LiveSummonerSpells {
  summonerSpellOne: LiveSummonerSpell;
  summonerSpellTwo: LiveSummonerSpell;
}

export interface LivePlayer {
  summonerName: string;
  championName: string;
  team: 'ORDER' | 'CHAOS';
  isDead: boolean;
  respawnTimer: number;
  summonerSpells: LiveSummonerSpells;
  scores: {
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    wardScore: number;
  };
  items: Array<{ itemID: number; displayName: string; count: number; slot: number }>;
}

export interface LiveActivePlayer {
  summonerName: string;
  championStats: Record<string, number>;
  abilities: {
    Passive: { displayName: string; id: string };
    Q: { displayName: string; id: string; abilityLevel: number };
    W: { displayName: string; id: string; abilityLevel: number };
    E: { displayName: string; id: string; abilityLevel: number };
    R: { displayName: string; id: string; abilityLevel: number };
  };
}

export interface LiveGameStats {
  gameMode: string;
  gameTime: number;
  mapName: string;
  mapNumber: number;
  mapTerrain: string;
}

// ─────────────────────────────────────────────────────────────────────────────

async function get<T>(endpoint: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(`${BASE_URL}${endpoint}`, { agent, timeout: TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(new Error(`Failed to parse response from ${endpoint}`));
          }
        } else {
          reject(new Error(`Live Client API ${endpoint} returned ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Live Client API ${endpoint} timed out`));
    });
  });
}

export const liveClientApi = {
  /** Check if the game is running by pinging the API */
  async isGameRunning(): Promise<boolean> {
    try {
      await get('/gamestats');
      return true;
    } catch {
      return false;
    }
  },

  /** Get all players in the current game */
  async getAllPlayers(): Promise<LivePlayer[]> {
    return get<LivePlayer[]>('/playerlist');
  },

  /** Get active player (the local player) data */
  async getActivePlayer(): Promise<LiveActivePlayer> {
    return get<LiveActivePlayer>('/activeplayer');
  },

  /** Get game stats (time, map, mode, etc.) */
  async getGameStats(): Promise<LiveGameStats> {
    return get<LiveGameStats>('/gamestats');
  },

  /** Get game event data (kills, dragons, barons, etc.) */
  async getEventData(): Promise<unknown> {
    return get<unknown>('/eventdata');
  },

  /** Get specific player items */
  async getPlayerItems(summonerName: string): Promise<unknown> {
    return get<unknown>(`/playeritems?summonerName=${encodeURIComponent(summonerName)}`);
  },

  /** Get specific player main runes */
  async getPlayerMainRunes(summonerName: string): Promise<unknown> {
    return get<unknown>(`/playermainrunes?summonerName=${encodeURIComponent(summonerName)}`);
  },

  /** Get player scores (kills, deaths, assists, cs, etc.) */
  async getPlayerScores(summonerName: string): Promise<unknown> {
    return get<unknown>(`/playerscores?summonerName=${encodeURIComponent(summonerName)}`);
  }
};
