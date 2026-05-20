import log from 'electron-log';
import type { AutoAcceptSettings, AutoAcceptStats } from '../../../shared/ipc';
import { lcuClient } from '../lcu/client';

const DEFAULT_SETTINGS: AutoAcceptSettings = {
  enabled: false,
  delayMs: 500
};

type Listener = (stats: AutoAcceptStats) => void;

class AutoAcceptModule {
  private settings: AutoAcceptSettings = { ...DEFAULT_SETTINGS };
  private stats: AutoAcceptStats = { acceptedCount: 0, lastAcceptedAt: null };
  private listeners = new Set<Listener>();
  private bound = false;
  /**
   * LCU bắn event `/lol-matchmaking/v1/ready-check` nhiều lần trong cùng một
   * session (mỗi khi có player accept/decline). Cần dedupe để chỉ POST accept
   * một lần, nếu không lần POST thứ 2 sẽ trả 500 vì client đã ready rồi.
   */
  private acceptInFlight = false;
  private pendingTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.bound) return;
    lcuClient.on('readyCheck', this.handleReadyCheck);
    this.bound = true;
    log.info('[autoAccept] module started');
  }

  stop(): void {
    if (!this.bound) return;
    lcuClient.off('readyCheck', this.handleReadyCheck);
    this.bound = false;
  }

  getSettings(): AutoAcceptSettings {
    return this.settings;
  }

  setSettings(next: Partial<AutoAcceptSettings>): AutoAcceptSettings {
    this.settings = { ...this.settings, ...next };
    log.info('[autoAccept] settings updated', this.settings);
    return this.settings;
  }

  getStats(): AutoAcceptStats {
    return this.stats;
  }

  onStatsChanged(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleReadyCheck = (state: string): void => {
    // Khi ready-check kết thúc (Invalid / EveryoneReady / vào champion select) thì
    // reset cờ để session tiếp theo có thể accept lại.
    if (state !== 'InProgress') {
      if (this.acceptInFlight || this.pendingTimer) {
        log.debug('[autoAccept] ready-check ended, resetting flags', { state });
      }
      this.resetAcceptState();
      return;
    }

    if (!this.settings.enabled) return;
    if (this.acceptInFlight || this.pendingTimer) {
      // Đã schedule cho session này rồi, bỏ qua các event update tiếp theo.
      return;
    }

    log.info('[autoAccept] ready-check detected, accepting in', this.settings.delayMs, 'ms');
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.accept();
    }, this.settings.delayMs);
  };

  private resetAcceptState(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.acceptInFlight = false;
  }

  private async accept(): Promise<void> {
    if (this.acceptInFlight) return;
    this.acceptInFlight = true;
    try {
      await lcuClient.request('POST', '/lol-matchmaking/v1/ready-check/accept');
      this.stats = {
        acceptedCount: this.stats.acceptedCount + 1,
        lastAcceptedAt: Date.now()
      };
      log.info('[autoAccept] accepted', this.stats);
      this.listeners.forEach((l) => l(this.stats));
    } catch (err) {
      log.warn('[autoAccept] accept failed', err);
    }
    // Giữ acceptInFlight = true cho đến khi ready-check rời InProgress để
    // tránh các event Update theo sau gây POST trùng. Reset trong handleReadyCheck.
  }
}

export const autoAccept = new AutoAcceptModule();