import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  AutoAcceptSettings,
  AutoAcceptStats,
  IpcResult,
  LcuStatus,
  MatchHistoryFilter,
  MatchHistoryResponse
} from '../../shared/ipc';

const api = {
  app: {
    getVersion: (): Promise<IpcResult<string>> => ipcRenderer.invoke(IpcChannels.app.getVersion)
  },
  lcu: {
    getStatus: (): Promise<IpcResult<LcuStatus>> => ipcRenderer.invoke(IpcChannels.lcu.getStatus),
    onStatusChanged: (cb: (status: LcuStatus) => void): (() => void) => {
      const listener = (_evt: unknown, status: LcuStatus): void => cb(status);
      ipcRenderer.on(IpcChannels.lcu.onStatusChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannels.lcu.onStatusChanged, listener);
    }
  },
  autoAccept: {
    getSettings: (): Promise<IpcResult<AutoAcceptSettings>> =>
      ipcRenderer.invoke(IpcChannels.autoAccept.getSettings),
    setSettings: (patch: Partial<AutoAcceptSettings>): Promise<IpcResult<AutoAcceptSettings>> =>
      ipcRenderer.invoke(IpcChannels.autoAccept.setSettings, patch),
    getStats: (): Promise<IpcResult<AutoAcceptStats>> =>
      ipcRenderer.invoke(IpcChannels.autoAccept.getStats),
    onStatsChanged: (cb: (stats: AutoAcceptStats) => void): (() => void) => {
      const listener = (_evt: unknown, stats: AutoAcceptStats): void => cb(stats);
      ipcRenderer.on(IpcChannels.autoAccept.onStatsChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannels.autoAccept.onStatsChanged, listener);
    }
  },
  matchHistory: {
    fetch: (filter?: MatchHistoryFilter): Promise<IpcResult<MatchHistoryResponse>> =>
      ipcRenderer.invoke(IpcChannels.matchHistory.fetch, filter)
  }
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);