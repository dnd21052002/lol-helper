import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  AutoAcceptSettings,
  AutoAcceptStats,
  AutoRankedSettings,
  AutoRankedState,
  ChampionPickerData,
  ChampSelectSession,
  CounterTipInfo,
  IpcResult,
  LcuStatus,
  MatchHistoryFilter,
  MatchHistoryResponse,
  OverlaySettings,
  OverlayState,
  OverlayGameData
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
  championPicker: {
    getChampions: (): Promise<IpcResult<ChampionPickerData>> =>
      ipcRenderer.invoke(IpcChannels.championPicker.getChampions),
    getSession: (): Promise<IpcResult<ChampSelectSession>> =>
      ipcRenderer.invoke(IpcChannels.championPicker.getSession),
    getCounters: (enemyChampionId: number): Promise<IpcResult<CounterTipInfo[]>> =>
      ipcRenderer.invoke(IpcChannels.championPicker.getCounters, enemyChampionId),
    onSessionChanged: (cb: (session: ChampSelectSession) => void): (() => void) => {
      const listener = (_evt: unknown, session: ChampSelectSession): void => cb(session);
      ipcRenderer.on(IpcChannels.championPicker.onSessionChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannels.championPicker.onSessionChanged, listener);
    }
  },
  autoRanked: {
    getSettings: (): Promise<IpcResult<AutoRankedSettings>> =>
      ipcRenderer.invoke(IpcChannels.autoRanked.getSettings),
    setSettings: (patch: Partial<AutoRankedSettings>): Promise<IpcResult<AutoRankedSettings>> =>
      ipcRenderer.invoke(IpcChannels.autoRanked.setSettings, patch),
    getState: (): Promise<IpcResult<AutoRankedState>> =>
      ipcRenderer.invoke(IpcChannels.autoRanked.getState),
    startQueue: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IpcChannels.autoRanked.startQueue),
    onStateChanged: (cb: (state: AutoRankedState) => void): (() => void) => {
      const listener = (_evt: unknown, state: AutoRankedState): void => cb(state);
      ipcRenderer.on(IpcChannels.autoRanked.onStateChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannels.autoRanked.onStateChanged, listener);
    }
  },
  matchHistory: {
    fetch: (filter?: MatchHistoryFilter): Promise<IpcResult<MatchHistoryResponse>> =>
      ipcRenderer.invoke(IpcChannels.matchHistory.fetch, filter)
  },
  overlay: {
    getSettings: (): Promise<IpcResult<OverlaySettings>> =>
      ipcRenderer.invoke(IpcChannels.overlay.getSettings),
    setSettings: (patch: Partial<OverlaySettings>): Promise<IpcResult<OverlaySettings>> =>
      ipcRenderer.invoke(IpcChannels.overlay.setSettings, patch),
    getState: (): Promise<IpcResult<OverlayState>> =>
      ipcRenderer.invoke(IpcChannels.overlay.getState),
    toggle: (visible: boolean): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(IpcChannels.overlay.toggle, visible),
    trackSpell: (data: { summonerName: string; championName: string; slot: 'D' | 'F'; spellName: string }): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(IpcChannels.overlay.trackSpell, data),
    onGameData: (cb: (data: OverlayGameData) => void): (() => void) => {
      const listener = (_evt: unknown, data: OverlayGameData): void => cb(data);
      ipcRenderer.on(IpcChannels.overlay.onGameData, listener);
      return () => ipcRenderer.removeListener(IpcChannels.overlay.onGameData, listener);
    },
    onStateChanged: (cb: (state: OverlayState) => void): (() => void) => {
      const listener = (_evt: unknown, state: OverlayState): void => cb(state);
      ipcRenderer.on(IpcChannels.overlay.onStateChanged, listener);
      return () => ipcRenderer.removeListener(IpcChannels.overlay.onStateChanged, listener);
    }
  }
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);