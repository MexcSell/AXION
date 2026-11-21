import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/exo-2';
import '@fontsource-variable/jetbrains-mono';
import './theme/tokens.css';
import './theme/base.css';
import './theme/shell.css';
import './theme/pages.css';
import './theme/touch.css';
import App from './App';
import { useUI } from './store/ui';
import { loadHelp } from './help/load';
import { loadDialogs } from './dialogs/DialogHost';
import { useData } from './store/data';
import './api/missionControl'; // api mode: getMissionControl answers from the server (Stage 6)

// Test hook for scripts/*.mjs. Always on in dev; in production builds only when localStorage 'axion.testhook' = '1'.
const hookOn = (() => { try { return import.meta.env.DEV || localStorage.getItem('axion.testhook') === '1'; } catch { return import.meta.env.DEV; } })();
if (hookOn) (window as unknown as { __axion: unknown }).__axion = { openDialog: useUI.getState().openDialog, closeAll: () => useUI.setState({ dialogs: [] }), helpKeys: async () => Object.keys((await loadHelp()).HELP), dialogIds: async () => Object.keys(await loadDialogs()), data: useData };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
