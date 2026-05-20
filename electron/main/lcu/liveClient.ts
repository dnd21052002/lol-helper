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
  async getAllPlayers(): Promise<unknown[]> {
    return get<unknown[]>('/playerlist');
  },

  /** Get active player (the local player) data */
  async getActivePlayer(): Promise<unknown> {
    return get<unknown>('/activeplayer');
  },

  /** Get game stats (time, map, mode, etc.) */
  async getGameStats(): Promise<unknown> {
    return get<unknown>('/gamestats');
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
