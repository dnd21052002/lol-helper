/**
 * In-Game Floating Panel Module
 *
 * Creates a compact, always-on-top floating panel that appears during game
 * (similar to how Porofessor/OP.GG works on macOS).
 * Shows as a small side panel visible even over fullscreen game.
 *
 * Data source: Riot Live Client Data API (https://127.0.0.1:2999/liveclientdata/...)
 */

import { BrowserWindow, screen, ipcMain, globalShortcut } from 'electron';
import path from 'node:path';
import log from 'electron-log';
import { liveClientApi } from '../lcu/liveClient';
import { getCountersFor } from '../data/counterData';
import { IpcChannels } from '../../../shared/ipc';
import type { OverlaySettings, OverlayState, OverlayGameData, OverlayEnemy, SpellCooldown, JungleTimer } from '../../../shared/ipc';

let overlayWindow: BrowserWindow | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let dataInterval: ReturnType<typeof setInterval> | null = null;
let isGameActive = false;

const POLL_GAME_MS = 2000;
const POLL_DATA_MS = 1000;

// ─── Panel Dimensions ────────────────────────────────────────────────────────

const PANEL_WIDTH = 280;
const PANEL_HEIGHT = 600;
const PANEL_MARGIN = 8; // margin from screen edge

// ─── Settings ────────────────────────────────────────────────────────────────

let settings: OverlaySettings = {
  enabled: true,
  showSpellTracker: true,
  showCounterTips: true,
  showJungleTimers: true,
  opacity: 0.92
};

// ─── Spell Tracking State ────────────────────────────────────────────────────

const spellCooldowns: SpellCooldown[] = [];

/** Summoner spell base cooldowns (without CDR — approximate) */
const SPELL_COOLDOWNS: Record<string, number> = {
  SummonerFlash: 300,
  SummonerHeal: 240,
  SummonerBarrier: 180,
  SummonerExhaust: 210,
  SummonerIgnite: 180,
  SummonerTeleport: 360,
  SummonerCleanse: 210,
  SummonerGhost: 210,
  SummonerSmite: 90,
  SummonerMana: 240, // Clarity
  SummonerSnowball: 40 // Mark (ARAM)
};

function getSpellCooldown(spellName: string): number {
  return SPELL_COOLDOWNS[spellName] ?? 300;
}

// ─── Jungle Timers State ─────────────────────────────────────────────────────

let jungleTimers: JungleTimer[] = [
  { objective: 'dragon', respawnAt: 0, label: 'Dragon' },
  { objective: 'baron', respawnAt: 0, label: 'Baron' },
  { objective: 'riftHerald', respawnAt: 0, label: 'Rift Herald' }
];

const RESPAWN_TIMES: Record<string, number> = {
  dragon: 300,    // 5 min
  baron: 360,     // 6 min
  riftHerald: 480 // 8 min (first spawn at 8:00, respawn 6 min after kill before 19:45)
};

// ─── Module Lifecycle ────────────────────────────────────────────────────────

export function startOverlayModule(mainWindow: BrowserWindow): void {
  registerIpcHandlers(mainWindow);
  registerHotkey(mainWindow);

  pollInterval = setInterval(async () => {
    if (!settings.enabled) return;

    const gameRunning = await liveClientApi.isGameRunning();

    if (gameRunning && !isGameActive) {
      isGameActive = true;
      log.info('[overlay] Game detected, creating floating panel');
      await createOverlayWindow(mainWindow);
      startDataPolling(mainWindow);
      broadcastState(mainWindow);
    } else if (!gameRunning && isGameActive) {
      isGameActive = false;
      log.info('[overlay] Game ended, destroying floating panel');
      destroyOverlayWindow();
      stopDataPolling();
      resetState();
      broadcastState(mainWindow);
    }
  }, POLL_GAME_MS);
}

