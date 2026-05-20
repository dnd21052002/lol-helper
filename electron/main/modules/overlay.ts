/**
 * In-Game Overlay Module
 *
 * Creates a transparent, always-on-top BrowserWindow that renders
 * overlay UI (counter tips, enemy spells, build suggestions, minimap info)
 * on top of the LoL game window.
 *
 * Data source: Riot Live Client Data API (https://127.0.0.1:2999/liveclientdata/...)
 * Approach: No injection into game process — safe regarding ToS.
 */

import { BrowserWindow, screen, ipcMain } from 'electron';
import path from 'node:path';
import { liveClientApi } from '../lcu/liveClient';

let overlayWindow: BrowserWindow | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let isGameActive = false;

const POLL_GAME_MS = 2000; // Check if game is running every 2s
const POLL_DATA_MS = 1000; // Fetch live data every 1s when in-game

export function startOverlayModule(mainWindow: BrowserWindow): void {
  // Poll for game start
  pollInterval = setInterval(async () => {
    const gameRunning = await liveClientApi.isGameRunning();

    if (gameRunning && !isGameActive) {
      isGameActive = true;
      await createOverlayWindow(mainWindow);
      startDataPolling();
    } else if (!gameRunning && isGameActive) {
      isGameActive = false;
      destroyOverlayWindow();
      stopDataPolling();
    }
  }, POLL_GAME_MS);

  // IPC: toggle overlay visibility
  ipcMain.handle('overlay:toggle', (_event, visible: boolean) => {
    if (overlayWindow) {
      if (visible) overlayWindow.show();
      else overlayWindow.hide();
    }
    return { ok: true, data: visible };
  });

  // IPC: get overlay state
  ipcMain.handle('overlay:getState', () => {
    return {
      ok: true,
      data: {
        isGameActive,
        isVisible: overlayWindow?.isVisible() ?? false
      }
    };
  });
}

export function stopOverlayModule(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  destroyOverlayWindow();
  stopDataPolling();
  ipcMain.removeHandler('overlay:toggle');
  ipcMain.removeHandler('overlay:getState');
}

async function createOverlayWindow(mainWindow: BrowserWindow): Promise<void> {
  if (overlayWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Make click-through except on interactive elements
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Load overlay renderer page
  if (process.env.NODE_ENV === 'development') {
    // In dev, load from vite dev server overlay route
    const mainUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    await overlayWindow.loadURL(`${mainUrl}#/overlay`);
  } else {
    await overlayWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      { hash: '/overlay' }
    );
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  // Notify main window that overlay is active
  mainWindow.webContents.send('overlay:stateChanged', { isGameActive: true, isVisible: true });
}

function destroyOverlayWindow(): void {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

let dataInterval: ReturnType<typeof setInterval> | null = null;

function startDataPolling(): void {
  if (dataInterval) return;

  dataInterval = setInterval(async () => {
    if (!overlayWindow) return;

    try {
      const [allPlayers, activePlayer, gameStats, events] = await Promise.all([
        liveClientApi.getAllPlayers(),
        liveClientApi.getActivePlayer(),
        liveClientApi.getGameStats(),
        liveClientApi.getEventData()
      ]);

      overlayWindow.webContents.send('overlay:gameData', {
        allPlayers,
        activePlayer,
        gameStats,
        events
      });
    } catch {
      // Game might have ended or API temporarily unavailable
    }
  }, POLL_DATA_MS);
}

function stopDataPolling(): void {
  if (dataInterval) {
    clearInterval(dataInterval);
    dataInterval = null;
  }
}
