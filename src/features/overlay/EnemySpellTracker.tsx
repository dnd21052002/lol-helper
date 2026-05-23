import type { EnemySpellInfo, SummonerSpellState } from '../../../shared/ipc';

interface SpellBadgeProps {
  spell: SummonerSpellState;
}

function SpellBadge({ spell }: SpellBadgeProps): JSX.Element {
  const isOnCooldown = spell.cooldownRemaining > 0;
  const pct = isOnCooldown
    ? Math.round((spell.cooldownRemaining / spell.cooldownTotal) * 100)
    : 0;

  return (
    <div className={`spell-badge ${isOnCooldown ? 'spell-badge--cd' : 'spell-badge--ready'}`}>
      <span className="spell-badge__name">{spell.name}</span>
      {isOnCooldown ? (
        <span className="spell-badge__cd" title={`${pct}% remaining`}>
          {spell.cooldownRemaining}s
        </span>
      ) : (
        <span className="spell-badge__ready">✓</span>
      )}
    </div>
  );
}

interface EnemyRowProps {
  enemy: EnemySpellInfo;
}

function EnemyRow({ enemy }: EnemyRowProps): JSX.Element {
  return (
    <div className="enemy-row">
      <span className="enemy-row__champ">{enemy.championName}</span>
      <div className="enemy-row__spells">
        <SpellBadge spell={enemy.spell1} />
        <SpellBadge spell={enemy.spell2} />
      </div>
    </div>
  );
}

interface EnemySpellTrackerProps {
  enemies: EnemySpellInfo[];
}

export function EnemySpellTracker({ enemies }: EnemySpellTrackerProps): JSX.Element {
  if (enemies.length === 0) {
    return (
      <div className="overlay-panel overlay-panel--top-right">
        <div className="overlay-badge">Enemy Spells</div>
        <p className="overlay-hint">Waiting for enemy data…</p>
      </div>
    );
  }

  return (
    <div className="overlay-panel overlay-panel--top-right enemy-tracker">
      <div className="overlay-badge">Enemy Spells</div>
      {enemies.map((e) => (
        <EnemyRow key={e.summonerName} enemy={e} />
      ))}
    </div>
  );
}