export function stopOverlayModule(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  destroyOverlayWindow();
  stopDataPolling();
  globalShortcut.unregister('F9');
  ipcMain.removeHandler(IpcChannels.overlay.getSettings);
  ipcMain.removeHandler(IpcChannels.overlay.setSettings);
  ipcMain.removeHandler(IpcChannels.overlay.getState);
  ipcMain.removeHandler(IpcChannels.overlay.toggle);
  ipcMain.removeHandler(IpcChannels.overlay.trackSpell);
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IpcChannels.overlay.getSettings, () => {
    return { ok: true, data: settings };
  });

  ipcMain.handle(IpcChannels.overlay.setSettings, (_evt, patch: Partial<OverlaySettings>) => {
    settings = { ...settings, ...patch };
    if (overlayWindow) {
      overlayWindow.setOpacity(settings.opacity);
    }
    return { ok: true, data: settings };
  });

  ipcMain.handle(IpcChannels.overlay.getState, () => {
    return { ok: true, data: getState() };
  });

  ipcMain.handle(IpcChannels.overlay.toggle, (_evt, visible: boolean) => {
    if (overlayWindow) {
      if (visible) overlayWindow.show();
      else overlayWindow.hide();
    }
    broadcastState(mainWindow);
    return { ok: true, data: visible };
  });

  ipcMain.handle(IpcChannels.overlay.trackSpell, (_evt, data: { summonerName: string; championName: string; slot: 'D' | 'F'; spellName: string }) => {
    const cooldownTotal = getSpellCooldown(data.spellName);
    const existing = spellCooldowns.find(s => s.summonerName === data.summonerName && s.slot === data.slot);
    if (existing) {
      existing.usedAt = Date.now();
      existing.cooldownTotal = cooldownTotal;
      existing.spellName = data.spellName;
    } else {
      spellCooldowns.push({
        ...data,
        cooldownTotal,
        usedAt: Date.now()
      });
    }
    return { ok: true, data: null };
  });
}

function registerHotkey(mainWindow: BrowserWindow): void {
  globalShortcut.register('F9', () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
      } else {
        overlayWindow.show();
      }
      broadcastState(mainWindow);
    }
  });
}

// ─── Floating Panel Window ───────────────────────────────────────────────────

function getPanelPosition(): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay();
  // Use bounds (full screen size) instead of workAreaSize (excludes Dock/taskbar)
  // This ensures correct positioning when game is in borderless/fullscreen mode
  const { width, height } = primaryDisplay.bounds;
  // Position: right side of screen, vertically centered
  return {
    x: width - PANEL_WIDTH - PANEL_MARGIN,
    y: Math.round((height - PANEL_HEIGHT) / 2)
  };
}

async function createOverlayWindow(mainWindow: BrowserWindow): Promise<void> {
  if (overlayWindow) return;

  const { x, y } = getPanelPosition();

  overlayWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    x,
    y,
    type: 'panel',        // macOS: allows floating over fullscreen apps
    transparent: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,        // Allow user to drag the panel
    focusable: true,      // Allow interaction (clicking spell buttons)
    hasShadow: true,
    roundedCorners: true,
    fullscreenable: false, // Prevent panel from entering fullscreen itself
    opacity: settings.opacity,
    backgroundColor: '#0f1115',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Float above all windows including fullscreen game on macOS
  // 'screen-saver' level (~2000) is required to appear over fullscreen Spaces
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // macOS: ensure the panel can appear on all Spaces (including fullscreen game Space)
  if (process.platform === 'darwin') {
    overlayWindow.setWindowButtonVisibility(false);
  }

  if (process.env.NODE_ENV === 'development') {
    const mainUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    await overlayWindow.loadURL(`${mainUrl}#/overlay`);
  } else {
    await overlayWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      { hash: '/overlay' }
    );
  }

  // Ensure the panel is shown and brought to front after content loads
  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow) return;
    overlayWindow.showInactive(); // Show without stealing focus from game
    // Re-apply alwaysOnTop after show to ensure macOS respects it
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  // If ready-to-show already fired (loadURL resolved), force show
  if (overlayWindow.webContents.isLoading() === false) {
    overlayWindow.showInactive();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  overlayWindow.on('closed', () => { overlayWindow = null; });
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannels.overlay.onStateChanged, getState());
  }
}

