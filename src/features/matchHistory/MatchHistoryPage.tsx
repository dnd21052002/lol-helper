import { useCallback, useEffect, useState } from 'react';
import type { MatchHistoryEntry, MatchHistoryFilter } from '../../../shared/ipc';

const QUEUE_OPTIONS = [
  { value: 0, label: 'All Queues' },
  { value: 420, label: 'Ranked Solo' },
  { value: 440, label: 'Ranked Flex' },
  { value: 400, label: 'Normal Draft' },
  { value: 430, label: 'Normal Blind' },
  { value: 450, label: 'ARAM' },
  { value: 1700, label: 'Arena' }
];

export function MatchHistoryPage(): JSX.Element {
  const [entries, setEntries] = useState<MatchHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState(0);
  const [championFilter, setChampionFilter] = useState('');
  const [selectedGame, setSelectedGame] = useState<MatchHistoryEntry | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filter: MatchHistoryFilter = {};
      if (queueFilter > 0) filter.queueId = queueFilter;
      const result = await window.api.matchHistory.fetch(filter);
      if (result.ok) {
        setEntries(result.data.entries);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [queueFilter]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const filteredEntries = championFilter
    ? entries.filter((e) =>
        e.championName.toLowerCase().includes(championFilter.toLowerCase())
      )
    : entries;

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (epoch: number): string => {
    const d = new Date(epoch);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const timeAgo = (epoch: number): string => {
    const diff = Date.now() - epoch;
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Vừa xong';
    if (hours < 24) return `${hours}h trước`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d trước`;
    return formatDate(epoch);
  };

  const kdaColor = (kills: number, deaths: number, assists: number): string => {
    const kda = deaths === 0 ? kills + assists : (kills + assists) / deaths;
    if (kda >= 5) return 'var(--color-gold)';
    if (kda >= 3) return 'var(--color-green)';
    if (kda >= 2) return 'var(--text-primary)';
    return 'var(--text-dim)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Match History</h2>
        <button
          onClick={() => void fetchHistory()}
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 13
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={queueFilter}
          onChange={(e) => setQueueFilter(Number(e.target.value))}
          aria-label="Filter by queue type"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 13
          }}
        >
          {QUEUE_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter champion..."
          value={championFilter}
          onChange={(e) => setChampionFilter(e.target.value)}
          aria-label="Filter by champion name"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 13,
            width: 160
          }}
        />

        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {filteredEntries.length} trận
        </span>
      </div>

      {error && (
        <div style={{ color: 'var(--color-red)', fontSize: 13, padding: '8px 0' }}>
          ⚠ {error}
        </div>
      )}

      {/* Match list + detail split */}
      <div style={{ display: 'flex', flex: 1, gap: 12, minHeight: 0 }}>
        {/* List */}
        <div
          style={{
            flex: selectedGame ? '0 0 55%' : '1',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}
        >
          {filteredEntries.length === 0 && !loading && (
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              Không có trận nào. Hãy kết nối League Client và thử lại.
            </p>
          )}

          {filteredEntries.map((entry) => (
            <button
              key={entry.gameId}
              onClick={() => setSelectedGame(entry)}
              aria-label={`Match ${entry.championName} ${entry.win ? 'Win' : 'Loss'}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: selectedGame?.gameId === entry.gameId
                  ? '1px solid var(--accent)'
                  : '1px solid transparent',
                background: entry.win
                  ? 'rgba(68, 189, 50, 0.08)'
                  : 'rgba(234, 57, 67, 0.08)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'border-color 0.15s'
              }}
            >
              {/* Win/Loss indicator */}
              <div
                style={{
                  width: 4,
                  height: 36,
                  borderRadius: 2,
                  background: entry.win ? 'var(--color-green)' : 'var(--color-red)',
                  flexShrink: 0
                }}
              />

              {/* Champion + queue */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {entry.championName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {entry.queueName} · {formatDuration(entry.gameDuration)}
                </div>
              </div>

              {/* KDA */}
              <div style={{ textAlign: 'center', minWidth: 80 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: kdaColor(entry.kills, entry.deaths, entry.assists)
                  }}
                >
                  {entry.kills}/{entry.deaths}/{entry.assists}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {entry.cs} CS · {(entry.goldEarned / 1000).toFixed(1)}k gold
                </div>
              </div>

              {/* Time */}
              <div style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 60, textAlign: 'right' }}>
                {timeAgo(entry.gameCreation)}
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        {selectedGame && (
          <div
            style={{
              flex: '0 0 42%',
              background: 'var(--bg-secondary)',
              borderRadius: 10,
              padding: 16,
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedGame.championName}</h3>
              <button
                onClick={() => setSelectedGame(null)}
                aria-label="Close detail panel"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: 18
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 8,
                background: selectedGame.win
                  ? 'rgba(68, 189, 50, 0.12)'
                  : 'rgba(234, 57, 67, 0.12)',
                fontSize: 14,
                fontWeight: 600,
                color: selectedGame.win ? 'var(--color-green)' : 'var(--color-red)'
              }}
            >
              {selectedGame.win ? '🏆 Victory' : '💀 Defeat'}
            </div>

            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <DetailItem label="Queue" value={selectedGame.queueName} />
              <DetailItem label="Duration" value={formatDuration(selectedGame.gameDuration)} />
              <DetailItem
                label="KDA"
                value={`${selectedGame.kills}/${selectedGame.deaths}/${selectedGame.assists}`}
              />
              <DetailItem
                label="KDA Ratio"
                value={
                  selectedGame.deaths === 0
                    ? 'Perfect'
                    : ((selectedGame.kills + selectedGame.assists) / selectedGame.deaths).toFixed(2)
                }
              />
              <DetailItem label="CS" value={String(selectedGame.cs)} />
              <DetailItem label="Gold" value={`${(selectedGame.goldEarned / 1000).toFixed(1)}k`} />
              <DetailItem label="Role" value={selectedGame.lane} />
              <DetailItem label="Date" value={formatDate(selectedGame.gameCreation)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
