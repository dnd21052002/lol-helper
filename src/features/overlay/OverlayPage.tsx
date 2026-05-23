import { useEffect, useState } from 'react';
import type { EnemyTrackerData } from '../../../shared/ipc';
import { EnemySpellTracker } from './EnemySpellTracker';

/**
 * Overlay page — rendered in the transparent always-on-top BrowserWindow.
 * Background is fully transparent; only UI elements are visible.
 */
export function OverlayPage(): JSX.Element {
  const [trackerData, setTrackerData] = useState<EnemyTrackerData | null>(null);

  useEffect(() => {
    // Fetch initial data
    void window.api.enemyTracker.getData().then((res) => {
      if (res.ok) setTrackerData(res.data);
    });

    // Subscribe to realtime updates
    const off = window.api.enemyTracker.onDataChanged(setTrackerData);
    return off;
  }, []);

  return (
    <div className="overlay-root">
      <EnemySpellTracker enemies={trackerData?.enemies ?? []} />
    </div>
  );
}

// ─── Spell Tracker ───────────────────────────────────────────────────────────

function SpellTracker({ enemies, cooldowns }: { enemies: OverlayEnemy[]; cooldowns: SpellCooldown[] }): JSX.Element {
  const handleTrackSpell = useCallback((enemy: OverlayEnemy, slot: 'D' | 'F') => {
    const spellName = slot === 'D' ? enemy.spellD : enemy.spellF;
    window.api.overlay.trackSpell({
      summonerName: enemy.summonerName,
      championName: enemy.championName,
      slot,
      spellName
    });
  }, []);

  return (
    <div className="fp-spells">
      {enemies.map((enemy) => {
        const cdD = cooldowns.find(c => c.summonerName === enemy.summonerName && c.slot === 'D');
        const cdF = cooldowns.find(c => c.summonerName === enemy.summonerName && c.slot === 'F');

        return (
          <div key={enemy.summonerName} className={`fp-spell-row ${enemy.isDead ? 'fp-spell-row--dead' : ''}`}>
            <span className="fp-spell-champ" title={enemy.summonerName}>
              {enemy.championName}
            </span>
            <span className="fp-spell-lvl">Lv{enemy.level}</span>
            <SpellButton
              spellName={enemy.spellD}
              cooldown={cdD}
              onClick={() => handleTrackSpell(enemy, 'D')}
            />
            <SpellButton
              spellName={enemy.spellF}
              cooldown={cdF}
              onClick={() => handleTrackSpell(enemy, 'F')}
            />
          </div>
        );
      })}
    </div>
  );
}

function SpellButton({ spellName, cooldown, onClick }: {
  spellName: string;
  cooldown: SpellCooldown | undefined;
  onClick: () => void;
}): JSX.Element {
  const remaining = cooldown ? getRemainingSeconds(cooldown) : 0;
  const isOnCooldown = remaining > 0;
  const displayName = spellName.replace('Summoner', '').replace('GeneratedTip_SummonerSpell_', '');

  return (
    <button
      className={`fp-spell-btn ${isOnCooldown ? 'fp-spell-btn--cd' : ''}`}
      onClick={onClick}
      title={`Click to track ${spellName} cooldown`}
    >
      <span className="fp-spell-btn__name">{displayName.slice(0, 4)}</span>
      {isOnCooldown && (
        <span className="fp-spell-btn__timer">{remaining}s</span>
      )}
    </button>
  );
}

// ─── Jungle Timers ───────────────────────────────────────────────────────────

function JungleTimerPanel({ timers, gameTime }: { timers: JungleTimer[]; gameTime: number }): JSX.Element {
  const ICONS: Record<string, string> = {
    dragon: '🐉',
    baron: '👾',
    riftHerald: '🦀'
  };

  return (
    <div className="fp-timers">
      {timers.map((timer) => {
        const remaining = timer.respawnAt > 0 ? Math.max(0, Math.ceil(timer.respawnAt - gameTime)) : 0;
        const isActive = remaining > 0;

        return (
          <div key={timer.objective} className={`fp-timer-row ${isActive ? 'fp-timer-row--active' : ''}`}>
            <span className="fp-timer-icon">{ICONS[timer.objective] ?? '⏱'}</span>
            <span className="fp-timer-label">{timer.label}</span>
            <span className="fp-timer-value">
              {isActive ? formatTime(remaining) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Counter Tips ────────────────────────────────────────────────────────────

function CounterTipsPanel({ tips }: { tips: string[] }): JSX.Element {
  return (
    <ul className="fp-tips">
      {tips.map((tip, i) => (
        <li key={i} className="fp-tip-item">{tip}</li>
      ))}
    </ul>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRemainingSeconds(cd: SpellCooldown): number {
  const elapsed = (Date.now() - cd.usedAt) / 1000;
  return Math.max(0, Math.ceil(cd.cooldownTotal - elapsed));
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