function destroyOverlayWindow(): void {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

// ─── Data Polling ────────────────────────────────────────────────────────────

function startDataPolling(mainWindow: BrowserWindow): void {
  if (dataInterval) return;

  dataInterval = setInterval(async () => {
    if (!overlayWindow) return;

    try {
      const [allPlayers, activePlayer, gameStats, events] = await Promise.all([
        liveClientApi.getAllPlayers() as Promise<LivePlayer[]>,
        liveClientApi.getActivePlayer() as Promise<ActivePlayer>,
        liveClientApi.getGameStats() as Promise<GameStats>,
        liveClientApi.getEventData() as Promise<EventData>
      ]);

      const myName = activePlayer.summonerName ?? activePlayer.riotId ?? '';
      const myChampion = (allPlayers.find(p => p.summonerName === myName || p.riotId === myName))?.championName ?? '';

      // Build enemies list
      const myTeam = allPlayers.find(p => p.summonerName === myName || p.riotId === myName)?.team ?? 'ORDER';
      const enemies: OverlayEnemy[] = allPlayers
        .filter(p => p.team !== myTeam)
        .map(p => ({
          summonerName: p.riotId || p.summonerName,
          championName: p.championName,
          level: p.level,
          spellD: p.summonerSpells?.summonerSpellOne?.rawDisplayName?.replace('GeneratedTip_SummonerSpell_', 'Summoner') ?? p.summonerSpells?.summonerSpellOne?.displayName ?? 'Unknown',
          spellF: p.summonerSpells?.summonerSpellTwo?.rawDisplayName?.replace('GeneratedTip_SummonerSpell_', 'Summoner') ?? p.summonerSpells?.summonerSpellTwo?.displayName ?? 'Unknown',
          isDead: p.isDead
        }));

      // Process events for jungle timers
      processEvents(events, gameStats.gameTime);

      // Get counter tips for lane opponent
      const counterTips = getCounterTipsForGame(myChampion, enemies);

      // Clean expired spell cooldowns
      cleanExpiredCooldowns();

      const gameData: OverlayGameData = {
        gameTime: gameStats.gameTime,
        enemies,
        spellCooldowns: [...spellCooldowns],
        jungleTimers: [...jungleTimers],
        counterTips,
        myChampionName: myChampion
      };

      overlayWindow.webContents.send(IpcChannels.overlay.onGameData, gameData);
      // Also send to main window for the settings page
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.overlay.onGameData, gameData);
      }
    } catch {
      // Game might have ended or API temporarily unavailable
    }
  }, POLL_DATA_MS);
}

function stopDataPolling(): void {
  if (dataInterval) { clearInterval(dataInterval); dataInterval = null; }
}

// ─── Game Logic Helpers ──────────────────────────────────────────────────────

function processEvents(events: EventData, _gameTime: number): void {
  if (!events?.Events) return;

  for (const evt of events.Events) {
    if (evt.EventName === 'DragonKill') {
      const timer = jungleTimers.find(t => t.objective === 'dragon');
      if (timer) timer.respawnAt = evt.EventTime + RESPAWN_TIMES.dragon;
    } else if (evt.EventName === 'BaronKill') {
      const timer = jungleTimers.find(t => t.objective === 'baron');
      if (timer) timer.respawnAt = evt.EventTime + RESPAWN_TIMES.baron;
    } else if (evt.EventName === 'HeraldKill') {
      const timer = jungleTimers.find(t => t.objective === 'riftHerald');
      if (timer) timer.respawnAt = evt.EventTime + RESPAWN_TIMES.riftHerald;
    }
  }
}

function getCounterTipsForGame(myChampion: string, enemies: OverlayEnemy[]): string[] {
  // Find counter tips for enemies against my champion
  const tips: string[] = [];
  for (const enemy of enemies) {
    const counters = getCountersFor(0); // We need champion ID lookup
    if (enemy.championName && myChampion) {
      tips.push(`vs ${enemy.championName}: Focus on trading when abilities are on cooldown`);
    }
  }
  return tips.slice(0, 3);
}

function cleanExpiredCooldowns(): void {
  const now = Date.now();
  for (let i = spellCooldowns.length - 1; i >= 0; i--) {
    const cd = spellCooldowns[i];
    const elapsed = (now - cd.usedAt) / 1000;
    if (elapsed > cd.cooldownTotal) {
      spellCooldowns.splice(i, 1);
    }
  }
}

function resetState(): void {
  spellCooldowns.length = 0;
  jungleTimers = [
    { objective: 'dragon', respawnAt: 0, label: 'Dragon' },
    { objective: 'baron', respawnAt: 0, label: 'Baron' },
    { objective: 'riftHerald', respawnAt: 0, label: 'Rift Herald' }
  ];
}

function getState(): OverlayState {
  return { isGameActive, isVisible: overlayWindow?.isVisible() ?? false };
}

function broadcastState(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IpcChannels.overlay.onStateChanged, getState());
}

// ─── Live Client API Types (internal) ────────────────────────────────────────

interface LivePlayer {
  summonerName: string;
  riotId?: string;
  championName: string;
  team: string;
  level: number;
  isDead: boolean;
  summonerSpells?: {
    summonerSpellOne?: { displayName?: string; rawDisplayName?: string };
    summonerSpellTwo?: { displayName?: string; rawDisplayName?: string };
  };
}

interface ActivePlayer {
  summonerName?: string;
  riotId?: string;
}

interface GameStats {
  gameTime: number;
}

interface GameEvent {
  EventName: string;
  EventTime: number;
}

interface EventData {
  Events?: GameEvent[];
}
