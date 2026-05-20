import { EventEmitter } from 'node:events';
import https from 'node:https';
import http from 'node:http';
import log from 'electron-log';
import WebSocket from 'ws';
import type { LcuStatus } from '../../../shared/ipc';
import { discoverCredentials, type LcuCredentials } from './lockfile';

/**
 * LCU client thuần Node, không phụ thuộc league-connect.
 *
 * - Tự discover credentials từ lockfile (mac/win), fallback sang scan process.
 * - HTTPS request bỏ qua self-signed cert của LCU.
 * - WebSocket dùng giao thức WAMP của LCU: gửi `[5, "OnJsonApiEvent"]` để
 *   subscribe tất cả event, sau đó tự filter theo URI ở client side.
 */

const RECONNECT_MS = 4000;

type LcuEvents = {
  statusChanged: (status: LcuStatus) => void;
  readyCheck: (state: string) => void;
  // event chung cho mọi LCU event đã subscribe (dạng [eventType, name, payload])
  lcuEvent: (uri: string, eventType: string, data: unknown) => void;
};

type WampMessage = [number, string, { uri: string; eventType: string; data: unknown }];

export class LcuClient extends EventEmitter {
  private status: LcuStatus = { state: 'disconnected' };
  private credentials: LcuCredentials | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  on<K extends keyof LcuEvents>(event: K, listener: LcuEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof LcuEvents>(event: K, ...args: Parameters<LcuEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  getStatus(): LcuStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connectLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        log.warn('[lcu] ws close error', err);
      }
      this.ws = null;
    }
    this.credentials = null;
    this.setStatus({ state: 'disconnected' });
  }

  private async connectLoop(): Promise<void> {
    if (this.stopped) return;
    this.setStatus({ state: 'connecting' });

    const creds = await discoverCredentials();
    if (!creds) {
      log.debug('[lcu] no credentials yet, retrying');
      return this.scheduleReconnect();
    }
    this.credentials = creds;

    try {
      const summoner = await this.fetchSummoner();
      if (!summoner) {
        // LCU lockfile exists but API not ready yet — retry without resetting to disconnected
        log.debug('[lcu] summoner not available yet, retrying');
        this.scheduleReconnect(true);
        return;
      }
      const phase = await this.fetchGameflow();
      this.setStatus({
        state: 'connected',
        summoner,
        gameflowPhase: phase
      });
      this.openWebSocket();
    } catch (err) {
      log.debug('[lcu] connect failed, will retry', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(keepConnecting = false): void {
    if (this.stopped) return;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    if (!keepConnecting) {
      this.setStatus({ state: 'disconnected' });
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.connectLoop();
    }, RECONNECT_MS);
  }

  private buildAuthHeader(): string {
    if (!this.credentials) throw new Error('LCU not connected');
    const { username, password } = this.credentials;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  /**
   * HTTP request tới LCU. Bỏ qua self-signed cert.
   */
  async request<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
    if (!this.credentials) throw new Error('LCU not connected');
    const { protocol, address, port } = this.credentials;
    const lib = protocol === 'https' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise<T>((resolve, reject) => {
      const req = lib.request(
        {
          host: address,
          port,
          path: url,
          method,
          rejectUnauthorized: false,
          headers: {
            Accept: 'application/json',
            Authorization: this.buildAuthHeader(),
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload)
                }
              : {})
          }
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              if (!raw) return resolve(undefined as T);
              try {
                resolve(JSON.parse(raw) as T);
              } catch {
                resolve(raw as unknown as T);
              }
            } else {
              reject(new Error(`LCU ${method} ${url} -> ${status}: ${raw}`));
            }
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async fetchSummoner(): Promise<LcuStatus['summoner']> {
    try {
      const json = await this.request<{
        summonerId: number;
        displayName: string;
        gameName?: string;
        tagLine?: string;
        summonerLevel: number;
        profileIconId: number;
      }>('GET', '/lol-summoner/v1/current-summoner');
      return {
        summonerId: json.summonerId,
        displayName:
          json.displayName ||
          (json.gameName ? `${json.gameName}#${json.tagLine ?? ''}` : 'Unknown'),
        summonerLevel: json.summonerLevel,
        profileIconId: json.profileIconId
      };
    } catch (err) {
      log.debug('[lcu] fetchSummoner failed', err);
      return undefined;
    }
  }

  private async fetchGameflow(): Promise<string | undefined> {
    try {
      return await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase');
    } catch {
      return undefined;
    }
  }

  /**
   * Mở WebSocket tới LCU. Giao thức là WAMP-ish:
   *   client -> [5, "OnJsonApiEvent"]  (subscribe all)
   *   server -> [8, "OnJsonApiEvent", { uri, eventType, data }]
   */
  private openWebSocket(): void {
    if (!this.credentials) return;
    const { protocol, address, port } = this.credentials;
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    const url = `${wsProtocol}://${address}:${port}/`;
    const ws = new WebSocket(url, 'wamp', {
      headers: { Authorization: this.buildAuthHeader() },
      rejectUnauthorized: false
    });

    ws.on('open', () => {
      log.info('[lcu] websocket opened');
      ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      const text = raw.toString();
      if (!text) return;
      try {
        const msg = JSON.parse(text) as WampMessage;
        if (!Array.isArray(msg) || msg.length < 3) return;
        const payload = msg[2];
        if (!payload || typeof payload !== 'object') return;
        this.handleEvent(payload.uri, payload.eventType, payload.data);
      } catch (err) {
        log.debug('[lcu] ws parse error', err);
      }
    });

    ws.on('close', () => {
      log.info('[lcu] websocket closed');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      log.debug('[lcu] websocket error', err);
    });

    this.ws = ws;
  }

  private handleEvent(uri: string, eventType: string, data: unknown): void {
    this.emit('lcuEvent', uri, eventType, data);

    if (uri === '/lol-gameflow/v1/gameflow-phase') {
      const phase = typeof data === 'string' ? data : undefined;
      this.setStatus({ ...this.status, gameflowPhase: phase });
      return;
    }

    if (uri === '/lol-matchmaking/v1/ready-check') {
      const state = (data as { state?: string } | null)?.state;
      if (state) this.emit('readyCheck', state);
    }
  }

  private setStatus(next: LcuStatus): void {
    this.status = next;
    this.emit('statusChanged', next);
  }
}

export const lcuClient = new LcuClient();