import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getWSClient } from './lib/ws';
import { applyTheme, getInitialTheme } from './lib/theme';

// Apply theme before React mounts so there's no flash of the wrong mode.
applyTheme(getInitialTheme());

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
