import { useEffect, useState } from 'react';

interface GameData {
  allPlayers: unknown[];
  activePlayer: unknown;
  gameStats: unknown;
  events: unknown;
}

/**
 * Overlay page — rendered in the transparent always-on-top BrowserWindow.
 * This is the root component for the in-game overlay.
 * Background is fully transparent; only UI elements are visible.
 */
export function OverlayPage(): JSX.Element {
  const [gameData, setGameData] = useState<GameData | null>(null);

  useEffect(() => {
    // Listen for game data pushed from main process
    const handler = (_event: unknown, data: GameData): void => {
      setGameData(data);
    };

    // @ts-expect-error -- overlay IPC not yet typed in preload
    const off = window.api?.overlay?.onGameData?.(handler);
    return () => { off?.(); };
  }, []);

  if (!gameData) {
    return (
      <div className="overlay-root overlay-root--loading">
        <div className="overlay-badge">Waiting for game data...</div>
      </div>
    );
  }

  return (
    <div className="overlay-root">
      {/* Top-right: Enemy spells tracker */}
      <div className="overlay-panel overlay-panel--top-right">
        <div className="overlay-badge">Enemy Spells</div>
        <p className="overlay-hint">Spell tracking coming soon</p>
      </div>

      {/* Left: Counter tips */}
      <div className="overlay-panel overlay-panel--left">
        <div className="overlay-badge">Counter Tips</div>
        <p className="overlay-hint">Tips will appear here</p>
      </div>

      {/* Bottom-right: Build suggestion */}
      <div className="overlay-panel overlay-panel--bottom-right">
        <div className="overlay-badge">Build Path</div>
        <p className="overlay-hint">Item suggestions coming soon</p>
      </div>

      {/* Bottom-left: Minimap info */}
      <div className="overlay-panel overlay-panel--bottom-left">
        <div className="overlay-badge">Map Info</div>
        <p className="overlay-hint">Jungle timers coming soon</p>
      </div>
    </div>
  );
}
