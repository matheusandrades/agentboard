import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getWSClient } from './lib/ws';
import { applyTheme, getInitialTheme } from './lib/theme';

// Apply theme before React mounts so there's no flash of the wrong mode.
applyTheme(getInitialTheme());

// Preview/demo bootstrap (957a6bce). When VITE_DEMO=true at build time, seed
// the store with representative data so launch_preview containers can show
// realistic UI without a backend. Skipped in normal builds.
if ((import.meta.env.VITE_DEMO as string | undefined) === 'true') {
  void import('./lib/demo-bootstrap').then((m) => m.bootstrapDemo());
}

// Kick off WS connection on module load so events start arriving even before
// the first component mounts. The store will subscribe on Layout mount.
getWSClient();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
