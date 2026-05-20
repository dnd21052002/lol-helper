import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { LcuStatusBar } from '../components/LcuStatusBar';
import { Sidebar } from '../components/Sidebar';
import type { LcuStatus } from '../../shared/ipc';

export function App(): JSX.Element {
  const [status, setStatus] = useState<LcuStatus>({ state: 'disconnected' });
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    void window.api.app.getVersion().then((res) => {
      if (res.ok) setVersion(res.data);
    });
    void window.api.lcu.getStatus().then((res) => {
      if (res.ok) setStatus(res.data);
    });
    const off = window.api.lcu.onStatusChanged(setStatus);
    return off;
  }, []);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div style={{ fontWeight: 600, letterSpacing: 0.4 }}>lol-helper</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>v{version || '0.1.0'}</div>
      </header>

      <LcuStatusBar status={status} />

      <div className="app-body">
        <Sidebar />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
