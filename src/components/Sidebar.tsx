import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Auto-Accept', icon: '⚡' },
  { to: '/auto-ranked', label: 'Auto Ranked', icon: '🏆' },
  { to: '/champion-picker', label: 'Champion Picker', icon: '🎯' },
  { to: '/enemy-tracker', label: 'Enemy Tracker', icon: '👁️' },
  { to: '/match-history', label: 'Match History', icon: '📊' },
  { to: '/build-importer', label: 'Build Importer', icon: '🔧' },
  { to: '/overlay-settings', label: 'Overlay', icon: '🖥️' }
];

export function Sidebar(): JSX.Element {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <ul className="sidebar__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
              }
            >
              <span className="sidebar__icon" aria-hidden>
                {item.icon}
              </span>
              <span className="sidebar__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
