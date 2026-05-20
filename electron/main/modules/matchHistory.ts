import log from 'electron-log';
import { lcuClient } from '../lcu/client';
import type { MatchHistoryEntry, MatchHistoryFilter, MatchHistoryResponse } from '../../../shared/ipc';

/**
 * Queue ID → tên hiển thị. Chỉ map các queue phổ biến.
 */
const QUEUE_NAMES: Record<number, string> = {
  400: 'Normal Draft',
  420: 'Ranked Solo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  700: 'Clash',
  900: 'URF',
  1020: 'One for All',
  1300: 'Nexus Blitz',
  1700: 'Arena',
  0: 'Custom'
};

/**
 * Raw participant data từ LCU match history endpoint.
 */
interface RawParticipant {
  championId: number;
  stats: {
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    totalMinionsKilled: number;
    neutralMinionsKilled: number;
    goldEarned: number;
    item0: number;
    item1: number;
    item2: number;
    item3: number;
    item4: number;
    item5: number;
    item6: number;
  };
  spell1Id: number;
  spell2Id: number;
  timeline?: {
    role?: string;
    lane?: string;
  };
}

interface RawParticipantIdentity {
  participantId: number;
  player: {
    summonerId: number;
    accountId: number;
    gameName?: string;
    tagLine?: string;
  };
}

interface RawGame {
  gameId: number;
  gameCreation: number;
  gameDuration: number;
  queueId: number;
  participants: RawParticipant[];
  participantIdentities: RawParticipantIdentity[];
}

interface RawMatchHistoryResponse {
  games: {
    games: RawGame[];
  };
}

/**
 * Champion ID → name mapping. Fetched once from Data Dragon.
 */
let championMap: Record<number, string> = {};
let championMapLoaded = false;

async function loadChampionMap(): Promise<void> {
  if (championMapLoaded) return;
  try {
    // Lấy version mới nhất từ Data Dragon
    const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versionList = (await versions.json()) as string[];
    const latest = versionList[0];

    const resp = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`
    );
    const data = (await resp.json()) as {
      data: Record<string, { key: string; name: string }>;
    };

    for (const champ of Object.values(data.data)) {
      championMap[Number(champ.key)] = champ.name;
    }
    championMapLoaded = true;
    log.info(`[matchHistory] loaded ${Object.keys(championMap).length} champions from ddragon`);
  } catch (err) {
    log.warn('[matchHistory] failed to load champion map from ddragon', err);
  }
}

function getChampionName(id: number): string {
  return championMap[id] ?? `Champion ${id}`;
}

function getQueueName(queueId: number): string {
  return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

/**
 * Fetch match history cho summoner hiện tại từ LCU.
 * Endpoint: GET /lol-match-history/v1/products/lol/{puuid}/matches
 * Fallback: GET /lol-match-history/v3/matchlist/account/{accountId}
 */
export async function fetchMatchHistory(filter?: MatchHistoryFilter): Promise<MatchHistoryResponse> {
  // Ensure champion names are loaded
  await loadChampionMap();

  const status = lcuClient.getStatus();
  if (status.state !== 'connected' || !status.summoner) {
    throw new Error('LCU not connected or summoner not available');
  }

  const summonerId = status.summoner.summonerId;

  // Lấy puuid từ current summoner
  const summonerData = await lcuClient.request<{
    puuid: string;
    accountId: number;
  }>('GET', '/lol-summoner/v1/current-summoner');

  const puuid = summonerData.puuid;

  // Build query params — LCU endpoint only supports begIndex/endIndex
  const url = `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=30`;

  log.debug('[matchHistory] fetching', url);

  const raw = await lcuClient.request<RawMatchHistoryResponse>('GET', url);

  let games = raw?.games?.games ?? [];

  // Client-side filtering (LCU doesn't support query params for queue/champion)
  if (filter?.queueId) {
    games = games.filter((g) => g.queueId === filter.queueId);
  }

  const entries: MatchHistoryEntry[] = games.map((game) => {
    // Tìm participant của mình
    const myIdentity = game.participantIdentities.find(
      (pi) => pi.player.summonerId === summonerId
    );
    const participantIndex = myIdentity
      ? game.participantIdentities.indexOf(myIdentity)
      : 0;
    const participant = game.participants[participantIndex];

    const stats = participant?.stats ?? {
      win: false,
      kills: 0,
      deaths: 0,
      assists: 0,
      totalMinionsKilled: 0,
      neutralMinionsKilled: 0,
      goldEarned: 0,
      item0: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0
    };

    return {
      gameId: game.gameId,
      championId: participant?.championId ?? 0,
      championName: getChampionName(participant?.championId ?? 0),
      gameCreation: game.gameCreation,
      gameDuration: game.gameDuration,
      queueId: game.queueId,
      queueName: getQueueName(game.queueId),
      win: stats.win,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      cs: stats.totalMinionsKilled + stats.neutralMinionsKilled,
      goldEarned: stats.goldEarned,
      items: [
        stats.item0,
        stats.item1,
        stats.item2,
        stats.item3,
        stats.item4,
        stats.item5,
        stats.item6
      ],
      summonerSpells: [participant?.spell1Id ?? 0, participant?.spell2Id ?? 0],
      role: participant?.timeline?.role ?? 'NONE',
      lane: participant?.timeline?.lane ?? 'NONE'
    };
  });

  return { entries, summonerId };
}
