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

// ─── Champion Picker ─────────────────────────────────────────────────────────

export interface ChampionInfo {
  id: number;
  name: string;
  title: string;
  tags: string[];    // e.g. ['Fighter', 'Tank']
  image: string;
  info: {
    attack: number;   // 1-10
    defense: number;
    magic: number;
    difficulty: number;
  };
  blurb: string;     // short lore
}

export interface ChampSelectSession {
  inChampSelect: boolean;
  localPlayerCellId: number;
  myTeam: ChampSelectPlayer[];
  theirTeam: ChampSelectPlayer[];
  bans: { myTeamBans: number[]; theirTeamBans: number[] };
  phase: string;
}

export interface ChampSelectPlayer {
  cellId: number;
  championId: number;
  championName: string;
  assignedPosition: string;
  summonerId: number;
  isLocalPlayer: boolean;
}

export interface CounterTipInfo {
  championId: number;
  championName: string;
  winRate: number;
  tip: string;
}

export interface ChampionPickerData {
  champions: ChampionInfo[];
  ddragonVersion: string;
}

// ─── Auto Ranked ─────────────────────────────────────────────────────────────

export interface RunePageConfig {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
}

export interface AutoRankedSettings {
  enabled: boolean;
  primaryRole: string;
  secondaryRole: string;
  banChampionIds: number[];
  pickChampionIds: number[];
  autoStartQueue: boolean;
  runes: RunePageConfig | null;
  itemSetId: string | null;
}

export interface AutoRankedState {
  step: string;
  message: string;
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

export interface OverlaySettings {
  enabled: boolean;
  showSpellTracker: boolean;
  showCounterTips: boolean;
  showJungleTimers: boolean;
  opacity: number; // 0.3 - 1.0
}

export interface OverlayState {
  isGameActive: boolean;
  isVisible: boolean;
}

export interface SpellCooldown {
  /** Summoner name (riotId) of the enemy */
  summonerName: string;
  championName: string;
  /** 'D' or 'F' */
  slot: 'D' | 'F';
  spellName: string;
  /** Total cooldown in seconds */
  cooldownTotal: number;
  /** Timestamp (Date.now()) when spell was used */
  usedAt: number;
}

export interface JungleTimer {
  objective: 'dragon' | 'baron' | 'riftHerald' | 'blueBuffAlly' | 'blueBuffEnemy' | 'redBuffAlly' | 'redBuffEnemy';
  /** Game time (seconds) when objective respawns. 0 = alive/unknown */
  respawnAt: number;
  label: string;
}

export interface OverlayGameData {
  gameTime: number; // seconds
  enemies: OverlayEnemy[];
  spellCooldowns: SpellCooldown[];
  jungleTimers: JungleTimer[];
  counterTips: string[];
  myChampionName: string;
}

export interface OverlayEnemy {
  summonerName: string;
  championName: string;
  level: number;
  spellD: string;
  spellF: string;
  isDead: boolean;
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
  championPicker: {
    getChampions: 'championPicker:getChampions',
    getSession: 'championPicker:getSession',
    getCounters: 'championPicker:getCounters',
    onSessionChanged: 'championPicker:sessionChanged'
  },
  autoRanked: {
    getSettings: 'autoRanked:getSettings',
    setSettings: 'autoRanked:setSettings',
    getState: 'autoRanked:getState',
    startQueue: 'autoRanked:startQueue',
    onStateChanged: 'autoRanked:stateChanged'
  },
  matchHistory: {
    fetch: 'matchHistory:fetch'
  },
  overlay: {
    getSettings: 'overlay:getSettings',
    setSettings: 'overlay:setSettings',
    getState: 'overlay:getState',
    toggle: 'overlay:toggle',
    trackSpell: 'overlay:trackSpell',
    onGameData: 'overlay:gameData',
    onStateChanged: 'overlay:stateChanged'
  },
  app: {
    getVersion: 'app:getVersion'
  }
} as const;
