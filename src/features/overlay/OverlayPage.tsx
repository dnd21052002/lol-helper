import { useEffect, useState, useCallback } from 'react';
import type { OverlayGameData, OverlayEnemy, SpellCooldown, JungleTimer } from '../../../shared/ipc';

/**
 * Floating Panel page — rendered in a compact side window next to the game.
 * NOT overlaid on the game. Works like Porofessor/OP.GG on macOS.
 */
export function OverlayPage(): JSX.Element {
  const [gameData, setGameData] = useState<OverlayGameData | null>(null);

  useEffect(() => {
    const off = window.api.overlay.onGameData((data) => {
      setGameData(data);
    });
    return () => { off(); };
  }, []);

  if (!gameData) {
    return (
      <div className="fp-root fp-root--loading">
        <div className="fp-header">
          <span className="fp-logo">⚔️ LoL Helper</span>
        </div>
        <div className="fp-loading">Waiting for game data...</div>
      </div>
    );
  }

  return (
    <div className="fp-root">
      {/* Draggable header */}
      <div className="fp-header">
        <span className="fp-logo">⚔️ LoL Helper</span>
        <span className="fp-time">{formatTime(gameData.gameTime)}</span>
      </div>

      <div className="fp-body">
        {/* Enemy Spell Tracker */}
        <section className="fp-section">
          <div className="fp-section__title">Enemy Spells</div>
          <SpellTracker
            enemies={gameData.enemies}
            cooldowns={gameData.spellCooldowns}
          />
        </section>

        {/* Jungle Timers */}
        <section className="fp-section">
          <div className="fp-section__title">Objectives</div>
          <JungleTimerPanel
            timers={gameData.jungleTimers}
            gameTime={gameData.gameTime}
          />
        </section>

        {/* Counter Tips */}
        {gameData.counterTips.length > 0 && (
          <section className="fp-section">
            <div className="fp-section__title">Tips</div>
            <CounterTipsPanel tips={gameData.counterTips} />
          </section>
        )}
      </div>

      <div className="fp-footer">
        <span className="fp-hint">F9 to hide • Drag to move</span>
      </div>
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
