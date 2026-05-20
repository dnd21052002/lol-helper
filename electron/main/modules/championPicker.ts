import { app } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import log from 'electron-log';
import { lcuClient } from '../lcu/client';

/**
 * Champion Picker module.
 *
 * - Cache Data Dragon champion list theo version (lưu JSON trong userData).
 * - Lắng nghe LCU champ-select events để sync trạng thái pick/ban hiện tại.
 * - Cung cấp API cho renderer: getChampions, getChampSelectSession, getCounterData.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChampionInfo {
  id: number;        // champion key (numeric)
  name: string;      // display name
  title: string;
  tags: string[];    // e.g. ['Fighter', 'Tank']
  image: string;     // filename e.g. 'Aatrox.png'
  info: {
    attack: number;
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
  phase: string;     // e.g. 'BAN_PICK', 'PLANNING', 'FINALIZATION'
}

export interface ChampSelectPlayer {
  cellId: number;
  championId: number;
  championName: string;
  assignedPosition: string; // e.g. 'top', 'jungle', 'middle', 'bottom', 'utility'
  summonerId: number;
  isLocalPlayer: boolean;
}

export interface CounterEntry {
  championId: number;
  championName: string;
  counters: CounterTip[];
}

export interface CounterTip {
  championId: number;
  championName: string;
  winRate: number;     // e.g. 53.2 means 53.2%
  tip: string;
}

interface DdragonCache {
  version: string;
  champions: ChampionInfo[];
  fetchedAt: number;
}

// ─── Module State ────────────────────────────────────────────────────────────

let champions: ChampionInfo[] = [];
let championsLoaded = false;
let ddragonVersion = '';
let currentSession: ChampSelectSession = {
  inChampSelect: false,
  localPlayerCellId: -1,
  myTeam: [],
  theirTeam: [],
  bans: { myTeamBans: [], theirTeamBans: [] },
  phase: ''
};

// Callbacks for broadcasting session changes
type SessionChangedCb = (session: ChampSelectSession) => void;
const sessionListeners: SessionChangedCb[] = [];

// ─── Cache Helpers ───────────────────────────────────────────────────────────

function getCacheDir(): string {
  return join(app.getPath('userData'), 'cache');
}

function getCachePath(): string {
  return join(getCacheDir(), 'ddragon-champions.json');
}

async function loadCacheFromDisk(): Promise<DdragonCache | null> {
  try {
    const raw = await readFile(getCachePath(), 'utf8');
    return JSON.parse(raw) as DdragonCache;
  } catch {
    return null;
  }
}

async function saveCacheToDisk(cache: DdragonCache): Promise<void> {
  try {
    await mkdir(getCacheDir(), { recursive: true });
    await writeFile(getCachePath(), JSON.stringify(cache), 'utf8');
  } catch (err) {
    log.warn('[championPicker] failed to save cache', err);
  }
}

// ─── Data Dragon Fetch ───────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function fetchLatestVersion(): Promise<string> {
  const resp = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const versions = (await resp.json()) as string[];
  return versions[0];
}

async function fetchChampionsFromDdragon(version: string): Promise<ChampionInfo[]> {
  const resp = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
  );
  const data = (await resp.json()) as {
    data: Record<string, {
      key: string;
      name: string;
      title: string;
      tags: string[];
      image: { full: string };
      info: { attack: number; defense: number; magic: number; difficulty: number };
      blurb: string;
    }>;
  };

  return Object.values(data.data).map((c) => ({
    id: Number(c.key),
    name: c.name,
    title: c.title,
    tags: c.tags,
    image: c.image.full,
    info: c.info,
    blurb: c.blurb
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadChampions(): Promise<ChampionInfo[]> {
  if (championsLoaded && champions.length > 0) return champions;

  // Try disk cache first
  const cached = await loadCacheFromDisk();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    champions = cached.champions;
    ddragonVersion = cached.version;
    championsLoaded = true;
    log.info(`[championPicker] loaded ${champions.length} champions from cache (v${ddragonVersion})`);
    return champions;
  }

  // Fetch fresh
  try {
    const version = await fetchLatestVersion();
    const list = await fetchChampionsFromDdragon(version);
    champions = list;
    ddragonVersion = version;
    championsLoaded = true;

    await saveCacheToDisk({ version, champions: list, fetchedAt: Date.now() });
    log.info(`[championPicker] fetched ${list.length} champions from ddragon v${version}`);
  } catch (err) {
    log.warn('[championPicker] failed to fetch from ddragon, using cache if available', err);
    if (cached) {
      champions = cached.champions;
      ddragonVersion = cached.version;
      championsLoaded = true;
    }
  }

  return champions;
}

// ─── Champion Name Lookup ────────────────────────────────────────────────────

function getChampionName(id: number): string {
  const champ = champions.find((c) => c.id === id);
  return champ?.name ?? `Champion ${id}`;
}

// ─── Champ Select Session Sync ───────────────────────────────────────────────

interface RawChampSelectSession {
  localPlayerCellId: number;
  myTeam: RawChampSelectCell[];
  theirTeam: RawChampSelectCell[];
  bans: {
    myTeamBans: number[];
    theirTeamBans: number[];
  };
  timer: { phase: string };
}

interface RawChampSelectCell {
  cellId: number;
  championId: number;
  assignedPosition: string;
  summonerId: number;
}

function parseSession(raw: RawChampSelectSession): ChampSelectSession {
  const localCellId = raw.localPlayerCellId;

  const mapPlayer = (cell: RawChampSelectCell): ChampSelectPlayer => ({
    cellId: cell.cellId,
    championId: cell.championId,
    championName: getChampionName(cell.championId),
    assignedPosition: cell.assignedPosition || '',
    summonerId: cell.summonerId,
    isLocalPlayer: cell.cellId === localCellId
  });

  return {
    inChampSelect: true,
    localPlayerCellId: localCellId,
    myTeam: (raw.myTeam ?? []).map(mapPlayer),
    theirTeam: (raw.theirTeam ?? []).map(mapPlayer),
    bans: {
      myTeamBans: (raw.bans?.myTeamBans ?? []).filter((id) => id > 0),
      theirTeamBans: (raw.bans?.theirTeamBans ?? []).filter((id) => id > 0)
    },
    phase: raw.timer?.phase ?? ''
  };
}

function notifySessionChanged(): void {
  for (const cb of sessionListeners) {
    cb(currentSession);
  }
}

export function onSessionChanged(cb: SessionChangedCb): void {
  sessionListeners.push(cb);
}

export function getChampSelectSession(): ChampSelectSession {
  return currentSession;
}

// ─── LCU Event Handling ──────────────────────────────────────────────────────

function handleLcuEvent(uri: string, _eventType: string, data: unknown): void {
  if (uri === '/lol-champ-select/v1/session') {
    if (data && typeof data === 'object') {
      currentSession = parseSession(data as RawChampSelectSession);
    } else {
      // Session ended (data is null or empty on Delete event)
      currentSession = {
        inChampSelect: false,
        localPlayerCellId: -1,
        myTeam: [],
        theirTeam: [],
        bans: { myTeamBans: [], theirTeamBans: [] },
        phase: ''
      };
    }
    notifySessionChanged();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getChampions(): ChampionInfo[] {
  return champions;
}

export function getDdragonVersion(): string {
  return ddragonVersion;
}

/**
 * Start the champion picker module: load data + subscribe to LCU events.
 */
export async function startChampionPicker(): Promise<void> {
  await loadChampions();
  lcuClient.on('lcuEvent', handleLcuEvent);

  // If already in champ select, fetch current session
  if (lcuClient.getStatus().state === 'connected') {
    try {
      const raw = await lcuClient.request<RawChampSelectSession>(
        'GET',
        '/lol-champ-select/v1/session'
      );
      if (raw && raw.localPlayerCellId !== undefined) {
        currentSession = parseSession(raw);
        notifySessionChanged();
      }
    } catch {
      // Not in champ select, that's fine
    }
  }

  log.info('[championPicker] module started');
}

export function stopChampionPicker(): void {
  lcuClient.removeListener('lcuEvent', handleLcuEvent);
}
