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
