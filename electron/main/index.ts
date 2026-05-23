import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log';
import { join } from 'node:path';
import { IpcChannels } from '../../shared/ipc';
import type { IpcResult, AutoAcceptSettings, LcuStatus, AutoAcceptStats, MatchHistoryFilter, MatchHistoryResponse, ChampionPickerData, ChampSelectSession, CounterTipInfo, EnemyTrackerData, AutoRankedSettings, AutoRankedState } from '../../shared/ipc';
import { lcuClient } from './lcu/client';
import { autoAccept } from './modules/autoAccept';
import { autoRanked } from './modules/autoRanked';
import { fetchMatchHistory } from './modules/matchHistory';
import { startChampionPicker, stopChampionPicker, getChampions, getDdragonVersion, getChampSelectSession, onSessionChanged } from './modules/championPicker';
import { getCountersFor } from './data/counterData';
import { enemyTracker } from './modules/enemyTracker';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  // App info
  ipcMain.handle(IpcChannels.app.getVersion, (): IpcResult<string> => {
    return { ok: true, data: app.getVersion() };
  });

  // LCU status
  ipcMain.handle(IpcChannels.lcu.getStatus, (): IpcResult<LcuStatus> => {
    return { ok: true, data: lcuClient.getStatus() };
  });

  // Auto-accept
  ipcMain.handle(IpcChannels.autoAccept.getSettings, (): IpcResult<AutoAcceptSettings> => {
    return { ok: true, data: autoAccept.getSettings() };
  });

  ipcMain.handle(
    IpcChannels.autoAccept.setSettings,
    (_evt, patch: Partial<AutoAcceptSettings>): IpcResult<AutoAcceptSettings> => {
      try {
        const next = autoAccept.setSettings(patch);
        return { ok: true, data: next };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle(IpcChannels.autoAccept.getStats, (): IpcResult<AutoAcceptStats> => {
    return { ok: true, data: autoAccept.getStats() };
  });

  // Champion Picker
  ipcMain.handle(IpcChannels.championPicker.getChampions, (): IpcResult<ChampionPickerData> => {
    return { ok: true, data: { champions: getChampions(), ddragonVersion: getDdragonVersion() } };
  });

  ipcMain.handle(IpcChannels.championPicker.getSession, (): IpcResult<ChampSelectSession> => {
    return { ok: true, data: getChampSelectSession() };
  });

  ipcMain.handle(
    IpcChannels.championPicker.getCounters,
    (_evt, enemyChampionId: number): IpcResult<CounterTipInfo[]> => {
      return { ok: true, data: getCountersFor(enemyChampionId) };
    }
  );

  // Auto Ranked
  ipcMain.handle(IpcChannels.autoRanked.getSettings, (): IpcResult<AutoRankedSettings> => {
    return { ok: true, data: autoRanked.getSettings() };
  });

  ipcMain.handle(
    IpcChannels.autoRanked.setSettings,
    (_evt, patch: Partial<AutoRankedSettings>): IpcResult<AutoRankedSettings> => {
      try {
        const next = autoRanked.setSettings(patch);
        return { ok: true, data: next };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle(IpcChannels.autoRanked.getState, (): IpcResult<AutoRankedState> => {
    return { ok: true, data: autoRanked.getState() };
  });

  ipcMain.handle(IpcChannels.autoRanked.startQueue, async (): Promise<IpcResult<void>> => {
    try {
      await autoRanked.startQueue();
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Match history
  ipcMain.handle(
    IpcChannels.matchHistory.fetch,
    async (_evt, filter?: MatchHistoryFilter): Promise<IpcResult<MatchHistoryResponse>> => {
      try {
        const data = await fetchMatchHistory(filter);
        return { ok: true, data };
      } catch (err) {
        log.warn('[matchHistory] fetch failed', err);
        return { ok: false, error: String(err) };
      }
    }
  );

  // Enemy tracker
  ipcMain.handle(IpcChannels.enemyTracker.getData, (): IpcResult<EnemyTrackerData> => {
    return { ok: true, data: enemyTracker.getData() };
  });
}

function wireBroadcasts(): void {
  lcuClient.on('statusChanged', (status) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IpcChannels.lcu.onStatusChanged, status);
    });
  });

  autoAccept.onStatsChanged((stats) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IpcChannels.autoAccept.onStatsChanged, stats);
    });
  });

  onSessionChanged((session) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IpcChannels.championPicker.onSessionChanged, session);
    });
  });

  enemyTracker.onDataChanged((data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IpcChannels.enemyTracker.onDataChanged, data);
    });
  });
}

void app.whenReady().then(async () => {
  log.info('[app] starting lol-helper', app.getVersion());
  registerIpc();
  wireBroadcasts();
  autoAccept.start();
  enemyTracker.start();
  void startChampionPicker();
  void lcuClient.start();
  createWindow();


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void lcuClient.stop();
  autoAccept.stop();
  enemyTracker.stop();
  stopChampionPicker();});
