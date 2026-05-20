import { useEffect, useState } from 'react';
import type { AutoAcceptSettings, AutoAcceptStats } from '../../../shared/ipc';

export function AutoAcceptPanel(): JSX.Element {
  const [settings, setSettings] = useState<AutoAcceptSettings>({
    enabled: false,
    delayMs: 500
  });
  const [stats, setStats] = useState<AutoAcceptStats>({
    acceptedCount: 0,
    lastAcceptedAt: null
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.api.autoAccept.getSettings().then((res) => {
      if (res.ok) setSettings(res.data);
    });
    void window.api.autoAccept.getStats().then((res) => {
      if (res.ok) setStats(res.data);
    });
    const off = window.api.autoAccept.onStatsChanged(setStats);
    return off;
  }, []);

  const update = async (patch: Partial<AutoAcceptSettings>): Promise<void> => {
    setSaving(true);
    const res = await window.api.autoAccept.setSettings(patch);
    if (res.ok) setSettings(res.data);
    setSaving(false);
  };

  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 20,
        maxWidth: 560
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>Auto-Accept</h2>
      <p style={{ marginTop: 0, color: 'var(--text-dim)', fontSize: 13 }}>
        Tự động bấm Accept khi tìm được trận. Cần kết nối được với LoL client.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 16,
          cursor: 'pointer'
        }}
      >
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={saving}
          onChange={(e) => void update({ enabled: e.target.checked })}
        />
        <span>Bật Auto-Accept</span>
      </label>

      <label style={{ display: 'block', marginTop: 16 }}>
        <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-dim)' }}>
          Delay trước khi accept (ms)
        </div>
        <input
          type="number"
          min={0}
          max={5000}
          step={100}
          value={settings.delayMs}
          disabled={saving}
          onChange={(e) => void update({ delayMs: Number(e.target.value) || 0 })}
          style={{
            width: 120,
            padding: '6px 8px',
            background: 'var(--bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4
          }}
        />
      </label>

      <div
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          fontSize: 13,
          color: 'var(--text-dim)'
        }}
      >
        Đã accept: <strong style={{ color: 'var(--text)' }}>{stats.acceptedCount}</strong> trận
        {stats.lastAcceptedAt && (
          <span> · lần cuối {new Date(stats.lastAcceptedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </section>
  );
}