import { useEffect, useState } from 'react';
import type { EnemyTrackerData, EnemySpellInfo, SummonerSpellState } from '../../../shared/ipc';

function SpellCell({ spell }: { spell: SummonerSpellState }): JSX.Element {
  const isOnCd = spell.cooldownRemaining > 0;
  return (
    <td className={`tracker-spell ${isOnCd ? 'tracker-spell--cd' : 'tracker-spell--ready'}`}>
      <span className="tracker-spell__name">{spell.name || '—'}</span>
      <span className="tracker-spell__cd">
        {isOnCd ? `${spell.cooldownRemaining}s` : '✓'}
      </span>
    </td>
  );
}

function EnemyTableRow({ enemy }: { enemy: EnemySpellInfo }): JSX.Element {
  return (
    <tr className="tracker-row">
      <td className="tracker-champ">{enemy.championName}</td>
      <td className="tracker-summoner">{enemy.summonerName}</td>
      <SpellCell spell={enemy.spell1} />
      <SpellCell spell={enemy.spell2} />
    </tr>
  );
}

export function EnemyTrackerPage(): JSX.Element {
  const [data, setData] = useState<EnemyTrackerData | null>(null);

  useEffect(() => {
    void window.api.enemyTracker.getData().then((res) => {
      if (res.ok) setData(res.data);
    });
    const off = window.api.enemyTracker.onDataChanged(setData);
    return off;
  }, []);

  const isInGame = data && data.enemies.length > 0;

  return (
    <div className="page-container">
      <h1 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Enemy Spell Tracker</span>
        {isInGame && <span className="live-dot" title="Live" />}
      </h1>

      {!isInGame ? (
        <div className="loading-state">
          <p>No active game detected.</p>
          <p style={{ fontSize: 12 }}>Start a game — enemy spell cooldowns will appear here in realtime.</p>
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)' }}>
            Updated: {new Date(data.lastUpdatedAt).toLocaleTimeString()}
          </p>
          <div className="tracker-table-wrap">
            <table className="tracker-table">
              <thead>
                <tr>
                  <th>Champion</th>
                  <th>Summoner</th>
                  <th>Spell D</th>
                  <th>Spell F</th>
                </tr>
              </thead>
              <tbody>
                {data.enemies.map((e) => (
                  <EnemyTableRow key={e.summonerName} enemy={e} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
