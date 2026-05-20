/**
 * Shared IPC contract between main và renderer.
 * Bất kỳ thay đổi nào ở đây cần update cả handler (main) lẫn binding (preload).
 */

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type LcuConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface LcuStatus {
  state: LcuConnectionState;
  summoner?: {
    summonerId: number;
    displayName: string;
    summonerLevel: number;
    profileIconId: number;
  };
  gameflowPhase?: string;
}

export interface AutoAcceptSettings {
  enabled: boolean;
  delayMs: number;
}

export interface AutoAcceptStats {
  acceptedCount: number;
  lastAcceptedAt: number | null;
}

// ─── Match History ───────────────────────────────────────────────────────────

export interface MatchHistoryEntry {
  gameId: number;
  championId: number;
  championName: string;
  gameCreation: number;       // epoch ms
  gameDuration: number;       // seconds
  queueId: number;
  queueName: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;                 // minions + jungle
  goldEarned: number;
  items: number[];            // item IDs (slot 0-6)
  summonerSpells: [number, number];
  role: string;
  lane: string;
}

export interface MatchHistoryFilter {
  championId?: number;
  queueId?: number;
}

export interface MatchHistoryResponse {
  entries: MatchHistoryEntry[];
  summonerId: number;
}

/**
 * Tên các channel IPC. Đặt theo dạng `domain:action`.
 */
export const IpcChannels = {
  lcu: {
    getStatus: 'lcu:getStatus',
    onStatusChanged: 'lcu:statusChanged'
  },
  autoAccept: {
    getSettings: 'autoAccept:getSettings',
    setSettings: 'autoAccept:setSettings',
    getStats: 'autoAccept:getStats',
    onStatsChanged: 'autoAccept:statsChanged'
  },
  matchHistory: {
    fetch: 'matchHistory:fetch'
  },
  app: {
    getVersion: 'app:getVersion'
  }
} as const;
