import { useEffect, useState, useMemo, useRef } from 'react';
import type { AutoRankedSettings, AutoRankedState, ChampionInfo } from '../../../shared/ipc';

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

/* ─── Champion Search Select ─── */
function ChampionSelect({
  champions,
  selectedIds,
  onChange,
  placeholder,
  ddragonVersion
}: {
  champions: ChampionInfo[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder: string;
  ddragonVersion: string;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return champions;
    const q = search.toLowerCase();
    return champions.filter((c) => c.name.toLowerCase().includes(q));
  }, [champions, search]);

  const selectedChamps = useMemo(
    () => selectedIds.map((id) => champions.find((c) => c.id === id)).filter(Boolean) as ChampionInfo[],
    [selectedIds, champions]
  );

  const addChampion = (champ: ChampionInfo): void => {
    if (!selectedIds.includes(champ.id)) {
      onChange([...selectedIds, champ.id]);
    }
    setSearch('');
    setOpen(false);
  };

  const removeChampion = (id: number): void => {
    onChange(selectedIds.filter((cid) => cid !== id));
  };

  const getIcon = (champ: ChampionInfo): string =>
    `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champ.image}`;

  return (
    <div className="champ-select" ref={ref}>
      {/* Selected tags */}
      <div className="champ-select__tags">
        {selectedChamps.map((c) => (
          <span key={c.id} className="champ-select__tag">
            <img src={getIcon(c)} alt={c.name} className="champ-select__tag-img" />
            {c.name}
            <button
              type="button"
              className="champ-select__tag-remove"
              onClick={() => removeChampion(c.id)}
              aria-label={`Remove ${c.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="champ-select__input"
          placeholder={selectedIds.length === 0 ? placeholder : ''}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>

      {/* Dropdown */}
      {open && (
        <ul className="champ-select__dropdown">
          {filtered.length === 0 && <li className="champ-select__empty">No champions found</li>}
          {filtered.slice(0, 30).map((c) => (
            <li
              key={c.id}
              className={`champ-select__option ${selectedIds.includes(c.id) ? 'champ-select__option--selected' : ''}`}
              onMouseDown={() => addChampion(c)}
            >
              <img src={getIcon(c)} alt={c.name} className="champ-select__option-img" />
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export function AutoRankedPage(): JSX.Element {
  const [settings, setSettings] = useState<AutoRankedSettings | null>(null);
  const [state, setState] = useState<AutoRankedState>({ step: 'idle', message: '' });
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [ddragonVersion, setDdragonVersion] = useState('14.10.1');

  useEffect(() => {
    window.api.autoRanked.getSettings().then((res) => {
      if (res.ok) setSettings(res.data);
    });
    window.api.autoRanked.getState().then((res) => {
      if (res.ok) setState(res.data);
    });
    // Load champion list from existing championPicker module
    window.api.championPicker.getChampions().then((res) => {
      if (res.ok) {
        setChampions(res.data.champions);
        setDdragonVersion(res.data.ddragonVersion);
      }
    });
    const unsub = window.api.autoRanked.onStateChanged(setState);
    return unsub;
  }, []);

  const updateSettings = (patch: Partial<AutoRankedSettings>): void => {
    window.api.autoRanked.setSettings(patch).then((res) => {
      if (res.ok) setSettings(res.data);
    });
  };

  const handleStartQueue = (): void => {
    window.api.autoRanked.startQueue();
  };

  if (!settings) return <div className="page-loading">Loading...</div>;

  return (
    <div className="auto-ranked">
      <h2 className="page-title">🏆 Auto Ranked</h2>

      {/* Status indicator */}
      <div className={`ar-status ar-status--${state.step === 'error' ? 'error' : state.step === 'idle' ? 'idle' : 'active'}`}>
        <span className="ar-status__step">{state.step}</span>
        {state.message && <span className="ar-status__msg">{state.message}</span>}
      </div>

      {/* Enable toggle */}
      <label className="toggle-row">
        <span>Enable Auto Ranked</span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => updateSettings({ enabled: e.target.checked })}
        />
      </label>

      {/* Role selection */}
      <fieldset className="ar-fieldset" disabled={!settings.enabled}>
        <legend>Roles</legend>
        <div className="ar-roles">
          <label>
            Primary
            <select
              value={settings.primaryRole}
              onChange={(e) => updateSettings({ primaryRole: e.target.value })}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>
            Secondary
            <select
              value={settings.secondaryRole}
              onChange={(e) => updateSettings({ secondaryRole: e.target.value })}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      {/* Ban Champions */}
      <fieldset className="ar-fieldset" disabled={!settings.enabled}>
        <legend>Ban Champions (priority order)</legend>
        <ChampionSelect
          champions={champions}
          selectedIds={settings.banChampionIds}
          onChange={(ids) => updateSettings({ banChampionIds: ids })}
          placeholder="Search champion to ban..."
          ddragonVersion={ddragonVersion}
        />
      </fieldset>

      {/* Pick Champions */}
      <fieldset className="ar-fieldset" disabled={!settings.enabled}>
        <legend>Pick Champions (priority order)</legend>
        <ChampionSelect
          champions={champions}
          selectedIds={settings.pickChampionIds}
          onChange={(ids) => updateSettings({ pickChampionIds: ids })}
          placeholder="Search champion to pick..."
          ddragonVersion={ddragonVersion}
        />
      </fieldset>

      {/* Start Queue button */}
      <button
        className="ar-btn ar-btn--start"
        disabled={!settings.enabled}
        onClick={handleStartQueue}
      >
        🚀 Start Queue
      </button>
    </div>
  );
}

export default AutoRankedPage;
