// Smoke test: kết nối LCU và in summoner hiện tại + gameflow phase.
// Chạy: node scripts/smoke-lcu.mjs
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const execAsync = promisify(exec);

const DEFAULT_PATHS = (() => {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/League of Legends.app/Contents/LoL/lockfile',
        path.join(os.homedir(), 'Applications/League of Legends.app/Contents/LoL/lockfile')
      ];
    case 'win32':
      return [
        'C:\\Riot Games\\League of Legends\\lockfile',
        'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
        'C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile'
      ];
    default:
      return [];
  }
})();

function parseLockfile(content) {
  const parts = content.trim().split(':');
  if (parts.length < 5) return null;
  const [, , port, password, protocol] = parts;
  return { protocol, address: '127.0.0.1', port: Number(port), username: 'riot', password };
}

async function readLockfile(p) {
  try {
    const c = await fs.readFile(p, 'utf8');
    return c.trim() ? parseLockfile(c) : null;
  } catch {
    return null;
  }
}

async function discover() {
  for (const p of DEFAULT_PATHS) {
    const c = await readLockfile(p);
    if (c) return c;
  }
  if (process.platform !== 'win32') {
    const { stdout } = await execAsync('ps -A -o args=');
    const line = stdout.split('\n').find((l) => /\/LeagueClient(Ux)?(\s|$)/.test(l));
    if (line) {
      const idx = line.indexOf(' --');
      const exe = idx >= 0 ? line.slice(0, idx) : line.split(' ')[0];
      const lolIdx = exe.indexOf('/LoL/');
      if (lolIdx !== -1) {
        return readLockfile(exe.slice(0, lolIdx + 5) + 'lockfile');
      }
    }
  }
  return null;
}

function authHeader(c) {
  return 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64');
}

function request(c, method, url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: c.address,
        port: c.port,
        path: url,
        method,
        rejectUnauthorized: false,
        headers: { Accept: 'application/json', Authorization: authHeader(c) }
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve(raw);
            }
          } else {
            reject(new Error(`${res.statusCode}: ${raw}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const creds = await discover();
if (!creds) {
  console.error('❌ No LCU credentials found. Is LoL client running and logged in?');
  process.exit(1);
}
console.log('✅ Credentials:', { ...creds, password: creds.password.slice(0, 4) + '…' });

try {
  const summoner = await request(creds, 'GET', '/lol-summoner/v1/current-summoner');
  console.log('✅ Summoner:', {
    displayName: summoner.displayName || `${summoner.gameName}#${summoner.tagLine}`,
    summonerLevel: summoner.summonerLevel,
    summonerId: summoner.summonerId
  });
} catch (e) {
  console.error('❌ fetchSummoner failed:', e.message);
}

try {
  const phase = await request(creds, 'GET', '/lol-gameflow/v1/gameflow-phase');
  console.log('✅ Gameflow phase:', phase);
} catch (e) {
  console.error('❌ fetchGameflow failed:', e.message);
}

console.log('--- Listening WebSocket events for 6s ---');
const ws = new WebSocket(`wss://${creds.address}:${creds.port}/`, 'wamp', {
  headers: { Authorization: authHeader(creds) },
  rejectUnauthorized: false
});
ws.on('open', () => {
  console.log('✅ WS open');
  ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
});
ws.on('message', (raw) => {
  const text = raw.toString();
  if (!text) return;
  try {
    const msg = JSON.parse(text);
    if (Array.isArray(msg) && msg[2]?.uri) {
      console.log('  evt', msg[2].eventType, msg[2].uri);
    }
  } catch {
    /* noop */
  }
});
ws.on('error', (e) => console.error('WS error', e.message));
setTimeout(() => {
  ws.close();
  console.log('--- Done ---');
  process.exit(0);
}, 6000);