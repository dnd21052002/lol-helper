import { useEffect, useState, useMemo } from 'react';
import type { ChampionInfo, ChampSelectSession, CounterTipInfo } from '../../../shared/ipc';
import { COUNTER_MAP } from '../../../electron/main/data/counterData';

const api = window.api;

const ROLES = ['All', 'Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'] as const;
type Role = (typeof ROLES)[number];

// Set of champion IDs that have counter data
const championsWithCounters = new Set(Object.keys(COUNTER_MAP).map(Number));

function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="difficulty-dots" title={`Difficulty: ${level}/10`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`dot ${i < level ? 'filled' : ''}`} />
      ))}
    </span>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="stat-bar-row">
      <span className="stat-label">{label}</span>
      <div className="stat-bar-track">
        <div className="stat-bar-fill" style={{ width: `${value * 10}%`, background: color }} />
      </div>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export default function ChampionPickerPage() {
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [ddragonVersion, setDdragonVersion] = useState('');
  const [session, setSession] = useState<ChampSelectSession | null>(null);
  const [search, setSearch] = useState('');
  const [selectedEnemy, setSelectedEnemy] = useState<number | null>(null);
  const [selectedChampion, setSelectedChampion] = useState<ChampionInfo | null>(null);
  const [counters, setCounters] = useState<CounterTipInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<Role>('All');

  // Load champions on mount
  useEffect(() => {
    async function init() {
      const res = await api.championPicker.getChampions();
      if (res.ok) {
        setChampions(res.data.champions);
        setDdragonVersion(res.data.ddragonVersion);
      }
      const sessRes = await api.championPicker.getSession();
      if (sessRes.ok) {
        setSession(sessRes.data.inChampSelect ? sessRes.data : null);
      }
      setLoading(false);
    }
    void init();
  }, []);

  // Subscribe to session changes
  useEffect(() => {
    const unsub = api.championPicker.onSessionChanged((sess) => {
      setSession(sess.inChampSelect ? sess : null);
    });
    return unsub;
  }, []);

  // Fetch counters when enemy selected
  useEffect(() => {
    if (selectedEnemy === null) {
      setCounters([]);
      return;
    }
    async function fetch() {
      const res = await api.championPicker.getCounters(selectedEnemy!);
      if (res.ok) setCounters(res.data);
    }
    void fetch();
  }, [selectedEnemy]);

  // Filtered champion list
  const filteredChampions = useMemo(() => {
    let list = champions;
    if (activeRole !== 'All') {
      list = list.filter((c) => c.tags.includes(activeRole));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [champions, search, activeRole]);

  // Get champion image URL
  function champImgUrl(image: string): string {
    if (!ddragonVersion) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${image}`;
  }

  function handleChampionClick(champ: ChampionInfo) {
    if (selectedChampion?.id === champ.id) {
      setSelectedChampion(null);
    } else {
      setSelectedChampion(champ);
      // Also load counters for this champion
      setSelectedEnemy(champ.id);
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-state">Loading champion data...</div>
      </div>
    );
  }

  return (
    <div className="page-container champion-picker-page">
      <h1>Champion Picker</h1>

      {/* Live Champ Select Session */}
      {session && (
        <section className="champ-select-live">
          <h2>
            <span className="live-dot" /> Live Champ Select — {session.phase || 'In Progress'}
          </h2>
          <div className="teams-row">
            <div className="team-col">
              <h3>Your Team</h3>
              {session.myTeam.map((p) => (
                <div key={p.cellId} className={`player-row ${p.isLocalPlayer ? 'is-local' : ''}`}>
                  <span className="player-role">{p.assignedPosition || '?'}</span>
                  <span className="player-champ">
                    {p.championId > 0 ? p.championName : '—'}
                  </span>
                  {p.isLocalPlayer && <span className="you-badge">YOU</span>}
                </div>
              ))}
            </div>
            <div className="team-col">
              <h3>Enemy Team</h3>
              {session.theirTeam.map((p) => (
                <div key={p.cellId} className="player-row enemy">
                  <span className="player-role">{p.assignedPosition || '?'}</span>
                  <span className="player-champ">
                    {p.championId > 0 ? p.championName : '—'}
                  </span>
                  {p.championId > 0 && (
                    <button
                      className="counter-btn"
                      onClick={() => setSelectedEnemy(p.championId)}
                      title="Show counters"
                    >
                      ⚔️
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {session.bans.myTeamBans.length > 0 && (
            <div className="bans-row">
              <span className="bans-label">Bans:</span>
              {[...session.bans.myTeamBans, ...session.bans.theirTeamBans].map((id, i) => {
                const champ = champions.find((c) => c.id === id);
                return (
                  <span key={i} className="ban-chip">
                    {champ?.name ?? `#${id}`}
                  </span>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Champion Detail Panel */}
      {selectedChampion && (
        <section className="champion-detail-panel">
          <div className="detail-header">
            <img
              src={champImgUrl(selectedChampion.image)}
              alt={selectedChampion.name}
              className="detail-avatar"
            />
            <div className="detail-title-block">
              <h2>{selectedChampion.name}</h2>
              <p className="detail-title">{selectedChampion.title}</p>
              <div className="detail-tags">
                {selectedChampion.tags.map((tag) => (
                  <span key={tag} className="tag-chip">{tag}</span>
                ))}
                {championsWithCounters.has(selectedChampion.id) && (
                  <span className="tag-chip tag-counter">⚔️ Has Counters</span>
                )}
              </div>
            </div>
            <button className="close-btn" onClick={() => { setSelectedChampion(null); setSelectedEnemy(null); }}>✕</button>
          </div>

          <div className="detail-body">
            <div className="detail-stats">
              <StatBar label="ATK" value={selectedChampion.info.attack} color="#f85149" />
              <StatBar label="DEF" value={selectedChampion.info.defense} color="#58a6ff" />
              <StatBar label="MAG" value={selectedChampion.info.magic} color="#a371f7" />
              <div className="stat-bar-row">
                <span className="stat-label">Difficulty</span>
                <DifficultyDots level={selectedChampion.info.difficulty} />
              </div>
            </div>

            <p className="detail-blurb">{selectedChampion.blurb}</p>

            {/* Counter section within detail */}
            {counters.length > 0 && (
              <div className="detail-counters">
                <h3>Counter Picks</h3>
                <div className="counter-list">
                  {counters.map((ct) => (
                    <div key={ct.championId} className="counter-card">
                      <img
                        src={champImgUrl(champions.find((c) => c.id === ct.championId)?.image ?? '')}
                        alt={ct.championName}
                        className="counter-img"
                      />
                      <div className="counter-info">
                        <div className="counter-name">
                          {ct.championName}
                          <span className="win-rate">{ct.winRate.toFixed(1)}% WR</span>
                        </div>
                        <p className="counter-tip">{ct.tip}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {counters.length === 0 && (
              <p className="no-data">No counter data available yet for this champion.</p>
            )}
          </div>
        </section>
      )}

      {/* Counter Tips Panel (standalone, when clicking from live session) */}
      {selectedEnemy !== null && !selectedChampion && (
        <section className="counter-panel">
          <div className="counter-header">
            <h2>
              Counters for {champions.find((c) => c.id === selectedEnemy)?.name ?? 'Unknown'}
            </h2>
            <button className="close-btn" onClick={() => setSelectedEnemy(null)}>✕</button>
          </div>
          {counters.length === 0 ? (
            <p className="no-data">No counter data available for this champion.</p>
          ) : (
            <div className="counter-list">
              {counters.map((ct) => (
                <div key={ct.championId} className="counter-card">
                  <img
                    src={champImgUrl(champions.find((c) => c.id === ct.championId)?.image ?? '')}
                    alt={ct.championName}
                    className="counter-img"
                  />
                  <div className="counter-info">
                    <div className="counter-name">
                      {ct.championName}
                      <span className="win-rate">{ct.winRate.toFixed(1)}% WR</span>
                    </div>
                    <p className="counter-tip">{ct.tip}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Champion Grid with Search + Role Filter */}
      <section className="champion-grid-section">
        <div className="grid-header">
          <h2>All Champions ({filteredChampions.length})</h2>
          <input
            type="text"
            className="search-input"
            placeholder="Search champion or role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Role Filter Tabs */}
        <div className="role-tabs">
          {ROLES.map((role) => (
            <button
              key={role}
              className={`role-tab ${activeRole === role ? 'active' : ''}`}
              onClick={() => setActiveRole(role)}
            >
              {role}
            </button>
          ))}
        </div>

        <div className="champion-grid">
          {filteredChampions.map((champ) => (
            <button
              key={champ.id}
              className={`champion-tile ${selectedChampion?.id === champ.id ? 'selected' : ''} ${championsWithCounters.has(champ.id) ? 'has-counter' : ''}`}
              onClick={() => handleChampionClick(champ)}
              title={`${champ.name} — ${champ.tags.join(', ')} | Difficulty: ${champ.info.difficulty}/10`}
            >
              <img src={champImgUrl(champ.image)} alt={champ.name} loading="lazy" />
              <span className="champ-name">{champ.name}</span>
              {championsWithCounters.has(champ.id) && <span className="counter-badge">⚔️</span>}
            </button>
          ))}
          {filteredChampions.length === 0 && (
            <p className="no-results">No champions match "{search}"</p>
          )}
        </div>
      </section>
    </div>
  );
}
