import { useEffect, useState } from 'react';
import type { OverlaySettings, OverlayState } from '../../../shared/ipc';

export function OverlaySettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<OverlaySettings>({
    enabled: true,
    showSpellTracker: true,
    showJungleTimers: true,
    showCounterTips: true,
    opacity: 0.85
  });
  const [state, setState] = useState<OverlayState>({
    isGameActive: false,
    isVisible: false
  });

  useEffect(() => {
    window.api.overlay.getSettings().then((res) => {
      if (res.ok) setSettings(res.data);
    });
    window.api.overlay.getState().then((res) => {
      if (res.ok) setState(res.data);
    });

    const cleanupState = window.api.overlay.onStateChanged(setState);
    return () => { cleanupState(); };
  }, []);

  const updateSetting = <K extends keyof OverlaySettings>(
    key: K,
    value: OverlaySettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    window.api.overlay.setSettings(next);
  };

  return (
    <div className="page">
      <h1>Floating Panel Settings</h1>

      <div className="overlay-status">
        <span className={`status-dot ${state.isGameActive ? 'status-dot--active' : ''}`} />
        <span>{state.isGameActive ? 'In Game' : 'Not In Game'}</span>
        {state.isVisible && <span className="overlay-badge">Panel Visible</span>}
      </div>

      {/* macOS True Fullscreen warning */}
      <div className="overlay-warning">
        <span className="overlay-warning__icon">⚠️</span>
        <div>
          <strong>Yêu cầu chế độ Borderless Windowed</strong>
          <p>
            macOS không cho phép overlay hiển thị trên game chạy <em>Toàn Màn hình</em> (True Fullscreen).
            Vào <strong>Tùy Chọn → Hình Ảnh → Chế độ Cửa sổ</strong> và chọn <strong>"Cửa sổ không viền"</strong> để panel hiển thị đúng.
          </p>
        </div>
      </div>

      <p className="hint">Panel xuất hiện bên cạnh cửa sổ game (giống Porofessor). Kéo để di chuyển. Nhấn F9 để ẩn/hiện.</p>

      <section className="settings-section">
        <label className="setting-row">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => updateSetting('enabled', e.target.checked)}
          />
          <span>Enable Overlay</span>
        </label>

        <label className="setting-row">
          <input
            type="checkbox"
            checked={settings.showSpellTracker}
            onChange={(e) => updateSetting('showSpellTracker', e.target.checked)}
          />
          <span>Show Spell Tracker</span>
        </label>

        <label className="setting-row">
          <input
            type="checkbox"
            checked={settings.showJungleTimers}
            onChange={(e) => updateSetting('showJungleTimers', e.target.checked)}
          />
          <span>Show Jungle Timers</span>
        </label>

        <label className="setting-row">
          <input
            type="checkbox"
            checked={settings.showCounterTips}
            onChange={(e) => updateSetting('showCounterTips', e.target.checked)}
          />
          <span>Show Counter Tips</span>
        </label>

        <label className="setting-row">
          <span>Opacity: {Math.round(settings.opacity * 100)}%</span>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={settings.opacity}
            onChange={(e) => updateSetting('opacity', parseFloat(e.target.value))}
          />
        </label>
      </section>

      <button
        className="btn btn--primary"
        onClick={() => window.api.overlay.toggle(!state.isVisible)}
        disabled={!state.isGameActive}
      >
        {state.isVisible ? 'Hide Overlay' : 'Show Overlay'}
      </button>
    </div>
  );
}
