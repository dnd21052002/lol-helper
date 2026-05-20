import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execAsync = promisify(exec);

export interface LcuCredentials {
  protocol: 'http' | 'https';
  address: string; // 127.0.0.1
  port: number;
  username: 'riot';
  password: string;
}

/**
 * Các đường dẫn lockfile mặc định theo OS.
 * Dùng cho fast-path khi LoL cài đúng chỗ; nếu không thấy sẽ fallback sang
 * scan process list.
 */
const DEFAULT_LOCKFILE_PATHS: string[] = (() => {
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

function parseLockfile(content: string): LcuCredentials | null {
  // Format: name:pid:port:password:protocol
  const parts = content.trim().split(':');
  if (parts.length < 5) return null;
  const [, , port, password, protocol] = parts;
  if (!port || !password || (protocol !== 'http' && protocol !== 'https')) return null;
  const portNum = Number(port);
  if (!Number.isFinite(portNum)) return null;
  return {
    protocol,
    address: '127.0.0.1',
    port: portNum,
    username: 'riot',
    password
  };
}

async function readLockfileAt(filePath: string): Promise<LcuCredentials | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) return null;
    return parseLockfile(content);
  } catch {
    return null;
  }
}

/**
 * Scan process list để tìm LeagueClient(Ux). Cách này hoạt động dù LoL cài chỗ
 * khác mặc định.
 *
 * - macOS/Linux: dùng `ps -A -o args=`
 * - Windows: dùng wmic
 *
 * Sau khi có command line, ta cố lấy install path từ process path rồi đọc
 * lockfile cạnh đó.
 */
async function discoverFromProcess(): Promise<LcuCredentials | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'wmic PROCESS WHERE name="LeagueClientUx.exe" GET ExecutablePath /VALUE'
      );
      const match = stdout.match(/ExecutablePath=(.+)/);
      if (!match) return null;
      const exe = match[1].trim();
      const dir = path.dirname(exe);
      return readLockfileAt(path.join(dir, 'lockfile'));
    }
    // unix-like
    const { stdout } = await execAsync('ps -A -o args=');
    const lines = stdout.split('\n');
    const lcLine = lines.find(
      (l) => /LeagueClient(Ux)?$/.test(l.split(' ')[0]) || /\/LeagueClient(Ux)?\s/.test(l)
    );
    if (!lcLine) return null;
    // path là token đầu tiên (có thể chứa space, nhưng ps trên macOS sẽ không escape).
    // Heuristic: cắt tới phần " --" đầu tiên.
    const idx = lcLine.indexOf(' --');
    const exe = idx >= 0 ? lcLine.slice(0, idx) : lcLine.split(' ')[0];
    // exe ví dụ: /Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClient
    // lockfile nằm ở .../LoL/lockfile
    const lolIdx = exe.indexOf('/LoL/');
    if (lolIdx === -1) return null;
    const lolDir = exe.slice(0, lolIdx + '/LoL/'.length);
    return readLockfileAt(path.join(lolDir, 'lockfile'));
  } catch {
    return null;
  }
}

/**
 * Tìm credentials LCU. Trả null nếu LoL chưa chạy / chưa login.
 */
export async function discoverCredentials(): Promise<LcuCredentials | null> {
  for (const p of DEFAULT_LOCKFILE_PATHS) {
    const creds = await readLockfileAt(p);
    if (creds) return creds;
  }
  return discoverFromProcess();
}