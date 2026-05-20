import type { LcuStatus } from '../../shared/ipc';

interface Props {
  status: LcuStatus;
}

const LABEL: Record<LcuStatus['state'], string> = {
  disconnected: 'Chưa kết nối client',
  connecting: 'Đang kết nối...',
  connected: 'Đã kết nối'
};

const COLOR: Record<LcuStatus['state'], string> = {
  disconnected: 'var(--danger)',
  connecting: 'var(--accent)',
  connected: 'var(--success)'
};

export function LcuStatusBar({ status }: Props): JSX.Element {
  return (
    <div
      style={{
        padding: '8px 20px',
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: COLOR[status.state]
        }}
      />
      <span>{LABEL[status.state]}</span>
      {status.summoner && (
        <span style={{ color: 'var(--text-dim)' }}>
          — {status.summoner.displayName} (Lv {status.summoner.summonerLevel})
        </span>
      )}
      {status.gameflowPhase && (
        <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>
          Phase: {status.gameflowPhase}
        </span>
      )}
    </div>
  );
}