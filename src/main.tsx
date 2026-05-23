import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { App } from './app/App';
import { AutoAcceptPanel } from './features/autoAccept/AutoAcceptPanel';
import ChampionPickerPage from './features/championPicker/ChampionPickerPage';
import { MatchHistoryPage } from './features/matchHistory/MatchHistoryPage';
import { BuildImporterPage } from './features/buildImporter/BuildImporterPage';
import { AutoRankedPage } from './features/autoRanked/AutoRankedPage';
import { OverlayPage } from './features/overlay/OverlayPage';
import { EnemyTrackerPage } from './features/enemyTracker/EnemyTrackerPage';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<AutoAcceptPanel />} />
          <Route path="auto-ranked" element={<AutoRankedPage />} />
          <Route path="champion-picker" element={<ChampionPickerPage />} />
          <Route path="match-history" element={<MatchHistoryPage />} />
          <Route path="build-importer" element={<BuildImporterPage />} />
          <Route path="enemy-tracker" element={<EnemyTrackerPage />} />
        </Route>
        {/* Overlay route — rendered in separate transparent BrowserWindow */}
        <Route path="overlay" element={<OverlayPage />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
